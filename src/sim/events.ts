import { produce } from "immer";
import { eventById, EVENTS } from "./content";
import { mulberry32 } from "./rng";
import type { Body, Condition, Effect, Empire, Fleet, GameEvent, GameState, ResourceKey } from "./types";

const RESOURCE_KEYS: ResourceKey[] = ["food", "energy", "political"];

// Local helper to avoid a circular import on reducer.ts. Events are
// fundamentally for the human empire — there's no eventQueue per AI.
function human(state: GameState): Empire | null {
  if (!state.humanEmpireId) return null;
  return state.empires.find((e) => e.id === state.humanEmpireId) ?? null;
}

export function conditionMet(state: GameState, cond: Condition): boolean {
  const player = human(state);
  if (!player) return false;
  switch (cond.kind) {
    case "hasFlag":
      return player.flags.includes(cond.flag);
    case "lacksFlag":
      return !player.flags.includes(cond.flag);
    case "minResource":
      return player[cond.resource] >= cond.value;
    case "originIs":
      return player.originId === cond.originId;
    case "turnAtLeast":
      return state.turn >= cond.value;
    case "popsAtCapitalAtLeast": {
      if (!player.capitalBodyId) return false;
      const cap = state.galaxy.bodies[player.capitalBodyId];
      if (!cap) return false;
      return cap.pops >= cond.value;
    }
    case "featureCountAtLeast": {
      let count = 0;
      for (const sid of player.systemIds) {
        const sys = state.galaxy.systems[sid];
        if (!sys) continue;
        for (const bid of sys.bodyIds) {
          const b = state.galaxy.bodies[bid];
          if (b && b.features.includes(cond.featureId)) count++;
        }
      }
      return count >= cond.value;
    }
    case "foodBelow":
      return player.food < cond.value;
  }
}

export function eventEligible(state: GameState, event: GameEvent): boolean {
  if (!event.requires || event.requires.length === 0) return true;
  return event.requires.every((c) => conditionMet(state, c));
}

export function pickRandomEvent(state: GameState, seed: number): GameEvent | null {
  const already = new Set(state.eventLog.map((e) => e.eventId));
  const pool = EVENTS.filter(
    (e) => !already.has(e.id) && eventEligible(state, e),
  );
  if (pool.length === 0) return null;
  const rand = mulberry32(seed);
  const totalWeight = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  let roll = rand() * totalWeight;
  for (const e of pool) {
    roll -= e.weight ?? 1;
    if (roll <= 0) return e;
  }
  return pool[pool.length - 1];
}

// Find the player's capital system id, or null. Used by effects
// that target "at the capital" — ships, defenders, features.
function capitalSystemId(state: GameState, player: Empire): string | null {
  if (!player.capitalBodyId) return null;
  const cap = state.galaxy.bodies[player.capitalBodyId];
  return cap?.systemId ?? null;
}

// Inline copy of reducer.spawnShipsInSystem — events.ts can't import
// reducer (that way lies a circular dep). Same rule: merge into an
// existing stationary fleet at the system, else create a fresh one.
// Fleet id counter — local, incremented per call, and prefixed with
// `ev_` so these can't collide with reducer-minted fleet ids.
let evFleetCounter = 0;
function spawnShipsEvent(draft: GameState, empireId: string, systemId: string, count: number): void {
  if (count <= 0) return;
  for (const f of Object.values(draft.fleets) as Fleet[]) {
    if (f.empireId === empireId && f.systemId === systemId && !f.destinationSystemId) {
      f.shipCount += count;
      return;
    }
  }
  evFleetCounter += 1;
  const id = `ev_${draft.turn}_${evFleetCounter}`;
  draft.fleets[id] = { id, empireId, systemId, shipCount: count };
}

// Pick a second body to host a feature: the most-populated owned
// body that isn't the capital and doesn't already have the feature.
// Returns null when no eligible body exists.
function pickSecondFeatureHost(state: GameState, player: Empire, featureId: string): Body | null {
  let best: Body | null = null;
  for (const sid of player.systemIds) {
    const sys = state.galaxy.systems[sid];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const b = state.galaxy.bodies[bid];
      if (!b) continue;
      if (b.id === player.capitalBodyId) continue;
      if (b.kind === "star") continue;
      if (b.features.includes(featureId)) continue;
      if (b.pops <= 0) continue;
      if (!best || b.pops > best.pops) best = b;
    }
  }
  return best;
}

