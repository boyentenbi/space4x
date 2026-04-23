import { produce } from "immer";
import { eventById, EVENTS } from "./content";
import { mulberry32 } from "./rng";
import type { Condition, Effect, Empire, GameEvent, GameState, ResourceKey } from "./types";

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
