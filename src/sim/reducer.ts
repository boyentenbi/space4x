import { current, produce } from "immer";
import { LEADERS, POLICIES, originById, policyById, projectById, speciesById, traitById, EMPIRE_PROJECTS } from "./content";
import { BALANCE } from "../content/balance";
import { pickRandomEvent, resolveEventChoice, RESOURCE_KEYS } from "./events";
import { generateGalaxy } from "./galaxy";
import { mulberry32, nextSeed } from "./rng";
import type {
  Body,
  BuildOrder,
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
export const COLONIZE_HAMMERS = 200;
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

export const HAMMERS_PER_POP = 0.4;
export const POP_GROWTH_FOOD_COST = 50;

// Expected turns until this body grows by +1 pop, or a status string.
// Matches the actual growth roll: chance = headroom * 0.5 each turn,
// so expected wait = 1/chance (rounded up). Gated on empire food.
// Expected pop growth *rate* for an empire this turn — sum of per-body
// growth chances, capped at 1 per body (single roll per body per turn).
// Returns 0 if food is below the growth threshold (no body can grow).
export function expectedPopGrowth(state: GameState, empire: Empire): number {
  if (empire.resources.food < POP_GROWTH_FOOD_COST) return 0;
  const growthMult = popGrowthMultiplier(empire);
  const growthAdd = popGrowthAdditive(empire);
  let total = 0;
  for (const body of ownedBodiesOf(state, empire)) {
    const cap = effectiveSpace(empire, body);
    if (body.pops >= cap) continue;
    const headroom = (cap - body.pops) / cap;
    const chance = Math.min(1, Math.max(0, (headroom * 0.5 + growthAdd) * growthMult));
    total += chance;
  }
  return total;
}

export function growthEstimate(
  _state: GameState,
  empire: Empire,
  body: Body,
): { kind: "full" } | { kind: "starved" } | { kind: "growing"; turns: number } {
  const cap = effectiveSpace(empire, body);
  if (body.pops >= cap) return { kind: "full" };
  if (empire.resources.food < POP_GROWTH_FOOD_COST) return { kind: "starved" };
  const headroom = (cap - body.pops) / cap;
  const chance = Math.max(
    0,
    Math.min(1, (headroom * 0.5 + popGrowthAdditive(empire)) * popGrowthMultiplier(empire)),
  );
  if (chance <= 0) return { kind: "full" };
  return { kind: "growing", turns: Math.ceil(1 / chance) };
}

// ===== AI empire setup =====
// AI empires are seeded by picking leaders from the content roster.
// Each leader brings their own portrait + archetype + name/manifesto.
// The origin is chosen per species (simple mapping for MVP — eventually
// leaders can carry their own origin preference too).
const AI_ORIGIN_BY_SPECIES: Record<string, string> = {
  humans: "steady_evolution",
  insectoid: "steady_evolution",
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
    resources: { ...EMPTY_RESOURCES },
    compute: { cap: 0, used: 0 },
    portraitArt: spec.portraitArt,
    expansionism: spec.expansionism,
    politic: spec.politic,
    leaderId: spec.leaderId,
    capitalBodyId: null,
    systemIds: [],
    projects: [],
    storyModifiers: {},
    completedProjects: [],
    adoptedPolicies: [],
    flags: [],
  };
}

