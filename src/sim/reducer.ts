import { produce } from "immer";
import { originById, speciesById, traitById } from "./content";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { generateGalaxy } from "./galaxy";
import { mulberry32, nextSeed } from "./rng";
import type {
  Body,
  BuildOrder,
  Empire,
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

export const GALAXY_SIZE = { width: 11, height: 9, density: 0.85 };

const PER_POP_BY_HAB: Record<HabitabilityTier, Partial<Record<ResourceKey, number>>> = {
  garden:    { food: 2, energy: 1, alloys: 0 },
  temperate: { food: 1, energy: 1, alloys: 1 },
  harsh:     { food: 0, energy: 1, alloys: 2 },
  hellscape: { food: -1, energy: 1, alloys: 3 },
};

const HAB_COLONIZE_SCORE: Record<HabitabilityTier, number> = {
  garden: 4,
  temperate: 3,
  harsh: 2,
  hellscape: 1,
};

export const HAMMERS_PER_POP = 1;
const COMPUTE_PER_BODY = 1;
export const POP_GROWTH_FOOD_COST = 5;

// Expected turns until this body grows by +1 pop, or a status string.
// Matches the actual growth roll: chance = headroom * 0.5 each turn,
// so expected wait = 1/chance (rounded up). Gated on empire food.
export function growthEstimate(
  _state: GameState,
  empire: Empire,
  body: Body,
): { kind: "full" } | { kind: "starved" } | { kind: "growing"; turns: number } {
  if (body.pops >= body.space) return { kind: "full" };
  if (empire.resources.food < POP_GROWTH_FOOD_COST) return { kind: "starved" };
  const headroom = (body.space - body.pops) / body.space;
  const chance = headroom * 0.5;
  if (chance <= 0) return { kind: "full" };
  return { kind: "growing", turns: Math.ceil(1 / chance) };
}

// ===== AI empire setup =====
interface AiSpec {
  id: string;
  name: string;
  color: string;
  speciesId: string;
  originId: string;
}

const AI_SPECS: AiSpec[] = [
  {
    id: "empire_ai_0",
    name: "Kepler Directive",
    color: "#d88a3a",
    speciesId: "insectoid",
    originId: "steady_evolution",
  },
  {
    id: "empire_ai_1",
    name: "Orvak Verdance",
    color: "#5fa55a",
    speciesId: "machine",
    originId: "emancipation",
  },
];

function makeEmpire(spec: { id: string; name: string; color: string; speciesId: string; originId: string }): Empire {
  return {
    id: spec.id,
    name: spec.name,
    speciesId: spec.speciesId,
    originId: spec.originId,
    color: spec.color,
    resources: { ...EMPTY_RESOURCES },
    compute: { cap: 0, used: 0 },
    capitalBodyId: null,
    systemIds: [],
    projects: [],
    flags: [],
  };
}

export function initialState(): GameState {
  return {
    schemaVersion: 6,
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
    aiEmpires: [],
    eventQueue: [],
    eventLog: [],
    gameOver: false,
  };
}

// ===== Cross-empire helpers =====

export function allEmpires(state: GameState): Empire[] {
  return [state.empire, ...state.aiEmpires];
}

export function empireById(state: GameState, id: string): Empire | null {
  if (state.empire.id === id) return state.empire;
  return state.aiEmpires.find((e) => e.id === id) ?? null;
}

// ===== Per-empire helpers (empire arg explicit) =====

export function ownedBodiesOf(state: GameState, empire: Empire): Body[] {
  const out: Body[] = [];
  for (const sid of empire.systemIds) {
    const sys = state.galaxy.systems[sid];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const b = state.galaxy.bodies[bid];
      if (b) out.push(b);
    }
  }
  return out;
}

export function totalPopsOf(state: GameState, empire: Empire): number {
  return ownedBodiesOf(state, empire).reduce((s, b) => s + b.pops, 0);
}

