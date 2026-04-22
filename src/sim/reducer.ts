import { current, original, produce } from "immer";
import { LEADERS, POLICIES, featureById, originById, policyById, projectById, speciesById, traitById, EMPIRE_PROJECTS } from "./content";
import { BALANCE } from "../content/balance";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { generateGalaxy, MAX_POPS_BY_HAB } from "./galaxy";
import { mulberry32, nextSeed } from "./rng";
import type {
  Body,
  BuildOrder,
  ComponentPool,
  Empire,
  Expansionism,
  Fleet,
  GameState,
  HabitabilityTier,
  Leader,
  Modifier,
  Politic,
  Resources,
  ResourceKey,
  StarSystem,
} from "./types";

// Every empire-scoped action carries `byEmpireId` so the player and the
// AI go through the same validation + effect path. Player UI passes
// `state.empire.id`; the AI passes the acting empire's id.
export type Action =
  | {
      type: "newGame";
      empireName: string;
      originId: string;
      speciesId: string;
      seed: number;
      portraitArt?: string;
      expansionism: Expansionism;
      politic: Politic;
    }
  | { type: "endTurn" }            // Synchronous shortcut: run a full round.
  | { type: "beginRound" }         // Paced round: tick everyone, set currentPhaseEmpireId.
  | { type: "runPhase" }           // Advance the current empire's phase; finalize if last.
  | { type: "resolveEvent"; eventId: string; choiceId: string }
  | { type: "queueColonize"; byEmpireId: string; targetBodyId: string }
  | { type: "queueEmpireProject"; byEmpireId: string; projectId: string; targetBodyId?: string }
  | { type: "cancelOrder"; byEmpireId: string; orderId: string }
  | { type: "adoptPolicy"; byEmpireId: string; policyId: string }
  | {
      type: "setFleetDestination";
      byEmpireId: string;
      fleetId: string;
      toSystemId: string | null;
    }
  | {
      type: "splitFleet";
      byEmpireId: string;
      fleetId: string;
      count: number;
      toSystemId: string;
    }
  | { type: "declareWar"; byEmpireId: string; targetEmpireId: string }
  | { type: "makePeace"; byEmpireId: string; targetEmpireId: string }
  | { type: "dismissProjectCompletion" }
  | { type: "dismissFirstContact" };

// Colonization tunables. Pop counts + space caps are now on a 10x
// scale (so a starter temperate world runs ~40 pops instead of 4),
// which gives per-turn growth a smoother feel.
export const COLONIZE_HAMMERS = 500;
export const COLONIZE_POLITICAL = 5;
// Pops the colony ship "carries": deducted from the capital when the
// order is queued, delivered to the target when it completes. Net zero
// empire-wide, but makes pops the real limiter on expansion — you can't
// spam colonies faster than your home can grow settlers.
export const COLONIZE_POP_COST = 5;
export const COLONIZE_STARTER_POPS = COLONIZE_POP_COST;

let orderCounter = 0;
function nextOrderId(): string {
  orderCounter += 1;
  return `order_${orderCounter}_${Math.floor(Math.random() * 1e6)}`;
}

const EMPTY_RESOURCES: Resources = {
  food: 0,
  energy: 0,
  political: 0,
};

// =====================================================================
// Connected components — the logistics graph.
// =====================================================================
// Food and energy flow between owned systems over hyperlanes. Two
// owned systems share a component iff there's a hyperlane path between
// them going entirely through systems this empire owns AND isn't being
// occupied by an enemy. An enemy occupation blocks transit through the
// system even though it's still formally ours.
//
// The component id is a canonical representative: the lexicographically
// smallest owned system id in that component. Stable as long as the
// component's membership is stable; if a system splits off or rejoins,
// the id may change (and componentPools gets reconciled in tickEmpire).

function systemIsTransitable(sys: StarSystem, empireId: string): boolean {
  if (sys.ownerId !== empireId) return false;
  if (sys.occupation && sys.occupation.empireId !== empireId) return false;
  return true;
}

// Returns a map systemId → componentId for every owned+transitable
// system of the given empire. Systems the empire owns but that are
// currently occupied by an enemy are *not* in the map (they can't
// pool resources with the rest of the empire).
export function computeComponents(
  state: GameState,
  empire: Empire,
): Map<string, string> {
  const result = new Map<string, string>();
  const ownedSet = new Set(empire.systemIds);
  // Precompute adjacency restricted to owned+transitable systems.
  const adj = new Map<string, string[]>();
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (!ownedSet.has(a) || !ownedSet.has(b)) continue;
    const sa = state.galaxy.systems[a];
    const sb = state.galaxy.systems[b];
    if (!sa || !sb) continue;
    if (!systemIsTransitable(sa, empire.id) || !systemIsTransitable(sb, empire.id)) continue;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const visited = new Set<string>();
  const sortedSystems = [...empire.systemIds].sort();
  for (const root of sortedSystems) {
    if (visited.has(root)) continue;
    const sys = state.galaxy.systems[root];
    if (!sys || !systemIsTransitable(sys, empire.id)) continue;
    // BFS. The root is the lex-smallest unvisited system, so it's
    // also the canonical rep of this component.
    const queue = [root];
    visited.add(root);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      result.set(cur, root);
      for (const n of adj.get(cur) ?? []) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
  }
  return result;
}

// The component id a body belongs to, or null if its system is
// untransitable (e.g., currently being occupied).
export function componentOfBody(
  state: GameState,
  empire: Empire,
  bodyId: string,
): string | null {
  const body = state.galaxy.bodies[bodyId];
  if (!body) return null;
  return componentOfSystem(state, empire, body.systemId);
}

export function componentOfSystem(
  state: GameState,
  empire: Empire,
  systemId: string,
): string | null {
  const components = computeComponents(state, empire);
  return components.get(systemId) ?? null;
}

// Ensure a pool exists for the given component id, creating an empty
// one if not. Returns the pool (mutably, so callers can += on it).
export function getComponentPool(empire: Empire, componentId: string): ComponentPool {
  let pool = empire.componentPools[componentId];
  if (!pool) {
    pool = { food: 0, energy: 0 };
    empire.componentPools[componentId] = pool;
  }
  return pool;
}

// Aggregates food/energy across all pools. Used for display when we
// want "total across the whole empire" and for AI scoring (which
// treats the empire as one actor).
export function totalComponentFood(empire: Empire): number {
  let t = 0;
  for (const k in empire.componentPools) t += empire.componentPools[k].food;
  return t;
}
export function totalComponentEnergy(empire: Empire): number {
  let t = 0;
  for (const k in empire.componentPools) t += empire.componentPools[k].energy;
  return t;
}

// Generic empire-total accessor. Handy for UI code that wants to show
// a single number per resource without caring whether it's pooled per
// component (food/energy) or empire-wide (political).
export function empireResourceStock(empire: Empire, key: ResourceKey): number {
  if (key === "political") return empire.political;
  if (key === "food") return totalComponentFood(empire);
  return totalComponentEnergy(empire);
}

// Reconcile componentPools against the current component membership:
// create empty pools for new components; drop pools whose component
// no longer exists (merged-away or split-away). Called at the start of
// tickEmpire each round.
export function reconcileComponentPools(
  state: GameState,
  empire: Empire,
): void {
  const components = computeComponents(state, empire);
  const liveIds = new Set(components.values());
  // Create missing pools.
  for (const cid of liveIds) {
    if (!empire.componentPools[cid]) {
      empire.componentPools[cid] = { food: 0, energy: 0 };
    }
  }
  // Drop defunct ones.
  for (const cid of Object.keys(empire.componentPools)) {
    if (!liveIds.has(cid)) delete empire.componentPools[cid];
  }
}

// Disc shape carved from this grid by the generator. 15 x 13 yields
// ~110 systems at 0.85 density — large enough to give multiple
// empires room to maneuver without the map becoming unreadable.
export const GALAXY_SIZE = { width: 15, height: 13, density: 0.85 };

// Food is produced only on temperate/garden worlds. Energy comes from
// pops on every habitable body. Hammers come from a separate flow
// pipeline (HAMMERS_PER_POP + modifiers), not from this table.
const PER_POP_BY_HAB: Record<HabitabilityTier, Partial<Record<ResourceKey, number>>> = {
  garden:    { food: 2, energy: 1 },
  temperate: { food: 2, energy: 1 },
  harsh:     { food: 0, energy: 1 },
  // Hellscape variants: each specializes in one resource at the cost
  // of food. Stars sit in the system but produce nothing on their own.
  frozen:    { food: 0, energy: 0 }, // compute bonus applied separately
  molten:    { food: 0, energy: 0 }, // hammer bonus applied separately
  barren:    { food: 0, energy: 2 },
  stellar:   { food: 0, energy: 0 },
};

// Per-pop bonuses specific to hellscape variants. Molten boosts hammer
// output, frozen boosts compute, barren gets energy via PER_POP_BY_HAB
// above. Stars are non-colonisable so they get nothing here.
const HAMMERS_PER_POP_HAB_BONUS: Partial<Record<HabitabilityTier, number>> = {
  molten: 1.5,
};

// Per-pop compute output, per habitability. Frozen worlds specialise
// in compute (compute nodes at scale); temperate and garden worlds
// produce a smaller baseline since general-purpose infrastructure
// still does some computing. Other habs (harsh, molten, barren,
// stellar) produce no compute.
const COMPUTE_PER_POP_HAB: Partial<Record<HabitabilityTier, number>> = {
  frozen: 1,
  temperate: 0.25,
  garden: 0.25,
};

export const HAMMERS_PER_POP = 1;
export const POP_GROWTH_FOOD_COST = 50;

// Deterministic logistic growth. Per turn, a body grows by
//   (BASE_ORGANIC_GROWTH_RATE × popGrowthMult × pops + additive) × (1 − pops/cap)
// which means: compound growth proportional to current pops, plus any
// flat additive streams (Matriarchal Hive's queen), both throttled as
// the body fills. Pops are stored as floats; UI floors for display.
//
// Growth is parameterised in terms of the *doubling time* an empty
// body would take to double its population if nothing else changed
// (no cap, no modifiers). Tune this one number to rebalance how
// patient or explosive the whole game feels. 60 turns ≈ mid-game
// colonies meaningfully gain pops over a dozen rounds without
// racing to cap.
export const ORGANIC_DOUBLING_TURNS = 60;
export const BASE_ORGANIC_GROWTH_RATE = Math.pow(2, 1 / ORGANIC_DOUBLING_TURNS) - 1;

// Deterministic per-turn pop delta for one body given an empire's
// current modifiers. Returns 0 for uncolonized, full, or food-starved
// bodies. Units: pops/turn (fractional).
//
// Empire-wide modifiers (species, origin, policies, feature
// empireModifiers) affect every body; feature bodyModifiers add
// only on the body they're installed on.
export function bodyGrowthRate(empire: Empire, body: Body): number {
  const cap = maxPopsFor(empire, body);
  if (cap <= 0 || body.pops <= 0 || body.pops >= cap) return 0;
  const organic = BASE_ORGANIC_GROWTH_RATE * popGrowthMultiplier(empire) * body.pops;
  const bodyMods = bodyFeatureModifiers(body);
  const additive = popGrowthAdditive(empire) + sumDelta(bodyMods, "popGrowthAdd");
  const headroom = (cap - body.pops) / cap;
  return Math.max(0, (organic + additive) * headroom);
}

// Sum of per-body pop growth across all owned bodies this turn, gated
// per-component on that component's food pool (disconnected regions
// with empty pantries don't contribute to the total).
export function expectedPopGrowth(state: GameState, empire: Empire): number {
  const components = computeComponents(state, empire);
  let total = 0;
  for (const body of ownedBodiesOf(state, empire)) {
    const cid = components.get(body.systemId);
    if (!cid) continue;
    const pool = empire.componentPools[cid];
    if (!pool || pool.food <= 0) continue;
    total += bodyGrowthRate(empire, body);
  }
  return total;
}

export function growthEstimate(
  state: GameState,
  empire: Empire,
  body: Body,
):
  | { kind: "uncolonized" }
  | { kind: "full" }
  | { kind: "starved" }
  | { kind: "growing"; perTurn: number } {
  // A body with no pops hasn't been colonised — it doesn't grow no
  // matter what food the region has. Return a dedicated state so the
  // UI can skip the pill rather than mislabel it as "starved".
  if (body.pops <= 0) return { kind: "uncolonized" };
  const cap = maxPopsFor(empire, body);
  if (body.pops >= cap) return { kind: "full" };
  const cid = componentOfSystem(state, empire, body.systemId);
  const pool = cid ? empire.componentPools[cid] : null;
  if (!pool || pool.food <= 0) return { kind: "starved" };
  const rate = bodyGrowthRate(empire, body);
  if (rate <= 0) return { kind: "full" };
  return { kind: "growing", perTurn: rate };
}

// ===== AI empire setup =====
// AI empires are seeded by picking leaders from the content roster.
// Each leader brings their own portrait + archetype + name/manifesto.
// The origin is chosen per species (simple mapping for MVP — eventually
// leaders can carry their own origin preference too).
// Default origin picked when seeding an AI of the given species.
// Must satisfy the origin's allowedSpeciesIds — e.g. insectoids
// can't use Steady Evolution (humans-only), so they default to
// Colony Seeders.
const AI_ORIGIN_BY_SPECIES: Record<string, string> = {
  humans: "steady_evolution",
  insectoid: "colony_seeders",
  machine: "graceful_handover",
};
const AI_COLOR_OVERRIDES: Record<string, string> = {
  // Warm amber for humans/insectoid AIs, forest green for machines —
  // visually distinct from the player's species colours.
  humans: "#d88a3a",
  insectoid: "#d88a3a",
  machine: "#5fa55a",
};

const AI_EMPIRE_COUNT = 2;