export function initialState(): GameState {
  return {
    schemaVersion: 18,
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
      expansionism: "pragmatist",
      politic: "centrist",
      capitalBodyId: null,
      systemIds: [],
      projects: [],
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
//  - Conqueror:    -40% political-capital cost to colonize (cheaper land
//                  grabs; fleets will also be cheaper once they exist).
//  - Pragmatist:   baseline.
//  - Isolationist: +50% PC cost to colonize (reluctant to expand), but
//                  +15% max pops and +15% pop growth on the worlds
//                  they do hold.
export function expansionismModifiers(ex: Expansionism): Modifier[] {
  switch (ex) {
    case "conqueror":
      return [
        { kind: "colonizePoliticalMult", value: 0.6 },
      ];
    case "pragmatist":
      return [];
    case "isolationist":
      return [
        { kind: "colonizePoliticalMult", value: 2.0 },
        { kind: "spaceMult", value: 2.0 },
        { kind: "popGrowthMult", value: 1.25 },
      ];
  }
}

// Politic lean:
//  - Collectivist:  state over individual — centralized authority
//                   translates to +0.5 political/turn and coordinated
//                   labour gives +0.25 hammers/pop.
//  - Centrist:      baseline.
//  - Individualist: liberty over state — reserved for an innovation /
//                   research bonus once the tech layer lands.
export function politicModifiers(p: Politic): Modifier[] {
  switch (p) {
    case "collectivist":
      return [
        { kind: "flat", resource: "political", value: 0.5 },
        { kind: "hammersPerPopDelta", value: 0.25 },
      ];
    case "centrist":
      return [];
    case "individualist":
      return [];
  }
}

// All modifiers that apply to an empire: species innates + trait mods +
// archetype leans + story bundles granted by origin/projects.
export function empireModifiers(empire: Empire): Modifier[] {
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
  return out;
}

// Multiplicative modifiers multiply together; returns 1.0 if none.
function productMult(
  mods: Modifier[],
  kind: "popGrowthMult" | "spaceMult" | "colonizeHammerMult" | "colonizePoliticalMult",
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

function sumDelta(mods: Modifier[], kind: "foodUpkeepDelta" | "hammersPerPopDelta" | "popGrowthAdd"): number {
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

// Effective food upkeep per pop, clamped at 0.
export function foodUpkeepPerPop(empire: Empire): number {
  return Math.max(0, 1 + sumDelta(empireModifiers(empire), "foodUpkeepDelta"));
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

// Effective space cap on a body (species spaceMult applied).
export function effectiveSpace(empire: Empire, body: Body): number {
  return Math.floor(body.space * productMult(empireModifiers(empire), "spaceMult"));
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
  rows: Array<{ id?: string; name: string; detail?: string; value: number; habitability?: HabitabilityTier }>;
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
  // Energy upkeep: ships + outposts drain the stockpile each turn.
  // Shown as negative rows in the breakdown so the deficit is legible.
  if (resource === "energy") {
    const shipCost = fleetEnergyUpkeep(state, empire);
    if (shipCost > 0) flat.push({ label: "Fleet upkeep", value: -shipCost });
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
  const bodyRows = ownedBodiesOf(state, empire).map((body) => {
    const cap = effectiveSpace(empire, body);
    return {
      id: body.id,
      name: body.name,
      detail: `${body.pops} / ${cap}`,
      value: body.pops,
      habitability: body.habitability,
    };
  });
  const modRows: StatBreakdownSection["rows"] = [];
  for (const lm of labelledModifiers(empire)) {
    if (lm.mod.kind === "spaceMult") {
      const pct = Math.round((lm.mod.value - 1) * 100);
      modRows.push({ name: lm.label, detail: "max pops", value: pct / 100 });
    }
    if (lm.mod.kind === "popGrowthMult") {
      const pct = Math.round((lm.mod.value - 1) * 100);
      modRows.push({ name: lm.label, detail: "growth rate", value: pct / 100 });
    }
    if (lm.mod.kind === "popGrowthAdd") {
      const pct = Math.round(lm.mod.value * 100);
      modRows.push({ name: lm.label, detail: "flat growth chance", value: pct / 100 });
    }
  }
  const total = bodyRows.reduce((s, r) => s + r.value, 0);
  return {
    title: "Population",
    iconSrc: "/icons/pops.png",
    total,
    sections: [
      ...(bodyRows.length > 0 ? [{ label: "Per body", rows: bodyRows }] : []),
      ...(modRows.length > 0 ? [{ label: "Cap + growth modifiers", rows: modRows }] : []),
    ],
  };
}

export function perTurnIncomeOf(state: GameState, empire: Empire): Resources {
  const income: Resources = { ...EMPTY_RESOURCES };
  for (const body of ownedBodiesOf(state, empire)) {
    const contrib = bodyIncomeFor(empire, body);
    for (const k of RESOURCE_KEYS) income[k] += contrib[k];
  }
  const mods = empireModifiers(empire);
  for (const k of RESOURCE_KEYS) {
    income[k] += flatEmpireIncome(mods, k);
  }
  // Baseline political tick (empires always get +1 regardless of traits).
  income.political += 1;
  // Energy upkeep — subtracted so the sidebar delta reflects net flow.
  income.energy -= fleetEnergyUpkeep(state, empire);
  income.energy -= outpostEnergyUpkeep(empire);
  return income;
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
    for (const order of empire.projects) {
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

// In-flight body-scope project order for a given body, if any.
export function bodyProjectOrderFor(empire: Empire, bodyId: string) {
  for (const order of empire.projects) {
    if (order.kind === "empire_project" && order.targetBodyId === bodyId) return order;
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
  if (empire.resources.political < policyCost(state, empire, policyId)) return false;
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
      return { policyId: p.id, cost, affordable: empire.resources.political >= cost };
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

    // Energy deficit → zero outgoing damage this combat (their ships
    // are present but harmless). Sampled once at the start; it doesn't
    // fluctuate mid-combat.
    const damageOutMult: Record<string, number> = {};
    for (const empId of empires) {
      const emp = empireById(draft, empId);
      damageOutMult[empId] = !emp || emp.resources.energy <= 0 ? 0 : 1;
    }

    // Work out which empires are actually at war with at least one
    // other empire here AND can deal damage. If only one such empire
    // remains, nothing fights.
    const belligerents = empires.filter((a) => {
      if (damageOutMult[a] === 0) return false;
      return empires.some(
        (b) => b !== a && damageOutMult[b] === 1 && atWar(draft, a, b),
      );
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

  for (const sys of Object.values(draft.galaxy.systems)) {
    if (!sys.ownerId) {
      // Unclaimed space can't be occupied — just cleared.
      if (sys.occupation) sys.occupation = undefined;
      continue;
    }
    const ownerId = sys.ownerId;
    const fleetsHere = Object.values(draft.fleets).filter(
      (f) => f.systemId === sys.id && f.shipCount > 0,
    );
    const defenderPresent = fleetsHere.some((f) => f.empireId === ownerId);
    if (defenderPresent) {
      sys.occupation = undefined;
      continue;
    }
    // Which foreign empires have ships here, at war with the owner?
    const invaderEmpireIds = new Set<string>();
    for (const f of fleetsHere) {
      if (f.empireId !== ownerId && atWar(draft, ownerId, f.empireId)) {
        invaderEmpireIds.add(f.empireId);
      }
    }
    if (invaderEmpireIds.size === 0) {
      sys.occupation = undefined;
      continue;
    }
    if (invaderEmpireIds.size > 1) {
      // Contested — nobody can occupy until one side wins out.
      sys.occupation = undefined;
      continue;
    }
    const invaderId = Array.from(invaderEmpireIds)[0];
    if (sys.occupation && sys.occupation.empireId === invaderId) {
      sys.occupation.turns += 1;
    } else {
      sys.occupation = { empireId: invaderId, turns: 1 };
      if (ownerId === draft.empire.id || invaderId === draft.empire.id) {
        const invader = empireById(draft, invaderId);
        draft.eventLog.push({
          turn: draft.turn,
          eventId: "occupation_begun",
          choiceId: null,
          text: `${invader?.name ?? "Enemy"} fleet is occupying ${sys.name}.`,
        });
      }
    }
    if (sys.occupation.turns >= OCCUPATION_TURNS_TO_FLIP) {
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

// Can `moverEmpireId` legally enter `systemId`? Own territory, unowned
// space, and enemy (at-war) territory all qualify. Neutral-owned space
// is off-limits until war is declared.
export function canEnterSystem(
  state: GameState,
  moverEmpireId: string,
  systemId: string,
): boolean {
  const sys = state.galaxy.systems[systemId];
  if (!sys) return false;
  if (!sys.ownerId) return true;
  if (sys.ownerId === moverEmpireId) return true;
  return atWar(state, moverEmpireId, sys.ownerId);
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
  if (effectiveSpace(empire, target) <= 0) return false;
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

function completeOrder(draft: GameState, empire: Empire, order: BuildOrder): void {
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
    empire.resources.political -= order.politicalCost;
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
    // One-shot stock costs.
    if (proj.costs) {
      for (const k of RESOURCE_KEYS) {
        const c = proj.costs[k];
        if (c) empire.resources[k] -= c;
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

// Kill one pop during a famine. Preferentially target the largest
// non-capital colony so the capital collapses last; if everything's
// the same size, fall back to the first owned body with pops > 0.
function killStarvingPop(draft: GameState, empire: Empire): string | null {
  const candidates: Body[] = [];
  for (const body of ownedBodiesOf(draft, empire)) {
    if (body.pops > 0) candidates.push(body);
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

// Per-turn energy cost of an empire's standing fleet.
export function fleetEnergyUpkeep(state: GameState, empire: Empire): number {
  return totalFleetShipsFor(state, empire) * BALANCE.shipEnergyUpkeep;
}

// Per-turn energy cost of each owned system's outpost.
export function outpostEnergyUpkeep(empire: Empire): number {
  return empire.systemIds.length * BALANCE.outpostEnergyUpkeep;
}

function tickEmpire(draft: GameState, empire: Empire, growthRand: () => number): void {
  // 1. Stock income (net — perTurnIncomeOf already subtracts energy
  //    upkeep from ships + outposts, so going negative here is the
  //    signal that fleets can't move / can't deal damage this round).
  const income = perTurnIncomeOf(draft, empire);
  for (const k of RESOURCE_KEYS) {
    empire.resources[k] += income[k];
  }
  // 2. Reset flow resources on this empire's bodies.
  empire.compute.cap = computeCapOf(draft, empire);
  empire.compute.used = 0;
  for (const body of ownedBodiesOf(draft, empire)) {
    const live = draft.galaxy.bodies[body.id];
    if (live) {
      live.hammers = Math.floor(live.pops * hammersPerPopFor(empire, live));
    }
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
  // 4. Pop growth — modifier-aware.
  //    chance = (headroom * 0.5 + additive) * multiplier, clamped [0, 1].
  //    Additive mods (e.g. Brood Mother) give a baseline of growth even
  //    on near-full bodies; multiplicative mods scale the whole thing.
  const growthMult = popGrowthMultiplier(empire);
  const growthAdd = popGrowthAdditive(empire);
  for (const sid of empire.systemIds) {
    const sys = draft.galaxy.systems[sid];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const body = draft.galaxy.bodies[bid];
      if (!body) continue;
      const cap = effectiveSpace(empire, body);
      // Strict logistic: pops never exceed cap. Clamp downward if
      // a cap-reducing modifier was removed between turns.
      if (body.pops > cap) body.pops = cap;
      if (body.pops >= cap) continue;
      // A body with zero pops has not been colonised — it doesn't
      // auto-populate just because the empire owns the system. Each
      // body requires its own explicit colonise action to bootstrap.
      if (body.pops === 0) continue;
      if (empire.resources.food < POP_GROWTH_FOOD_COST) continue;
      const headroom = (cap - body.pops) / cap;
      const chance = Math.max(0, Math.min(1, (headroom * 0.5 + growthAdd) * growthMult));
      if (growthRand() < chance) {
        body.pops = Math.min(cap, body.pops + 1);
        empire.resources.food -= POP_GROWTH_FOOD_COST;
      }
    }
  }

  // 5. Famine check — after income + project completions + growth.
  //    Food should never stay negative; every turn in deficit kills
  //    one pop somewhere (non-capital first, largest first) and
  //    clamps food back to zero.
  if (empire.resources.food < 0) {
    const starved = killStarvingPop(draft, empire);
    empire.resources.food = 0;
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
// Horizon weight on per-turn flows — roughly "how many turns of this
// future stream do I value". Keeping it a single knob (rather than
// per-resource) keeps the search simple.
export const FLOW_HORIZON = 5;

// Per unit of effective pop-space in an owned system (or a system with
// an outpost under way, scaled by progress). Values "room to grow" so
// a lush system outscores a rocky one even before colonies land.
// Calibrated below a filled-pop's flow value (~12/unit on temperate),
// since empty space is potential, not production.
export const MAX_POPS_VALUE = 8;

// Per-archetype intrinsic value of a ship. Conquerors want navies;
// isolationists want enough to defend; pragmatists sit in the middle.
// This is the base number before at-war multipliers and over-cap
// diminishing returns.
function shipValueFor(empire: Empire): number {
  switch (empire.expansionism) {
    case "conqueror":    return 300;
    case "pragmatist":   return 200;
    case "isolationist": return 250;
  }
}

export function scoreState(state: GameState, empireId: string): number {
  const empire = empireById(state, empireId);
  if (!empire) return -Infinity;
  let score = 0;
  // Hard assets (raw hammer-cost equivalent).
  score += empire.systemIds.length * COLONIZE_HAMMERS;
  // Max-pops potential: for every body in an owned system, credit its
  // effective space. This is the "room to grow" that differentiates a
  // lush system from a rocky one, and it's what in-flight outposts
  // contribute progress toward.
  for (const sysId of empire.systemIds) {
    const sys = state.galaxy.systems[sysId];
    if (!sys) continue;
    for (const bid of sys.bodyIds) {
      const body = state.galaxy.bodies[bid];
      if (!body) continue;
      score += effectiveSpace(empire, body) * MAX_POPS_VALUE;
    }
  }
  // Ships: archetype-weighted × at-war premium, with diminishing
  // returns once the fleet exceeds the per-turn compute cap (ships
  // you can't move in a single turn are mostly dead weight).
  const totalShips = totalFleetShipsFor(state, empire);
  if (totalShips > 0) {
    const atWar = enemiesOf(state, empire.id).length > 0;
    const shipBase = shipValueFor(empire) * (atWar ? 1.5 : 1.0);
    const cap = computeCapOf(state, empire);
    const mobileShips = Math.min(totalShips, cap);
    const stuckShips = Math.max(0, totalShips - cap);
    score += mobileShips * shipBase;
    score += stuckShips * shipBase * 0.2;
  }
  // Future production flows: a system with 30 busy pops is worth
  // markedly more than an empty one of the same colonize cost, and
  // this is where that difference shows up.
  let hammerRate = 0;
  for (const body of ownedBodiesOf(state, empire)) {
    hammerRate += body.pops * hammersPerPopFor(empire, body);
  }
  const flow = perTurnIncomeOf(state, empire);
  score += hammerRate * FLOW_HORIZON;
  score += flow.food * FLOW_HORIZON;
  score += flow.energy * FLOW_HORIZON;
  score += flow.political * FLOW_HORIZON * 3; // political is scarcer
  // Political capital is expensive to regenerate — rough exchange rate.
  score += empire.resources.political * 15;
  // In-flight projects: anticipate what they will be worth when they
  // complete, scaled by progress. For colonize, that's the new system
  // plus the flows its body will generate once populated — which
  // naturally values temperate/garden above harsh/hellscape because
  // their effective space is higher and they produce food. No hab
  // table, no hand-tuned weights — just the existing flow math.
  for (const order of empire.projects) {
    const progress =
      order.hammersRequired > 0
        ? Math.min(1, order.hammersPaid / order.hammersRequired)
        : 0;
    const progressWeight = 0.3 + 0.7 * progress;
    if (order.kind === "colonize") {
      const body = state.galaxy.bodies[order.targetBodyId];
      if (!body) continue;
      const pops = Math.min(COLONIZE_STARTER_POPS, effectiveSpace(empire, body));
      const hypothetical: Body = { ...body, pops };
      const projectedIncome = bodyIncomeFor(empire, hypothetical);
      const projectedHammers = pops * hammersPerPopFor(empire, body);
      const flow =
        (projectedHammers + projectedIncome.food + projectedIncome.energy) *
        FLOW_HORIZON;
      // Cost-of-work + anticipated flow, progress-weighted for
      // cancel risk.
      score += (COLONIZE_HAMMERS + flow) * progressWeight;
      // Colony-ship pops are already drawn from the capital — credit
      // the target's future flow at full weight so the net-zero pop
      // transfer doesn't show up as a loss. On a temperate→temperate
      // transfer this cleanly offsets the lower capital flow; on a
      // transfer to a worse hab the score correctly ends up lower.
      score += flow;
    } else if (
      order.kind === "empire_project" &&
      order.projectId === "build_frigate"
    ) {
      // A finished frigate is valued the same way as an existing one —
      // archetype × at-war premium. This is what makes Conqueror AIs at
      // war actually pile up fleets instead of stopping at the raw
      // hammer-cost-equivalent.
      const atWar = enemiesOf(state, empire.id).length > 0;
      const shipBase = shipValueFor(empire) * (atWar ? 1.5 : 1.0);
      score += shipBase * progressWeight;
    } else if (
      order.kind === "empire_project" &&
      order.projectId === "build_outpost"
    ) {
      // A finished outpost claims its system (COLONIZE_HAMMERS),
      // unlocks its pop-potential (MAX_POPS_VALUE per space), and
      // gains a small flat frontier value for the transit/denial
      // benefits that every claimed system provides (even a star-
      // only one). All three credit progress-weighted so starting
      // work on an outpost pulls some of that reward forward.
      const FRONTIER_PREMIUM = 50;
      const hostBody = order.targetBodyId ? state.galaxy.bodies[order.targetBodyId] : null;
      const targetSys = hostBody ? state.galaxy.systems[hostBody.systemId] : null;
      let sysMaxPops = 0;
      if (targetSys) {
        for (const bid of targetSys.bodyIds) {
          const b = state.galaxy.bodies[bid];
          if (b) sysMaxPops += effectiveSpace(empire, b);
        }
      }
      score += (COLONIZE_HAMMERS + FRONTIER_PREMIUM + sysMaxPops * MAX_POPS_VALUE) * progressWeight;
    } else {
      // Generic empire_project — fall back to 70% of raw hammer cost.
      score += order.hammersRequired * 0.7 * progressWeight;
    }
  }
  // Occupations — partial transfers in flight. Credit / debit are
  // conditional on active fleet presence: if the occupier has no fleet
  // at the system any more, the siege clears next turn (no credit); if
  // the defender has a fleet at their own sieged system, the siege
  // clears (no debit). This makes "stay and finish the job" and "go
  // defend a sieged system" the highest-scoring moves naturally,
  // without any heuristic rules in the move planner.
  for (const sys of Object.values(state.galaxy.systems)) {
    const occ = sys.occupation;
    if (!occ) continue;
    const progress = occ.turns / OCCUPATION_TURNS_TO_FLIP;
    const occupierHasFleet = Object.values(state.fleets).some(
      (f) => f.empireId === occ.empireId && f.systemId === sys.id && f.shipCount > 0,
    );
    const defenderHasFleet =
      sys.ownerId !== null &&
      Object.values(state.fleets).some(
        (f) => f.empireId === sys.ownerId && f.systemId === sys.id && f.shipCount > 0,
      );
    if (occ.empireId === empireId) {
      // We're the occupier — partial gain, only if we're still here.
      if (occupierHasFleet && !defenderHasFleet) {
        score += COLONIZE_HAMMERS * progress;
      }
    } else if (sys.ownerId === empireId) {
      // We're being occupied — partial loss, unless we have a defender.
      if (occupierHasFleet && !defenderHasFleet) {
        score -= COLONIZE_HAMMERS * progress;
      }
    }
  }
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

  // Archetype character filter — isolationists refuse to claim new
  // systems (either by outpost or any future colonize-into-unclaimed
  // mechanic). Applied as a post-filter so the enumerator itself stays
  // content-driven; character is a separate layer.
  if (empire.expansionism === "isolationist") {
    return actions.filter((a) => {
      if (a.type !== "queueEmpireProject") return true;
      if (a.projectId !== "build_outpost") return true;
      return false;
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
  if (empire.projects.length > 0) return;

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
    // Empire in energy deficit can't fuel movement. Destination stays
    // set; the fleet just doesn't step this turn.
    const fleetOwner = empireById(draft, fleet.empireId);
    if (!fleetOwner || fleetOwner.resources.energy <= 0) continue;
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
  }
}

// Build adjacency from the hyperlane list. Repeated on every turn's
// AI plan; cheap enough at current galaxy sizes.
function buildHyperlaneAdj(draft: GameState): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of draft.galaxy.hyperlanes) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  return adj;
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

  for (const fleet of ourFleets) {
    const reachable: string[] = [];
    for (const sid of Object.keys(baseline.galaxy.systems)) {
      if (sid === fleet.systemId) continue;
      const path = shortestPathFor(baseline, empire.id, fleet.systemId, sid);
      if (path && path.length > 0) reachable.push(sid);
    }

    const scoreCandidate = (mutate: (d: GameState) => void): number => {
      const projected = produce(baseline, (d) => {
        mutate(d);
        // 1-step forward sim: combat settles any new encounter, then
        // occupation ticks reveal whether we're advancing or breaking
        // sieges. scoreState reads the resulting state.
        resolveCombat(d);
        processOccupation(d);
      });
      return scoreState(projected, empire.id);
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

    // Each reachable destination (teleport approximation).
    for (const dest of reachable) {
      const score = scoreCandidate((d) => {
        const f = d.fleets[fleet.id];
        if (!f) return;
        f.systemId = dest;
        f.destinationSystemId = undefined;
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

// Archetype-driven war declarations. Conquerors occasionally declare
// war on a reachable neighbour; pragmatists and isolationists don't
// initiate (they still fight back via combat resolution).
function aiPlanDiplomacy(draft: GameState, empire: Empire, rand: () => number): void {
  if (empire.expansionism !== "conqueror") return;
  if (enemiesOf(draft, empire.id).length >= 1) return;
  if (empire.systemIds.length === 0) return;

  const adj = buildHyperlaneAdj(draft);

  // BFS through our + unowned territory; any hit on a foreign-owned
  // system counts as "in contact" for the purpose of starting a war.
  const MAX_DEPTH = 6;
  const contacted = new Set<string>();
  const visited = new Set<string>();
  let frontier = new Set<string>(empire.systemIds);
  for (const id of frontier) visited.add(id);
  for (let d = 0; d < MAX_DEPTH && frontier.size > 0; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (visited.has(n)) continue;
        const sys = draft.galaxy.systems[n];
        if (!sys) continue;
        if (sys.ownerId && sys.ownerId !== empire.id) {
          contacted.add(sys.ownerId);
          continue; // don't traverse through them
        }
        visited.add(n);
        next.add(n);
      }
    }
    frontier = next;
  }

  if (contacted.size === 0) return;
  if (rand() > 0.15) return;

  const list = Array.from(contacted);
  const pick = list[Math.floor(rand() * list.length)];
  if (!pick) return;
  applyDeclareWar(draft, {
    byEmpireId: empire.id,
    targetEmpireId: pick,
  });
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
  const cap = draft.galaxy.bodies[emp.capitalBodyId!];
  cap.pops -= COLONIZE_POP_COST;
  emp.projects.push({
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
  emp.projects.push({
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
  const order = emp.projects.find((o) => o.id === action.orderId);
  if (!order) return;
  // Refund colony-ship pops to the current capital (capital may have
  // changed since queue time if the old one fell; refund lands at the
  // new home). If no capital exists, the settlers are lost.
  if (order.kind === "colonize") {
    const cap = emp.capitalBodyId ? draft.galaxy.bodies[emp.capitalBodyId] : null;
    if (cap) cap.pops += COLONIZE_POP_COST;
  }
  emp.projects = emp.projects.filter((o) => o.id !== action.orderId);
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
  emp.resources.political -= cost;
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
            space: Math.max(starterBody.space, 80),
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
            space: 80,
            pops: startingPops,
            hammers: 0,
            queue: [],
            flavorFlags: [],
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
        for (const key of RESOURCE_KEYS) {
          draft.empire.resources[key] = origin.startingResources[key] ?? 0;
        }
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
            const targetBodyId =
              proj.scope === "body"
                ? draft.empire.capitalBodyId ?? undefined
                : undefined;
            draft.empire.projects.push({
              kind: "empire_project",
              id: nextOrderId(),
              projectId: proj.id,
              hammersRequired: proj.hammersRequired,
              hammersPaid: 0,
              targetBodyId,
            });
          }
        }
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
            for (const key of RESOURCE_KEYS) {
              empire.resources[key] = originObj.startingResources[key] ?? 0;
            }
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
                const targetBodyId =
                  proj.scope === "body"
                    ? empire.capitalBodyId ?? undefined
                    : undefined;
                empire.projects.push({
                  kind: "empire_project",
                  id: nextOrderId(),
                  projectId: proj.id,
                  hammersRequired: proj.hammersRequired,
                  hammersPaid: 0,
                  targetBodyId,
                });
              }
            }
          }
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

    const growthRand = mulberry32(draft.rngSeed ^ 0xa5a5a5a5);

    // AI project planning runs before ticks so newly-queued orders
    // drain this turn (mirrors how the player queues before endTurn).
    for (const ai of draft.aiEmpires) {
      aiPlanProject(draft, ai);
    }

    tickEmpire(draft, draft.empire, growthRand);
    for (const ai of draft.aiEmpires) {
      tickEmpire(draft, ai, growthRand);
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
