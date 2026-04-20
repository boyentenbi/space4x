import { produce } from "immer";
import { eventById, EVENTS } from "./content";
import { mulberry32 } from "./rng";
import type { Condition, Effect, GameEvent, GameState, ResourceKey } from "./types";

const RESOURCE_KEYS: ResourceKey[] = ["energy", "minerals", "food", "influence", "research"];

export function conditionMet(state: GameState, cond: Condition): boolean {
  switch (cond.kind) {
    case "hasFlag":
      return state.empire.flags.includes(cond.flag);
    case "lacksFlag":
      return !state.empire.flags.includes(cond.flag);
    case "minResource":
      return (state.empire.resources[cond.resource] ?? 0) >= cond.value;
    case "originIs":
      return state.empire.originId === cond.originId;
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
    switch (effect.kind) {
      case "addResource":
        draft.empire.resources[effect.resource] =
          (draft.empire.resources[effect.resource] ?? 0) + effect.value;
        break;
      case "addPops":
        draft.empire.pops += effect.value;
        break;
      case "addFlag":
        if (!draft.empire.flags.includes(effect.flag)) {
          draft.empire.flags.push(effect.flag);
        }
        break;
      case "removeFlag":
        draft.empire.flags = draft.empire.flags.filter((f) => f !== effect.flag);
        break;
      case "logText":
        // Log text is attached when the choice resolves; no-op here.
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