function pickAiLeaders(rand: () => number, count: number): Leader[] {
  const pool = [...LEADERS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function makeEmpire(spec: {
  id: string;
  name: string;
  color: string;
  speciesId: string;
  originId: string;
  expansionism: Expansionism;
  politic: Politic;
  leaderId?: string;
  portraitArt?: string;
}): Empire {
  return {
    id: spec.id,
    name: spec.name,
    speciesId: spec.speciesId,
    originId: spec.originId,
    color: spec.color,
    political: 0,
    componentPools: {},
    compute: { cap: 0, used: 0 },
    portraitArt: spec.portraitArt,
    expansionism: spec.expansionism,
    politic: spec.politic,
    leaderId: spec.leaderId,
    capitalBodyId: null,
    systemIds: [],
    storyModifiers: {},
    completedProjects: [],
    adoptedPolicies: [],
    flags: [],
  };
}

export function initialState(): GameState {
  return {
    schemaVersion: 22,
    turn: 0,
    rngSeed: 0,
    galaxy: { systems: {}, bodies: {}, hyperlanes: [], width: 0, height: 0 },
    empire: {
      id: "empire_player",
      name: "",
      originId: "",
      speciesId: "",
      color: "#7ec8ff",
      political: 0,
      componentPools: {},
      compute: { cap: 0, used: 0 },
      expansionism: "pragmatist",
      politic: "centrist",
      capitalBodyId: null,
      systemIds: [],
      storyModifiers: {},
      completedProjects: [],
      adoptedPolicies: [],
      flags: [],
    },
    aiEmpires: [],
    fleets: {},
    wars: [],
    currentPhaseEmpireId: null,
    eventQueue: [],
    eventLog: [],
    projectCompletions: [],
    pendingFirstContacts: [],
    gameOver: false,
  };
}

let fleetCounter = 0;
function nextFleetId(): string {
  fleetCounter += 1;
  return `fleet_${fleetCounter}_${Math.floor(Math.random() * 1e6)}`;
}

// Spawn `count` ships for `empireId` at `systemId`. Merges into the
// empire's existing fleet at that system if one exists; otherwise
// creates a new fleet. Operates on an immer draft.
function spawnShipsInSystem(
  draft: GameState,
  empireId: string,
  systemId: string,
  count: number,
): void {
  if (count <= 0) return;
  // Merge into an existing same-empire fleet at this system ONLY if
  // that fleet isn't in the middle of a route. Dropping the new ship
  // onto a moving fleet would silently inflate its ship count past the
  // compute budget and cancel its move — confusing for the player.
  for (const f of Object.values(draft.fleets)) {
    if (
      f.empireId === empireId &&
      f.systemId === systemId &&
      !f.destinationSystemId
    ) {
      f.shipCount += count;
      return;
    }
  }
  const id = nextFleetId();
  draft.fleets[id] = { id, empireId, systemId, shipCount: count };
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

// ===== Modifier plumbing =====

// Expansionism lean:
//  - Conqueror:    -25% political-capital cost to colonize (cheaper land
//                  grabs; fleets will also be cheaper once they exist).
//  - Pragmatist:   baseline.
//  - Isolationist: +50% PC cost to colonize (reluctant to expand), but
//                  +15% max pops and +15% pop growth on the worlds
//                  they do hold.
export function expansionismModifiers(ex: Expansionism): Modifier[] {
  switch (ex) {
    case "conqueror":
      return [
        { kind: "colonizePoliticalMult", value: 0.75 },
      ];
    case "pragmatist":
      return [];
    case "isolationist":
      return [
        { kind: "colonizePoliticalMult", value: 2.0 },
        { kind: "maxPopsMult", value: 2.0 },
        { kind: "popGrowthMult", value: 1.25 },
      ];
  }
}

// Politic lean:
//  - Collectivist:  state over individual — centralized authority
//                   translates to +0.1 political/turn and a mild
//                   coordinated-labour bonus of +0.1 hammers/pop.
//  - Centrist:      baseline.
//  - Individualist: liberty over state — reserved for an innovation /
//                   research bonus once the tech layer lands.
export function politicModifiers(p: Politic): Modifier[] {
  switch (p) {
    case "collectivist":
      return [
        { kind: "flat", resource: "political", value: 0.1 },
        { kind: "hammersPerPopDelta", value: 0.1 },
      ];
    case "centrist":
      return [];
    case "individualist":
      return [];
  }
}

// Rebuild the "feature:*" entries in empire.storyModifiers from every
// Feature currently installed on any owned body. Called each round
// (start of tickEmpire) and at state-change points (newGame, conquest)
// so the empire's effective modifier set always matches the features
// it actually controls — no drift if a body changes hands.
//
// Only a feature's *empireModifiers* are stamped here. Its
// bodyModifiers stay local and are applied via bodyFeatureModifiers
// at growth-calc time; they don't leak into empireModifiers().
export function syncFeatureModifiers(state: GameState, empire: Empire): void {
  for (const key of Object.keys(empire.storyModifiers)) {
    if (key.startsWith("feature:")) delete empire.storyModifiers[key];
  }
  for (const body of ownedBodiesOf(state, empire)) {
    for (const fid of body.features ?? []) {
      const feat = featureById(fid);
      if (!feat || !feat.empireModifiers || feat.empireModifiers.length === 0) continue;
      empire.storyModifiers[`feature:${fid}`] = [...feat.empireModifiers];
    }
  }
}

// Modifiers contributed by every feature *installed on this body* —
// applied only to calculations for this specific body (the queen
// lays where she lives, not across the whole empire).
function bodyFeatureModifiers(body: Body): Modifier[] {
  const out: Modifier[] = [];
  for (const fid of body.features ?? []) {
    const feat = featureById(fid);
    if (!feat || !feat.bodyModifiers) continue;
    out.push(...feat.bodyModifiers);
  }
  return out;
}

// All modifiers that apply to an empire: species innates + trait mods +
// archetype leans + story bundles (granted by origin, projects, or
// features via syncFeatureModifiers).
// Memoise by Empire identity. Immer produces a new Empire object on
// any mutation, so a stale cache entry becomes unreachable (its key
// Empire is gone) and GC collects it. The same Empire object always
// has the same modifier set — re-computing the flattened list was a
// meaningful fraction of scoreState cost before the cache.
const empireModifiersCache = new WeakMap<Empire, Modifier[]>();

export function empireModifiers(empire: Empire): Modifier[] {
  const cached = empireModifiersCache.get(empire);
  if (cached) return cached;
  const species = speciesById(empire.speciesId);
  const out: Modifier[] = [];
  if (species) {
    out.push(...species.modifiers);
    for (const tid of species.traitIds) {
      const t = traitById(tid);
      if (t) out.push(...t.modifiers);
    }
  }
  out.push(...expansionismModifiers(empire.expansionism));
  out.push(...politicModifiers(empire.politic));
  for (const bundle of Object.values(empire.storyModifiers)) {
    out.push(...bundle);
  }
  empireModifiersCache.set(empire, out);
  return out;
}


// Multiplicative modifiers multiply together; returns 1.0 if none.
function productMult(
  mods: Modifier[],
  kind: "popGrowthMult" | "maxPopsMult" | "colonizeHammerMult" | "colonizePoliticalMult",
): number {
  let m = 1;
  for (const mod of mods) if (mod.kind === kind) m *= mod.value;
  return m;
}

// Effective per-colonize costs after applying empire modifiers. Rounded
// so the queued order stores a clean integer.
export function effectiveColonizeHammers(empire: Empire): number {
  return Math.max(
    1,
    Math.round(COLONIZE_HAMMERS * productMult(empireModifiers(empire), "colonizeHammerMult")),
  );
}
export function effectiveColonizePolitical(empire: Empire): number {
  return Math.max(
    0,
    Math.round(COLONIZE_POLITICAL * productMult(empireModifiers(empire), "colonizePoliticalMult")),
  );
}

function sumDelta(
  mods: Modifier[],
  kind: "foodUpkeepDelta" | "hammersPerPopDelta" | "popGrowthAdd" | "maxPopsDelta",
): number {
  let s = 0;
  for (const mod of mods) if (mod.kind === kind) s += mod.value;
  return s;
}

export function popGrowthAdditive(empire: Empire): number {
  return sumDelta(empireModifiers(empire), "popGrowthAdd");
}

// Per-pop resource yield: sums `perPop` mods + `habBonus` matching this body.
function perPopYield(
  mods: Modifier[],
  hab: HabitabilityTier,
  resource: ResourceKey,
): number {
  let v = 0;
  for (const m of mods) {
    if (m.kind === "perPop" && m.resource === resource) v += m.value;
    else if (m.kind === "habBonus" && m.habitability === hab && m.resource === resource) v += m.value;
  }
  return v;
}

function flatEmpireIncome(mods: Modifier[], resource: ResourceKey): number {
  let v = 0;
  for (const m of mods) if (m.kind === "flat" && m.resource === resource) v += m.value;
  return v;
}

// Base food each pop eats per turn. Modifiers (e.g. Agricultural
// Subsidies) layer on top via foodUpkeepDelta.
export const FOOD_UPKEEP_PER_POP = 0.5;

// Fraction of the source body's pops that migrate out per turn
// within a connected component. Scales with empire size — a tiny
// hive trickles pops, a big one moves meaningful numbers — while
// still staying gentle at any scale. 0.02 ≈ "2% of the biggest
// colony's population drifts elsewhere each turn," which is
// slightly above the baseline organic-growth rate so migration
// keeps up with accumulation.
export const MIGRATION_RATE_PER_POP = 0.02;

// Effective food upkeep per pop, clamped at 0.
export function foodUpkeepPerPop(empire: Empire): number {
  return Math.max(0, FOOD_UPKEEP_PER_POP + sumDelta(empireModifiers(empire), "foodUpkeepDelta"));
}

// Effective hammer yield per pop — empire-wide baseline (no hab bonus).
export function hammersPerPop(empire: Empire): number {
  return HAMMERS_PER_POP + sumDelta(empireModifiers(empire), "hammersPerPopDelta");
}

// Hammer yield per pop on a specific body — adds the hellscape-variant
// bonus (molten bodies run factories that boost output) on top of the
// empire baseline.
export function hammersPerPopFor(empire: Empire, body: Body): number {
  return hammersPerPop(empire) + (HAMMERS_PER_POP_HAB_BONUS[body.habitability] ?? 0);
}

// Max pops this body can hold. Empire-wide modifiers (species,
// origin, policies, feature empireModifiers) apply to every body;
// feature bodyModifiers (e.g. a Brood Mother adding +200 maxPops
// to her host) apply only here.
export function maxPopsFor(empire: Empire, body: Body): number {
  const empireMods = empireModifiers(empire);
  const bodyMods = bodyFeatureModifiers(body);
  const delta =
    sumDelta(empireMods, "maxPopsDelta") + sumDelta(bodyMods, "maxPopsDelta");
  const mult = productMult([...empireMods, ...bodyMods], "maxPopsMult");
  return Math.floor((body.maxPops + delta) * mult);
}

export function popGrowthMultiplier(empire: Empire): number {
  return productMult(empireModifiers(empire), "popGrowthMult");
}

// ===== Income =====

// Per-body NET contribution: production (base + modifiers) minus
// this body's pop food upkeep. Empire-level income sums these so per-body
// chips show truthful net values.
export function bodyIncomeFor(empire: Empire, body: Body): Resources {
  const mods = empireModifiers(empire);
  const base = PER_POP_BY_HAB[body.habitability];
  const out: Resources = { ...EMPTY_RESOURCES };
  for (const k of RESOURCE_KEYS) {
    const perPop = (base[k] ?? 0) + perPopYield(mods, body.habitability, k);
    out[k] = perPop * body.pops;
  }
  // Food upkeep (modifier-aware).
  out.food -= foodUpkeepPerPop(empire) * body.pops;
  return out;
}

// Itemized per-turn contribution for a single resource — used by the UI
// "where is this coming from?" breakdown panel.
export interface ResourceContribution {
  label: string;
  value: number;
}
export interface ResourceBreakdown {
  resource: ResourceKey;
  perBody: Array<{ bodyId: string; bodyName: string; contribution: number; perPop: number; upkeep: number; pops: number; habitability: HabitabilityTier }>;
  flat: Array<ResourceContribution>;
  total: number;
}

// Generic itemized breakdown used for non-resource stats (hammers,
// compute, pops). Keeps the UI simple: a list of named sections, each
// with rows that have an optional detail + a value.
export interface StatBreakdownSection {
  label: string;
  rows: Array<{
    id?: string;
    name: string;
    detail?: string;
    value: number;
    habitability?: HabitabilityTier;
    // Optional display hint. "percent" renders as ±N% (typically for
    // multiplier deltas where the raw value is a fraction like -1);
    // default is a plain number. Kept separate from the breakdown's
    // overall `unit` because individual rows can mix formats
    // (e.g., a pops breakdown has integer rows and %-delta rows).
    format?: "percent";
  }>;
}
export interface StatBreakdown {
  title: string;
  iconSrc: string;
  unit?: string;
  total: number;
  sections: StatBreakdownSection[];
}

export function resourceBreakdownFor(
  state: GameState,
  empire: Empire,
  resource: ResourceKey,
): ResourceBreakdown {
  const mods = empireModifiers(empire);
  const upkeepPerPop = resource === "food" ? foodUpkeepPerPop(empire) : 0;
  const perBody: ResourceBreakdown["perBody"] = [];
  for (const body of ownedBodiesOf(state, empire)) {
    const base = (PER_POP_BY_HAB[body.habitability][resource] ?? 0);
    const perPop = base + perPopYield(mods, body.habitability, resource);
    const contribution = (perPop - upkeepPerPop) * body.pops;
    perBody.push({
      bodyId: body.id,
      bodyName: body.name,
      contribution,
      perPop,
      upkeep: upkeepPerPop,
      pops: body.pops,
      habitability: body.habitability,
    });
  }
  const flat: ResourceContribution[] = [];
  // Baseline +1 political/turn applies to every empire.
  if (resource === "political") flat.push({ label: "Baseline", value: 1 });
  // Flat modifier contributions broken out individually so the player can
  // see which species/trait/story bundle is responsible.
  const species = speciesById(empire.speciesId);
  if (species) {
    for (const m of species.modifiers) {
      if (m.kind === "flat" && m.resource === resource) {
        flat.push({ label: species.name, value: m.value });
      }
    }
    for (const tid of species.traitIds) {
      const t = traitById(tid);
      if (!t) continue;
      for (const m of t.modifiers) {
        if (m.kind === "flat" && m.resource === resource) {
          flat.push({ label: t.name, value: m.value });
        }
      }
    }
  }
  for (const [key, bundle] of Object.entries(empire.storyModifiers)) {
    for (const m of bundle) {
      if (m.kind === "flat" && m.resource === resource) {
        flat.push({ label: key.replace(/_/g, " "), value: m.value });
      }
    }
  }
  // Energy upkeep: outposts drain the stockpile each turn (fleets no
  // longer draw upkeep — hammers are the real fleet-production lever).
  if (resource === "energy") {
    const outpostCost = outpostEnergyUpkeep(empire);
    if (outpostCost > 0) flat.push({ label: "Outpost upkeep", value: -outpostCost });
  }
  const total = perBody.reduce((s, row) => s + row.contribution, 0) + flat.reduce((s, row) => s + row.value, 0);
  return { resource, perBody, flat, total };
}

// Collect every flat/per-pop/scalar modifier affecting a given numeric
// quantity, labelled by source (species name / trait name / story key).
// Used to populate "rate modifiers" sections in the breakdown modal.
interface LabelledMod {
  label: string;
  mod: Modifier;
}
function labelledModifiers(empire: Empire): LabelledMod[] {
  const out: LabelledMod[] = [];
  const species = speciesById(empire.speciesId);
  if (species) {
    for (const m of species.modifiers) out.push({ label: species.name, mod: m });
    for (const tid of species.traitIds) {
      const t = traitById(tid);
      if (!t) continue;
      for (const m of t.modifiers) out.push({ label: t.name, mod: m });
    }
  }
  for (const [key, bundle] of Object.entries(empire.storyModifiers)) {
    const pretty = key.replace(/_/g, " ");
    for (const m of bundle) out.push({ label: pretty, mod: m });
  }
  return out;
}

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  food: "Food",
  energy: "Energy",
  political: "Political Capital",
};
const RESOURCE_ICON_PATH: Record<ResourceKey, string> = {
  food: "/icons/food.png",
  energy: "/icons/energy.png",
  political: "/icons/political.png",
};

export function resourceBreakdownAsStat(
  state: GameState,
  empire: Empire,
  resource: ResourceKey,
): StatBreakdown {
  const raw = resourceBreakdownFor(state, empire, resource);
  const perBodyRows = raw.perBody
    .filter((r) => r.contribution !== 0)
    .map((r) => ({
      id: r.bodyId,
      name: r.bodyName,
      detail:
        r.upkeep > 0
          ? `${r.pops} × (${r.perPop} − ${r.upkeep})`
          : `${r.pops} × ${r.perPop}`,
      value: r.contribution,
      habitability: r.habitability,
    }));
  const flatRows = raw.flat
    .filter((r) => r.value !== 0)
    .map((r) => ({ name: r.label, value: r.value }));
  return {
    title: RESOURCE_LABEL[resource],
    iconSrc: RESOURCE_ICON_PATH[resource],
    unit: "/turn",
    total: raw.total,
    sections: [
      ...(perBodyRows.length > 0 ? [{ label: "Per body", rows: perBodyRows }] : []),
      ...(flatRows.length > 0 ? [{ label: "Empire-wide", rows: flatRows }] : []),
    ],
  };
}

export function hammersBreakdownFor(state: GameState, empire: Empire): StatBreakdown {
  const bodyRows = ownedBodiesOf(state, empire)
    .filter((b) => b.pops > 0)
    .map((body) => {
      const rate = hammersPerPopFor(empire, body);
      return {
        id: body.id,
        name: body.name,
        detail: `${body.pops} pops × ${rate}/pop`,
        value: Math.floor(body.pops * rate),
        habitability: body.habitability,
      };
    });
  const modRows: StatBreakdownSection["rows"] = [
    { name: "Baseline per pop", detail: "", value: HAMMERS_PER_POP },
  ];
  for (const lm of labelledModifiers(empire)) {
    if (lm.mod.kind === "hammersPerPopDelta") {
      modRows.push({ name: lm.label, detail: "per pop", value: lm.mod.value });
    }
  }
  const total = bodyRows.reduce((s, r) => s + r.value, 0);
  return {
    title: "Hammers",
    iconSrc: "/icons/hammers.png",
    unit: "/turn",
    total,
    sections: [
      ...(bodyRows.length > 0 ? [{ label: "Per body", rows: bodyRows }] : []),
      ...(modRows.length > 1 ? [{ label: "Per-pop rate", rows: modRows }] : []),
    ],
  };
}

export function computeBreakdownFor(state: GameState, empire: Empire): StatBreakdown {
  const bodyRows = ownedBodiesOf(state, empire).map((body) => {
    const rate = COMPUTE_PER_POP_HAB[body.habitability] ?? 0;
    const value = bodyComputeOutput(body);
    const detail =
      rate > 0 && body.pops > 0
        ? `${body.pops} pops × ${rate}/pop`
        : "no compute output";
    return {
      id: body.id,
      name: body.name,
      detail,
      value,
      habitability: body.habitability,
    };
  });
  const capTotal = bodyRows.reduce((s, r) => s + r.value, 0);

  // Projected spend next turn — each routed fleet will cost its ship
  // count in compute to execute the jump.
  const fleetRows = Object.values(state.fleets)
    .filter((f) => f.empireId === empire.id && f.destinationSystemId && f.shipCount > 0)
    .map((f) => {
      const dest = state.galaxy.systems[f.destinationSystemId!];
      return {
        id: f.id,
        name: `Fleet → ${dest?.name ?? "?"}`,
        detail: `${f.shipCount} ship${f.shipCount === 1 ? "" : "s"}`,
        value: -f.shipCount,
      };
    });
  const projectedSpend = fleetRows.reduce((s, r) => s - r.value, 0);

  return {
    title: "Compute",
    iconSrc: "/icons/compute.png",
    unit: "/turn",
    total: capTotal - projectedSpend,
    sections: [
      { label: "Per body", rows: bodyRows },
      ...(fleetRows.length > 0 ? [{ label: "Fleet jumps (projected)", rows: fleetRows }] : []),
    ],
  };
}

// Projected compute that will be consumed by fleet jumps this turn —
// used to show a deficit warning in the sidebar.
export function projectedFleetCompute(state: GameState, empire: Empire): number {
  let total = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.empireId !== empire.id) continue;
    if (!f.destinationSystemId) continue;
    if (f.shipCount <= 0) continue;
    total += f.shipCount;
  }
  return total;
}

