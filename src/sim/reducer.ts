import { produce } from "immer";
import { originById, speciesById, traitById } from "./content";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { assignStarterSystem, generateGalaxy } from "./galaxy";
import { mulberry32, nextSeed } from "./rng";
import type {
  Body,
  GameState,
  HabitabilityTier,
  Resources,
  ResourceKey,
} from "./types";

export type Action =
  | { type: "newGame"; empireName: string; originId: string; speciesId: string; seed: number }
  | { type: "endTurn" }
  | { type: "resolveEvent"; eventId: string; choiceId: string }
  | { type: "queueColonize"; targetBodyId: string }
  | { type: "cancelOrder"; orderId: string };

// Colonization tunables.
export const COLONIZE_HAMMERS = 20;
export const COLONIZE_POLITICAL = 5;
export const COLONIZE_STARTER_POPS = 1;

let orderCounter = 0;
function nextOrderId(): string {
  orderCounter += 1;
  return `order_${orderCounter}_${Math.floor(Math.random() * 1e6)}`;
}

const EMPTY_RESOURCES: Resources = {
  food: 0,
  energy: 0,
  alloys: 0,
  political: 0,
};

// Oversized grid with a disc shape carved out of it by the generator.
export const GALAXY_SIZE = { width: 11, height: 9, density: 0.85 };

// Per-pop production by habitability. Gardens farm, hellscapes mine.
// Net of food consumption: every pop also eats 1 food/turn (applied once at empire level).
const PER_POP_BY_HAB: Record<HabitabilityTier, Partial<Record<ResourceKey, number>>> = {
  garden:    { food: 2, energy: 1, alloys: 0 },
  temperate: { food: 1, energy: 1, alloys: 1 },
  harsh:     { food: 0, energy: 1, alloys: 2 },
  hellscape: { food: -1, energy: 1, alloys: 3 },
};

// Flat per-pop hammers (production flow, resets each turn).
const HAMMERS_PER_POP = 1;

// Flat per-body passive compute (stand-in for future data-center buildings).
const COMPUTE_PER_BODY = 1;

// Food cost to spawn one new pop via natural growth.
const POP_GROWTH_FOOD_COST = 5;

export function initialState(): GameState {
  return {
    schemaVersion: 5,
    turn: 0,
    rngSeed: 0,
    galaxy: { systems: {}, bodies: {}, hyperlanes: [], width: 0, height: 0 },
    empire: {
      id: "empire_player",
      name: "",
      originId: "",
      speciesId: "",
      color: "#7ec8ff",
      resources: { ...EMPTY_RESOURCES },
      compute: { cap: 0, used: 0 },
      capitalBodyId: null,
      systemIds: [],
      projects: [],
      flags: [],
    },
    eventQueue: [],
    eventLog: [],
    gameOver: false,
  };
}

// True if `systemId` shares a hyperlane with any system the empire owns.
// Used to gate colonization targets to the "frontier".
export function isSystemAdjacentToEmpire(state: GameState, systemId: string): boolean {
  const owned = new Set(state.empire.systemIds);
  if (owned.has(systemId)) return false;
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (a === systemId && owned.has(b)) return true;
    if (b === systemId && owned.has(a)) return true;
  }
  return false;
}

export function colonizeOrderForTarget(state: GameState, targetBodyId: string) {
  for (const order of state.empire.projects) {
    if (order.kind === "colonize" && order.targetBodyId === targetBodyId) return order;
  }
  return null;
}

// Can `target` body be colonized by the player right now?
// - Target's system must not already be owned.
// - Target's system must be hyperlane-adjacent to an owned system.
// - No existing empire project already targets this body.
export function canColonize(state: GameState, targetBodyId: string): boolean {
  const target = state.galaxy.bodies[targetBodyId];
  if (!target) return false;
  const targetSys = state.galaxy.systems[target.systemId];
  if (!targetSys) return false;
  if (targetSys.ownerId) return false;
  if (!isSystemAdjacentToEmpire(state, targetSys.id)) return false;
  if (colonizeOrderForTarget(state, targetBodyId)) return false;
  return true;
}

export function ownedBodies(state: GameState): Body[] {
  const out: Body[] = [];
  for (const sid of state.empire.systemIds) {
    const sys = state.galaxy.systems[sid];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const b = state.galaxy.bodies[bid];
      if (b) out.push(b);
    }
  }
  return out;
}

export function totalPops(state: GameState): number {
  return ownedBodies(state).reduce((s, b) => s + b.pops, 0);
}

function traitBonusPerPop(state: GameState): Partial<Record<ResourceKey, number>> {
  const species = speciesById(state.empire.speciesId);
  if (!species) return {};
  const bonus: Partial<Record<ResourceKey, number>> = {};
  for (const tid of species.traitIds) {
    const t = traitById(tid);
    if (!t) continue;
    for (const k of RESOURCE_KEYS) {
      bonus[k] = (bonus[k] ?? 0) + (t.modifiers[k] ?? 0);
    }
  }
  return bonus;
}

// Per-body raw production (no empire-level upkeep or flat bonuses).
export function bodyIncome(state: GameState, body: Body): Resources {
  const traitBonus = traitBonusPerPop(state);
  const base = PER_POP_BY_HAB[body.habitability];
  const out: Resources = { ...EMPTY_RESOURCES };
  for (const k of RESOURCE_KEYS) {
    out[k] = ((base[k] ?? 0) + (traitBonus[k] ?? 0)) * body.pops;
  }
  return out;
}

export function perTurnIncome(state: GameState): Resources {
  const income: Resources = { ...EMPTY_RESOURCES };
  for (const body of ownedBodies(state)) {
    const contrib = bodyIncome(state, body);
    for (const k of RESOURCE_KEYS) income[k] += contrib[k];
  }
  // Empire-level food upkeep: 1 per pop.
  income.food -= totalPops(state);
  // Baseline political capital tick.
  income.political += 1;
  return income;
}

