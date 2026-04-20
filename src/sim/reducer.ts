import { produce } from "immer";
import { originById, speciesById, traitById } from "./content";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { assignStarterSystem, generateGalaxy } from "./galaxy";
import { mulberry32, nextSeed } from "./rng";
import type { GameState, Resources, ResourceKey } from "./types";

export type Action =
  | { type: "newGame"; empireName: string; originId: string; speciesId: string; seed: number }
  | { type: "endTurn" }
  | { type: "resolveEvent"; eventId: string; choiceId: string };

const EMPTY_RESOURCES: Resources = {
  food: 0,
  energy: 0,
  alloys: 0,
  influence: 0,
};

export const GALAXY_SIZE = { width: 9, height: 6, density: 0.75 };

export function initialState(): GameState {
  return {
    schemaVersion: 3,
    turn: 0,
    rngSeed: 0,
    galaxy: { systems: {}, bodies: {}, width: 0, height: 0 },
    empire: {
      id: "empire_player",
      name: "",
      originId: "",
      speciesId: "",
      resources: { ...EMPTY_RESOURCES },
      compute: { cap: 0, used: 0 },
      capitalBodyId: null,
      systemIds: [],
      flags: [],
    },
    eventQueue: [],
    eventLog: [],
    gameOver: false,
  };
}

export function totalPops(state: GameState): number {
  let sum = 0;
  for (const id of Object.keys(state.galaxy.bodies)) {
    const body = state.galaxy.bodies[id];
    if (state.galaxy.systems[body.systemId]?.ownerId === state.empire.id) {
      sum += body.pops;
    }
  }
  return sum;
}

function perTurnIncome(state: GameState): Resources {
  const species = speciesById(state.empire.speciesId);
  const pops = totalPops(state);
  const income: Resources = { ...EMPTY_RESOURCES };
  const perPop: Partial<Record<ResourceKey, number>> = {
    energy: 1,
    alloys: 1,
    food: 1,
  };
  for (const key of RESOURCE_KEYS) {
    income[key] = (perPop[key] ?? 0) * pops;
  }
  if (species) {
    for (const traitId of species.traitIds) {
      const trait = traitById(traitId);
      if (!trait) continue;
      for (const key of RESOURCE_KEYS) {
        income[key] += (trait.modifiers[key] ?? 0) * pops;
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

      const fresh = initialState();
      const galaxy = generateGalaxy({ ...GALAXY_SIZE, seed: action.seed });
      const starter = assignStarterSystem(
        galaxy,
        fresh.empire.id,
        origin.startingPops,
        action.seed ^ 0x9e3779b1,
      );

      return produce(fresh, (draft) => {
        draft.turn = 1;
        draft.rngSeed = action.seed >>> 0;
        draft.galaxy = starter.galaxy;
        draft.empire.name = action.empireName || "Unnamed Empire";
        draft.empire.originId = action.originId;
        draft.empire.speciesId = action.speciesId;
        draft.empire.capitalBodyId = starter.capitalBodyId;
        draft.empire.systemIds = [starter.systemId];
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