export function popsBreakdownFor(state: GameState, empire: Empire): StatBreakdown {
  // Per-body section only includes colonised bodies — uncolonised
  // worlds with 0 pops don't contribute to any running total and
  // would just clutter the modal.
  const bodyRows = ownedBodiesOf(state, empire)
    .filter((body) => body.pops > 0)
    .map((body) => {
      const cap = maxPopsFor(empire, body);
      return {
        id: body.id,
        name: body.name,
        detail: `${Math.floor(body.pops)} / ${cap}`,
        value: body.pops,
        habitability: body.habitability,
      };
    });
  // Growth this turn — sums to the +Δ the sidebar shows next to the
  // pops counter. The detail field shows the math explicitly:
  //   (raw organic+additive) × (1 − pops/cap) = rate
  // so the logistic damping is visible instead of hidden inside the
  // final number.
  const growthRows: StatBreakdownSection["rows"] = [];
  const components = computeComponents(state, empire);
  const growthMult = popGrowthMultiplier(empire);
  const empireAdd = popGrowthAdditive(empire);
  for (const body of ownedBodiesOf(state, empire)) {
    // Skip bodies with no organic growth surface at all (no pops,
    // uncolonised) and bodies that can't grow (at cap).
    if (body.pops <= 0) continue;
    const cap = maxPopsFor(empire, body);
    const cid = components.get(body.systemId);
    const pool = cid ? empire.componentPools[cid] : null;
    const starved = !pool || pool.food <= 0;
    const bodyAdd = sumDelta(bodyFeatureModifiers(body), "popGrowthAdd");
    const organic = BASE_ORGANIC_GROWTH_RATE * growthMult * body.pops;
    const raw = organic + empireAdd + bodyAdd;
    const rate = bodyGrowthRate(empire, body);
    const pops = Math.round(body.pops * 10) / 10;
    const detail = starved
      ? `starved (no food in component)`
      : `${raw.toFixed(2)} × (1 − ${pops}/${cap}) = ${rate.toFixed(2)}`;
    growthRows.push({
      id: body.id,
      name: body.name,
      detail,
      value: starved ? 0 : rate,
      habitability: body.habitability,
    });
  }
  const modRows: StatBreakdownSection["rows"] = [];
  for (const lm of labelledModifiers(empire)) {
    if (lm.mod.kind === "maxPopsMult") {
      modRows.push({
        name: lm.label,
        detail: "max pops",
        value: lm.mod.value - 1,
        format: "percent",
      });
    }
    if (lm.mod.kind === "popGrowthMult") {
      modRows.push({
        name: lm.label,
        detail: "organic growth",
        value: lm.mod.value - 1,
        format: "percent",
      });
    }
    if (lm.mod.kind === "popGrowthAdd") {
      modRows.push({ name: lm.label, detail: "flat pops/turn", value: lm.mod.value });
    }
  }
  const total = bodyRows.reduce((s, r) => s + r.value, 0);
  return {
    title: "Population",
    iconSrc: "/icons/pops.png",
    total,
    sections: [
      ...(bodyRows.length > 0 ? [{ label: "Per body", rows: bodyRows }] : []),
      ...(growthRows.length > 0 ? [{ label: "Growth this turn", rows: growthRows }] : []),
      ...(modRows.length > 0 ? [{ label: "Cap + growth modifiers", rows: modRows }] : []),
    ],
  };
}

// Political income for the empire this turn. Flat +1 baseline + any
// empire-wide political modifiers + sum of per-body political yield.
// Political is empire-wide, so unlike food/energy it's not routed by
// component.
export function empirePoliticalIncomeOf(state: GameState, empire: Empire): number {
  let total = 1; // baseline tick
  const mods = empireModifiers(empire);
  total += flatEmpireIncome(mods, "political");
  for (const body of ownedBodiesOf(state, empire)) {
    total += bodyIncomeFor(empire, body).political;
  }
  return total;
}

// Food + energy income for a single connected component this turn.
// Bodies contribute from their perPop yields; empire-level flat food/
// energy modifiers credit to the capital's component; fleet + outpost
// upkeep drains from whatever component the fleet / outpost is in.
// Bodies in systems that are currently untransitable (occupied by an
// enemy, so not in any component) are silently dropped — their
// output can't be shipped out during the siege.
export function componentIncomeOf(
  state: GameState,
  empire: Empire,
  componentId: string,
): { food: number; energy: number } {
  const components = computeComponents(state, empire);
  let food = 0;
  let energy = 0;
  for (const body of ownedBodiesOf(state, empire)) {
    if (components.get(body.systemId) !== componentId) continue;
    const contrib = bodyIncomeFor(empire, body);
    food += contrib.food;
    energy += contrib.energy;
  }
  const capSysId = empire.capitalBodyId
    ? state.galaxy.bodies[empire.capitalBodyId]?.systemId
    : null;
  if (capSysId && components.get(capSysId) === componentId) {
    const mods = empireModifiers(empire);
    food += flatEmpireIncome(mods, "food");
    energy += flatEmpireIncome(mods, "energy");
  }
  // Outpost upkeep drains the local component's pool — cutting a
  // region off means that region has to pay for its own outposts.
  // Fleets no longer have upkeep (hammers throttle production directly).
  const outpostCost = BALANCE.outpostEnergyUpkeep;
  for (const sid of empire.systemIds) {
    if (components.get(sid) !== componentId) continue;
    energy -= outpostCost;
  }
  return { food, energy };
}

// Empire-wide aggregate income — used for UI totals and AI scoring
// where we want "one number per resource" rather than per-component
// breakdown.
export function perTurnIncomeOf(state: GameState, empire: Empire): Resources {
  const out: Resources = { food: 0, energy: 0, political: empirePoliticalIncomeOf(state, empire) };
  const components = computeComponents(state, empire);
  const ids = new Set(components.values());
  for (const cid of ids) {
    const ci = componentIncomeOf(state, empire, cid);
    out.food += ci.food;
    out.energy += ci.energy;
  }
  return out;
}

// Compute produced by this single body (floored). Frozen worlds produce
// 1/pop, temperate and garden produce 0.25/pop, others produce 0.
export function bodyComputeOutput(body: Body): number {
  const rate = COMPUTE_PER_POP_HAB[body.habitability] ?? 0;
  return Math.floor(body.pops * rate);
}