export function computeCap(state: GameState): number {
  return ownedBodies(state).length * COMPUTE_PER_BODY;
}

// Applied inside an immer draft when a BuildOrder finishes. Order-specific
// side effects (ownership flip, resource deduction, chronicle entry) live here.
function completeOrder(draft: GameState, order: import("./types").BuildOrder): void {
  if (order.kind === "colonize") {
    const target = draft.galaxy.bodies[order.targetBodyId];
    if (!target) return;
    const targetSys = draft.galaxy.systems[target.systemId];
    if (!targetSys) return;
    // Pre-empt check: if someone else grabbed it while we were building, bail.
    if (targetSys.ownerId && targetSys.ownerId !== draft.empire.id) return;
    draft.empire.resources.political -= order.politicalCost;
    targetSys.ownerId = draft.empire.id;
    if (!draft.empire.systemIds.includes(targetSys.id)) {
      draft.empire.systemIds.push(targetSys.id);
    }
    target.pops = Math.max(target.pops, COLONIZE_STARTER_POPS);
    draft.eventLog.push({
      turn: draft.turn,
      eventId: "colonize",
      choiceId: null,
      text: `Colonized ${target.name} in ${targetSys.name}.`,
    });
  }
}

// Simple logistic-ish growth: more headroom => more likely to grow this turn.
// Gated on food availability to avoid growth during famine.
function tryGrowPops(state: GameState, rand: () => number): GameState {
  return produce(state, (draft) => {
    for (const sid of draft.empire.systemIds) {
      const sys = draft.galaxy.systems[sid];
      if (!sys) continue;
      for (const bid of sys.bodyIds) {
        const body = draft.galaxy.bodies[bid];
        if (!body || body.pops >= body.space) continue;
        if (draft.empire.resources.food < POP_GROWTH_FOOD_COST) continue;
        const headroom = (body.space - body.pops) / body.space;
        const chance = headroom * 0.5;
        if (rand() < chance) {
          body.pops += 1;
          draft.empire.resources.food -= POP_GROWTH_FOOD_COST;
        }
      }
    }
  });
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
        const species = speciesById(action.speciesId);
        if (species) draft.empire.color = species.color;
        draft.empire.capitalBodyId = starter.capitalBodyId;
        draft.empire.systemIds = [starter.systemId];
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] = origin.startingResources[key] ?? 0;
        }
        // Seed compute cap + per-body hammers for turn 1.
        draft.empire.compute.cap = starter.galaxy.systems[starter.systemId].bodyIds.length * COMPUTE_PER_BODY;
        draft.empire.compute.used = 0;
        for (const bid of starter.galaxy.systems[starter.systemId].bodyIds) {
          const body = draft.galaxy.bodies[bid];
          if (body) body.hammers = body.pops * HAMMERS_PER_POP;
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

    case "queueColonize": {
      if (!canColonize(state, action.targetBodyId)) return state;
      return produce(state, (draft) => {
        draft.empire.projects.push({
          kind: "colonize",
          id: nextOrderId(),
          targetBodyId: action.targetBodyId,
          hammersRequired: COLONIZE_HAMMERS,
          hammersPaid: 0,
          politicalCost: COLONIZE_POLITICAL,
        });
      });
    }

    case "cancelOrder": {
      return produce(state, (draft) => {
        draft.empire.projects = draft.empire.projects.filter((o) => o.id !== action.orderId);
      });
    }

    case "endTurn": {
      if (state.eventQueue.length > 0) return state;

      // 1. Accumulate stock resources (food/energy/alloys/political).
      const income = perTurnIncome(state);
      let next = produce(state, (draft) => {
        draft.turn += 1;
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] += income[key];
        }
        // 2. Reset flow resources.
        draft.empire.compute.cap = computeCap(draft);
        draft.empire.compute.used = 0;
        for (const body of ownedBodies(draft)) {
          const live = draft.galaxy.bodies[body.id];
          if (live) live.hammers = live.pops * HAMMERS_PER_POP;
        }
        // 3. Sum all empire hammers, drain them FIFO into empire-level
        //    projects. Unused hammers this turn are lost (flow-not-stock).
        let pool = 0;
        for (const sid of draft.empire.systemIds) {
          const sys = draft.galaxy.systems[sid];
          if (!sys) continue;
          for (const bid of sys.bodyIds) {
            const body = draft.galaxy.bodies[bid];
            if (!body) continue;
            pool += body.hammers;
            body.hammers = 0;
          }
        }
        while (pool > 0 && draft.empire.projects.length > 0) {
          const order = draft.empire.projects[0];
          const need = order.hammersRequired - order.hammersPaid;
          const spent = Math.min(pool, need);
          order.hammersPaid += spent;
          pool -= spent;
          if (order.hammersPaid >= order.hammersRequired) {
            completeOrder(draft, order);
            draft.empire.projects.shift();
          } else {
            break;
          }
        }
        draft.rngSeed = nextSeed(draft.rngSeed);
      });

      // 4. Pop growth (uses seeded RNG — deterministic per turn).
      const growthRand = mulberry32(next.rngSeed ^ 0xa5a5a5a5);
      next = tryGrowPops(next, growthRand);

      // 4. Roll a random event (same as before).
      const rand = mulberry32(next.rngSeed);
      if (rand() < 0.55) {
        const event = pickRandomEvent(next, next.rngSeed);
        if (event) {
          next = produce(next, (draft) => {
            draft.eventQueue.push({ eventId: event.id, seed: next.rngSeed });
          });
        }
      }
      return next;
    }
  }
}
