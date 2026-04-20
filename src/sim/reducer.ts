import { produce } from "immer";
import { originById, speciesById, traitById } from "./content";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { mulberry32, nextSeed } from "./rng";
import type { GameState, Resources, ResourceKey } from "./types";

export type Action =
  | { type: "newGame"; empireName: string; originId: string; speciesId: string; seed: number }
  | { type: "endTurn" }
  | { type: "resolveEvent"; eventId: string; choiceId: string };

const EMPTY_RESOURCES: Resources = {
  energy: 0,
  minerals: 0,
  food: 0,
  influence: 0,
  research: 0,
};

export function initialState(): GameState {
  return {
    schemaVersion: 2,
    turn: 0,
    rngSeed: 0,
    empire: {
      name: "",
      originId: "",
      speciesId: "",
      resources: { ...EMPTY_RESOURCES },
      pops: 0,
      flags: [],
    },
    eventQueue: [],
    eventLog: [],
    gameOver: false,
  };
}

function perTurnIncome(state: GameState): Resources {
  const species = speciesById(state.empire.speciesId);
  const income: Resources = { ...EMPTY_RESOURCES };
  const perPop: Partial<Record<ResourceKey, number>> = {
    energy: 1,
    minerals: 1,
    food: 1,
    research: 0.5,
  };
  for (const key of RESOURCE_KEYS) {
    income[key] = (perPop[key] ?? 0) * state.empire.pops;
  }
  if (species) {
    for (const traitId of species.traitIds) {
      const trait = traitById(traitId);
      if (!trait) continue;
      for (const key of RESOURCE_KEYS) {
        income[key] += (trait.modifiers[key] ?? 0) * state.empire.pops;
      }
    }
  }
  income.influence += 1;
  return income;
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "newGame": {
      const origin = originById(action.originId);
      if (!origin) return state;
      return produce(initialState(), (draft) => {
        draft.turn = 1;
        draft.rngSeed = action.seed >>> 0;
        draft.empire.name = action.empireName || "Unnamed Empire";
        draft.empire.originId = action.originId;
        draft.empire.speciesId = action.speciesId;
        draft.empire.pops = origin.startingPops;
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] = origin.startingResources[key] ?? 0;
        }
        if (origin.flagEvents) {
          for (const eventId of origin.flagEvents) {
            draft.eventQueue.push({ eventId, seed: action.seed });
          }
        }
      });
    }

    case "resolveEvent":
      return resolveEventChoice(state, action.eventId, action.choiceId);

    case "endTurn": {
      if (state.eventQueue.length > 0) return state;
      const income = perTurnIncome(state);
      const withIncome = produce(state, (draft) => {
        draft.turn += 1;
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] += income[key];
        }
        draft.rngSeed = nextSeed(draft.rngSeed);
      });
      const rand = mulberry32(withIncome.rngSeed);
      const eventRoll = rand();
      if (eventRoll < 0.55) {
        const event = pickRandomEvent(withIncome, withIncome.rngSeed);
        if (event) {
          return produce(withIncome, (draft) => {
            draft.eventQueue.push({ eventId: event.id, seed: withIncome.rngSeed });
          });
        }
      }
      return withIncome;
    }
  }
}