export function computeCapOf(state: GameState, empire: Empire): number {
  let total = 0;
  for (const body of ownedBodiesOf(state, empire)) {
    total += bodyComputeOutput(body);
  }
  return total;
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

// All outstanding build orders across every body this empire owns.
// Replaces the old `empire.projects` iteration (projects live on
// per-body queues now).
export function allOrdersOf(state: GameState, empire: Empire): BuildOrder[] {
  const out: BuildOrder[] = [];
  for (const body of ownedBodiesOf(state, empire)) {
    for (const order of body.queue) out.push(order);
  }
  return out;
}

// Cross-empire: does *any* empire already have a colonize order on this body?
export function colonizeOrderForTarget(state: GameState, targetBodyId: string) {
  for (const e of allEmpires(state)) {
    for (const order of allOrdersOf(state, e)) {
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
    for (const order of allOrdersOf(state, empire)) {
      if (order.kind !== "colonize") continue;
      const target = state.galaxy.bodies[order.targetBodyId];
      if (target && target.systemId === systemId) return empire.id;
    }
  }
  return null;
}

// Is this empire allowed to queue the given project right now?
// For body-scope projects, pass the `targetBodyId` of the intended host
// (capital or any-owned) so the body requirement can be validated.
export function canQueueProjectFor(
  state: GameState,
  empire: Empire,
  projectId: string,
  targetBodyId?: string,
): boolean {
  const proj = projectById(projectId);
  if (!proj) return false;
  const a = proj.availability;
  if (a.speciesIds && !a.speciesIds.includes(empire.speciesId)) return false;
  if (a.originIds && !a.originIds.includes(empire.originId)) return false;
  if (a.requiresFlag && !empire.flags.includes(a.requiresFlag)) return false;
  if (a.excludesFlag && empire.flags.includes(a.excludesFlag)) return false;
  if (a.excludesCompleted && empire.completedProjects.includes(projectId)) return false;
  // Scope-specific: body projects need a valid host body.
  if (proj.scope === "body") {
    if (!targetBodyId) return false;
    if (proj.bodyRequirement === "capital" && targetBodyId !== empire.capitalBodyId) return false;
    if (proj.bodyRequirement === "any_owned") {
      const body = state.galaxy.bodies[targetBodyId];
      if (!body) return false;
      const sys = state.galaxy.systems[body.systemId];
      if (!sys || sys.ownerId !== empire.id) return false;
      // Must be actually colonized — orbital yards need pops to staff.
      if (body.pops <= 0) return false;
    }
    if (proj.bodyRequirement === "star") {
      const body = state.galaxy.bodies[targetBodyId];
      if (!body || body.kind !== "star") return false;
      const sys = state.galaxy.systems[body.systemId];
      if (!sys) return false;
      // Can't outpost if someone already owns this system.
      if (sys.ownerId) return false;
      // Frontier check: the star system must be reachable from current territory.
      if (!isSystemAdjacentToEmpireOf(state, empire, sys.id)) return false;
    }
  }
  // Dedupe rules (opt out with `repeatable: true` on the project):
  //  - Empire-scope projects: at most one of a given projectId queued.
  //  - Body-scope projects: at most one (projectId, targetBodyId) pair.
  if (!proj.repeatable) {
    for (const order of allOrdersOf(state, empire)) {
      if (order.kind !== "empire_project" || order.projectId !== projectId) continue;
      if (proj.scope === "body") {
        if (order.targetBodyId === targetBodyId) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

// Empire-scope projects this empire can queue right now.
export function availableProjectsFor(state: GameState, empire: Empire) {
  return EMPIRE_PROJECTS.filter(
    (p) => p.scope === "empire" && canQueueProjectFor(state, empire, p.id),
  );
}

// Body-scope projects this empire can queue on the given body.
export function availableBodyProjectsFor(state: GameState, empire: Empire, bodyId: string) {
  return EMPIRE_PROJECTS.filter(
    (p) => p.scope === "body" && canQueueProjectFor(state, empire, p.id, bodyId),
  );
}

// In-flight body-scope project order targeting the given body. An
// order's target and its host body aren't always the same (Build
// Outpost on an unowned star is hosted on the capital), so we have to
// scan all of the target's empire's queues for a matching targetBodyId.
export function bodyProjectOrderFor(state: GameState, bodyId: string) {
  const body = state.galaxy.bodies[bodyId];
  if (!body) return null;
  for (const empire of allEmpires(state)) {
    for (const order of allOrdersOf(state, empire)) {
      if (order.kind !== "empire_project") continue;
      if (order.targetBodyId === bodyId) return order;
    }
  }
  return null;
}

// Hyperlane diameter of an empire's owned-systems subgraph. 0 for
// single-system empires, Infinity for empires whose systems aren't
// connected through their own hyperlane graph (rare — disconnected
// clusters from conquered islands). Implemented as BFS from each
// owned system, returning the max shortest-path distance.
export function empireDiameter(state: GameState, empire: Empire): number {
  const owned = new Set(empire.systemIds);
  if (owned.size <= 1) return 0;
  const adj: Record<string, string[]> = {};
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (owned.has(a) && owned.has(b)) {
      (adj[a] ??= []).push(b);
      (adj[b] ??= []).push(a);
    }
  }
  let best = 0;
  for (const start of empire.systemIds) {
    const dist: Record<string, number> = { [start]: 0 };
    const queue: string[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const cd = dist[cur];
      for (const nxt of adj[cur] ?? []) {
        if (nxt in dist) continue;
        dist[nxt] = cd + 1;
        queue.push(nxt);
      }
    }
    for (const d of Object.values(dist)) {
      if (d > best) best = d;
    }
  }
  return best;
}

// Political capital cost for a policy at the given empire's current
// spread. Base cost × (1 + diameter × 0.15), rounded.
export function policyCost(state: GameState, empire: Empire, policyId: string): number {
  const p = policyById(policyId);
  if (!p) return Infinity;
  const diameter = empireDiameter(state, empire);
  return Math.max(1, Math.round(p.basePoliticalCost * (1 + diameter * 0.15)));
}

export function canAdoptPolicy(state: GameState, empire: Empire, policyId: string): boolean {
  const p = policyById(policyId);
  if (!p) return false;
  if (empire.adoptedPolicies.includes(policyId)) return false;
  const a = p.availability;
  if (a?.speciesIds && !a.speciesIds.includes(empire.speciesId)) return false;
  if (a?.expansionism && !a.expansionism.includes(empire.expansionism)) return false;
  if (a?.politic && !a.politic.includes(empire.politic)) return false;
  if (a?.requiresFlag && !empire.flags.includes(a.requiresFlag)) return false;
  if (a?.excludesFlag && empire.flags.includes(a.excludesFlag)) return false;
  if (empire.political < policyCost(state, empire, policyId)) return false;
  return true;
}

export function availablePoliciesFor(state: GameState, empire: Empire): Array<{ policyId: string; cost: number; affordable: boolean }> {
  const diameter = empireDiameter(state, empire);
  return POLICIES
    .filter((p) => !empire.adoptedPolicies.includes(p.id))
    .filter((p) => {
      const a = p.availability;
      if (a?.speciesIds && !a.speciesIds.includes(empire.speciesId)) return false;
      if (a?.expansionism && !a.expansionism.includes(empire.expansionism)) return false;
      if (a?.politic && !a.politic.includes(empire.politic)) return false;
      if (a?.requiresFlag && !empire.flags.includes(a.requiresFlag)) return false;
      if (a?.excludesFlag && empire.flags.includes(a.excludesFlag)) return false;
      return true;
    })
    .map((p) => {
      const cost = Math.max(1, Math.round(p.basePoliticalCost * (1 + diameter * 0.15)));
      return { policyId: p.id, cost, affordable: empire.political >= cost };
    });
}

// Resolve contested systems: if fleets from two or more at-war empires
// share a system, combat iterates 30%-attrition rounds until only one
// side has ships left (or all have died). Happens entirely within one
// combat call — no "fight one round and retreat" — so the outcome
// feels decisive.
function resolveCombat(draft: GameState): void {
  const bySystem: Record<string, Fleet[]> = {};
  for (const f of Object.values(draft.fleets)) {
    (bySystem[f.systemId] ??= []).push(f);
  }
  for (const [sysId, fleets] of Object.entries(bySystem)) {
    const empires = Array.from(new Set(fleets.map((f) => f.empireId)));
    if (empires.length < 2) continue;

    // Snapshot before-counts for the chronicle entry (BEFORE the loop).
    const before: Record<string, number> = {};
    for (const f of fleets) {
      before[f.empireId] = (before[f.empireId] ?? 0) + f.shipCount;
    }

    // Fleets don't need fuel any more (upkeep was dropped), so every
    // present empire can always deal damage. The `damageOutMult` map
    // is kept as an API shape so downstream code needn't branch.
    const damageOutMult: Record<string, number> = {};
    for (const empId of empires) damageOutMult[empId] = 1;

    // Work out which empires are actually at war with at least one
    // other empire here. If only one such empire remains, nothing fights.
    const belligerents = empires.filter((a) => {
      return empires.some((b) => b !== a && atWar(draft, a, b));
    });
    const canDealDamage = empires.filter((e) =>
      empires.some((o) => o !== e && atWar(draft, e, o)),
    );
    if (canDealDamage.length < 2) continue;

    const shipsOf = (empId: string): number =>
      fleets
        .filter((f) => f.empireId === empId && f.shipCount > 0)
        .reduce((s, f) => s + f.shipCount, 0);

    let anyFightHappened = false;

    // Fast path: exactly two at-war empires contesting the system →
    // closed-form Lanchester square. Winner survivors = sqrt(A² - B²);
    // loser annihilated. Asymmetric damage output (one side in energy
    // deficit) reduces to "the fighting side keeps all its ships".
    if (canDealDamage.length === 2) {
      const [idA, idB] = canDealDamage;
      const shipsA = shipsOf(idA);
      const shipsB = shipsOf(idB);
      const canA = damageOutMult[idA] === 1 && shipsA > 0;
      const canB = damageOutMult[idB] === 1 && shipsB > 0;

      let survivorId: string | null = null;
      let survivorCount = 0;
      let fight = false;

      if (canA && !canB) {
        // Only A can fight; B is shot to pieces without returning fire.
        survivorId = idA;
        survivorCount = shipsA;
        fight = shipsB > 0;
      } else if (canB && !canA) {
        survivorId = idB;
        survivorCount = shipsB;
        fight = shipsA > 0;
      } else if (canA && canB) {
        fight = true;
        if (shipsA > shipsB) {
          survivorId = idA;
          survivorCount = Math.floor(Math.sqrt(shipsA * shipsA - shipsB * shipsB));
        } else if (shipsB > shipsA) {
          survivorId = idB;
          survivorCount = Math.floor(Math.sqrt(shipsB * shipsB - shipsA * shipsA));
        } else {
          // Mutual annihilation.
          survivorId = null;
          survivorCount = 0;
        }
      }

      if (fight) {
        anyFightHappened = true;
        for (const f of fleets) {
          if (f.empireId !== idA && f.empireId !== idB) continue;
          if (f.shipCount <= 0) continue;
          if (f.empireId === survivorId) {
            const totalForSide = f.empireId === idA ? shipsA : shipsB;
            const share = f.shipCount / totalForSide;
            f.shipCount = Math.max(0, Math.round(share * survivorCount));
          } else {
            f.shipCount = 0;
          }
        }
      }
    } else {
      // Fallback: 3+ at-war empires contesting (rare). Iterative
      // attrition until only one side has ships left.
      for (let round = 0; round < 100; round++) {
        const empireShips: Record<string, number> = {};
        for (const f of fleets) {
          if (f.shipCount > 0) {
            empireShips[f.empireId] = (empireShips[f.empireId] ?? 0) + f.shipCount;
          }
        }
        const liveEmpires = Object.keys(empireShips);
        if (liveEmpires.length < 2) break;

        const damageIn: Record<string, number> = {};
        let totalDamage = 0;
        for (const empId of liveEmpires) {
          let enemyDamage = 0;
          for (const otherId of liveEmpires) {
            if (otherId === empId) continue;
            if (atWar(draft, empId, otherId)) {
              enemyDamage += empireShips[otherId] * damageOutMult[otherId];
            }
          }
          damageIn[empId] = enemyDamage * 0.3;
          totalDamage += enemyDamage;
        }
        if (totalDamage === 0) break;
        anyFightHappened = true;

        for (const f of fleets) {
          if (f.shipCount <= 0) continue;
          if ((damageIn[f.empireId] ?? 0) <= 0) continue;
          const empTotal = empireShips[f.empireId];
          if (empTotal === 0) continue;
          const share = f.shipCount / empTotal;
          const losses = Math.max(1, Math.ceil(damageIn[f.empireId] * share));
          f.shipCount = Math.max(0, f.shipCount - losses);
        }
      }
    }
    void belligerents;
    if (!anyFightHappened) continue;

    // After-counts per empire; then drop empty fleets.
    const after: Record<string, number> = {};
    for (const f of fleets) {
      if (f.shipCount > 0) after[f.empireId] = (after[f.empireId] ?? 0) + f.shipCount;
    }
    for (const empId of empires) {
      if (!(empId in after)) after[empId] = 0;
    }
    for (const f of fleets) {
      if (f.shipCount <= 0) delete draft.fleets[f.id];
    }

    if (empires.includes(draft.empire.id)) {
      const sys = draft.galaxy.systems[sysId];
      const sysName = sys?.name ?? "a contested system";
      const playerId = draft.empire.id;
      const parts: string[] = [];
      // Player side first, then each foreign empire alphabetically.
      const orderedEmpires = empires.slice().sort((a, b) => {
        if (a === playerId) return -1;
        if (b === playerId) return 1;
        return a.localeCompare(b);
      });
      for (const empId of orderedEmpires) {
        const e = empireById(draft, empId);
        const label = empId === playerId ? "you" : e?.name ?? "unknown";
        const b = before[empId] ?? 0;
        const a = after[empId] ?? 0;
        parts.push(`${label} ${b}→${a}`);
      }
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "combat",
        choiceId: null,
        text: `Combat at ${sysName}: ${parts.join(", ")}.`,
      });
    }
  }
}

// Turns an unopposed enemy presence must hold before a system flips.
export const OCCUPATION_TURNS_TO_FLIP = 3;

// After combat each turn, advance or clear occupation counters and
// flip systems that crossed the threshold. Then prune any empires
// left with zero systems.
function processOccupation(draft: GameState): void {
  const flips: Array<{ systemId: string; fromOwnerId: string; toOwnerId: string }> = [];

  // Index fleets by their current system once, so we don't re-scan
  // all fleets for every system in the loop below. Fleets get
  // mutated upstream (mutate() teleports one, resolveCombat changes
  // shipCount), so we read from the draft (proxy) to see the
  // post-combat state.
  const fleetsBySystem = new Map<string, Fleet[]>();
  for (const f of Object.values(draft.fleets)) {
    if (f.shipCount <= 0) continue;
    let arr = fleetsBySystem.get(f.systemId);
    if (!arr) {
      arr = [];
      fleetsBySystem.set(f.systemId, arr);
    }
    arr.push(f);
  }

  // Systems don't mutate upstream of this call — the only writes so
  // far are fleet movement + combat. Read from the unproxied original
  // to avoid creating 100+ Immer proxies; only iterate *owned* systems
  // since unowned systems can't have occupation set (every occupation
  // assignment in the codebase requires sys.ownerId). This is the
  // bulk of the AI's per-turn cost.
  const baseGalaxy = original(draft.galaxy) ?? draft.galaxy;
  const baseSystems = baseGalaxy.systems;
  // Walk ownerId directly off each system rather than going through
  // empires; avoids extra original(empire) hops on the hot path.
  for (const sys of Object.values(baseSystems)) {
    const ownerId = sys.ownerId;
    if (!ownerId) continue;
    const fleetsHere = fleetsBySystem.get(sys.id) ?? [];
    const defenderPresent = fleetsHere.some((f) => f.empireId === ownerId);
    if (defenderPresent) {
      if (sys.occupation) draft.galaxy.systems[sys.id].occupation = undefined;
      continue;
    }
    const invaderEmpireIds = new Set<string>();
    for (const f of fleetsHere) {
      if (f.empireId !== ownerId && atWar(draft, ownerId, f.empireId)) {
        invaderEmpireIds.add(f.empireId);
      }
    }
    if (invaderEmpireIds.size === 0) {
      if (sys.occupation) draft.galaxy.systems[sys.id].occupation = undefined;
      continue;
    }
    if (invaderEmpireIds.size > 1) {
      // Contested — nobody can occupy until one side wins out.
      if (sys.occupation) draft.galaxy.systems[sys.id].occupation = undefined;
      continue;
    }
    const invaderId = Array.from(invaderEmpireIds)[0];
    const continuing = sys.occupation && sys.occupation.empireId === invaderId;
    const newTurns = continuing ? sys.occupation!.turns + 1 : 1;
    draft.galaxy.systems[sys.id].occupation = { empireId: invaderId, turns: newTurns };
    if (!continuing && (ownerId === draft.empire.id || invaderId === draft.empire.id)) {
      const invader = empireById(draft, invaderId);
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "occupation_begun",
        choiceId: null,
        text: `${invader?.name ?? "Enemy"} fleet is occupying ${sys.name}.`,
      });
    }
    if (newTurns >= OCCUPATION_TURNS_TO_FLIP) {
      flips.push({ systemId: sys.id, fromOwnerId: ownerId, toOwnerId: invaderId });
    }
  }

  for (const flip of flips) {
    flipSystem(draft, flip.systemId, flip.fromOwnerId, flip.toOwnerId);
  }
}

function flipSystem(
  draft: GameState,
  systemId: string,
  fromOwnerId: string,
  toOwnerId: string,
): void {
  const sys = draft.galaxy.systems[systemId];
  if (!sys) return;
  const oldOwner = empireById(draft, fromOwnerId);
  const newOwner = empireById(draft, toOwnerId);
  if (!oldOwner || !newOwner) return;

  sys.ownerId = toOwnerId;
  sys.occupation = undefined;
  oldOwner.systemIds = oldOwner.systemIds.filter((id) => id !== systemId);
  if (!newOwner.systemIds.includes(systemId)) newOwner.systemIds.push(systemId);

  // If the old owner lost their capital, the capital pointer dangles —
  // pick a new capital from whatever they have left (if anything).
  if (oldOwner.capitalBodyId) {
    const capBody = draft.galaxy.bodies[oldOwner.capitalBodyId];
    if (capBody && capBody.systemId === systemId) {
      oldOwner.capitalBodyId = null;
      for (const sid of oldOwner.systemIds) {
        const s = draft.galaxy.systems[sid];
        if (!s) continue;
        for (const bid of s.bodyIds) {
          const b = draft.galaxy.bodies[bid];
          if (b && b.pops > 0) {
            oldOwner.capitalBodyId = b.id;
            break;
          }
        }
        if (oldOwner.capitalBodyId) break;
      }
    }
  }

  // Log for the player if they're on either side of it.
  const playerId = draft.empire.id;
  if (fromOwnerId === playerId || toOwnerId === playerId) {
    const winner = toOwnerId === playerId ? "You" : newOwner.name;
    const loser = fromOwnerId === playerId ? "you" : oldOwner.name;
    draft.eventLog.push({
      turn: draft.turn,
      eventId: "system_conquered",
      choiceId: null,
      text: `${sys.name} has fallen — ${winner} took it from ${loser}.`,
    });
  }
}

// Remove empires that hold zero systems. Player elimination flips the
// gameOver flag; AI elimination drops them from the roster and cleans
// up their fleets + wars.
// First-contact detection: fires when two empires' territories first
// become hyperlane-adjacent (any system of A touches any system of B
// via one hyperlane hop). Each side gets a "met:<otherId>" flag so it
// only fires once per pair, and the player side gets a chronicle entry
// plus a pendingFirstContacts entry for the UI modal.
function detectFirstContacts(draft: GameState): void {
  const ownerOf: Record<string, string> = {};
  for (const sys of Object.values(draft.galaxy.systems)) {
    if (sys.ownerId) ownerOf[sys.id] = sys.ownerId;
  }
  // Build adjacency pairs between different empires.
  const contactPairs = new Set<string>();
  for (const [a, b] of draft.galaxy.hyperlanes) {
    const oa = ownerOf[a];
    const ob = ownerOf[b];
    if (!oa || !ob || oa === ob) continue;
    const key = oa < ob ? `${oa}|${ob}` : `${ob}|${oa}`;
    contactPairs.add(key);
  }
  const playerId = draft.empire.id;
  for (const key of contactPairs) {
    const [idA, idB] = key.split("|");
    const flagA = `met:${idB}`;
    const flagB = `met:${idA}`;
    const empA = empireById(draft, idA);
    const empB = empireById(draft, idB);
    if (!empA || !empB) continue;
    const alreadyMet =
      empA.flags.includes(flagA) || empB.flags.includes(flagB);
    if (alreadyMet) continue;
    if (!empA.flags.includes(flagA)) empA.flags.push(flagA);
    if (!empB.flags.includes(flagB)) empB.flags.push(flagB);
    // Chronicle + UI hook only when the player's involved.
    if (idA === playerId || idB === playerId) {
      const other = idA === playerId ? empB : empA;
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "first_contact",
        choiceId: null,
        text: `First contact: ${other.name} — ${other.expansionism} ${other.politic}.`,
      });
      draft.pendingFirstContacts.push({
        otherEmpireId: other.id,
        turn: draft.turn,
      });
    }
  }
}

function checkEliminations(draft: GameState): void {
  // An empire is eliminated only when it has no systems AND no ships.
  // Lose your last planet but keep a fleet? You're a wandering ghost
  // empire until that fleet dies. Same rule for player + AIs.
  function hasShips(empireId: string): boolean {
    for (const f of Object.values(draft.fleets)) {
      if (f.empireId === empireId && f.shipCount > 0) return true;
    }
    return false;
  }
  if (
    draft.empire.systemIds.length === 0 &&
    !hasShips(draft.empire.id) &&
    !draft.gameOver
  ) {
    draft.gameOver = true;
    draft.eventLog.push({
      turn: draft.turn,
      eventId: "empire_eliminated",
      choiceId: null,
      text: `Your empire has fallen. There is nothing left to command.`,
    });
  }
  const survivors: Empire[] = [];
  for (const ai of draft.aiEmpires) {
    if (ai.systemIds.length > 0 || hasShips(ai.id)) {
      survivors.push(ai);
    } else {
      // Clean up wars (they have no fleets left either).
      draft.wars = draft.wars.filter(([a, b]) => a !== ai.id && b !== ai.id);
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "empire_eliminated",
        choiceId: null,
        text: `${ai.name} has fallen.`,
      });
    }
  }
  draft.aiEmpires = survivors;
}