function traitBonusPerPopOf(empire: Empire): Partial<Record<ResourceKey, number>> {
  const species = speciesById(empire.speciesId);
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

// Per-body NET contribution: production (by habitability + traits) minus
// this body's pop upkeep for food. Empire-level income sums these, so
// per-body food chips read truthfully (e.g. hellscape -8 food net).
export function bodyIncomeFor(empire: Empire, body: Body): Resources {
  const traitBonus = traitBonusPerPopOf(empire);
  const base = PER_POP_BY_HAB[body.habitability];
  const out: Resources = { ...EMPTY_RESOURCES };
  for (const k of RESOURCE_KEYS) {
    out[k] = ((base[k] ?? 0) + (traitBonus[k] ?? 0)) * body.pops;
  }
  // Food upkeep: 1 per pop, per body.
  out.food -= body.pops;
  return out;
}

export function perTurnIncomeOf(state: GameState, empire: Empire): Resources {
  const income: Resources = { ...EMPTY_RESOURCES };
  for (const body of ownedBodiesOf(state, empire)) {
    const contrib = bodyIncomeFor(empire, body);
    for (const k of RESOURCE_KEYS) income[k] += contrib[k];
  }
  income.political += 1;
  return income;
}

export function computeCapOf(state: GameState, empire: Empire): number {
  return ownedBodiesOf(state, empire).length * COMPUTE_PER_BODY;
}

export function isSystemAdjacentToEmpireOf(
  state: GameState,
  empire: Empire,
  systemId: string,
): boolean {
  const owned = new Set(empire.systemIds);
  if (owned.has(systemId)) return false;
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (a === systemId && owned.has(b)) return true;
    if (b === systemId && owned.has(a)) return true;
  }
  return false;
}

// Cross-empire: does *any* empire already have a colonize order on this body?
export function colonizeOrderForTarget(state: GameState, targetBodyId: string) {
  for (const e of allEmpires(state)) {
    for (const order of e.projects) {
      if (order.kind === "colonize" && order.targetBodyId === targetBodyId) return order;
    }
  }
  return null;
}

// Who effectively "holds" a system? If it has a populated/owned body, its
// ownerId. Otherwise, if any empire has a colonize project targeting any
// body in the system, that empire is the pending claimant. Simple rule:
// one empire per system, whether via completion or in-flight claim.
export function systemClaimant(state: GameState, systemId: string): string | null {
  const sys = state.galaxy.systems[systemId];
  if (!sys) return null;
  if (sys.ownerId) return sys.ownerId;
  for (const empire of allEmpires(state)) {
    for (const order of empire.projects) {
      if (order.kind !== "colonize") continue;
      const target = state.galaxy.bodies[order.targetBodyId];
      if (target && target.systemId === systemId) return empire.id;
    }
  }
  return null;
}

export function canColonizeFor(state: GameState, empire: Empire, targetBodyId: string): boolean {
  const target = state.galaxy.bodies[targetBodyId];
  if (!target) return false;
  const targetSys = state.galaxy.systems[target.systemId];
  if (!targetSys) return false;
  if (target.pops > 0) return false;
  if (colonizeOrderForTarget(state, targetBodyId)) return false;
  const claimant = systemClaimant(state, targetSys.id);
  if (claimant && claimant !== empire.id) return false;   // locked to another empire
  if (claimant === empire.id) return true;                 // we already have presence here
  return isSystemAdjacentToEmpireOf(state, empire, targetSys.id); // frontier
}

// ===== Player-facing convenience (default to player empire) =====

export function ownedBodies(state: GameState): Body[] {
  return ownedBodiesOf(state, state.empire);
}
export function totalPops(state: GameState): number {
  return totalPopsOf(state, state.empire);
}
export function bodyIncome(state: GameState, body: Body): Resources {
  return bodyIncomeFor(state.empire, body);
}
export function perTurnIncome(state: GameState): Resources {
  return perTurnIncomeOf(state, state.empire);
}
export function computeCap(state: GameState): number {
  return computeCapOf(state, state.empire);
}
export function canColonize(state: GameState, targetBodyId: string): boolean {
  return canColonizeFor(state, state.empire, targetBodyId);
}

// ===== Order completion =====

function completeOrder(draft: GameState, empire: Empire, order: BuildOrder): void {
  if (order.kind === "colonize") {
    const target = draft.galaxy.bodies[order.targetBodyId];
    if (!target) return;
    const targetSys = draft.galaxy.systems[target.systemId];
    if (!targetSys) return;
    if (targetSys.ownerId && targetSys.ownerId !== empire.id) return;
    empire.resources.political -= order.politicalCost;
    targetSys.ownerId = empire.id;
    if (!empire.systemIds.includes(targetSys.id)) {
      empire.systemIds.push(targetSys.id);
    }
    target.pops = Math.max(target.pops, COLONIZE_STARTER_POPS);
    // Only log player-visible events in the chronicle for now.
    if (empire.id === draft.empire.id) {
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "colonize",
        choiceId: null,
        text: `Colonized ${target.name} in ${targetSys.name}.`,
      });
    }
  }
}

