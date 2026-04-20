import { produce } from "immer";
import { LEADERS, originById, projectById, speciesById, traitById, EMPIRE_PROJECTS } from "./content";
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
  | { type: "endTurn" }
  | { type: "resolveEvent"; eventId: string; choiceId: string }
  | { type: "queueColonize"; targetBodyId: string }
  | { type: "queueEmpireProject"; projectId: string; targetBodyId?: string }
  | { type: "cancelOrder"; orderId: string }
  | { type: "dismissProjectCompletion" };

// Colonization tunables. Pop counts + space caps are now on a 10x
// scale (so a starter temperate world runs ~40 pops instead of 4),
// which gives per-turn growth a smoother feel.
export const COLONIZE_HAMMERS = 200;
export const COLONIZE_POLITICAL = 5;
export const COLONIZE_STARTER_POPS = 10;

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

// Disc shape carved from this grid by the generator. 15 x 13 yields
// ~110 systems at 0.85 density — large enough to give multiple
// empires room to maneuver without the map becoming unreadable.
export const GALAXY_SIZE = { width: 15, height: 13, density: 0.85 };

// Food is produced ONLY on temperate/garden worlds and only per pop.
// Harsh and hellscape bodies generate 0 food. Everything else
// (energy/alloys) still scales per pop by habitability.
const PER_POP_BY_HAB: Record<HabitabilityTier, Partial<Record<ResourceKey, number>>> = {
  garden:    { food: 2, energy: 1, alloys: 0 },
  temperate: { food: 2, energy: 1, alloys: 1 },
  harsh:     { food: 0, energy: 1, alloys: 2 },
  hellscape: { food: 0, energy: 1, alloys: 3 },
};

const HAB_COLONIZE_SCORE: Record<HabitabilityTier, number> = {
  garden: 4,
  temperate: 3,
  harsh: 2,
  hellscape: 1,
};

export const HAMMERS_PER_POP = 1;
const COMPUTE_PER_BODY = 1;
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
    flags: [],
  };
}