export function fleetsInSystem(state: GameState, systemId: string): Fleet[] {
  return Object.values(state.fleets).filter((f) => f.systemId === systemId);
}

// =====================================================================
// War state — symmetric relation stored as sorted pairs.
// =====================================================================
function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function atWar(state: GameState, a: string, b: string): boolean {
  if (a === b) return false;
  const [x, y] = sortedPair(a, b);
  return state.wars.some(([p, q]) => p === x && q === y);
}

// Enemies of `empireId` — every empire we have an active war with.
export function enemiesOf(state: GameState, empireId: string): string[] {
  const out: string[] = [];
  for (const [a, b] of state.wars) {
    if (a === empireId) out.push(b);
    else if (b === empireId) out.push(a);
  }
  return out;
}

// When a fleet lands at a system owned by a foreign empire we aren't
// already at war with, the entry IS a declaration. Push the war to
// state.wars and log a chronicle entry if the player's involved.
// Called by both the real fleet-movement path and the scoreCandidate
// projection so the AI sees war as a downstream consequence of moves.
export function maybeAutoDeclareWar(
  state: GameState,
  moverEmpireId: string,
  systemId: string,
): void {
  const sys = state.galaxy.systems[systemId];
  if (!sys) return;
  const ownerId = sys.ownerId;
  if (!ownerId || ownerId === moverEmpireId) return;
  if (atWar(state, moverEmpireId, ownerId)) return;
  const pair = sortedPair(moverEmpireId, ownerId);
  state.wars.push(pair);
  if (moverEmpireId === state.empire.id || ownerId === state.empire.id) {
    const mover = empireById(state, moverEmpireId);
    const defender = empireById(state, ownerId);
    state.eventLog.push({
      turn: state.turn,
      eventId: "war_declared",
      choiceId: null,
      text: `${mover?.name ?? "?"} declared war on ${defender?.name ?? "?"} by entering ${sys.name}.`,
    });
  }
}

// Can `moverEmpireId` legally enter `systemId`? Own territory, unowned
// space, and enemy (at-war) territory all qualify. Neutral-owned space
// is off-limits until war is declared.
// Any system is legally enterable. Entering a foreign-owned system
// that you're not already at war with is itself the declaration —
// the fleet movement path (processFleetOrders, and the scoreCandidate
// projection in aiPlanMoves) calls maybeAutoDeclareWar on arrival.
// The _moverEmpireId parameter is retained for signature stability;
// the war check has moved to the entry point.
export function canEnterSystem(
  state: GameState,
  _moverEmpireId: string,
  systemId: string,
): boolean {
  return state.galaxy.systems[systemId] !== undefined;
}

// BFS shortest path between systems, respecting canEnterSystem for
// every node after the start. Returns the list of system ids AFTER
// `fromSystemId` up to and including `toSystemId`, or null if no legal
// path exists. The origin is always traversable regardless of current
// ownership (fleets can always leave where they currently sit).
export function shortestPathFor(
  state: GameState,
  empireId: string,
  fromSystemId: string,
  toSystemId: string,
): string[] | null {
  if (fromSystemId === toSystemId) return [];
  const adj = new Map<string, string[]>();
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const prev = new Map<string, string>();
  const visited = new Set<string>([fromSystemId]);
  const queue: string[] = [fromSystemId];
  let found = false;
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === toSystemId) { found = true; break; }
    for (const n of adj.get(id) ?? []) {
      if (visited.has(n)) continue;
      if (!canEnterSystem(state, empireId, n)) continue;
      visited.add(n);
      prev.set(n, id);
      queue.push(n);
    }
  }
  if (!found) return null;
  const out: string[] = [];
  let cur = toSystemId;
  while (cur !== fromSystemId) {
    out.push(cur);
    const p = prev.get(cur);
    if (!p) return null;
    cur = p;
  }
  out.reverse();
  return out;
}

export function totalFleetShipsFor(state: GameState, empire: Empire): number {
  let total = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.empireId === empire.id) total += f.shipCount;
  }
  return total;
}

export function canColonizeFor(state: GameState, empire: Empire, targetBodyId: string): boolean {
  const target = state.galaxy.bodies[targetBodyId];
  if (!target) return false;
  // Stars aren't colonisable — they're claim targets for outposts.
  if (target.kind === "star") return false;
  const targetSys = state.galaxy.systems[target.systemId];
  if (!targetSys) return false;
  if (target.pops > 0) return false;
  // Zero effective space = no pops can live here anyway.
  if (maxPopsFor(empire, target) <= 0) return false;
  if (colonizeOrderForTarget(state, targetBodyId)) return false;
  // Colonising now requires the system to already be ours — the
  // system claim happens via Build Outpost on the star, not via
  // colonising a body.
  if (targetSys.ownerId !== empire.id) return false;
  // Colony ship: requires the capital to have enough pops to load onto
  // the ship. Pops are deducted at queue time and delivered on arrival.
  const cap = empire.capitalBodyId ? state.galaxy.bodies[empire.capitalBodyId] : null;
  if (!cap || cap.pops < COLONIZE_POP_COST) return false;
  return true;
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

// hostBodyId is the body the order is queued on (for per-body queues).
// It's used to figure out which component pays the food/energy cost
// of the project when it completes.
function completeOrder(
  draft: GameState,
  empire: Empire,
  order: BuildOrder,
  hostBodyId: string,
): void {
  if (order.kind === "colonize") {
    const target = draft.galaxy.bodies[order.targetBodyId];
    const targetSys = target ? draft.galaxy.systems[target.systemId] : null;
    const fizzled = !target || !targetSys || targetSys.ownerId !== empire.id;
    if (fizzled) {
      // Colony never landed. Refund the settlers to the current capital
      // so the pops aren't silently destroyed.
      const cap = empire.capitalBodyId ? draft.galaxy.bodies[empire.capitalBodyId] : null;
      if (cap) cap.pops += COLONIZE_POP_COST;
      return;
    }
    empire.political -= order.politicalCost;
    target.pops = Math.max(target.pops, COLONIZE_STARTER_POPS);
    if (empire.id === draft.empire.id) {
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "colonize",
        choiceId: null,
        text: `Colonized ${target.name} in ${targetSys.name}.`,
      });
    }
  } else if (order.kind === "empire_project") {
    const proj = projectById(order.projectId);
    if (!proj) return;
    // One-shot stock costs. Political pays from empire; food/energy
    // pay from the host body's component pool (or capital's component
    // if this is a capital-scope project). No component = no deduction
    // (edge case: project completed in an occupied system).
    if (proj.costs) {
      const hostBody = draft.galaxy.bodies[hostBodyId];
      const compId = hostBody ? componentOfSystem(draft, empire, hostBody.systemId) : null;
      const pool = compId ? empire.componentPools[compId] : null;
      for (const k of RESOURCE_KEYS) {
        const c = proj.costs[k];
        if (!c) continue;
        if (k === "political") empire.political -= c;
        else if (pool) pool[k] -= c;
      }
    }
    // Apply completion effects.
    if (proj.onComplete.removeStoryModifierKeys) {
      for (const key of proj.onComplete.removeStoryModifierKeys) {
        delete empire.storyModifiers[key];
      }
    }
    if (proj.onComplete.grantStoryModifiers) {
      for (const [key, mods] of Object.entries(proj.onComplete.grantStoryModifiers)) {
        empire.storyModifiers[key] = mods;
      }
    }
    if (proj.onComplete.addFlag && !empire.flags.includes(proj.onComplete.addFlag)) {
      empire.flags.push(proj.onComplete.addFlag);
    }
    // Ship-spawning projects land their ships in the target body's
    // system. Only meaningful for body-scope projects; empire-scope
    // projects without a targetBodyId silently skip.
    if (proj.onComplete.spawnShip && order.targetBodyId) {
      const targetBody = draft.galaxy.bodies[order.targetBodyId];
      if (targetBody) {
        spawnShipsInSystem(
          draft,
          empire.id,
          targetBody.systemId,
          proj.onComplete.spawnShip.count,
        );
      }
    }
    // Build Outpost — claims the star's system for the empire. Any
    // project with bodyRequirement "star" gets this treatment so
    // future flavour outposts don't need bespoke wiring.
    if (proj.bodyRequirement === "star" && order.targetBodyId) {
      const starBody = draft.galaxy.bodies[order.targetBodyId];
      if (starBody) {
        const sys = draft.galaxy.systems[starBody.systemId];
        if (sys && !sys.ownerId) {
          sys.ownerId = empire.id;
          if (!empire.systemIds.includes(sys.id)) empire.systemIds.push(sys.id);
          if (empire.id === draft.empire.id) {
            draft.eventLog.push({
              turn: draft.turn,
              eventId: "outpost",
              choiceId: null,
              text: `Outpost established — ${sys.name} is yours.`,
            });
          }
        }
      }
    }
    empire.completedProjects.push(proj.id);
    if (empire.id === draft.empire.id) {
      draft.eventLog.push({
        turn: draft.turn,
        eventId: `project:${proj.id}`,
        choiceId: null,
        text: proj.onComplete.chronicle,
      });
    }
  }
}

// ===== Per-empire turn tick =====

// Kill one pop during a famine, restricted to bodies in one connected
// component (since food pools are per-component now). Preferentially
// targets the largest non-capital colony in the component so the
// empire's capital is the last to collapse.
function killStarvingPopInComponent(
  draft: GameState,
  empire: Empire,
  components: Map<string, string>,
  componentId: string,
): string | null {
  const candidates: Body[] = [];
  for (const body of ownedBodiesOf(draft, empire)) {
    if (body.pops <= 0) continue;
    if (components.get(body.systemId) !== componentId) continue;
    candidates.push(body);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aCap = a.id === empire.capitalBodyId ? 1 : 0;
    const bCap = b.id === empire.capitalBodyId ? 1 : 0;
    if (aCap !== bCap) return aCap - bCap;        // non-capital first
    return b.pops - a.pops;                        // highest pops first
  });
  const target = draft.galaxy.bodies[candidates[0].id];
  if (!target) return null;
  target.pops -= 1;
  return target.name;
}

// Per-turn energy cost of each owned system's outpost.
export function outpostEnergyUpkeep(empire: Empire): number {
  return empire.systemIds.length * BALANCE.outpostEnergyUpkeep;
}

function tickEmpire(draft: GameState, empire: Empire): void {
  // 0. Resync feature modifiers from current body.features. Handles
  //    conquest / body loss cleanly — a Brood Mother captured this
  //    turn is already contributing, and one we lost has stopped.
  syncFeatureModifiers(draft, empire);

  // 1. Reconcile component pools against current graph membership.
  //    New components get empty pools; pools for defunct components
  //    (merged or split away) are dropped. Pools for untransitable
  //    systems (those being occupied by an enemy) aren't in the map,
  //    so their stranded income is implicitly lost — can't ship
  //    under siege.
  reconcileComponentPools(draft, empire);
  const components = computeComponents(draft, empire);

  // 2. Apply political income (empire-wide).
  empire.political += empirePoliticalIncomeOf(draft, empire);

  // 3. Apply per-component food + energy income.
  const compIds = new Set(components.values());
  for (const cid of compIds) {
    const ci = componentIncomeOf(draft, empire, cid);
    const pool = getComponentPool(empire, cid);
    pool.food += ci.food;
    pool.energy += ci.energy;
  }

  // 4. Reset per-body hammer flow + empire compute.
  empire.compute.cap = computeCapOf(draft, empire);
  empire.compute.used = 0;
  for (const body of ownedBodiesOf(draft, empire)) {
    const live = draft.galaxy.bodies[body.id];
    if (live) {
      live.hammers = Math.floor(live.pops * hammersPerPopFor(empire, live));
    }
  }

  // 5. Drain each body's hammers into its own FIFO queue. Hammers are
  //    system-local — a frontier system's output can't be pooled into
  //    a capital megaproject. Completed orders roll up via the same
  //    completeOrder path the empire queue used to.
  for (const body of ownedBodiesOf(draft, empire)) {
    const live = draft.galaxy.bodies[body.id];
    if (!live) continue;
    let pool = live.hammers;
    while (pool > 0 && live.queue.length > 0) {
      const order = live.queue[0];
      const need = order.hammersRequired - order.hammersPaid;
      const spent = Math.min(pool, need);
      order.hammersPaid += spent;
      pool -= spent;
      if (order.hammersPaid >= order.hammersRequired) {
        completeOrder(draft, empire, order, live.id);
        live.queue.shift();
      } else {
        break;
      }
    }
  }

  // 6. Pop growth — deterministic logistic, per-component food gate.
  //    ΔPops = (BASE × popGrowthMult × pops + additive) × (1 − pops/cap)
  //    A body only grows if its component has food; the growth cost
  //    (50 food/pop) drains from that component's pool only.
  const growthMult = popGrowthMultiplier(empire);
  const growthAdd = popGrowthAdditive(empire);
  for (const sid of empire.systemIds) {
    const sys = draft.galaxy.systems[sid];
    if (!sys) continue;
    const cid = components.get(sid);
    if (!cid) continue; // untransitable system: no shared food
    const pool = empire.componentPools[cid];
    if (!pool) continue;
    for (const bid of sys.bodyIds) {
      const body = draft.galaxy.bodies[bid];
      if (!body) continue;
      const cap = maxPopsFor(empire, body);
      if (body.pops > cap) body.pops = cap;
      if (body.pops >= cap) continue;
      if (body.pops <= 0) continue;
      if (pool.food <= 0) continue;
      const headroom = cap > 0 ? (cap - body.pops) / cap : 0;
      const organic = BASE_ORGANIC_GROWTH_RATE * growthMult * body.pops;
      // Body-local additive (e.g. the queen on her host body) stacks
      // on top of the empire-wide additive pool.
      const localAdd = sumDelta(bodyFeatureModifiers(body), "popGrowthAdd");
      const delta = (organic + growthAdd + localAdd) * headroom;
      if (delta <= 0) continue;
      const capped = Math.min(delta, cap - body.pops);
      body.pops += capped;
      pool.food -= POP_GROWTH_FOOD_COST * capped;
    }
  }

  // 7. Internal migration. Within each connected component, drift
  //    MIGRATION_RATE_PER_POP × source.pops from the most-populated
  //    body toward the body with the most absolute headroom. Scales
  //    with empire size so late-game hives move meaningful numbers
  //    while early colonies still trickle. Uncolonised bodies aren't
  //    eligible sinks — colony ships remain the way to settle new
  //    worlds.
  for (const cid of compIds) {
    const inComponent: Body[] = [];
    for (const body of ownedBodiesOf(draft, empire)) {
      if (components.get(body.systemId) !== cid) continue;
      inComponent.push(body);
    }
    if (inComponent.length < 2) continue;
    let source: Body | null = null;
    let sink: Body | null = null;
    for (const b of inComponent) {
      const cap = maxPopsFor(empire, b);
      if (b.pops >= 1 && (!source || b.pops > source.pops)) source = b;
      const headroom = cap - b.pops;
      if (
        b.pops > 0 &&
        headroom > 0 &&
        (!sink || headroom > maxPopsFor(empire, sink) - sink.pops)
      ) {
        sink = b;
      }
    }
    if (!source || !sink || source.id === sink.id) continue;
    if (source.pops <= sink.pops) continue; // don't reverse-flow
    // Scales with source population; cap the flow at the imbalance so
    // we don't overshoot the sink past the source in one turn.
    const desired = MIGRATION_RATE_PER_POP * source.pops;
    const maxFair = (source.pops - sink.pops) / 2;
    const moved = Math.min(desired, maxFair, source.pops);
    if (moved <= 0) continue;
    source.pops -= moved;
    sink.pops += moved;
  }

  // 8. Per-component famine. Each component with food < 0 starves one
  //    pop somewhere *in that component* and clamps food back to zero.
  //    A disconnected region runs out of food first; famines are local.
  for (const cid of compIds) {
    const pool = empire.componentPools[cid];
    if (!pool || pool.food >= 0) continue;
    const starved = killStarvingPopInComponent(draft, empire, components, cid);
    pool.food = 0;
    if (starved && empire.id === draft.empire.id) {
      draft.eventLog.push({
        turn: draft.turn,
        eventId: "famine",
        choiceId: null,
        text: `Famine on ${starved}. A pop died.`,
      });
    }
  }
}