// ===== Per-empire turn tick =====

function tickEmpire(draft: GameState, empire: Empire, growthRand: () => number): void {
  // 1. Stock income.
  const income = perTurnIncomeOf(draft, empire);
  for (const k of RESOURCE_KEYS) {
    empire.resources[k] += income[k];
  }
  // 2. Reset flow resources on this empire's bodies.
  empire.compute.cap = computeCapOf(draft, empire);
  empire.compute.used = 0;
  for (const body of ownedBodiesOf(draft, empire)) {
    const live = draft.galaxy.bodies[body.id];
    if (live) live.hammers = live.pops * HAMMERS_PER_POP;
  }
  // 3. Sum hammer pool + drain into FIFO projects.
  let pool = 0;
  for (const body of ownedBodiesOf(draft, empire)) {
    pool += body.hammers;
  }
  while (pool > 0 && empire.projects.length > 0) {
    const order = empire.projects[0];
    const need = order.hammersRequired - order.hammersPaid;
    const spent = Math.min(pool, need);
    order.hammersPaid += spent;
    pool -= spent;
    if (order.hammersPaid >= order.hammersRequired) {
      completeOrder(draft, empire, order);
      empire.projects.shift();
    } else {
      break;
    }
  }
  // 4. Pop growth.
  for (const sid of empire.systemIds) {
    const sys = draft.galaxy.systems[sid];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const body = draft.galaxy.bodies[bid];
      if (!body || body.pops >= body.space) continue;
      if (empire.resources.food < POP_GROWTH_FOOD_COST) continue;
      const headroom = (body.space - body.pops) / body.space;
      const chance = headroom * 0.5;
      if (growthRand() < chance) {
        body.pops += 1;
        empire.resources.food -= POP_GROWTH_FOOD_COST;
      }
    }
  }
}

// Greedy AI colonize policy: queue a project for the best-scoring
// colonizable target if none is in flight.
function aiPlan(state: GameState, empire: Empire): BuildOrder | null {
  if (empire.projects.length > 0) return null;
  if (empire.resources.political < COLONIZE_POLITICAL) return null;
  let bestId: string | null = null;
  let bestScore = -1;
  for (const body of Object.values(state.galaxy.bodies)) {
    if (!canColonizeFor(state, empire, body.id)) continue;
    const score = HAB_COLONIZE_SCORE[body.habitability] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestId = body.id;
    }
  }
  if (!bestId) return null;
  return {
    kind: "colonize",
    id: nextOrderId(),
    targetBodyId: bestId,
    hammersRequired: COLONIZE_HAMMERS,
    hammersPaid: 0,
    politicalCost: COLONIZE_POLITICAL,
  };
}