export function initialState(): GameState {
  return {
    schemaVersion: 12,
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
      flags: [],
    },
    aiEmpires: [],
    fleets: {},
    eventQueue: [],
    eventLog: [],
    projectCompletions: [],
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
  // Look for an existing fleet for this empire at this system.
  for (const f of Object.values(draft.fleets)) {
    if (f.empireId === empireId && f.systemId === systemId) {
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

// Effective hammer yield per pop.
export function hammersPerPop(empire: Empire): number {
  return HAMMERS_PER_POP + sumDelta(empireModifiers(empire), "hammersPerPopDelta");
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
  alloys: "Alloys",
  political: "Political Capital",
};
const RESOURCE_ICON_PATH: Record<ResourceKey, string> = {
  food: "/icons/food.png",
  energy: "/icons/energy.png",
  alloys: "/icons/alloys.png",
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
  const rate = hammersPerPop(empire);
  const bodyRows = ownedBodiesOf(state, empire)
    .filter((b) => b.pops > 0)
    .map((body) => ({
      id: body.id,
      name: body.name,
      detail: `${body.pops} pops × ${rate}/pop`,
      value: Math.floor(body.pops * rate),
      habitability: body.habitability,
    }));
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
  const bodyRows = ownedBodiesOf(state, empire).map((body) => ({
    id: body.id,
    name: body.name,
    detail: "data-center stub",
    value: COMPUTE_PER_BODY,
    habitability: body.habitability,
  }));
  const total = bodyRows.reduce((s, r) => s + r.value, 0);
  return {
    title: "Compute",
    iconSrc: "/icons/compute.png",
    unit: "/turn",
    total,
    sections: [{ label: "Per body", rows: bodyRows }],
  };
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

// Is this empire allowed to queue the given project right now?
// For body-scope projects, pass the `targetBodyId` of the intended host
// (capital or any-owned) so the body requirement can be validated.
export function canQueueProjectFor(
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
    // "any_owned" — caller is expected to only call with an owned body.
  }
  // Dedupe rules:
  //  - Empire-scope projects: at most one of a given projectId queued.
  //  - Body-scope projects: at most one (projectId, targetBodyId) pair.
  //    Different bodies can queue the same project concurrently so
  //    repeatable things like frigates can be built in parallel.
  for (const order of empire.projects) {
    if (order.kind !== "empire_project" || order.projectId !== projectId) continue;
    if (proj.scope === "body") {
      if (order.targetBodyId === targetBodyId) return false;
    } else {
      return false;
    }
  }
  return true;
}

// Empire-scope projects this empire can queue right now.
export function availableProjectsFor(empire: Empire) {
  return EMPIRE_PROJECTS.filter(
    (p) => p.scope === "empire" && canQueueProjectFor(empire, p.id),
  );
}

// Body-scope projects this empire can queue on the given body.
export function availableBodyProjectsFor(empire: Empire, bodyId: string) {
  return EMPIRE_PROJECTS.filter(
    (p) => p.scope === "body" && canQueueProjectFor(empire, p.id, bodyId),
  );
}

// In-flight body-scope project order for a given body, if any.
export function bodyProjectOrderFor(empire: Empire, bodyId: string) {
  for (const order of empire.projects) {
    if (order.kind === "empire_project" && order.targetBodyId === bodyId) return order;
  }
  return null;
}

export function fleetsInSystem(state: GameState, systemId: string): Fleet[] {
  return Object.values(state.fleets).filter((f) => f.systemId === systemId);
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
    empire.completedProjects.push(proj.id);
    if (empire.id === draft.empire.id) {
      draft.eventLog.push({
        turn: draft.turn,
        eventId: `project:${proj.id}`,
        choiceId: null,
        text: proj.onComplete.chronicle,
      });
      // Queue a modal so the player gets a dedicated flavour beat.
      draft.projectCompletions.push({ projectId: proj.id, turn: draft.turn });
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

function tickEmpire(draft: GameState, empire: Empire, growthRand: () => number): void {
  // 1. Stock income.
  const income = perTurnIncomeOf(draft, empire);
  for (const k of RESOURCE_KEYS) {
    empire.resources[k] += income[k];
  }
  // 2. Reset flow resources on this empire's bodies.
  empire.compute.cap = computeCapOf(draft, empire);
  empire.compute.used = 0;
  const hammerRate = hammersPerPop(empire);
  for (const body of ownedBodiesOf(draft, empire)) {
    const live = draft.galaxy.bodies[body.id];
    if (live) live.hammers = Math.floor(live.pops * hammerRate);
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
function aiPlan(state: GameState, empire: Empire): BuildOrder | null {
  if (empire.projects.length > 0) return null;

  const effPolitical = effectiveColonizePolitical(empire);
  const effHammers = effectiveColonizeHammers(empire);
  // Buffer on top of the colonize PC cost, so more-isolationist empires
  // also demand a larger stockpile before committing.
  const buffer = (() => {
    switch (empire.expansionism) {
      case "conqueror":    return 0;
      case "pragmatist":   return 5;
      case "isolationist": return 15;
    }
  })();
  if (empire.resources.political < effPolitical + buffer) return null;

  let bestId: string | null = null;
  let bestScore = -1;
  for (const body of Object.values(state.galaxy.bodies)) {
    if (!canColonizeFor(state, empire, body.id)) continue;
    // Isolationists won't claim new systems — only fill in systems they
    // already own.
    if (empire.expansionism === "isolationist") {
      const targetSys = state.galaxy.systems[body.systemId];
      if (!targetSys || targetSys.ownerId !== empire.id) continue;
    }
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
    hammersRequired: effHammers,
    hammersPaid: 0,
    politicalCost: effPolitical,
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
        const starterBodyId = sys.bodyIds[0];
        const starterBody = nextGalaxy.bodies[starterBodyId];
        // Starter body is guaranteed temperate with generous space.
        // (Gardens are disabled for now — see galaxy.ts.)
        const updatedBody = {
          ...starterBody,
          habitability: "temperate" as const,
          kind: "planet" as const,
          space: Math.max(starterBody.space, 80),
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
        draft.empire.compute.cap = draft.galaxy.systems[playerStarter.systemId].bodyIds.length * COMPUTE_PER_BODY;
        draft.empire.compute.used = 0;
        const playerHammerRate = hammersPerPop(draft.empire);
        for (const bid of draft.galaxy.systems[playerStarter.systemId].bodyIds) {
          const body = draft.galaxy.bodies[bid];
          if (body) body.hammers = Math.floor(body.pops * playerHammerRate);
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
          empire.compute.cap = draft.galaxy.systems[starter.systemId].bodyIds.length * COMPUTE_PER_BODY;
          return empire;
        });
        // Seed AI bodies' hammers too so turn-1 rates show correctly.
        for (const ai of draft.aiEmpires) {
          const rate = hammersPerPop(ai);
          for (const bid of draft.galaxy.systems[ai.systemIds[0]].bodyIds) {
            const body = draft.galaxy.bodies[bid];
            if (body) body.hammers = Math.floor(body.pops * rate);
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

    case "queueColonize": {
      if (!canColonize(state, action.targetBodyId)) return state;
      const hammers = effectiveColonizeHammers(state.empire);
      const political = effectiveColonizePolitical(state.empire);
      return produce(state, (draft) => {
        draft.empire.projects.push({
          kind: "colonize",
          id: nextOrderId(),
          targetBodyId: action.targetBodyId,
          hammersRequired: hammers,
          hammersPaid: 0,
          politicalCost: political,
        });
      });
    }

    case "queueEmpireProject": {
      if (!canQueueProjectFor(state.empire, action.projectId, action.targetBodyId)) return state;
      const proj = projectById(action.projectId);
      if (!proj) return state;
      return produce(state, (draft) => {
        draft.empire.projects.push({
          kind: "empire_project",
          id: nextOrderId(),
          projectId: proj.id,
          hammersRequired: proj.hammersRequired,
          hammersPaid: 0,
          targetBodyId: action.targetBodyId,
        });
      });
    }

    case "cancelOrder": {
      return produce(state, (draft) => {
        draft.empire.projects = draft.empire.projects.filter((o) => o.id !== action.orderId);
      });
    }

    case "dismissProjectCompletion": {
      return produce(state, (draft) => {
        draft.projectCompletions.shift();
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