// AI colonize policy. Each expansionism tier has a different threshold
// for willingness to queue a new colonize project:
//  - Conqueror  : queues as soon as political capital covers the cost.
//  - Pragmatist : waits until there's a comfortable surplus.
//  - Isolationist: only expands into intra-system uncolonized bodies
//                  (no new system claims) and only with a big surplus.
// Pick and apply at most one project action per AI empire per turn.
// Prefers colonizing the best available body; falls back to queuing a
// frigate if fleet target isn't met; else no-op.
// ===================================================================
// AI value function + action search.
//
// scoreState values a game state for a given empire in hammer-equivalent
// units: every system is "worth" what it cost to colonize, every ship
// is worth what it cost to build, and stockpiled political capital has
// a rough hammer exchange rate. In-flight projects contribute partial
// credit proportional to completion, discounted so the AI still prefers
// things that are actually built.
// ===================================================================
// Horizon weight on per-turn flows — "how many turns of this future
// stream do I value". Different per-resource weights sit below; the
// horizon multiplies all of them uniformly.
export const FLOW_HORIZON = 5;

// Per-resource weight on flow values. Political is scarce and hard to
// generate, so each point is worth 3× a point of food / energy / hammers.
// These slot into scoreState and into the occupation preview.
export const FLOW_WEIGHTS = {
  hammers: 1,
  food: 1,
  energy: 1,
  political: 3,
} as const;

// Every body contributes to an owned system's intrinsic value. Stars
// encode the "owning this node in the galaxy" value — what the old
// sysClaim used to be — so a system-with-only-a-star is still worth
// claiming for transit / denial. Planets and moons contribute via
// pop potential: maxPops × MAX_POPS_VALUE. Actual population value
// flows through this term's sibling (bodyFlowScore), not through the
// intrinsic.
export const STAR_BODY_VALUE = 600;
// Score per unit of effective maxPops. Calibrated so a 50%-full
// temperate (pops ~1.75/t food-eq ≈ 175 flow × horizon 5 = 875) sits
// at roughly 80% flow / 20% potential with 100 maxPops (200 potential).
export const MAX_POPS_VALUE = 2;

// Occupation progress weighting: how close to a flip does the AI
// think an active siege is worth? Indexed by occ.turns (1-based),
// so turn 1 = 0.3, turn 2 = 0.6, turn 3 = 1.0. Indices outside
// [1, OCCUPATION_TURNS_TO_FLIP] clamp to 0.
const OCCUPATION_WEIGHT_BY_TURNS: readonly number[] = [0, 0.3, 0.6, 1.0];

// Per-enemy cost of being at war, by archetype. Subtracted from
// scoreState once per active war. Conquerors pay nothing (they
// value fleet pressure for its own sake, already captured in
// ship-value at-war premium). Pragmatists pay a moderate amount —
// they'd rather stability. Isolationists pay a lot — any war is
// an existential affront to their worldview. This is how "moving
// into enemy territory auto-declares war" gets priced into the
// value function: the move gains whatever conquest promises, but
// takes a standing hit for having the enemy on your books.
const AT_WAR_COST_PER_ENEMY: Record<Expansionism, number> = {
  conqueror: 0,
  pragmatist: 500,
  isolationist: 2000,
};

// Per-archetype intrinsic value of a ship, measured in hammer-
// equivalent units. Derived from the actual build_frigate cost so
// retuning the project content automatically retunes the AI's ship
// valuation. Conquerors price a ship above its raw cost (they value
// fleet pressure); pragmatists at cost; isolationists slightly
// above (they want enough to deter, not raid).
const SHIP_VALUE_MULT: Record<Expansionism, number> = {
  conqueror: 1.5,
  pragmatist: 1.0,
  isolationist: 1.25,
};
function shipValueFor(empire: Empire): number {
  const frigate = projectById("build_frigate");
  const cost = frigate?.hammersRequired ?? COLONIZE_HAMMERS;
  return cost * SHIP_VALUE_MULT[empire.expansionism];
}

// A body's intrinsic contribution to its owning empire's score.
// Stars carry STAR_BODY_VALUE (the "owning this system" premium —
// what sysClaim used to be). Other bodies contribute via pop
// potential: maxPopsFor × MAX_POPS_VALUE. Realized population shows
// up through flows elsewhere; this term is pure potential.
function bodyIntrinsicValue(empire: Empire, body: Body): number {
  if (body.kind === "star") return STAR_BODY_VALUE;
  return maxPopsFor(empire, body) * MAX_POPS_VALUE;
}

// Sum a system's current-turn flows (hammers + food/energy/political)
// weighted per resource. Used both for the main score (over owned
// bodies) and as the "expected flow from this system" preview for
// occupation + outposts.
function bodyFlowScore(empire: Empire, body: Body): number {
  const hammers = body.pops * hammersPerPopFor(empire, body);
  const income = bodyIncomeFor(empire, body);
  return (
    hammers * FLOW_WEIGHTS.hammers +
    income.food * FLOW_WEIGHTS.food +
    income.energy * FLOW_WEIGHTS.energy +
    income.political * FLOW_WEIGHTS.political
  );
}

// Full per-body score contribution as if the body were owned right
// now: intrinsic potential + this-turn flow × horizon. The occupation
// and outpost paths use this to preview what a system will be worth
// once it flips / claims.
function bodyOwnedScore(empire: Empire, body: Body): number {
  return bodyIntrinsicValue(empire, body) + bodyFlowScore(empire, body) * FLOW_HORIZON;
}

function systemOwnedScore(empire: Empire, sys: StarSystem, state: GameState): number {
  let total = 0;
  for (const bid of sys.bodyIds) {
    const body = state.galaxy.bodies[bid];
    if (body) total += bodyOwnedScore(empire, body);
  }
  return total;
}

// Bench counters for the AI hot path. Tests (perf bench) reset at
// the start of a measurement window and read at the end. In normal
// play these are just integer bumps — negligible.
export const BENCH = {
  scoreStateCalls: 0,
  scoreStateTimeMs: 0,
  moveCandidateCalls: 0,
  moveCandidateTimeMs: 0,
  produceTimeMs: 0,
  resolveCombatTimeMs: 0,
  processOccupationTimeMs: 0,
  reset() {
    this.scoreStateCalls = 0;
    this.scoreStateTimeMs = 0;
    this.moveCandidateCalls = 0;
    this.moveCandidateTimeMs = 0;
    this.produceTimeMs = 0;
    this.resolveCombatTimeMs = 0;
    this.processOccupationTimeMs = 0;
  },
};

export function scoreState(state: GameState, empireId: string): number {
  const __t0 = performance.now();
  const empire = empireById(state, empireId);
  if (!empire) {
    BENCH.scoreStateCalls += 1;
    BENCH.scoreStateTimeMs += performance.now() - __t0;
    return -Infinity;
  }
  let score = 0;
  // Owned bodies: each one's intrinsic value (star → STAR_BODY_VALUE,
  // other → maxPops × MAX_POPS_VALUE) + its current-turn flows ×
  // horizon × resource weights. The old "system-claim" constant is
  // encoded as the star's body value, so a system's total = sum over
  // its bodies with no separate per-system flat.
  for (const sysId of empire.systemIds) {
    const sys = state.galaxy.systems[sysId];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const body = state.galaxy.bodies[bid];
      if (!body) continue;
      score += bodyOwnedScore(empire, body);
    }
  }
  // Empire-wide flows not attributed to any single body: baseline
  // political tick, flat empire modifiers (e.g. Steady Evolution's
  // +0.2 political), and outpost upkeep drain. These layer on top of
  // the per-body flows already credited above.
  {
    const mods = empireModifiers(empire);
    const pcFlat = 1 + flatEmpireIncome(mods, "political");
    const foodFlat = flatEmpireIncome(mods, "food");
    const energyFlat = flatEmpireIncome(mods, "energy");
    const outpostDrain = empire.systemIds.length * BALANCE.outpostEnergyUpkeep;
    score += pcFlat * FLOW_HORIZON * FLOW_WEIGHTS.political;
    score += foodFlat * FLOW_HORIZON * FLOW_WEIGHTS.food;
    score += (energyFlat - outpostDrain) * FLOW_HORIZON * FLOW_WEIGHTS.energy;
  }
  // Ships: archetype-weighted × at-war premium, with diminishing
  // returns once the fleet exceeds the per-turn compute cap (ships
  // you can't move in a single turn are mostly dead weight).
  const totalShips = totalFleetShipsFor(state, empire);
  if (totalShips > 0) {
    const atWar = enemiesOf(state, empire.id).length > 0;
    const shipBase = shipValueFor(empire) * (atWar ? 1.2 : 1.0);
    const cap = computeCapOf(state, empire);
    const mobileShips = Math.min(totalShips, cap);
    const stuckShips = Math.max(0, totalShips - cap);
    score += mobileShips * shipBase;
    score += stuckShips * shipBase * 0.2;
  }
  // Political stockpile: empire-wide, expensive to regenerate.
  score += empire.political * 15;
  // Archetype-weighted cost of being at war. Entering foreign space
  // auto-declares war; this term is how we price that consequence
  // into the value function.
  const enemies = enemiesOf(state, empire.id);
  score -= enemies.length * AT_WAR_COST_PER_ENEMY[empire.expansionism];
  // Enemy threat term: every enemy ship is a future headache, priced
  // at the same rate we value our own ships. Without this, combat
  // reads as pure cost (we lose ships and can't credit kills), so
  // the AI would decline even winning engagements. With it, 1:1
  // trades are neutral and favourable trades are net-positive.
  //
  // We weight by the *biggest single enemy's* fleet rather than the
  // sum: two 5-ship enemies aren't as scary as one 10-ship enemy
  // because they can't combine forces, so the cost shouldn't stack
  // linearly. Encourages the AI to grind down the biggest threat
  // first rather than nickel-and-dime weaker sides equally.
  if (enemies.length > 0) {
    const enemyShipCost = shipValueFor(empire) * 1.2; // at war by def
    const enemyShipTotals: Record<string, number> = {};
    for (const eid of enemies) enemyShipTotals[eid] = 0;
    for (const f of Object.values(state.fleets)) {
      if (f.shipCount <= 0) continue;
      if (enemyShipTotals[f.empireId] !== undefined) {
        enemyShipTotals[f.empireId] += f.shipCount;
      }
    }
    let maxEnemyShips = 0;
    for (const eid of enemies) {
      if (enemyShipTotals[eid] > maxEnemyShips) maxEnemyShips = enemyShipTotals[eid];
    }
    score -= maxEnemyShips * enemyShipCost;
  }
  // In-flight projects: preview what they'll be worth at completion,
  // scaled by progress for cancel risk.
  for (const order of allOrdersOf(state, empire)) {
    const progress =
      order.hammersRequired > 0
        ? Math.min(1, order.hammersPaid / order.hammersRequired)
        : 0;
    const progressWeight = 0.3 + 0.7 * progress;
    if (order.kind === "colonize") {
      const body = state.galaxy.bodies[order.targetBodyId];
      if (!body) continue;
      // Project the body's score as if the 5 settlers had landed:
      // maxPops-potential + flow from those landed pops.
      const pops = Math.min(COLONIZE_STARTER_POPS, maxPopsFor(empire, body));
      const hypothetical: Body = { ...body, pops };
      const intrinsic = bodyIntrinsicValue(empire, hypothetical);
      const flow = bodyFlowScore(empire, hypothetical) * FLOW_HORIZON;
      // Progress-weighted for cancel risk on the hammer-cost side;
      // pop transfer is pre-paid (deducted from capital at queue),
      // so credit the future flow + intrinsic at full weight.
      score += COLONIZE_HAMMERS * progressWeight;
      score += intrinsic + flow;
    } else if (
      order.kind === "empire_project" &&
      order.projectId === "build_frigate"
    ) {
      const atWar = enemiesOf(state, empire.id).length > 0;
      const shipBase = shipValueFor(empire) * (atWar ? 1.2 : 1.0);
      score += shipBase * progressWeight;
    } else if (
      order.kind === "empire_project" &&
      order.projectId === "build_outpost"
    ) {
      // Outpost = claim the system + all its bodies become owned.
      // Preview the sum of body scores (intrinsic + flow) at completion,
      // progress-weighted.
      const hostBody = order.targetBodyId ? state.galaxy.bodies[order.targetBodyId] : null;
      const targetSys = hostBody ? state.galaxy.systems[hostBody.systemId] : null;
      if (targetSys) {
        score += systemOwnedScore(empire, targetSys, state) * progressWeight;
      }
    } else {
      // Generic empire_project — fall back to 70% of raw hammer cost.
      score += order.hammersRequired * 0.7 * progressWeight;
    }
  }
  // Occupations — partial credit / debit based on how close to flipping.
  // Credit the FULL post-flip value of the system (intrinsic + flow ×
  // horizon) scaled by OCCUPATION_WEIGHT_BY_TURNS, so the AI sees the
  // real payoff of a 3-turn siege rather than just a fraction of the
  // bare system-claim value. Only applies while an occupier fleet is
  // there and no defender is — otherwise the siege clears.
  for (const sys of Object.values(state.galaxy.systems)) {
    const occ = sys.occupation;
    if (!occ) continue;
    const occW =
      OCCUPATION_WEIGHT_BY_TURNS[occ.turns] ??
      OCCUPATION_WEIGHT_BY_TURNS[OCCUPATION_WEIGHT_BY_TURNS.length - 1];
    const occupierHasFleet = Object.values(state.fleets).some(
      (f) => f.empireId === occ.empireId && f.systemId === sys.id && f.shipCount > 0,
    );
    const defenderHasFleet =
      sys.ownerId !== null &&
      Object.values(state.fleets).some(
        (f) => f.empireId === sys.ownerId && f.systemId === sys.id && f.shipCount > 0,
      );
    if (!occupierHasFleet || defenderHasFleet) continue;
    const sysValue = systemOwnedScore(empire, sys, state);
    if (occ.empireId === empireId) {
      score += sysValue * occW;
    } else if (sys.ownerId === empireId) {
      score -= sysValue * occW;
    }
  }
  BENCH.scoreStateCalls += 1;
  BENCH.scoreStateTimeMs += performance.now() - __t0;
  return score;
}

// Enumerate every legal project-queue action this empire could take
// right now — includes a null/no-op so search can choose to do nothing.
function aiEnumerateProjectActions(state: GameState, empire: Empire): Action[] {
  const actions: Action[] = [];

  // Colonize candidates — every body in the galaxy; canColonizeFor
  // filters by star/pops/space/ownership/reachability.
  for (const body of Object.values(state.galaxy.bodies)) {
    if (!canColonizeFor(state, empire, body.id)) continue;
    actions.push({
      type: "queueColonize",
      byEmpireId: empire.id,
      targetBodyId: body.id,
    });
  }

  // Body-scope empire projects — every body × every body-scope project.
  // canQueueProjectFor handles all legality (bodyRequirement, ownership,
  // reachability, flags, dedupe). New projects with new
  // bodyRequirement values are picked up automatically.
  for (const body of Object.values(state.galaxy.bodies)) {
    for (const proj of EMPIRE_PROJECTS) {
      if (proj.scope !== "body") continue;
      if (!canQueueProjectFor(state, empire, proj.id, body.id)) continue;
      actions.push({
        type: "queueEmpireProject",
        byEmpireId: empire.id,
        projectId: proj.id,
        targetBodyId: body.id,
      });
    }
  }

  // Empire-scope projects.
  for (const proj of EMPIRE_PROJECTS) {
    if (proj.scope !== "empire") continue;
    if (!canQueueProjectFor(state, empire, proj.id)) continue;
    actions.push({
      type: "queueEmpireProject",
      byEmpireId: empire.id,
      projectId: proj.id,
    });
  }

  return actions;
}