export function applyEffect(state: GameState, effect: Effect): GameState {
  return produce(state, (draft) => {
    const player = human(draft);
    if (!player) return;
    switch (effect.kind) {
      case "addResource": {
        player[effect.resource] += effect.value;
        break;
      }
      case "addPops": {
        const capitalId = player.capitalBodyId;
        if (capitalId && draft.galaxy.bodies[capitalId]) {
          const body = draft.galaxy.bodies[capitalId];
          body.pops = Math.min(body.maxPops, body.pops + effect.value);
        }
        break;
      }
      case "addFlag":
        if (!player.flags.includes(effect.flag)) {
          player.flags.push(effect.flag);
        }
        break;
      case "removeFlag":
        player.flags = player.flags.filter((f) => f !== effect.flag);
        break;
      case "logText":
        break;
      case "addShips": {
        const sysId = capitalSystemId(draft, player);
        if (sysId) spawnShipsEvent(draft, player.id, sysId, effect.value);
        break;
      }
      case "addDefenders": {
        const sysId = capitalSystemId(draft, player);
        if (!sysId) break;
        const sys = draft.galaxy.systems[sysId];
        if (!sys) break;
        sys.defenders = (sys.defenders ?? 0) + effect.value;
        break;
      }
      case "grantFeatureOnCapital": {
        if (!player.capitalBodyId) break;
        const cap = draft.galaxy.bodies[player.capitalBodyId];
        if (!cap) break;
        if (!cap.features.includes(effect.featureId)) cap.features.push(effect.featureId);
        break;
      }
      case "removeFeatureFromCapital": {
        if (!player.capitalBodyId) break;
        const cap = draft.galaxy.bodies[player.capitalBodyId];
        if (!cap) break;
        cap.features = cap.features.filter((f) => f !== effect.featureId);
        break;
      }
      case "grantFeatureOnSecondBody": {
        const host = pickSecondFeatureHost(draft, player, effect.featureId);
        if (!host) break;
        // `host` was read from the snapshot state; index into draft
        // to get a mutable proxy.
        const target = draft.galaxy.bodies[host.id];
        if (target && !target.features.includes(effect.featureId)) {
          target.features.push(effect.featureId);
        }
        break;
      }
      case "grantStoryModifier": {
        // Overwrite (not append) if the key already exists — events
        // that re-fire with the same key are re-stating, not stacking.
        player.storyModifiers[effect.key] = [...effect.modifiers];
        if (effect.durationTurns !== undefined && effect.durationTurns > 0) {
          if (!player.storyModifierExpiries) player.storyModifierExpiries = {};
          player.storyModifierExpiries[effect.key] = draft.turn + effect.durationTurns;
        } else if (player.storyModifierExpiries?.[effect.key]) {
          // Re-granting permanently — drop any existing expiry.
          delete player.storyModifierExpiries[effect.key];
        }
        break;
      }
      case "liftStoryModifier": {
        delete player.storyModifiers[effect.key];
        if (player.storyModifierExpiries) {
          delete player.storyModifierExpiries[effect.key];
        }
        break;
      }
    }
  });
}

export function resolveEventChoice(
  state: GameState,
  eventId: string,
  choiceId: string,
): GameState {
  const event = eventById(eventId);
  if (!event) return state;
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) return state;

  let next = state;
  for (const effect of choice.effects) {
    next = applyEffect(next, effect);
  }

  const logLine = choice.effects.find((e): e is Extract<Effect, { kind: "logText" }> => e.kind === "logText");
  return produce(next, (draft) => {
    draft.eventQueue = draft.eventQueue.filter((e) => e.eventId !== eventId);
    draft.eventLog.push({
      turn: draft.turn,
      eventId,
      choiceId,
      text: logLine?.text ?? choice.text,
    });
  });
}

export { RESOURCE_KEYS };