// Pick starter systems that are spread apart: first one random interior,
// each subsequent one maximizing minimum distance to previously picked.
function pickSpreadStarters(
  galaxy: { systems: Record<string, { id: string; q: number; r: number }>; width: number; height: number },
  rand: () => number,
  count: number,
): string[] {
  const candidates = Object.values(galaxy.systems).filter(
    (s) =>
      s.q > 0 &&
      s.q < galaxy.width - 1 &&
      s.r > 0 &&
      s.r < galaxy.height - 1,
  );
  const pool = candidates.length >= count ? candidates : Object.values(galaxy.systems);
  if (pool.length === 0) return [];
  const picked: typeof pool = [pool[Math.floor(rand() * pool.length)]];
  while (picked.length < count && picked.length < pool.length) {
    let best: typeof pool[number] | null = null;
    let bestMinDist = -1;
    for (const cand of pool) {
      if (picked.includes(cand)) continue;
      let minDist = Infinity;
      for (const p of picked) {
        const d = Math.hypot(cand.q - p.q, cand.r - p.r);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = cand;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked.map((s) => s.id);
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "newGame": {
      const origin = originById(action.originId);
      if (!origin) return state;

      const fresh = initialState();
      const galaxy = generateGalaxy({ ...GALAXY_SIZE, seed: action.seed });
      const rand = mulberry32(action.seed ^ 0x243f6a88);

      // Pick three spread-out starters: [player, ai_0, ai_1].
      const starters = pickSpreadStarters(galaxy, rand, 1 + AI_SPECS.length);
      const [playerStarterId, ...aiStarterIds] = starters;
      if (!playerStarterId) return state;

      // Manually assign starter systems (adapted from assignStarterSystem)
      // so we can place multiple empires in one pass.
      let nextGalaxy = galaxy;
      function claimStarter(
        empireId: string,
        sysId: string,
        startingPops: number,
      ): { galaxy: typeof galaxy; capitalBodyId: string; systemId: string } {
        const sys = nextGalaxy.systems[sysId];
        const starterBodyId = sys.bodyIds[0];
        const starterBody = nextGalaxy.bodies[starterBodyId];
        // Starter body is guaranteed temperate with generous space.
        // (Gardens are disabled for now — see galaxy.ts.)
        const updatedBody = {
          ...starterBody,
          habitability: "temperate" as const,
          kind: "planet" as const,
          space: Math.max(starterBody.space, 8),
          pops: startingPops,
        };
        const updatedSys = { ...sys, ownerId: empireId };
        nextGalaxy = {
          ...nextGalaxy,
          systems: { ...nextGalaxy.systems, [sysId]: updatedSys },
          bodies: { ...nextGalaxy.bodies, [starterBodyId]: updatedBody },
        };
        return { galaxy: nextGalaxy, capitalBodyId: starterBodyId, systemId: sysId };
      }

      const playerStarter = claimStarter(fresh.empire.id, playerStarterId, origin.startingPops);
      const aiStarters = aiStarterIds.map((sid, i) => {
        const spec = AI_SPECS[i];
        const aiOrigin = originById(spec.originId);
        return {
          spec,
          starter: claimStarter(spec.id, sid, aiOrigin?.startingPops ?? 4),
          originObj: aiOrigin,
        };
      });

      return produce(fresh, (draft) => {
        draft.turn = 1;
        draft.rngSeed = action.seed >>> 0;
        draft.galaxy = nextGalaxy;

        // Player empire setup.
        draft.empire.name = action.empireName || "Unnamed Empire";
        draft.empire.originId = action.originId;
        draft.empire.speciesId = action.speciesId;
        const species = speciesById(action.speciesId);
        if (species) draft.empire.color = species.color;
        draft.empire.capitalBodyId = playerStarter.capitalBodyId;
        draft.empire.systemIds = [playerStarter.systemId];
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] = origin.startingResources[key] ?? 0;
        }
        draft.empire.compute.cap = draft.galaxy.systems[playerStarter.systemId].bodyIds.length * COMPUTE_PER_BODY;
        draft.empire.compute.used = 0;
        for (const bid of draft.galaxy.systems[playerStarter.systemId].bodyIds) {
          const body = draft.galaxy.bodies[bid];
          if (body) body.hammers = body.pops * HAMMERS_PER_POP;
        }

        // AI empires.
        draft.aiEmpires = aiStarters.map(({ spec, starter, originObj }) => {
          const empire = makeEmpire(spec);
          empire.capitalBodyId = starter.capitalBodyId;
          empire.systemIds = [starter.systemId];
          if (originObj) {
            for (const key of RESOURCE_KEYS) {
              empire.resources[key] = originObj.startingResources[key] ?? 0;
            }
          }
          empire.compute.cap = draft.galaxy.systems[starter.systemId].bodyIds.length * COMPUTE_PER_BODY;
          return empire;
        });
        // Seed AI bodies' hammers too so turn-1 rates show correctly.
        for (const ai of draft.aiEmpires) {
          for (const bid of draft.galaxy.systems[ai.systemIds[0]].bodyIds) {
            const body = draft.galaxy.bodies[bid];
            if (body) body.hammers = body.pops * HAMMERS_PER_POP;
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

      let next = produce(state, (draft) => {
        draft.turn += 1;
        draft.rngSeed = nextSeed(draft.rngSeed);

        const growthRand = mulberry32(draft.rngSeed ^ 0xa5a5a5a5);
        const aiPlanRand = mulberry32(draft.rngSeed ^ 0xdeadbeef);
        void aiPlanRand; // reserved for tie-breaking if we ever randomize AI picks

        // AI planning before ticks, so newly-queued orders drain this turn.
        for (const ai of draft.aiEmpires) {
          const plan = aiPlan(draft, ai);
          if (plan) ai.projects.push(plan);
        }

        // Tick every empire (player + AIs).
        tickEmpire(draft, draft.empire, growthRand);
        for (const ai of draft.aiEmpires) {
          tickEmpire(draft, ai, growthRand);
        }
      });

      // Random event for the player only (for now).
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