// Dispatch an Action against a draft via the same apply* paths the
// reducer uses. Kept local to the AI search so we can score hypothetical
// futures without going through the public reducer.
function applyActionToDraft(draft: GameState, action: Action): void {
  switch (action.type) {
    case "queueColonize":
      applyQueueColonize(draft, action);
      return;
    case "queueEmpireProject":
      applyQueueEmpireProject(draft, action);
      return;
    case "declareWar":
      applyDeclareWar(draft, action);
      return;
    case "makePeace":
      applyMakePeace(draft, action);
      return;
    case "setFleetDestination":
      applySetFleetDestination(draft, action);
      return;
    case "splitFleet":
      applySplitFleet(draft, action);
      return;
    case "adoptPolicy":
      applyAdoptPolicy(draft, action);
      return;
    case "cancelOrder":
      applyCancelOrder(draft, action);
      return;
    default:
      // No search-driven dispatch for round-level actions (endTurn,
      // beginRound, runPhase, resolveEvent, newGame, dismissProjectCompletion).
      return;
  }
}

// Pick the project action that maximises scoreState, or none if
// doing nothing scores as well as any move.
export function aiPlanProject(draft: GameState, empire: Empire): void {
  // Skip if there's already an outstanding order anywhere in the empire.
  // Keeps the AI's per-turn decision to "queue one more thing".
  if (allOrdersOf(draft, empire).length > 0) return;

  const baseline = current(draft);
  const baselineScore = scoreState(baseline, empire.id);
  const candidates = aiEnumerateProjectActions(baseline, empire);

  let bestAction: Action | null = null;
  let bestScore = baselineScore;
  for (const action of candidates) {
    const projected = produce(baseline, (d) => {
      applyActionToDraft(d, action);
    });
    const score = scoreState(projected, empire.id);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }
  if (bestAction) {
    applyActionToDraft(draft, bestAction);
  }
}

// Auto-step every fleet carrying a destinationSystemId: recompute the
// legal-path BFS, walk one hop, and clear the order on arrival. Fleets
// whose route is now blocked are stranded (destination cleared,
// chronicled for the player). This is the ONLY mechanism by which
// fleets move — setFleetDestination never moves a fleet itself.
//
// Each hop costs `shipCount` compute from the empire's per-turn budget.
// If the empire can't afford a hop, the fleet stays put this turn with
// its route intact and retries next turn.
function processFleetOrders(draft: GameState, onlyEmpireId?: string): void {
  const fleetIds = Object.keys(draft.fleets);
  for (const fid of fleetIds) {
    const fleet = draft.fleets[fid];
    if (!fleet) continue;
    if (!fleet.destinationSystemId) continue;
    if (fleet.shipCount <= 0) continue;
    if (onlyEmpireId && fleet.empireId !== onlyEmpireId) continue;
    if (fleet.systemId === fleet.destinationSystemId) {
      fleet.destinationSystemId = undefined;
      continue;
    }
    const path = shortestPathFor(
      draft,
      fleet.empireId,
      fleet.systemId,
      fleet.destinationSystemId,
    );
    if (!path || path.length === 0) {
      if (fleet.empireId === draft.empire.id) {
        const here = draft.galaxy.systems[fleet.systemId];
        const target = draft.galaxy.systems[fleet.destinationSystemId];
        draft.eventLog.push({
          turn: draft.turn,
          eventId: "fleet_stranded",
          choiceId: null,
          text: `Fleet stranded at ${here?.name ?? "a system"} — no route to ${target?.name ?? "destination"}.`,
        });
      }
      fleet.destinationSystemId = undefined;
      continue;
    }
    // Compute budget check: moving N ships costs N compute.
    const owner =
      draft.empire.id === fleet.empireId
        ? draft.empire
        : draft.aiEmpires.find((e) => e.id === fleet.empireId);
    if (!owner) continue;
    const cost = fleet.shipCount;
    if (owner.compute.used + cost > owner.compute.cap) {
      if (fleet.empireId === draft.empire.id) {
        const here = draft.galaxy.systems[fleet.systemId];
        draft.eventLog.push({
          turn: draft.turn,
          eventId: "fleet_idled",
          choiceId: null,
          text: `Fleet at ${here?.name ?? "a system"} held station — not enough compute to coordinate the jump.`,
        });
      }
      continue;
    }
    owner.compute.used += cost;
    const nextHop = path[0];
    const final = fleet.destinationSystemId;
    const moveCount = fleet.shipCount;

    // Merge into an existing friendly fleet at the next hop, if any.
    let destFleet: Fleet | undefined;
    for (const f of Object.values(draft.fleets)) {
      if (f.id !== fleet.id && f.empireId === fleet.empireId && f.systemId === nextHop) {
        destFleet = f;
        break;
      }
    }
    if (destFleet) {
      destFleet.shipCount += moveCount;
      destFleet.destinationSystemId = nextHop === final ? undefined : final;
      delete draft.fleets[fid];
    } else {
      fleet.systemId = nextHop;
      if (nextHop === final) fleet.destinationSystemId = undefined;
    }
    // Entering a foreign-owned system is a declaration of war.
    maybeAutoDeclareWar(draft, fleet.empireId, nextHop);
  }
}

// Per-fleet greedy search over destinations. For each fleet, try
// "stay here", "clear route", and every reachable system as a
// candidate. Score each by imagining the fleet is ALREADY at that
// destination (teleport approximation) and letting scoreState decide.
// The "don't abandon a siege", "defend an occupied home system", and
// "attack the weakest enemy" behaviours all fall out of the value
// function without special-casing.
// For each of `empire`'s fleets, try every reachable destination as a
// candidate move. For each candidate, imagine the fleet is already at
// that destination (teleport), run one forward step of combat +
// occupation to let consequences land, then score the resulting state.
// Pick the best. "Don't abandon a siege", "defend a sieged system",
// "press the attack", etc. all emerge from scoreState via this search,
// not from hand-coded rules.
export function aiPlanMoves(draft: GameState, empire: Empire): void {
  const baseline = current(draft);
  const ourFleets = Object.values(baseline.fleets).filter(
    (f) => f.empireId === empire.id && f.shipCount > 0,
  );

  // Per-source-system reachability cache. Every fleet in the same
  // system has the same reachable destinations; no reason to BFS
  // more than once per unique starting point.
  const reachableBySource = new Map<string, string[]>();

  // Build the hyperlane adjacency map ONCE per planning call instead
  // of rebuilding it inside every shortestPathFor. Hyperlanes don't
  // change mid-plan, and the map was a meaningful fraction of the
  // per-fleet reachability cost.
  const adj = new Map<string, string[]>();
  for (const [a, b] of baseline.galaxy.hyperlanes) {
    let la = adj.get(a);
    if (!la) { la = []; adj.set(a, la); }
    la.push(b);
    let lb = adj.get(b);
    if (!lb) { lb = []; adj.set(b, lb); }
    lb.push(a);
  }

  for (const fleet of ourFleets) {
    // One BFS from the fleet's current system gives every reachable
    // destination in a single O(nodes + edges) pass. Cache by source
    // system: fleets co-located have identical reachable sets.
    let reachable = reachableBySource.get(fleet.systemId);
    if (!reachable) {
      reachable = [];
      const visited = new Set<string>([fleet.systemId]);
      const queue: string[] = [fleet.systemId];
      let head = 0; // array-as-queue with head pointer; shift() is O(n).
      while (head < queue.length) {
        const id = queue[head++];
        for (const n of adj.get(id) ?? []) {
          if (visited.has(n)) continue;
          if (!canEnterSystem(baseline, empire.id, n)) continue;
          visited.add(n);
          queue.push(n);
          reachable.push(n);
        }
      }
      reachableBySource.set(fleet.systemId, reachable);
    }

    const scoreCandidate = (mutate: (d: GameState) => void): number => {
      const __t0 = performance.now();
      let __tCombat = 0;
      let __tOccupation = 0;
      const projected = produce(baseline, (d) => {
        mutate(d);
        const __c0 = performance.now();
        resolveCombat(d);
        const __c1 = performance.now();
        processOccupation(d);
        const __c2 = performance.now();
        __tCombat = __c1 - __c0;
        __tOccupation = __c2 - __c1;
      });
      const __t1 = performance.now();
      const score = scoreState(projected, empire.id);
      BENCH.moveCandidateCalls += 1;
      BENCH.moveCandidateTimeMs += performance.now() - __t0;
      // produce() wraps the mutate/combat/occupation closure — its
      // time is (finish - start) minus the inner phases.
      BENCH.produceTimeMs += (__t1 - __t0) - __tCombat - __tOccupation;
      BENCH.resolveCombatTimeMs += __tCombat;
      BENCH.processOccupationTimeMs += __tOccupation;
      return score;
    };

    let bestScore = scoreCandidate(() => {}); // baseline: no change
    let bestAction: { kind: "keep" } | { kind: "set"; to: string | null } = {
      kind: "keep",
    };

    // Clearing the route (stay + no travel).
    {
      const score = scoreCandidate((d) => {
        const f = d.fleets[fleet.id];
        if (f) f.destinationSystemId = undefined;
      });
      if (score > bestScore) {
        bestScore = score;
        bestAction = { kind: "set", to: null };
      }
    }

    // Each reachable destination (teleport approximation). If the
    // destination is a foreign-owned system we're not at war with yet,
    // the mutate also pushes a war into the projection so scoreState
    // sees the full consequence (new enemy, AT_WAR_COST, enabled
    // occupation debit, etc).
    for (const dest of reachable) {
      const score = scoreCandidate((d) => {
        const f = d.fleets[fleet.id];
        if (!f) return;
        f.systemId = dest;
        f.destinationSystemId = undefined;
        maybeAutoDeclareWar(d, empire.id, dest);
      });
      if (score > bestScore) {
        bestScore = score;
        bestAction = { kind: "set", to: dest };
      }
    }

    if (bestAction.kind === "set") {
      applySetFleetDestination(draft, {
        byEmpireId: empire.id,
        fleetId: fleet.id,
        toSystemId: bestAction.to,
      });
    }
  }
}

// War declarations now emerge from fleet movements: moving a fleet
// into a foreign-owned system declares war on that empire (handled
// in processFleetOrders via maybeAutoDeclareWar and previewed in the
// scoreCandidate projection so the AI can weigh it). Each archetype
// pays a different AT_WAR_COST_PER_ENEMY on every active war, so the
// value function naturally governs who picks fights and when. This
// function is intentionally a no-op — retained only for the explicit
// callsite in the phase loop until that can be cleaned up.
function aiPlanDiplomacy(_draft: GameState, _empire: Empire, _rand: () => number): void {
  // intentionally empty
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

// =====================================================================
// apply* — pure draft mutators. Each action type corresponds to one
// apply* function. The top-level reducer wraps the call in produce()
// for player dispatches; the AI planner calls these directly from
// inside endTurn's existing produce() block. Both paths share the same
// validation and effects, so "player does X" and "AI does X" are
// guaranteed to behave identically.
// =====================================================================

function applyQueueColonize(
  draft: GameState,
  action: { byEmpireId: string; targetBodyId: string },
): void {
  const emp = empireById(draft, action.byEmpireId);
  if (!emp) return;
  if (!canColonizeFor(draft, emp, action.targetBodyId)) return;
  // Load settlers onto the colony ship. canColonizeFor already
  // guarantees the capital exists and has ≥ COLONIZE_POP_COST pops.
  // The colony-ship project is queued on the capital body itself:
  // hammers there pay for construction, and it's always a transitable
  // system (capital can't be in a disconnected component by definition).
  const cap = draft.galaxy.bodies[emp.capitalBodyId!];
  cap.pops -= COLONIZE_POP_COST;
  cap.queue.push({
    kind: "colonize",
    id: nextOrderId(),
    targetBodyId: action.targetBodyId,
    hammersRequired: effectiveColonizeHammers(emp),
    hammersPaid: 0,
    politicalCost: effectiveColonizePolitical(emp),
  });
}

function applyQueueEmpireProject(
  draft: GameState,
  action: { byEmpireId: string; projectId: string; targetBodyId?: string },
): void {
  const emp = empireById(draft, action.byEmpireId);
  if (!emp) return;
  if (!canQueueProjectFor(draft, emp, action.projectId, action.targetBodyId)) return;
  const proj = projectById(action.projectId);
  if (!proj) return;
  // Projects live on an owned body's queue (that body's hammers pay).
  // Usually the target (build_frigate on a colonised world builds
  // there). Exception: the target sits in an unowned system — e.g.,
  // Build Outpost on an adjacent star — so we fall back to hosting on
  // the capital, where there are hammers.
  let hostBodyId: string | null = emp.capitalBodyId;
  if (action.targetBodyId) {
    const target = draft.galaxy.bodies[action.targetBodyId];
    const targetSys = target ? draft.galaxy.systems[target.systemId] : null;
    if (target && targetSys && targetSys.ownerId === emp.id) {
      hostBodyId = target.id;
    }
  }
  if (!hostBodyId) return;
  const hostBody = draft.galaxy.bodies[hostBodyId];
  if (!hostBody) return;
  hostBody.queue.push({
    kind: "empire_project",
    id: nextOrderId(),
    projectId: proj.id,
    hammersRequired: proj.hammersRequired,
    hammersPaid: 0,
    targetBodyId: action.targetBodyId,
  });
}

function applyCancelOrder(
  draft: GameState,
  action: { byEmpireId: string; orderId: string },
): void {
  const emp = empireById(draft, action.byEmpireId);
  if (!emp) return;
  // Find the order across all the empire's bodies; queues are per-body now.
  for (const body of ownedBodiesOf(draft, emp)) {
    const idx = body.queue.findIndex((o) => o.id === action.orderId);
    if (idx === -1) continue;
    const order = body.queue[idx];
    // Refund colony-ship pops to the current capital (capital may have
    // changed since queue time; refund lands at the new home). If no
    // capital exists, the settlers are lost.
    if (order.kind === "colonize") {
      const cap = emp.capitalBodyId ? draft.galaxy.bodies[emp.capitalBodyId] : null;
      if (cap) cap.pops += COLONIZE_POP_COST;
    }
    const live = draft.galaxy.bodies[body.id];
    if (live) live.queue.splice(idx, 1);
    return;
  }
}

function applyAdoptPolicy(
  draft: GameState,
  action: { byEmpireId: string; policyId: string },
): void {
  const emp = empireById(draft, action.byEmpireId);
  if (!emp) return;
  if (!canAdoptPolicy(draft, emp, action.policyId)) return;
  const p = policyById(action.policyId);
  if (!p) return;
  const cost = policyCost(draft, emp, action.policyId);
  emp.political -= cost;
  emp.adoptedPolicies.push(p.id);
  emp.storyModifiers[`policy:${p.id}`] = [...p.modifiers];
  const prefix = emp.id === draft.empire.id ? "" : `${emp.name}: `;
  draft.eventLog.push({
    turn: draft.turn,
    eventId: `policy:${p.id}`,
    choiceId: null,
    text: `${prefix}Policy adopted: ${p.name}.`,
  });
}

function applyDeclareWar(
  draft: GameState,
  action: { byEmpireId: string; targetEmpireId: string },
): void {
  const aggressor = empireById(draft, action.byEmpireId);
  const target = empireById(draft, action.targetEmpireId);
  if (!aggressor || !target) return;
  if (aggressor.id === target.id) return;
  if (atWar(draft, aggressor.id, target.id)) return;
  draft.wars.push(sortedPair(aggressor.id, target.id));
  // Log only when the player is involved, to keep the chronicle clean
  // of AI-vs-AI noise until we build a dedicated diplomacy feed.
  const playerId = draft.empire.id;
  if (aggressor.id === playerId || target.id === playerId) {
    const who = aggressor.id === playerId ? "You" : aggressor.name;
    draft.eventLog.push({
      turn: draft.turn,
      eventId: "war_declared",
      choiceId: null,
      text: `${who} declared war on ${target.name}.`,
    });
  }
}

function applyMakePeace(
  draft: GameState,
  action: { byEmpireId: string; targetEmpireId: string },
): void {
  const a = empireById(draft, action.byEmpireId);
  const b = empireById(draft, action.targetEmpireId);
  if (!a || !b) return;
  if (!atWar(draft, a.id, b.id)) return;
  const [x, y] = sortedPair(a.id, b.id);
  draft.wars = draft.wars.filter(([p, q]) => !(p === x && q === y));
  const playerId = draft.empire.id;
  if (a.id === playerId || b.id === playerId) {
    const otherName = a.id === playerId ? b.name : a.name;
    draft.eventLog.push({
      turn: draft.turn,
      eventId: "peace_declared",
      choiceId: null,
      text: `Peace with ${otherName}.`,
    });
  }
}

function applySetFleetDestination(
  draft: GameState,
  action: { byEmpireId: string; fleetId: string; toSystemId: string | null },
): void {
  const fleet = draft.fleets[action.fleetId];
  if (!fleet) return;
  if (fleet.empireId !== action.byEmpireId) return;
  if (action.toSystemId === null) {
    fleet.destinationSystemId = undefined;
    return;
  }
  if (action.toSystemId === fleet.systemId) {
    fleet.destinationSystemId = undefined;
    return;
  }
  // Destination must have a legal path. Reject the order if there's
  // none — keeps the "stranded" state reachable only through mid-route
  // territory flips, not by setting impossible orders.
  const path = shortestPathFor(draft, fleet.empireId, fleet.systemId, action.toSystemId);
  if (!path || path.length === 0) return;
  fleet.destinationSystemId = action.toSystemId;
}

function applySplitFleet(
  draft: GameState,
  action: { byEmpireId: string; fleetId: string; count: number; toSystemId: string },
): void {
  const fleet = draft.fleets[action.fleetId];
  if (!fleet) return;
  if (fleet.empireId !== action.byEmpireId) return;
  if (action.count <= 0 || action.count >= fleet.shipCount) return;
  if (action.toSystemId === fleet.systemId) return;
  const path = shortestPathFor(draft, fleet.empireId, fleet.systemId, action.toSystemId);
  if (!path || path.length === 0) return;
  // Peel off a new co-located fleet with the requested destination.
  // Movement itself happens at end of turn via processFleetOrders.
  fleet.shipCount -= action.count;
  const id = nextFleetId();
  draft.fleets[id] = {
    id,
    empireId: fleet.empireId,
    systemId: fleet.systemId,
    shipCount: action.count,
    destinationSystemId: action.toSystemId,
  };
}

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "newGame": {
      const origin = originById(action.originId);
      if (!origin) return state;

      const fresh = initialState();
      const galaxy = generateGalaxy({ ...GALAXY_SIZE, seed: action.seed });
      const rand = mulberry32(action.seed ^ 0x243f6a88);

      // Pick N+1 spread-out starters: [player, ai_0, ai_1, ...].
      const aiLeaders = pickAiLeaders(rand, AI_EMPIRE_COUNT);
      const starters = pickSpreadStarters(galaxy, rand, 1 + aiLeaders.length);
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

        // The star is body[0] now; the starter needs to be a non-star
        // body. If the system has one we upgrade it to temperate; if
        // not (star-only system), we mint a fresh temperate planet so
        // the empire has a home.
        const nonStarIds = sys.bodyIds.filter(
          (bid) => nextGalaxy.bodies[bid]?.kind !== "star",
        );
        let starterBodyId: string;
        const nextBodiesMap = { ...nextGalaxy.bodies };
        if (nonStarIds.length > 0) {
          starterBodyId = nonStarIds[0];
          const starterBody = nextBodiesMap[starterBodyId];
          nextBodiesMap[starterBodyId] = {
            ...starterBody,
            habitability: "temperate" as const,
            kind: "planet" as const,
            maxPops: MAX_POPS_BY_HAB.temperate,
            pops: startingPops,
          };
        } else {
          starterBodyId = `body_starter_${sysId}`;
          nextBodiesMap[starterBodyId] = {
            id: starterBodyId,
            systemId: sysId,
            name: `${sys.name} I`,
            kind: "planet",
            habitability: "temperate",
            maxPops: MAX_POPS_BY_HAB.temperate,
            pops: startingPops,
            hammers: 0,
            queue: [],
            flavorFlags: [],
            features: [],
          };
        }
        const updatedSys = {
          ...sys,
          bodyIds: sys.bodyIds.includes(starterBodyId)
            ? sys.bodyIds
            : [...sys.bodyIds, starterBodyId],
          ownerId: empireId,
        };
        nextGalaxy = {
          ...nextGalaxy,
          systems: { ...nextGalaxy.systems, [sysId]: updatedSys },
          bodies: nextBodiesMap,
        };
        return { galaxy: nextGalaxy, capitalBodyId: starterBodyId, systemId: sysId };
      }

      const playerStarter = claimStarter(fresh.empire.id, playerStarterId, origin.startingPops);
      const aiStarters = aiStarterIds.map((sid, i) => {
        const leader = aiLeaders[i];
        const aiOriginId = AI_ORIGIN_BY_SPECIES[leader.speciesId] ?? "steady_evolution";
        const aiOrigin = originById(aiOriginId);
        return {
          leader,
          empireId: `empire_ai_${i}`,
          color: AI_COLOR_OVERRIDES[leader.speciesId] ?? "#7ec8ff",
          starter: claimStarter(`empire_ai_${i}`, sid, aiOrigin?.startingPops ?? 4),
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
        draft.empire.expansionism = action.expansionism;
        draft.empire.politic = action.politic;
        const species = speciesById(action.speciesId);
        if (species) draft.empire.color = species.color;
        if (action.portraitArt) draft.empire.portraitArt = action.portraitArt;
        draft.empire.capitalBodyId = playerStarter.capitalBodyId;
        draft.empire.systemIds = [playerStarter.systemId];
        // Political lives on the empire; food and energy go into the
        // starter's component pool (just the starter system for now).
        draft.empire.political = origin.startingResources.political ?? 0;
        draft.empire.componentPools = {
          [playerStarter.systemId]: {
            food: origin.startingResources.food ?? 0,
            energy: origin.startingResources.energy ?? 0,
          },
        };
        // Apply origin story modifiers + auto-queued starter projects.
        if (origin.startingStoryModifiers) {
          for (const [key, mods] of Object.entries(origin.startingStoryModifiers)) {
            draft.empire.storyModifiers[key] = [...mods];
          }
        }
        if (origin.startingProjectIds) {
          for (const pid of origin.startingProjectIds) {
            const proj = projectById(pid);
            if (!proj) continue;
            const hostBodyId =
              proj.scope === "body"
                ? draft.empire.capitalBodyId
                : draft.empire.capitalBodyId;
            if (!hostBodyId) continue;
            const hostBody = draft.galaxy.bodies[hostBodyId];
            if (!hostBody) continue;
            hostBody.queue.push({
              kind: "empire_project",
              id: nextOrderId(),
              projectId: proj.id,
              hammersRequired: proj.hammersRequired,
              hammersPaid: 0,
              targetBodyId: proj.scope === "body" ? hostBodyId : undefined,
            });
          }
        }
        // Install any origin-provided starter Features on the capital
        // (e.g. Matriarchal Hive arrives with a Brood Mother).
        if (origin.startingFeatures && draft.empire.capitalBodyId) {
          const capBody = draft.galaxy.bodies[draft.empire.capitalBodyId];
          if (capBody) {
            for (const fid of origin.startingFeatures) {
              if (!capBody.features.includes(fid)) capBody.features.push(fid);
            }
          }
        }
        syncFeatureModifiers(draft, draft.empire);
        draft.empire.compute.cap = computeCapOf(draft, draft.empire);
        draft.empire.compute.used = 0;
        for (const bid of draft.galaxy.systems[playerStarter.systemId].bodyIds) {
          const body = draft.galaxy.bodies[bid];
          if (body) body.hammers = Math.floor(body.pops * hammersPerPopFor(draft.empire, body));
        }

        // AI empires — one per leader.
        draft.aiEmpires = aiStarters.map(({ leader, empireId, color, starter, originObj }) => {
          const empire = makeEmpire({
            id: empireId,
            name: leader.name,
            color,
            speciesId: leader.speciesId,
            originId: originObj?.id ?? "steady_evolution",
            expansionism: leader.expansionism,
            politic: leader.politic,
            leaderId: leader.id,
            portraitArt: leader.portraitPath,
          });
          empire.capitalBodyId = starter.capitalBodyId;
          empire.systemIds = [starter.systemId];
          if (originObj) {
            empire.political = originObj.startingResources.political ?? 0;
            empire.componentPools = {
              [starter.systemId]: {
                food: originObj.startingResources.food ?? 0,
                energy: originObj.startingResources.energy ?? 0,
              },
            };
            if (originObj.startingStoryModifiers) {
              for (const [key, mods] of Object.entries(originObj.startingStoryModifiers)) {
                empire.storyModifiers[key] = [...mods];
              }
            }
            // AIs also auto-queue their origin starter projects (e.g., an
            // Emancipation AI must build Complete Emancipation to lift the
            // debuff — same rules as the player).
            if (originObj.startingProjectIds) {
              for (const pid of originObj.startingProjectIds) {
                const proj = projectById(pid);
                if (!proj) continue;
                const hostBodyId = empire.capitalBodyId;
                if (!hostBodyId) continue;
                const hostBody = draft.galaxy.bodies[hostBodyId];
                if (!hostBody) continue;
                hostBody.queue.push({
                  kind: "empire_project",
                  id: nextOrderId(),
                  projectId: proj.id,
                  hammersRequired: proj.hammersRequired,
                  hammersPaid: 0,
                  targetBodyId: proj.scope === "body" ? hostBodyId : undefined,
                });
              }
            }
            if (originObj.startingFeatures && empire.capitalBodyId) {
              const capBody = draft.galaxy.bodies[empire.capitalBodyId];
              if (capBody) {
                for (const fid of originObj.startingFeatures) {
                  if (!capBody.features.includes(fid)) capBody.features.push(fid);
                }
              }
            }
          }
          syncFeatureModifiers(draft, empire);
          empire.compute.cap = computeCapOf(draft, empire);
          return empire;
        });
        // Seed AI bodies' hammers too so turn-1 rates show correctly.
        for (const ai of draft.aiEmpires) {
          for (const bid of draft.galaxy.systems[ai.systemIds[0]].bodyIds) {
            const body = draft.galaxy.bodies[bid];
            if (body) body.hammers = Math.floor(body.pops * hammersPerPopFor(ai, body));
          }
        }

        // Every empire starts with one frigate at its capital system.
        spawnShipsInSystem(draft, draft.empire.id, playerStarter.systemId, 1);
        for (let i = 0; i < aiStarters.length; i++) {
          spawnShipsInSystem(draft, `empire_ai_${i}`, aiStarters[i].starter.systemId, 1);
        }
      });
    }

    case "resolveEvent":
      return resolveEventChoice(state, action.eventId, action.choiceId);

    case "queueColonize":
      return produce(state, (draft) => applyQueueColonize(draft, action));

    case "queueEmpireProject":
      return produce(state, (draft) => applyQueueEmpireProject(draft, action));

    case "cancelOrder":
      return produce(state, (draft) => applyCancelOrder(draft, action));

    case "adoptPolicy":
      return produce(state, (draft) => applyAdoptPolicy(draft, action));

    case "dismissProjectCompletion":
      return produce(state, (draft) => {
        draft.projectCompletions.shift();
      });

    case "dismissFirstContact":
      return produce(state, (draft) => {
        draft.pendingFirstContacts.shift();
      });

    case "declareWar":
      return produce(state, (draft) => applyDeclareWar(draft, action));

    case "makePeace":
      return produce(state, (draft) => applyMakePeace(draft, action));

    case "setFleetDestination":
      return produce(state, (draft) => applySetFleetDestination(draft, action));

    case "splitFleet":
      return produce(state, (draft) => applySplitFleet(draft, action));

    case "beginRound": {
      if (state.eventQueue.length > 0) return state;
      return applyBeginRound(state);
    }

    case "runPhase": {
      if (!state.currentPhaseEmpireId) return state;
      return applyRunPhase(state);
    }

    case "endTurn": {
      if (state.eventQueue.length > 0) return state;
      // Synchronous cascade — used in tests and as a fallback; the
      // store orchestrates a paced version for the actual UI.
      let next = applyBeginRound(state);
      while (next.currentPhaseEmpireId) {
        next = applyRunPhase(next);
      }
      return next;
    }
  }
}

// Per-round kickoff: advance the turn counter, AI project-planning,
// tick every empire, and arm the phase cycle at the player.
function applyBeginRound(state: GameState): GameState {
  return produce(state, (draft) => {
    draft.turn += 1;
    draft.rngSeed = nextSeed(draft.rngSeed);

    // AI project planning runs before ticks so newly-queued orders
    // drain this turn (mirrors how the player queues before endTurn).
    for (const ai of draft.aiEmpires) {
      aiPlanProject(draft, ai);
    }

    tickEmpire(draft, draft.empire);
    for (const ai of draft.aiEmpires) {
      tickEmpire(draft, ai);
    }

    draft.currentPhaseEmpireId = draft.empire.id;
  });
}

// A single empire's phase: AI decisions (if applicable), step that
// empire's fleets, resolve combat, advance the phase pointer. When
// the last empire has acted, finalize the round (occupation, eliminations,
// random event for the player) and clear the pointer.
function applyRunPhase(state: GameState): GameState {
  const currentId = state.currentPhaseEmpireId;
  if (!currentId) return state;

  let next = produce(state, (draft) => {
    const isAI = draft.empire.id !== currentId;
    const diplomacyRand = mulberry32(draft.rngSeed ^ 0xd1910ac7);

    if (isAI) {
      const ai = draft.aiEmpires.find((e) => e.id === currentId);
      if (ai) {
        aiPlanDiplomacy(draft, ai, diplomacyRand);
        aiPlanMoves(draft, ai);
      }
    }

    processFleetOrders(draft, currentId);
    resolveCombat(draft);

    const order = [draft.empire.id, ...draft.aiEmpires.map((e) => e.id)];
    const idx = order.indexOf(currentId);
    const isLast = idx === -1 || idx === order.length - 1;
    if (isLast) {
      processOccupation(draft);
      checkEliminations(draft);
      detectFirstContacts(draft);
      draft.currentPhaseEmpireId = null;
    } else {
      draft.currentPhaseEmpireId = order[idx + 1];
    }
  });

  // Random event pick happens outside produce so it can consult the
  // post-round rng. Only fires when we've just finalized (no next phase).
  if (next.currentPhaseEmpireId === null || next.currentPhaseEmpireId === undefined) {
    const rand = mulberry32(next.rngSeed);
    if (rand() < 0.55) {
      const event = pickRandomEvent(next, next.rngSeed);
      if (event) {
        next = produce(next, (draft) => {
          draft.eventQueue.push({ eventId: event.id, seed: next.rngSeed });
        });
      }
    }
  }

  return next;
}
