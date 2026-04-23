import { produce } from "immer";
import { describe, expect, it } from "vitest";
import {
  aiPlanMoves,
  aiPlanProject,
  allOrdersOf,
  atWar,
  autoDiscoveryDestination,
  availableBodyProjectsFor,
  shortestPathFor,
  BENCH,
  canEnterSystem,
  empireById,
  filterStateFor,
  foreignFleetsInSensor,
  hostileFleetsInSensor,
  needsPlayerAttention,
  reduce,
  scoreState,
  sensorSet,
  updateVisibility,
} from "./reducer";
import type { Body, Empire, Fleet, GameState, StarSystem } from "./types";

// =====================================================================
// Builders. The game state is plain data, so tests construct states by
// hand rather than running the full newGame reducer. This keeps tests
// deterministic and focused on the behaviour under test.
// =====================================================================

function makeBody(overrides: Partial<Body> & { id: string; systemId: string }): Body {
  return {
    id: overrides.id,
    systemId: overrides.systemId,
    name: overrides.name ?? overrides.id,
    kind: overrides.kind ?? "planet",
    habitability: overrides.habitability ?? "temperate",
    maxPops: overrides.maxPops ?? 100,
    pops: overrides.pops ?? 0,
    hammers: overrides.hammers ?? 0,
    queue: overrides.queue ?? [],
    flavorFlags: overrides.flavorFlags ?? [],
    features: overrides.features ?? [],
  };
}

function makeSystem(overrides: Partial<StarSystem> & { id: string; bodyIds: string[] }): StarSystem {
  return {
    name: overrides.id,
    q: 0,
    r: 0,
    starKind: "yellow_main",
    ownerId: null,
    ...overrides,
  };
}

// Tests take a compact `resources` bag that maps directly to the
// empire's flat food/energy/political stocks. Keeps the existing
// test call sites untouched now that component pools have been
// retired.
type LegacyEmpireOverrides = Partial<Empire> & {
  id: string;
  resources?: { food?: number; energy?: number; political?: number };
};
function makeEmpire(overrides: LegacyEmpireOverrides): Empire {
  const res = overrides.resources ?? { food: 500, energy: 500, political: 20 };
  const systemIds = overrides.systemIds ?? [];
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    speciesId: overrides.speciesId ?? "humans",
    originId: overrides.originId ?? "steady_evolution",
    color: overrides.color ?? "#7ec8ff",
    food: overrides.food ?? res.food ?? 0,
    energy: overrides.energy ?? res.energy ?? 0,
    political: overrides.political ?? res.political ?? 20,
    compute: overrides.compute ?? { cap: 0, used: 0 },
    expansionism: overrides.expansionism ?? "pragmatist",
    politic: overrides.politic ?? "centrist",
    capitalBodyId: overrides.capitalBodyId ?? null,
    systemIds,
    storyModifiers: overrides.storyModifiers ?? {},
    completedProjects: overrides.completedProjects ?? [],
    adoptedPolicies: overrides.adoptedPolicies ?? [],
    flags: overrides.flags ?? [],
    perception: overrides.perception ?? {
      discovered: [],
      snapshots: {},
      seenFlavour: [],
      surveyed: [],
      
    },
  };
}

// Test helper — scoreState now demands a filtered view as its input.
// Tests generally don't care about the filter step; they're testing
// scoring behaviour. This wrapper runs the filter then scores so the
// existing test code reads naturally.
function score(state: GameState, empireId: string): number {
  return scoreState(filterStateFor(state, empireId), empireId);
}

// Run just one empire's phase inside a fresh round: tick everyone via
// beginRound, then step phases until the target empire has acted.
// The round isn't finalized (no occupation pass, no random event),
// which keeps tests focused on what happens in this one phase rather
// than on full end-of-round mechanics. Defaults to the player.
function runOnePhase(
  state: GameState,
  empireId?: string,
): GameState {
  const target = empireId ?? state.humanEmpireId;
  let s = reduce(state, { type: "beginRound" });
  // runPhase processes the current empire and advances the pointer.
  // Stop once we've run the target empire's phase.
  while (s.currentPhaseEmpireId) {
    const running = s.currentPhaseEmpireId;
    s = reduce(s, { type: "runPhase" });
    if (running === target) break;
  }
  return s;
}

function makeState(overrides: {
  systems: StarSystem[];
  bodies: Body[];
  hyperlanes?: Array<[string, string]>;
  empire: Empire;
  aiEmpires?: Empire[];
  fleets?: Fleet[];
  wars?: Array<[string, string]>;
  turn?: number;
}): GameState {
  const fleetsRec: Record<string, Fleet> = {};
  for (const f of overrides.fleets ?? []) fleetsRec[f.id] = f;
  const ais = overrides.aiEmpires ?? [];
  const raw: GameState = {
    schemaVersion: 28,
    turn: overrides.turn ?? 1,
    rngSeed: 1,
    galaxy: {
      systems: Object.fromEntries(overrides.systems.map((s) => [s.id, s])),
      bodies: Object.fromEntries(overrides.bodies.map((b) => [b.id, b])),
      hyperlanes: overrides.hyperlanes ?? [],
      width: 10,
      height: 10,
    },
    empires: [overrides.empire, ...ais],
    humanEmpireId: overrides.empire.id,
    fleets: fleetsRec,
    wars: overrides.wars ?? [],
    eventQueue: [],
    eventLog: [],
    projectCompletions: [],
    pendingFirstContacts: [],
    gameOver: false,
  };
  // Seed fog the way production does at new-game time — every empire
  // starts knowing its own territory and the 1-jump ring around it.
  // Without this, AI fog checks in scoreState / aiPlanMoves /
  // aiEnumerateProjectActions would see empty discovered sets and
  // refuse to move or colonize anywhere.
  return produce(raw, (draft) => updateVisibility(draft));
}

// =====================================================================
// Tests
// =====================================================================

describe("deterministic pop growth", () => {
  it("applies the hard-cap growth formula exactly in one tick", () => {
    // Formula (hard cap, no logistic damping):
    //   ΔPops = BASE_ORGANIC_GROWTH_RATE × mult × pops + additive
    // where BASE_ORGANIC_GROWTH_RATE = 2^(1/60) − 1 ≈ 0.011619.
    // Test empire has no origin modifiers → mult = 1, additive = 0.
    // For pops = 20: 0.011619 × 1 × 20 ≈ 0.232388 → 20.232388.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 20, maxPops: 40 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 10000, energy: 10000, political: 10 },
    });
    const state = makeState({ systems: [home], bodies: [cap], empire: player });
    const ticked = runOnePhase(state, "e_player");
    expect(ticked.galaxy.bodies["b_cap"].pops).toBeCloseTo(20.23239, 4);
  });

  it("Matriarchal-Hive-style modifiers: zero organic, positive additive", () => {
    // popGrowthMult = 0 kills organic entirely; popGrowthAdd = 0.3
    // contributes flat per-turn pops. Hard cap means no headroom
    // factor: for pops = 10, cap = 40 → ΔPops = 0 + 0.3 = 0.3.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 10, maxPops: 40 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 10000, energy: 10000, political: 10 },
      storyModifiers: {
        matriarchal_hive: [
          { kind: "popGrowthMult", value: 0 },
          { kind: "popGrowthAdd", value: 0.3 },
        ],
      },
    });
    const state = makeState({ systems: [home], bodies: [cap], empire: player });
    const ticked = runOnePhase(state, "e_player");
    expect(ticked.galaxy.bodies["b_cap"].pops).toBeCloseTo(10.3, 4);
  });

  it("does not grow an uncolonized (0-pop) body with only organic growth", () => {
    // Organic growth compounds off existing pops, so a 0-pop body stays
    // at 0 even on a big owned planet — you need to colonise it first.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap", "b_empty"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const empty = makeBody({ id: "b_empty", systemId: "s_home", pops: 0 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 10000, energy: 10000, political: 10 },
    });
    const state = makeState({ systems: [home], bodies: [cap, empty], empire: player });
    const ticked = runOnePhase(state, "e_player");
    expect(ticked.galaxy.bodies["b_empty"].pops).toBe(0);
  });

  it("internal migration moves pops from the empire's largest colony to its most-headroom colony", () => {
    // Big populated world + a sparsely-populated frontier colony
    // with lots of room. After a tick, pops should drift from big
    // to the frontier. No hyperlane between them — migration is
    // empire-wide now (no connectivity gate).
    const home = makeSystem({ id: "s_home", bodyIds: ["b_big"], ownerId: "e_player" });
    const remote = makeSystem({ id: "s_remote", bodyIds: ["b_small"], ownerId: "e_player" });
    const big = makeBody({ id: "b_big", systemId: "s_home", pops: 30, maxPops: 40 });
    const small = makeBody({ id: "b_small", systemId: "s_remote", pops: 5, maxPops: 80 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_big",
      systemIds: [home.id, remote.id],
      resources: { food: 10000, energy: 10000, political: 10 },
    });
    const state = makeState({
      systems: [home, remote],
      bodies: [big, small],
      // Deliberately no hyperlane — migration is empire-wide.
      empire: player,
    });
    const ticked = runOnePhase(state, "e_player");
    // Delta narrows (big loses, small gains) regardless of how much
    // organic growth both sides also pick up this turn.
    const beforeDelta = small.pops - big.pops;
    const afterDelta =
      ticked.galaxy.bodies["b_small"].pops -
      ticked.galaxy.bodies["b_big"].pops;
    expect(afterDelta).toBeGreaterThan(beforeDelta);
  });
});

describe("availableBodyProjectsFor", () => {
  it("does NOT offer build_frigate on an uncolonized body (pops = 0)", () => {
    // This is the exact regression we shipped — prior to the fix, the
    // "Build Frigate" button appeared on every body in an owned system
    // regardless of whether it had pops.
    const capital = makeBody({
      id: "b_capital",
      systemId: "s_home",
      pops: 30,
    });
    const uncolonized = makeBody({
      id: "b_barren",
      systemId: "s_home",
      pops: 0,
    });
    const system = makeSystem({
      id: "s_home",
      bodyIds: [capital.id, uncolonized.id],
      ownerId: "e_player",
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: capital.id,
      systemIds: [system.id],
    });
    const state = makeState({
      systems: [system],
      bodies: [capital, uncolonized],
      empire,
    });

    const onColonized = availableBodyProjectsFor(state, empire, capital.id);
    const onBarren = availableBodyProjectsFor(state, empire, uncolonized.id);

    expect(onColonized.map((p) => p.id)).toContain("build_frigate");
    expect(onBarren.map((p) => p.id)).not.toContain("build_frigate");
  });

  it("rejects bodies whose system is owned by someone else", () => {
    const b = makeBody({ id: "b", systemId: "s", pops: 30 });
    const s = makeSystem({ id: "s", bodyIds: [b.id], ownerId: "e_other" });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: null,
      systemIds: [],
    });
    const state = makeState({ systems: [s], bodies: [b], empire });
    expect(availableBodyProjectsFor(state, empire, b.id).map((p) => p.id)).not.toContain(
      "build_frigate",
    );
  });
});

describe("canEnterSystem", () => {
  function setup(opts: {
    targetOwner: string | null;
    wars?: Array<[string, string]>;
  }): { state: GameState; moverId: string; targetId: string } {
    const target = makeSystem({ id: "s_target", bodyIds: [], ownerId: opts.targetOwner });
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const empire = makeEmpire({ id: "e_player", systemIds: [home.id] });
    const state = makeState({
      systems: [home, target],
      bodies: [],
      empire,
      wars: opts.wars,
    });
    return { state, moverId: "e_player", targetId: target.id };
  }

  it("allows entry into unowned systems", () => {
    const { state, moverId, targetId } = setup({ targetOwner: null });
    expect(canEnterSystem(state, moverId, targetId)).toBe(true);
  });

  it("allows entry into own systems", () => {
    const { state, moverId } = setup({ targetOwner: null });
    expect(canEnterSystem(state, moverId, "s_home")).toBe(true);
  });

  it("allows entry into neutral-owned systems (declares war on arrival)", () => {
    // Pre-arrival reachability is now unrestricted — moving into a
    // foreign-owned system IS the declaration of war. The actual
    // entry point (processFleetOrders / scoreCandidate) calls
    // maybeAutoDeclareWar to make that real.
    const { state, moverId, targetId } = setup({ targetOwner: "e_other" });
    expect(canEnterSystem(state, moverId, targetId)).toBe(true);
  });

  it("allows entry into at-war systems", () => {
    const { state, moverId, targetId } = setup({
      targetOwner: "e_other",
      wars: [["e_other", "e_player"].sort() as [string, string]],
    });
    expect(canEnterSystem(state, moverId, targetId)).toBe(true);
  });
});

describe("atWar", () => {
  it("is symmetric", () => {
    const e = makeEmpire({ id: "e_a" });
    const state = makeState({
      systems: [],
      bodies: [],
      empire: e,
      wars: [["e_a", "e_b"]],
    });
    expect(atWar(state, "e_a", "e_b")).toBe(true);
    expect(atWar(state, "e_b", "e_a")).toBe(true);
    expect(atWar(state, "e_a", "e_a")).toBe(false);
    expect(atWar(state, "e_a", "e_c")).toBe(false);
  });
});

describe("setFleetDestination action", () => {
  function twoSystemSetup(opts: {
    destOwner?: string | null;
    wars?: Array<[string, string]>;
  } = {}): { state: GameState; fleetId: string; destId: string } {
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const dest = makeSystem({
      id: "s_dest",
      bodyIds: [],
      ownerId: opts.destOwner === undefined ? null : opts.destOwner,
    });
    const empire = makeEmpire({ id: "e_player", systemIds: [home.id] });
    const fleet: Fleet = { id: "f1", empireId: "e_player", systemId: "s_home", shipCount: 3 };
    const state = makeState({
      systems: [home, dest],
      bodies: [],
      hyperlanes: [["s_home", "s_dest"]],
      empire,
      fleets: [fleet],
      wars: opts.wars,
    });
    return { state, fleetId: fleet.id, destId: dest.id };
  }

  it("stores the destination without moving the fleet", () => {
    const { state, fleetId, destId } = twoSystemSetup();
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    expect(next.fleets[fleetId]?.systemId).toBe("s_home");
    expect(next.fleets[fleetId]?.destinationSystemId).toBe(destId);
  });

  it("clears the destination when toSystemId is null", () => {
    const { state, fleetId, destId } = twoSystemSetup();
    const withOrder = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    const cleared = reduce(withOrder, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: null,
    });
    expect(cleared.fleets[fleetId]?.destinationSystemId).toBeUndefined();
  });

  it("refuses a dispatch from an empire that doesn't own the fleet", () => {
    const { state, fleetId, destId } = twoSystemSetup();
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_other",
      fleetId,
      toSystemId: destId,
    });
    expect(next).toBe(state);
  });

  it("accepts a neutral destination (entry will auto-declare war)", () => {
    // Foreign-owned systems are reachable now — the declaration of
    // war happens when the fleet actually arrives, handled by the
    // move pipeline (not by this commit path).
    const { state, fleetId, destId } = twoSystemSetup({ destOwner: "e_other" });
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    expect(next.fleets[fleetId]?.destinationSystemId).toBe(destId);
  });

  it("accepts an at-war destination", () => {
    const { state, fleetId, destId } = twoSystemSetup({
      destOwner: "e_other",
      wars: [["e_other", "e_player"].sort() as [string, string]],
    });
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    expect(next.fleets[fleetId]?.destinationSystemId).toBe(destId);
  });
});

describe("AI scoreState value function", () => {
  it("partially credits in-progress occupations on both sides", () => {
    // Zero-pop bodies isolate the assertion to occupation math only.
    const contested = makeSystem({
      id: "s_contested",
      bodyIds: ["b_contested"],
      ownerId: "e_player",
      occupation: { empireId: "e_ai", turns: 2 },
    });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const contestedBody = makeBody({ id: "b_contested", systemId: "s_contested", pops: 0 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 0 });
    const player = makeEmpire({
      id: "e_player",
      systemIds: [contested.id],
      resources: { food: 0, energy: 0, political: 0 },
    });
    const ai = makeEmpire({
      id: "e_ai",
      systemIds: [aiHome.id],
      resources: { food: 0, energy: 0, political: 0 },
    });
    const siegeFleet: Fleet = {
      id: "f_siege",
      empireId: "e_ai",
      systemId: "s_contested",
      shipCount: 1,
    };
    const state = makeState({
      systems: [contested, aiHome],
      bodies: [contestedBody, aiBody],
      empire: player,
      aiEmpires: [ai],
      fleets: [siegeFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    // Player = body intrinsic (100 maxPops × 2) = 200
    // + empire flats (+1 political baseline × 5 × 3 = 15, -1 outpost
    //   upkeep × 5 = -5) = 10
    // + scout reach (1 owned system × 50 pragmatist) = 50
    // - occupation debit (200 × 0.6 = 120)
    // - AT_WAR_COST (pragmatist × 1 enemy = 500)
    // - enemy-ship threat (1 AI ship × 500 × 1.2 = 600)
    // ≈ -960.
    const playerScore = score(state, "e_player");
    expect(playerScore).toBeGreaterThan(-970);
    expect(playerScore).toBeLessThan(-950);
    // AI = body intrinsic (200)
    // + empire flats (10)
    // + stuck 1-ship @ at-war (500 pragmatist × 1.2 × 0.2) = 120
    // + scout reach (2 systems: own aiHome + fleet at s_contested) × 50 = 100
    // + occupation credit (200 × 0.6 = 120)
    // - AT_WAR_COST (pragmatist × 1 enemy = 500)
    // - enemy-ship threat (player has no ships = 0)
    // ≈ 50.
    const aiScore = score(state, "e_ai");
    expect(aiScore).toBeGreaterThan(40);
    expect(aiScore).toBeLessThan(60);
  });

  it("values systems and ships in hammer-equivalent units", () => {
    // Use a 0-pop body so the flow terms (hammers/food/energy per turn)
    // are all zero and the expected number is purely assets.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 0 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 0, energy: 0, political: 0 },
    });
    const fleet: Fleet = {
      id: "f",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 2,
    };
    const state = makeState({
      systems: [home],
      bodies: [cap],
      empire: player,
      fleets: [fleet],
    });
    // Body intrinsic: maxPops (100) × MAX_POPS_VALUE (2) = 200.
    // Flows from the body: 0 (no pops).
    // Ships: 2 × 500 (pragmatist peace) × stuck 20% (cap=0) = 200.
    // Political flat: +1 baseline × FLOW_HORIZON (5) × weight (3) = 15.
    // Energy from empire-level outpost upkeep: -1 × 5 × 1 = -5.
    // Scout reach: 1 system (s_home, own + fleet there) × 50 = 50.
    // Total = 200 + 200 + 15 − 5 + 50 = 460.
    expect(score(state, "e_player")).toBe(460);
  });

  it("queueing colonize deducts COLONIZE_POP_COST from the capital", () => {
    // The colony ship "carries" its pops from the capital. Queueing
    // the order pays those pops up front; the same number arrive on
    // the target when the order completes. Net-zero empire-wide.
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_cap", "b_vacant"],
      ownerId: "e_player",
    });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const vacant = makeBody({
      id: "b_vacant",
      systemId: "s_home",
      habitability: "temperate",
      pops: 0,
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const state = makeState({ systems: [home], bodies: [cap, vacant], empire });
    const queued = reduce(state, {
      type: "queueColonize",
      byEmpireId: "e_player",
      targetBodyId: "b_vacant",
    });
    expect(queued.galaxy.bodies["b_cap"].pops).toBe(25);
    expect(allOrdersOf(queued, queued.empires[0])).toHaveLength(1);
  });

  it("refuses to queue colonize when the capital has fewer than COLONIZE_POP_COST pops", () => {
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_cap", "b_vacant"],
      ownerId: "e_player",
    });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 4 });
    const vacant = makeBody({
      id: "b_vacant",
      systemId: "s_home",
      habitability: "temperate",
      pops: 0,
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const state = makeState({ systems: [home], bodies: [cap, vacant], empire });
    const attempted = reduce(state, {
      type: "queueColonize",
      byEmpireId: "e_player",
      targetBodyId: "b_vacant",
    });
    // No order queued, capital pops untouched.
    expect(allOrdersOf(attempted, attempted.empires[0])).toHaveLength(0);
    expect(attempted.galaxy.bodies["b_cap"].pops).toBe(4);
  });

  it("cancelling a colonize order refunds the pops to the capital", () => {
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_cap", "b_vacant"],
      ownerId: "e_player",
    });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const vacant = makeBody({
      id: "b_vacant",
      systemId: "s_home",
      habitability: "temperate",
      pops: 0,
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const state = makeState({ systems: [home], bodies: [cap, vacant], empire });
    const queued = reduce(state, {
      type: "queueColonize",
      byEmpireId: "e_player",
      targetBodyId: "b_vacant",
    });
    const orderId = allOrdersOf(queued, queued.empires[0])[0].id;
    const cancelled = reduce(queued, {
      type: "cancelOrder",
      byEmpireId: "e_player",
      orderId,
    });
    expect(allOrdersOf(cancelled, cancelled.empires[0])).toHaveLength(0);
    expect(cancelled.galaxy.bodies["b_cap"].pops).toBe(30);
  });

  it("scoreState increases after queueing colonize on a second body in an owned system", () => {
    // The target system is already ours (via an earlier outpost —
    // which is how systems get claimed under the new model). Queueing
    // colonise on an empty body in it should raise our score by the
    // partial-credit weight.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap", "b_vacant"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const vacant = makeBody({
      id: "b_vacant",
      systemId: "s_home",
      habitability: "temperate",
      pops: 0,
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 500, energy: 500, political: 20 },
    });
    const state = makeState({
      systems: [home],
      bodies: [cap, vacant],
      empire,
    });
    const baseScore = score(state, "e_player");
    const queued = reduce(state, {
      type: "queueColonize",
      byEmpireId: "e_player",
      targetBodyId: "b_vacant",
    });
    expect(score(queued, "e_player")).toBeGreaterThan(baseScore);
  });

  it("rates an in-flight outpost on a lush target above one on a star-only target", () => {
    // Two adjacent unclaimed systems: one has a temperate planet
    // alongside its star, the other is star-only. Queueing an outpost
    // on either puts the empire in the same "system-claim-in-progress"
    // state — but the lush one should score higher because its pop
    // potential is credited at progress weight.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const lush = makeSystem({ id: "s_lush", bodyIds: ["b_lush_star", "b_lush_temp"], ownerId: null });
    const barren = makeSystem({ id: "s_barren", bodyIds: ["b_barren_star"], ownerId: null });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 0 });
    const lushStar = makeBody({
      id: "b_lush_star",
      systemId: "s_lush",
      kind: "star",
      habitability: "stellar",
      maxPops: 0,
    });
    const lushTemp = makeBody({
      id: "b_lush_temp",
      systemId: "s_lush",
      habitability: "temperate",
      pops: 0,
    });
    const barrenStar = makeBody({
      id: "b_barren_star",
      systemId: "s_barren",
      kind: "star",
      habitability: "stellar",
      maxPops: 0,
    });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 500, energy: 500, political: 20 },
    });
    const state = makeState({
      systems: [home, lush, barren],
      bodies: [cap, lushStar, lushTemp, barrenStar],
      hyperlanes: [["s_home", "s_lush"], ["s_home", "s_barren"]],
      empire,
    });
    const toLush = reduce(state, {
      type: "queueEmpireProject",
      byEmpireId: "e_player",
      projectId: "build_outpost",
      targetBodyId: "b_lush_star",
    });
    const toBarren = reduce(state, {
      type: "queueEmpireProject",
      byEmpireId: "e_player",
      projectId: "build_outpost",
      targetBodyId: "b_barren_star",
    });
    expect(score(toLush, "e_player")).toBeGreaterThan(
      score(toBarren, "e_player"),
    );
  });
});

describe("combat chronicle", () => {
  it("records before/after ship counts per faction for player-involved combat", () => {
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const ai = makeEmpire({
      id: "e_ai",
      name: "Rival Empire",
      capitalBodyId: "b_ai",
      systemIds: [aiHome.id],
      expansionism: "pragmatist",
    });
    const playerFleet: Fleet = {
      id: "f_p",
      empireId: "e_player",
      systemId: "s_ai",
      shipCount: 4,
    };
    const aiFleet: Fleet = {
      id: "f_a",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 3,
    };
    const state = makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [playerFleet, aiFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    // Combat resolves inside any phase where the two sides share a
    // system; running only the player's phase is enough to produce
    // the log entry we want to assert on.
    const next = runOnePhase(state);
    const combat = next.eventLog.find((e) => e.eventId === "combat");
    expect(combat?.text).toContain("s_ai"); // system name fallback = id here
    expect(combat?.text).toContain("you 4→");
    expect(combat?.text).toContain("Rival Empire 3→");
  });
});

describe("AI project selection (decision only)", () => {
  it("conqueror at war with an adjacent empire queues a frigate", () => {
    // Two-hex map: conqueror AI owns s_ai (with a temperate capital),
    // enemy owns s_enemy (adjacent, already claimed so no outpost).
    // They're at war. With no colonise targets in own system and no
    // outpost candidates, the one useful play is to build ships —
    // and the at-war multiplier + conqueror archetype should make
    // this the clear winner over doing nothing.
    const home = makeSystem({ id: "s_ai", bodyIds: ["b_cap"], ownerId: "e_ai" });
    const enemyHome = makeSystem({ id: "s_enemy", bodyIds: ["b_enemy"], ownerId: "e_enemy" });
    const cap = makeBody({ id: "b_cap", systemId: "s_ai", pops: 30 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 30 });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_cap",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home, enemyHome],
      bodies: [cap, enemyBody],
      hyperlanes: [["s_ai", "s_enemy"]],
      empire: player,
      aiEmpires: [ai, enemy],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
    });

    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const frigate = aiOrders.find(
      (p) => p.kind === "empire_project" && p.projectId === "build_frigate",
    );
    expect(frigate).toBeDefined();
  });

  it("queues an outpost on an adjacent unclaimed system's star", () => {
    // AI owns s_home. s_target is unclaimed and has only a star body.
    // The right first move is build_outpost on that star — it claims
    // the system and sets up future colonising.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_ai" });
    const target = makeSystem({ id: "s_target", bodyIds: ["b_star"], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const star = makeBody({
      id: "b_star",
      systemId: "s_target",
      kind: "star",
      habitability: "stellar",
      pops: 0,
      maxPops: 0,
    });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody, star],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      aiEmpires: [ai],
    });

    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const outpost = aiOrders.find(
      (p) => p.kind === "empire_project" && p.projectId === "build_outpost",
    );
    expect(outpost).toBeDefined();
    if (outpost && outpost.kind === "empire_project") {
      expect(outpost.targetBodyId).toBe("b_star");
    }
  });

  it("colonises the temperate planet once the system is already claimed", () => {
    // AI already owns s_target (via a prior outpost, simulated by
    // ownerId being set). The system contains a star + a temperate
    // planet. The AI should queue colonize on the planet.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_ai" });
    const target = makeSystem({
      id: "s_target",
      bodyIds: ["b_star", "b_temp"],
      ownerId: "e_ai",
    });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const star = makeBody({
      id: "b_star",
      systemId: "s_target",
      kind: "star",
      habitability: "stellar",
      pops: 0,
      maxPops: 0,
    });
    const tempBody = makeBody({
      id: "b_temp",
      systemId: "s_target",
      habitability: "temperate",
      pops: 0,
    });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_home",
      systemIds: ["s_home", "s_target"],
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody, star, tempBody],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      aiEmpires: [ai],
    });

    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const colonize = aiOrders.find((p) => p.kind === "colonize");
    expect(colonize).toBeDefined();
    if (colonize && colonize.kind === "colonize") {
      expect(colonize.targetBodyId).toBe("b_temp");
    }
  });

  it("prefers colonising the temperate body over the frozen one when both are in an owned system", () => {
    // AI owns one system that contains both a temperate body (space
    // large, food-producing) and a frozen body (small, no food, only
    // compute). With both colonisable, the temperate should win.
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_home", "b_temp", "b_frozen"],
      ownerId: "e_ai",
    });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const tempBody = makeBody({
      id: "b_temp",
      systemId: "s_home",
      habitability: "temperate",
      pops: 0,
    });
    const frozenBody = makeBody({
      id: "b_frozen",
      systemId: "s_home",
      habitability: "frozen",
      maxPops: 8,
      pops: 0,
    });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home],
      bodies: [homeBody, tempBody, frozenBody],
      empire: player,
      aiEmpires: [ai],
    });

    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const colonizeOrder = aiOrders.find((p) => p.kind === "colonize");
    expect(colonizeOrder).toBeDefined();
    if (colonizeOrder && colonizeOrder.kind === "colonize") {
      expect(colonizeOrder.targetBodyId).toBe("b_temp");
    }
  });

  it("isolationist grabs an adjacent temperate-bearing system", () => {
    // Same shape as the generic outpost test but the AI is
    // isolationist. The target is lush (temperate planet beside the
    // star), so pop potential dominates the score and an outpost
    // should still win despite the low SYSTEM_CLAIM_MULT.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_ai" });
    const target = makeSystem({
      id: "s_target",
      bodyIds: ["b_star", "b_temp"],
      ownerId: null,
    });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const star = makeBody({
      id: "b_star",
      systemId: "s_target",
      kind: "star",
      habitability: "stellar",
      pops: 0,
      maxPops: 0,
    });
    const tempBody = makeBody({
      id: "b_temp",
      systemId: "s_target",
      habitability: "temperate",
      pops: 0,
      maxPops: 100,
    });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
      expansionism: "isolationist",
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody, star, tempBody],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      aiEmpires: [ai],
    });
    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const outpost = aiOrders.find(
      (p) => p.kind === "empire_project" && p.projectId === "build_outpost",
    );
    expect(outpost).toBeDefined();
  });

  it("isolationist ignores a barren adjacent system", () => {
    // A star-only unclaimed system next door has no pop potential.
    // Under the archetype-weighted scoring, an isolationist values
    // the system-claim itself much less than a conqueror, so the
    // outpost's value ≈ TILE_VALUE alone — enough to be
    // outscored by the null-action baseline.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_ai" });
    const target = makeSystem({ id: "s_target", bodyIds: ["b_star"], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const star = makeBody({
      id: "b_star",
      systemId: "s_target",
      kind: "star",
      habitability: "stellar",
      pops: 0,
      maxPops: 0,
    });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
      expansionism: "isolationist",
      resources: { food: 500, energy: 500, political: 50 },
    });
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody, star],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      aiEmpires: [ai],
    });
    const decided = produce(state, (d) => {
      const emp = empireById(d, "e_ai");
      if (emp) aiPlanProject(d, emp);
    });
    const aiPost = empireById(decided, "e_ai");
    const aiOrders = aiPost ? allOrdersOf(decided, aiPost) : [];
    const outpost = aiOrders.find(
      (p) => p.kind === "empire_project" && p.projectId === "build_outpost",
    );
    expect(outpost).toBeUndefined();
  });

});

describe("AI fleet routing (decision only)", () => {
  // These tests exercise the AI's decision step directly: build a
  // state, call aiPlanMoves, inspect the chosen destination on the
  // fleet. No combat, occupation, or round-progression is evaluated —
  // that belongs in end-to-end tests, not behaviour-of-the-planner
  // tests. A failure here pins the bug to the AI's choice.
  function runAiMoves(state: GameState, empireId: string): GameState {
    return produce(state, (d) => {
      const emp = empireById(d, empireId);
      if (emp) aiPlanMoves(d, emp);
    });
  }

  // Minimal 2-hex setup: AI owns one, enemy owns the other, one
  // hyperlane between. The AI's fleet lives wherever the test puts it.
  function twoHexSetup(opts: {
    aiFleetAt: "s_ai" | "s_target";
    occupation?: { turns: number };
  }): GameState {
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const target = makeSystem({
      id: "s_target",
      bodyIds: ["b_target"],
      ownerId: "e_player",
      ...(opts.occupation
        ? { occupation: { empireId: "e_ai", turns: opts.occupation.turns } }
        : {}),
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    // Target body is unpopulated — with only the outpost for defence
    // (threshold = 1) a 2-ship invader cleanly exceeds it. Keeps the
    // test focused on AI movement, not fleet math.
    const targetBody = makeBody({ id: "b_target", systemId: "s_target", pops: 0 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_target",
      systemIds: ["s_target"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "pragmatist",
    });
    const aiFleet: Fleet = {
      id: "f_ai",
      empireId: "e_ai",
      systemId: opts.aiFleetAt,
      shipCount: 2,
    };
    return makeState({
      systems: [aiHome, target],
      bodies: [aiBody, targetBody],
      hyperlanes: [["s_ai", "s_target"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
  }

  it("routes a fleet toward an adjacent at-war enemy system", () => {
    const state = twoHexSetup({ aiFleetAt: "s_ai" });
    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_ai"]?.destinationSystemId).toBe("s_target");
  });

  it("keeps an AI fleet in place mid-siege (turns=1) — no destination set", () => {
    const state = twoHexSetup({
      aiFleetAt: "s_target",
      occupation: { turns: 1 },
    });
    const decided = runAiMoves(state, "e_ai");
    // Staying wins: AI leaves destination unset so processFleetOrders
    // doesn't try to walk the fleet anywhere.
    expect(decided.fleets["f_ai"]?.destinationSystemId).toBeUndefined();
  });

  it("keeps an AI fleet in place mid-siege (turns=2) — no destination set", () => {
    const state = twoHexSetup({
      aiFleetAt: "s_target",
      occupation: { turns: 2 },
    });
    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_ai"]?.destinationSystemId).toBeUndefined();
  });

  it("routes a defender fleet toward a sieged own-system to break the siege", () => {
    // A (AI) owns both hexes. B has a fleet on the left at turns=2.
    // A's only fleet is on the right. The AI should pick s_left as
    // the destination for that fleet — no heuristic required; the
    // value function sees the siege debit vanish when a defender
    // arrives.
    const right = makeSystem({ id: "s_right", bodyIds: ["b_r"], ownerId: "e_ai" });
    const left = makeSystem({
      id: "s_left",
      bodyIds: ["b_l"],
      ownerId: "e_ai",
      occupation: { empireId: "e_player", turns: 2 },
    });
    const rBody = makeBody({ id: "b_r", systemId: "s_right", pops: 30 });
    const lBody = makeBody({ id: "b_l", systemId: "s_left", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: null, systemIds: [] });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_r",
      systemIds: ["s_right", "s_left"],
      expansionism: "pragmatist",
    });
    const aiDefender: Fleet = {
      id: "f_def",
      empireId: "e_ai",
      systemId: "s_right",
      shipCount: 6,
    };
    // Weak invader — the AI defender should clearly win the combat
    // and choose to defend (system value > 1-ship loss).
    const playerInvader: Fleet = {
      id: "f_inv",
      empireId: "e_player",
      systemId: "s_left",
      shipCount: 1,
    };
    const state = makeState({
      systems: [right, left],
      bodies: [rBody, lBody],
      hyperlanes: [["s_right", "s_left"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiDefender, playerInvader],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_def"]?.destinationSystemId).toBe("s_left");
  });

  // User observed an at-war conqueror repeatedly throwing a lone
  // ship at a 5-ship player garrison. In this minimal setup the
  // current scoring handles it correctly — the projected combat
  // kills the attacker, removing its shipValue credit, and the
  // threat term reads the surviving defenders. Leaving this as a
  // pinning test so any future scoring regression that reopens
  // the bug trips it, and keeping the TODO note open for the
  // scenario that actually reproduced (probably a multi-fleet or
  // high-momentum state that's not captured here yet).
  it("conqueror refuses to throw a lone ship at a 5-ship defender", () => {
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const enemyHome = makeSystem({
      id: "s_enemy",
      bodyIds: ["b_enemy"],
      ownerId: "e_player",
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
    });
    const aiFleet: Fleet = {
      id: "f_lone",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 1,
    };
    const defenderFleet: Fleet = {
      id: "f_garrison",
      empireId: "e_player",
      systemId: "s_enemy",
      shipCount: 5,
    };
    const state = makeState({
      systems: [aiHome, enemyHome],
      bodies: [aiBody, enemyBody],
      hyperlanes: [["s_ai", "s_enemy"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiFleet, defenderFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    const decided = runAiMoves(state, "e_ai");
    // Once the fix lands, the 1-ship AI should NOT set the 5-ship
    // system as destination — guaranteed loss.
    expect(decided.fleets["f_lone"]?.destinationSystemId).not.toBe("s_enemy");
  });

  // The actual in-game bug. The AI's snapshot of a discovered-but-
  // out-of-sensor system says "0 defenders" (old observation, the
  // scout has since moved on). Reality has 5 defenders there now.
  // Without the no-blind-attack rule, `filterStateFor` synthesizes
  // snapshot fleets for stale systems, scoreCandidate resolves
  // combat against those, and the AI "sees" an easy walk-in while
  // reality has a garrison waiting. It then ships 1-ship fleets
  // into the meat grinder every turn.
  //
  // Fix: aiPlanMoves skips foreign-owned destinations not in
  // current sensor — scout first, invade second.
  it("conqueror refuses to blindly attack a stale system that might have a garrison", () => {
    // s_ai — s_mid — s_enemy. AI owns s_ai only (so s_enemy is
    // NOT adjacent to anything AI owns — out of sensor).
    // AI's snapshot claims s_enemy has no defenders, but reality
    // has a 5-ship garrison there right now.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const enemyHome = makeSystem({
      id: "s_enemy",
      bodyIds: ["b_enemy"],
      ownerId: "e_player",
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
      perception: {
        // s_enemy is discovered from an old scout that's moved on.
        discovered: ["s_ai", "s_mid", "s_enemy"],
        snapshots: {
          // Stale snapshot claims nobody is home (old intel).
          s_enemy: {
            turn: 1,
            ownerId: "e_player",
            fleets: [],
          },
        },
        seenFlavour: [],
        surveyed: ["s_ai"],
      },
    });
    const aiFleet: Fleet = {
      id: "f_lone",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 1,
    };
    // Reality: 5 defenders are at s_enemy right now. The AI's
    // snapshot doesn't know.
    const defenderFleet: Fleet = {
      id: "f_hidden_garrison",
      empireId: "e_player",
      systemId: "s_enemy",
      shipCount: 5,
    };
    const state = makeState({
      systems: [aiHome, mid, enemyHome],
      bodies: [aiBody, enemyBody],
      hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_enemy"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiFleet, defenderFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
      turn: 5,
    });
    const decided = runAiMoves(state, "e_ai");
    // The lone ship shouldn't go — it can't see what's waiting.
    // Expected behaviour once the fix lands. Fails today.
    expect(decided.fleets["f_lone"]?.destinationSystemId).not.toBe("s_enemy");
  });

  it("at-war conqueror with a large fleet attacks a smaller adjacent enemy fleet", () => {
    // The threat term in scoreState prices each enemy ship against
    // our own ship value, so wiping out a smaller foe registers as
    // net-positive score. A 6 vs 1 engagement should clearly resolve
    // to "attack" — the conqueror has both the ship premium and the
    // occupation credit on their side.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const enemyHome = makeSystem({
      id: "s_enemy",
      bodyIds: ["b_enemy"],
      ownerId: "e_player",
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
    });
    const aiFleet: Fleet = {
      id: "f_attack",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 6,
    };
    const enemyFleet: Fleet = {
      id: "f_def",
      empireId: "e_player",
      systemId: "s_enemy",
      shipCount: 1,
    };
    const state = makeState({
      systems: [aiHome, enemyHome],
      bodies: [aiBody, enemyBody],
      hyperlanes: [["s_ai", "s_enemy"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiFleet, enemyFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_attack"]?.destinationSystemId).toBe("s_enemy");
  });

  it("isolationist not-at-war ignores a smaller adjacent neutral fleet", () => {
    // Mirror of the conqueror-attack test but with an isolationist
    // AI and no war declared. Attacking would auto-declare war (the
    // destination is a foreign-owned system), and the AT_WAR_COST
    // for isolationists (2000 per enemy) plus the new-enemy-threat
    // term should make the move score negative. AI stays home.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const otherHome = makeSystem({
      id: "s_other",
      bodyIds: ["b_other"],
      ownerId: "e_player",
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const otherBody = makeBody({ id: "b_other", systemId: "s_other", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_other",
      systemIds: ["s_other"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "isolationist",
    });
    const aiFleet: Fleet = {
      id: "f_iso",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 6,
    };
    const otherFleet: Fleet = {
      id: "f_small",
      empireId: "e_player",
      systemId: "s_other",
      shipCount: 1,
    };
    const state = makeState({
      systems: [aiHome, otherHome],
      bodies: [aiBody, otherBody],
      hyperlanes: [["s_ai", "s_other"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [aiFleet, otherFleet],
      // No wars — walking into s_other would auto-declare.
    });
    const decided = runAiMoves(state, "e_ai");
    // AI stays put (or at least doesn't commit to entering the
    // foreign-owned system, which would auto-declare war).
    expect(decided.fleets["f_iso"]?.destinationSystemId).not.toBe("s_other");
  });

  it("isolationist with a big fleet won't invade a juicy peaceful neighbour", () => {
    // Regression for the "start a war to unlock ×1.2 fleet bonus"
    // exploit. At-peace isolationist AI sits with 15 ships next to
    // the player's plump 2-temperate system. Before the baseline-
    // war gating, scoring this move flipped the atWar flag on in
    // the projection and retroactively inflated every own ship by
    // 20% (+1875), which plus occupation credit crossed the
    // AT_WAR_COST threshold and the AI attacked. With the fix, the
    // ×1.2 only applies if we were at war BEFORE the move — so the
    // projection no longer pays a phantom dividend for declaring
    // war, and AT_WAR_COST dominates. Isolationist stays home.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const juicy = makeSystem({
      id: "s_juicy",
      bodyIds: ["b_a", "b_b"],
      ownerId: "e_player",
    });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    // Two populated temperate worlds — the kind of cluster that
    // previously tempted isolationist AIs to break peace.
    const juicyA = makeBody({
      id: "b_a",
      systemId: "s_juicy",
      habitability: "temperate",
      maxPops: 100,
      pops: 40,
    });
    const juicyB = makeBody({
      id: "b_b",
      systemId: "s_juicy",
      habitability: "temperate",
      maxPops: 100,
      pops: 40,
    });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_a",
      systemIds: ["s_juicy"],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "isolationist",
    });
    const bigFleet: Fleet = {
      id: "f_big",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 15,
    };
    const state = makeState({
      systems: [aiHome, juicy],
      bodies: [aiBody, juicyA, juicyB],
      hyperlanes: [["s_ai", "s_juicy"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [bigFleet],
      // Peace — moving into s_juicy would auto-declare war.
    });
    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_big"]?.destinationSystemId).not.toBe("s_juicy");
  });
});

describe("per-empire phases", () => {
  it("processes player first, then AIs, clearing currentPhaseEmpireId at end", () => {
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: [aiHome.id] });
    const state = makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
    });
    const afterBegin = reduce(state, { type: "beginRound" });
    expect(afterBegin.currentPhaseEmpireId).toBe("e_player");

    const afterPlayer = reduce(afterBegin, { type: "runPhase" });
    expect(afterPlayer.currentPhaseEmpireId).toBe("e_ai");

    const afterAi = reduce(afterPlayer, { type: "runPhase" });
    expect(afterAi.currentPhaseEmpireId).toBe(null);
  });

  it("prevents pass-through: enemy fleets heading to each other's systems fight before swapping", () => {
    // Player fleet at s_home routed to s_ai (enemy). AI already set its
    // own fleet heading toward s_home (via aiPlanMoves each turn). Since
    // player phase runs first, player's fleet steps to s_ai (AI's
    // system), combat resolves before AI phase moves its fleet — so
    // they can't pass-through silently any more.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: [aiHome.id],
      expansionism: "pragmatist", // won't initiate war on its own
    });
    const playerFleet: Fleet = {
      id: "f_player",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 1,
      destinationSystemId: "s_ai",
    };
    const aiFleet: Fleet = {
      id: "f_ai",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 1,
      destinationSystemId: "s_home",
    };
    const state = makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [playerFleet, aiFleet],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });

    // Hop takes TURNS_PER_HOP turns to accumulate, so neither fleet
    // moves until the third end-turn — but on that round player phase
    // runs first and steps into s_ai before AI can step out, so they
    // collide and both 1-ship fleets die.
    let next = state;
    for (let i = 0; i < 3; i++) next = reduce(next, { type: "endTurn" });
    expect(next.fleets["f_player"]).toBeUndefined();
    expect(next.fleets["f_ai"]).toBeUndefined();
  });
});

// Fleet upkeep was dropped, so fleets no longer gate on empire energy
// for movement or combat. The remaining energy lever is outpost
// upkeep, which runs per-component — cutting a region off can push
// that region's pool negative but doesn't itself brick fleet ops.

describe("processFleetOrders via endTurn", () => {
  it("steps a fleet one hop per turn along the stored path", () => {
    // Three systems in a line: home - mid - far. All unowned except home.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: [], ownerId: null });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const fleet: Fleet = {
      id: "f1",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 1,
      destinationSystemId: "s_far",
    };
    const state = makeState({
      systems: [home, mid, far],
      bodies: [cap],
      hyperlanes: [
        ["s_home", "s_mid"],
        ["s_mid", "s_far"],
      ],
      empire,
      fleets: [fleet],
    });

    // Each hop takes TURNS_PER_HOP=3 turns to accumulate. After 3
    // end-turns the fleet should have completed one hop (home → mid)
    // and reset progress; after 6 it should have completed both hops.
    let s = state;
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "endTurn" });
    expect(s.fleets["f1"]?.systemId).toBe("s_mid");
    expect(s.fleets["f1"]?.destinationSystemId).toBe("s_far");
    expect(s.fleets["f1"]?.hopProgress ?? 0).toBe(0);
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "endTurn" });
    expect(s.fleets["f1"]?.systemId).toBe("s_far");
    expect(s.fleets["f1"]?.destinationSystemId).toBeUndefined();
    expect(s.fleets["f1"]?.hopProgress).toBeUndefined();
  });

  it("idles a fleet whose jump would exceed the compute budget", () => {
    // 0-pop temperate body → compute.cap = 0. A 1-ship fleet routed
    // to a neighbour costs 1 compute → can't afford, stays put.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 0 });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const fleet: Fleet = {
      id: "f_big",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 1,
      destinationSystemId: "s_mid",
    };
    const state = makeState({
      systems: [home, mid],
      bodies: [cap],
      hyperlanes: [["s_home", "s_mid"]],
      empire,
      fleets: [fleet],
    });

    const next = runOnePhase(state);
    // Fleet stayed home; route intact.
    expect(next.fleets["f_big"]?.systemId).toBe("s_home");
    expect(next.fleets["f_big"]?.destinationSystemId).toBe("s_mid");
  });
});

describe("conquering", () => {
  function wartimeSetup(): GameState {
    // Player owns s_home, AI owns s_target. Both are at war.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const target = makeSystem({ id: "s_target", bodyIds: ["b_target"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_target", systemId: "s_target", pops: 20 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      // Overkill compute so the attacking fleet can walk in unimpeded
      // across consecutive end-turns in the test.
      resources: { food: 500, energy: 500, political: 20 },
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_target",
      systemIds: [target.id],
    });
    // Player has a fleet already sitting in the AI's system — no
    // defender present since the AI has no fleets.
    // Defense of s_target = 1 (outpost) + ceil(20/20) (pops) = 2.
    // The invader needs >2 ships to start the occupation counter.
    const invader: Fleet = {
      id: "f_invader",
      empireId: "e_player",
      systemId: "s_target",
      shipCount: 3,
    };
    return makeState({
      systems: [home, target],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [invader],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
  }

  it("ticks the occupation counter while a foreign fleet sits unopposed", () => {
    const state = wartimeSetup();
    const t1 = reduce(state, { type: "endTurn" });
    const t2 = reduce(t1, { type: "endTurn" });
    expect(t2.galaxy.systems["s_target"]?.occupation?.turns).toBe(2);
    // Still owned by AI until the threshold.
    expect(t2.galaxy.systems["s_target"]?.ownerId).toBe("e_ai");
  });

  it("flips ownership after OCCUPATION_TURNS_TO_FLIP turns", () => {
    let s = wartimeSetup();
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "endTurn" });
    const sys = s.galaxy.systems["s_target"];
    expect(sys?.ownerId).toBe("e_player");
    expect(sys?.occupation).toBeUndefined();
    // Player now owns both systems.
    expect(s.empires[0].systemIds).toContain("s_target");
    // AI is eliminated (lost its only system).
    expect(s.empires.find((e) => e.id === "e_ai")).toBeUndefined();
  });

  it("doesn't start an occupation on unowned space", () => {
    // Invader fleet sitting in an unclaimed system should NOT accumulate
    // occupation — unowned systems aren't conquerable.
    const unclaimed = makeSystem({ id: "s_free", bodyIds: [], ownerId: null });
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_cap", systemIds: [home.id] });
    const fleet: Fleet = {
      id: "f",
      empireId: "e_player",
      systemId: "s_free",
      shipCount: 1,
    };
    const state = makeState({
      systems: [unclaimed, home],
      bodies: [cap],
      hyperlanes: [["s_home", "s_free"]],
      empire: player,
      fleets: [fleet],
    });
    const next = reduce(state, { type: "endTurn" });
    expect(next.galaxy.systems["s_free"]?.occupation).toBeUndefined();
    expect(next.galaxy.systems["s_free"]?.ownerId).toBeNull();
  });

  it("sets gameOver when the player loses their last system", () => {
    // Flip: AI invades the player's home, player has no defenders.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: [aiHome.id],
    });
    // Defense of s_home = 1 outpost + ceil(30/20) pops = 3. Invader
    // needs >3 ships.
    const invader: Fleet = {
      id: "f_ai",
      empireId: "e_ai",
      systemId: "s_home",
      shipCount: 5,
    };
    let s = makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [invader],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "endTurn" });
    expect(s.galaxy.systems["s_home"]?.ownerId).toBe("e_ai");
    // Player is gone (eliminated, removed from empires[]), so look
    // them up by id rather than by index.
    expect(s.empires.find((e) => e.id === "e_player")).toBeUndefined();
    expect(s.gameOver).toBe(true);
  });
});

describe("setFleetDestination clears auto-discover", () => {
  it("setting a manual destination on an auto-discover fleet ends auto-discover", () => {
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const target = makeSystem({ id: "s_target", bodyIds: [], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 10 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_home", systemIds: ["s_home"] });
    const fleet: Fleet = {
      id: "f_scout",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 1,
      autoDiscover: true,
    };
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      fleets: [fleet],
    });
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId: "f_scout",
      toSystemId: "s_target",
    });
    expect(next.fleets["f_scout"]?.destinationSystemId).toBe("s_target");
    expect(next.fleets["f_scout"]?.autoDiscover).toBeFalsy();
  });

  it("cancelling a route on an auto-discover fleet also ends auto-discover", () => {
    // The "cancel route" path in the move bar dispatches
    // setFleetDestination with toSystemId=null. We treat that as
    // the player taking manual control too — otherwise the chooser
    // would re-route the fleet next turn and the cancel would
    // appear to do nothing.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const target = makeSystem({ id: "s_target", bodyIds: [], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 10 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_home", systemIds: ["s_home"] });
    const fleet: Fleet = {
      id: "f_scout",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 1,
      autoDiscover: true,
      destinationSystemId: "s_target",
    };
    const state = makeState({
      systems: [home, target],
      bodies: [homeBody],
      hyperlanes: [["s_home", "s_target"]],
      empire: player,
      fleets: [fleet],
    });
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId: "f_scout",
      toSystemId: null,
    });
    expect(next.fleets["f_scout"]?.destinationSystemId).toBeUndefined();
    expect(next.fleets["f_scout"]?.autoDiscover).toBeFalsy();
  });
});

describe("empire elimination ignores fleets", () => {
  it("eliminates an AI the round it loses its last system, even with surviving fleets", () => {
    // AI owns s_ai. Player invades and flips it (via the standard
    // 3-turn occupation flow). The AI has a stray fleet at s_else
    // that survives. Old "wandering ghost" rule kept the AI alive
    // via that fleet; new rule retires it the moment systemIds
    // empties out, and orphan fleets get cleaned up.
    const playerHome = makeSystem({ id: "s_player", bodyIds: ["b_player"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const elsewhere = makeSystem({ id: "s_else", bodyIds: [], ownerId: null });
    const playerBody = makeBody({ id: "b_player", systemId: "s_player", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_player", systemIds: ["s_player"] });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const invader: Fleet = {
      id: "f_invader",
      empireId: "e_player",
      systemId: "s_ai",
      shipCount: 10,
    };
    const ghost: Fleet = {
      id: "f_ghost",
      empireId: "e_ai",
      systemId: "s_else",
      shipCount: 4,
    };
    let s = makeState({
      systems: [playerHome, aiHome, elsewhere],
      bodies: [playerBody, aiBody],
      hyperlanes: [["s_player", "s_ai"], ["s_ai", "s_else"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [invader, ghost],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
    // Three rounds of unopposed occupation flip s_ai to e_player.
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "endTurn" });
    expect(s.galaxy.systems["s_ai"]?.ownerId).toBe("e_player");
    // AI is gone — even though f_ghost was still floating around.
    expect(s.empires.find((e) => e.id === "e_ai")).toBeUndefined();
    // And the orphan fleet has been cleaned up.
    expect(s.fleets["f_ghost"]).toBeUndefined();
  });
});

describe("splitFleet action", () => {
  it("peels off a co-located fleet with its own destination", () => {
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const dest = makeSystem({ id: "s_dest", bodyIds: [], ownerId: null });
    const empire = makeEmpire({ id: "e_player", systemIds: [home.id] });
    const fleet: Fleet = { id: "f1", empireId: "e_player", systemId: "s_home", shipCount: 5 };
    const state = makeState({
      systems: [home, dest],
      bodies: [],
      hyperlanes: [["s_home", "s_dest"]],
      empire,
      fleets: [fleet],
    });

    const next = reduce(state, {
      type: "splitFleet",
      byEmpireId: "e_player",
      fleetId: "f1",
      count: 2,
      toSystemId: "s_dest",
    });

    // Original fleet stays at home with 3 ships.
    expect(next.fleets["f1"]?.systemId).toBe("s_home");
    expect(next.fleets["f1"]?.shipCount).toBe(3);
    expect(next.fleets["f1"]?.destinationSystemId).toBeUndefined();
    // New fleet is at home (not yet moved) with 2 ships and destination.
    const split = Object.values(next.fleets).find((f) => f.id !== "f1");
    expect(split?.systemId).toBe("s_home");
    expect(split?.shipCount).toBe(2);
    expect(split?.destinationSystemId).toBe("s_dest");
  });
});

describe("declareWar / makePeace round-trip", () => {
  it("adds and removes a war pair", () => {
    const player = makeEmpire({ id: "e_player" });
    const ai = makeEmpire({ id: "e_ai" });
    const state = makeState({
      systems: [],
      bodies: [],
      empire: player,
      aiEmpires: [ai],
    });

    const atWarState = reduce(state, {
      type: "declareWar",
      byEmpireId: "e_player",
      targetEmpireId: "e_ai",
    });
    expect(atWar(atWarState, "e_player", "e_ai")).toBe(true);

    const peaceState = reduce(atWarState, {
      type: "makePeace",
      byEmpireId: "e_player",
      targetEmpireId: "e_ai",
    });
    expect(atWar(peaceState, "e_player", "e_ai")).toBe(false);
  });

  it("fleet entering a not-at-war empire's system auto-declares war", () => {
    // Player fleet at s_home sets a destination at s_enemy (owned by
    // e_ai, no war yet). After endTurn the fleet steps into s_enemy
    // and the reducer adds (e_ai, e_player) to state.wars.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const enemy = makeSystem({ id: "s_enemy", bodyIds: ["b_enemy"], ownerId: "e_ai" });
    const hBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const eBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_home", systemIds: ["s_home"] });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_enemy", systemIds: ["s_enemy"] });
    const fleet: Fleet = {
      id: "f1",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 3,
      destinationSystemId: "s_enemy",
    };
    const state = makeState({
      systems: [home, enemy],
      bodies: [hBody, eBody],
      hyperlanes: [["s_home", "s_enemy"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [fleet],
    });
    expect(atWar(state, "e_player", "e_ai")).toBe(false);
    // 3 end-turns to complete the one-hop journey to s_enemy.
    let next = state;
    for (let i = 0; i < 3; i++) next = reduce(next, { type: "endTurn" });
    // War was declared as the fleet crossed the border.
    expect(atWar(next, "e_player", "e_ai")).toBe(true);
  });
});

describe("fog of war: first contact via sensor", () => {
  it("meets a foreign empire when a scout fleet enters their sensor range", () => {
    // Old behaviour fired first contact only on hyperlane-adjacent
    // owned territories; a scout fleet crossing into an empty border
    // system would never register. New behaviour: A's sensor touches
    // any B-owned system (or vice versa) → mutual met.
    const own = makeSystem({ id: "s_own", bodyIds: ["b_own"], ownerId: "e_player" });
    const scout = makeSystem({ id: "s_scout", bodyIds: [], ownerId: null });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const ownBody = makeBody({ id: "b_own", systemId: "s_own", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_own", systemIds: ["s_own"] });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    // Player scout sits at s_scout, adjacent to the AI's s_ai via hyperlane.
    const playerScout: Fleet = {
      id: "f_player",
      empireId: "e_player",
      systemId: "s_scout",
      shipCount: 1,
    };
    const state = makeState({
      systems: [own, scout, aiHome],
      bodies: [ownBody, aiBody],
      hyperlanes: [["s_scout", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [playerScout],
    });
    // Not yet met — no territory touches, no scout triggered detection.
    expect(state.empires[0].flags.includes("met:e_ai")).toBe(false);
    expect(state.empires[1].flags.includes("met:e_player")).toBe(false);

    // One round of endTurn runs detectFirstContacts at isLast.
    const next = reduce(state, { type: "endTurn" });
    expect(next.empires[0].flags.includes("met:e_ai")).toBe(true);
    // The AI gets the symmetric "met:e_player" flag.
    expect(next.empires[1].flags.includes("met:e_player")).toBe(true);
  });
});

describe("fog of war: sensorSet", () => {
  it("includes owned systems and their 1-jump neighbours but not 2-jump", () => {
    // home <-> mid <-> far. Empire owns home only.
    // sensorSet should be {home, mid}, NOT far.
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: [], ownerId: null });
    const player = makeEmpire({ id: "e_player", systemIds: ["s_home"] });
    const state = makeState({
      systems: [home, mid, far],
      bodies: [],
      hyperlanes: [["s_home", "s_mid"], ["s_mid", "s_far"]],
      empire: player,
    });
    const visible = sensorSet(state, "e_player");
    expect(visible.has("s_home")).toBe(true);
    expect(visible.has("s_mid")).toBe(true);
    expect(visible.has("s_far")).toBe(false);
  });

  it("a fleet sitting alone in a system reveals it and its neighbours", () => {
    // Empire owns nothing. A scout fleet sits at s_scout, adjacent to s_a.
    // Without owned territory the only sensor source is the fleet itself.
    const scout = makeSystem({ id: "s_scout", bodyIds: [], ownerId: null });
    const neighbour = makeSystem({ id: "s_a", bodyIds: [], ownerId: null });
    const elsewhere = makeSystem({ id: "s_b", bodyIds: [], ownerId: null });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const fleet: Fleet = {
      id: "f1",
      empireId: "e_player",
      systemId: "s_scout",
      shipCount: 1,
    };
    const state = makeState({
      systems: [scout, neighbour, elsewhere],
      bodies: [],
      hyperlanes: [["s_scout", "s_a"]],
      empire: player,
      fleets: [fleet],
    });
    const visible = sensorSet(state, "e_player");
    expect(visible.has("s_scout")).toBe(true);
    expect(visible.has("s_a")).toBe(true);
    expect(visible.has("s_b")).toBe(false);
  });
});

describe("fog of war: updateVisibility", () => {
  it("populates discovered and snapshots for systems in sensor range", () => {
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const player = makeEmpire({ id: "e_player", systemIds: ["s_home"] });
    const state = makeState({
      systems: [home, mid],
      bodies: [],
      hyperlanes: [["s_home", "s_mid"]],
      empire: player,
      turn: 7,
    });
    const next = produce(state, (draft) => updateVisibility(draft));
    expect([...next.empires[0].perception.discovered].sort()).toEqual(["s_home", "s_mid"]);
    expect(next.empires[0].perception.snapshots["s_home"]).toBeDefined();
    expect(next.empires[0].perception.snapshots["s_mid"]).toBeDefined();
    expect(next.empires[0].perception.snapshots["s_home"].turn).toBe(7);
  });

  it("snapshots an in-sensor enemy fleet by empire and ship count", () => {
    // Player owns home. AI owns neighbour (1 jump away) and has 5 ships
    // there. After updateVisibility the player's snapshot of neighbour
    // should reflect the AI's fleet.
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const neighbour = makeSystem({ id: "s_n", bodyIds: [], ownerId: "e_ai" });
    const player = makeEmpire({ id: "e_player", systemIds: ["s_home"] });
    const ai = makeEmpire({ id: "e_ai", systemIds: ["s_n"] });
    const enemyFleet: Fleet = {
      id: "f_enemy",
      empireId: "e_ai",
      systemId: "s_n",
      shipCount: 5,
    };
    const state = makeState({
      systems: [home, neighbour],
      bodies: [],
      hyperlanes: [["s_home", "s_n"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [enemyFleet],
    });
    const next = produce(state, (draft) => updateVisibility(draft));
    const snap = next.empires[0].perception.snapshots["s_n"];
    expect(snap).toBeDefined();
    expect(snap.ownerId).toBe("e_ai");
    expect(snap.fleets).toEqual([{ empireId: "e_ai", shipCount: 5 }]);
  });

  it("does not snapshot out-of-sensor enemy buildups (hidden isolationist)", () => {
    // home <-> mid <-> far. Player owns home; AI hides 5 ships at far.
    // Player's sensor doesn't reach far, so the snapshot is absent.
    const home = makeSystem({ id: "s_home", bodyIds: [], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: [], ownerId: "e_ai" });
    const player = makeEmpire({ id: "e_player", systemIds: ["s_home"] });
    const ai = makeEmpire({ id: "e_ai", systemIds: ["s_far"] });
    const hiddenFleet: Fleet = {
      id: "f_hidden",
      empireId: "e_ai",
      systemId: "s_far",
      shipCount: 5,
    };
    const state = makeState({
      systems: [home, mid, far],
      bodies: [],
      hyperlanes: [["s_home", "s_mid"], ["s_mid", "s_far"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [hiddenFleet],
    });
    const next = produce(state, (draft) => updateVisibility(draft));
    expect(next.empires[0].perception.discovered).not.toContain("s_far");
    expect(next.empires[0].perception.snapshots["s_far"]).toBeUndefined();
  });

  it("keeps a stale snapshot once a system leaves sensor range", () => {
    // Turn 1: scout fleet at s_scout, adjacent to s_target. Player sees
    // s_target with 0 fleets + ownerId null.
    // Turn 2: fleet leaves; AI claims s_target and parks 9 ships there.
    // Player's snapshot of s_target should still reflect turn-1 reality.
    const scout = makeSystem({ id: "s_scout", bodyIds: [], ownerId: null });
    const target = makeSystem({ id: "s_target", bodyIds: [], ownerId: null });
    const elsewhere = makeSystem({ id: "s_else", bodyIds: [], ownerId: null });
    const player = makeEmpire({ id: "e_player", systemIds: [] });
    const ai = makeEmpire({ id: "e_ai", systemIds: [] });
    const fleet: Fleet = {
      id: "f1",
      empireId: "e_player",
      systemId: "s_scout",
      shipCount: 1,
    };
    const turn1State = makeState({
      systems: [scout, target, elsewhere],
      bodies: [],
      hyperlanes: [
        ["s_scout", "s_target"],
        ["s_scout", "s_else"],
      ],
      empire: player,
      aiEmpires: [ai],
      fleets: [fleet],
      turn: 1,
    });
    const seen = produce(turn1State, (draft) => updateVisibility(draft));
    expect(seen.empires[0].perception.snapshots["s_target"]?.turn).toBe(1);
    expect(seen.empires[0].perception.snapshots["s_target"]?.ownerId).toBeNull();

    // Turn 2: scout moves away to s_else; AI takes s_target and parks
    // a fleet there; updateVisibility runs again.
    const turn2State = produce(seen, (draft) => {
      draft.turn = 2;
      draft.fleets["f1"].systemId = "s_else";
      draft.galaxy.systems["s_target"].ownerId = "e_ai";
      draft.empires[1].systemIds = ["s_target"];
      draft.fleets["f_ai"] = {
        id: "f_ai",
        empireId: "e_ai",
        systemId: "s_target",
        shipCount: 9,
      };
      updateVisibility(draft);
    });
    // The stale snapshot from turn 1 must NOT have been overwritten —
    // s_target is no longer in the player's sensor.
    const stale = turn2State.empires[0].perception.snapshots["s_target"];
    expect(stale.turn).toBe(1);
    expect(stale.ownerId).toBeNull();
    expect(stale.fleets).toEqual([]);
  });
});

describe("autoplay attention: hostile fleet in sensor", () => {
  // Shared setup: AI parks a fleet one jump from the player's home.
  // With (wars=[]) it's a peaceful observer; with wars set, it's a
  // hostile scout. sensor reaches the border via hyperlane, so the
  // fleet is visible in both cases.
  function setupObserver(opts: { atWar: boolean }): GameState {
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const border = makeSystem({ id: "s_border", bodyIds: [], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
    });
    const ai = makeEmpire({ id: "e_ai", systemIds: [] });
    const enemyFleet: Fleet = {
      id: "f_observer",
      empireId: "e_ai",
      systemId: "s_border",
      shipCount: 3,
    };
    return makeState({
      systems: [home, border],
      bodies: [homeBody],
      hyperlanes: [["s_home", "s_border"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [enemyFleet],
      wars: opts.atWar ? [["e_ai", "e_player"].sort() as [string, string]] : [],
    });
  }

  it("peaceful neighbour in sensor does NOT pause autoplay", () => {
    // The foreign fleet is visible and definitely in the sensor ring,
    // but with no war declared we shouldn't yield autoplay — they
    // can't hurt us until they step across a border, which will auto-
    // declare war and trigger the pause on that turn.
    const state = setupObserver({ atWar: false });
    expect(atWar(state, "e_player", "e_ai")).toBe(false);
    expect(foreignFleetsInSensor(state, state.empires[0]).map((f) => f.id)).toContain("f_observer");
    expect(hostileFleetsInSensor(state, state.empires[0]).length).toBe(0);
  });

  it("at-war fleet in sensor pauses autoplay", () => {
    const state = setupObserver({ atWar: true });
    expect(hostileFleetsInSensor(state, state.empires[0]).map((f) => f.id)).toContain("f_observer");
    expect(needsPlayerAttention(state)).toBe(true);
  });
});

describe("fog of war: AI info-leak invariants", () => {
  function runAiMoves(state: GameState, empireId: string): GameState {
    return produce(state, (d) => {
      const emp = empireById(d, empireId);
      if (emp) aiPlanMoves(d, emp);
    });
  }

  it("attacks a visible weak enemy even when a hidden reinforcement fleet is 2 jumps away", () => {
    // Conqueror at war with e_enemy. Enemy keeps 1 ship at the
    // adjacent border system (s_target) and a huge 30-ship reserve
    // at s_hidden (2 jumps away, outside AI's discovered). If the
    // value function peeked at the reserve through the projection's
    // expanded sensor, it would see a 31-ship threat and decline to
    // attack. Under fog-correct scoring the AI only sees the 1
    // border defender and should attack s_target.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const target = makeSystem({ id: "s_target", bodyIds: ["b_target"], ownerId: "e_enemy" });
    const hidden = makeSystem({ id: "s_hidden", bodyIds: ["b_hidden"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const targetBody = makeBody({ id: "b_target", systemId: "s_target", pops: 20 });
    const hiddenBody = makeBody({ id: "b_hidden", systemId: "s_hidden", pops: 20 });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
    });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_target",
      systemIds: ["s_target", "s_hidden"],
    });
    const attackerFleet: Fleet = {
      id: "f_attacker",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 6,
    };
    const visibleDefender: Fleet = {
      id: "f_defender",
      empireId: "e_enemy",
      systemId: "s_target",
      shipCount: 1,
    };
    const hiddenReserve: Fleet = {
      id: "f_reserve",
      empireId: "e_enemy",
      systemId: "s_hidden",
      shipCount: 30,
    };
    const state = makeState({
      systems: [aiHome, target, hidden],
      bodies: [aiBody, targetBody, hiddenBody],
      // s_ai — s_target — s_hidden. s_hidden sits 2 jumps away and
      // is NOT in the AI's 1-jump sensor ring.
      hyperlanes: [["s_ai", "s_target"], ["s_target", "s_hidden"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai, enemy],
      fleets: [attackerFleet, visibleDefender, hiddenReserve],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
    });
    // Sanity: the reserve's system is NOT in the AI's discovered.
    expect(state.empires[1].perception.discovered).not.toContain("s_hidden");

    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_attacker"]?.destinationSystemId).toBe("s_target");
  });

  it("makes the same movement decision whether or not a hidden enemy stack exists", () => {
    // Twin states, one with a 30-ship hidden reserve outside the
    // AI's discovered, one without. A fog-correct AI must pick the
    // same destination in both — if it doesn't, the hidden stack
    // was leaking through the projection somehow.
    const baseSystems = (): StarSystem[] => [
      makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" }),
      makeSystem({ id: "s_target", bodyIds: ["b_target"], ownerId: "e_enemy" }),
      makeSystem({ id: "s_hidden", bodyIds: ["b_hidden"], ownerId: "e_enemy" }),
    ];
    const baseBodies = (): Body[] => [
      makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 }),
      makeBody({ id: "b_target", systemId: "s_target", pops: 20 }),
      makeBody({ id: "b_hidden", systemId: "s_hidden", pops: 20 }),
    ];
    const baseEmpires = () => ({
      ai: makeEmpire({
        id: "e_ai",
        capitalBodyId: "b_ai",
        systemIds: ["s_ai"],
        expansionism: "conqueror",
      }),
      enemy: makeEmpire({
        id: "e_enemy",
        capitalBodyId: "b_target",
        systemIds: ["s_target", "s_hidden"],
      }),
    });
    const visibleDefender: Fleet = {
      id: "f_def",
      empireId: "e_enemy",
      systemId: "s_target",
      shipCount: 1,
    };
    const attacker = (): Fleet => ({
      id: "f_attack",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 6,
    });

    const withReserve = makeState({
      systems: baseSystems(),
      bodies: baseBodies(),
      hyperlanes: [["s_ai", "s_target"], ["s_target", "s_hidden"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      ...(() => {
        const { ai, enemy } = baseEmpires();
        return { aiEmpires: [ai, enemy] };
      })(),
      fleets: [
        attacker(),
        visibleDefender,
        { id: "f_res", empireId: "e_enemy", systemId: "s_hidden", shipCount: 30 },
      ],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
    });
    const withoutReserve = makeState({
      systems: baseSystems(),
      bodies: baseBodies(),
      hyperlanes: [["s_ai", "s_target"], ["s_target", "s_hidden"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      ...(() => {
        const { ai, enemy } = baseEmpires();
        return { aiEmpires: [ai, enemy] };
      })(),
      fleets: [attacker(), visibleDefender],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
    });
    const withReserveDest = runAiMoves(withReserve, "e_ai").fleets["f_attack"]?.destinationSystemId;
    const withoutReserveDest = runAiMoves(withoutReserve, "e_ai").fleets["f_attack"]?.destinationSystemId;
    expect(withReserveDest).toBe(withoutReserveDest);
  });

  it("uses stale snapshot fleet counts for a threat estimate after the enemy leaves sensor", () => {
    // At turn 1 the AI sees e_enemy with 5 ships at s_border and
    // snapshots it. Turn 2: the AI pulls its scout back home so
    // s_border drops out of sensor; meanwhile e_enemy's actual
    // fleet balloons to 30 ships there. The AI's threat estimate
    // must still read off the stale snapshot (5), not peek at the
    // live 30.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const scout = makeSystem({ id: "s_scout", bodyIds: [], ownerId: null });
    const border = makeSystem({ id: "s_border", bodyIds: ["b_border"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const borderBody = makeBody({ id: "b_border", systemId: "s_border", pops: 20 });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_border",
      systemIds: ["s_border"],
    });
    const scoutFleet: Fleet = {
      id: "f_scout",
      empireId: "e_ai",
      systemId: "s_scout",
      shipCount: 1,
    };
    const enemyFleet: Fleet = {
      id: "f_enemy",
      empireId: "e_enemy",
      systemId: "s_border",
      shipCount: 5,
    };
    // s_ai — s_scout — s_border.
    const turn1 = makeState({
      systems: [aiHome, scout, border],
      bodies: [aiBody, borderBody],
      hyperlanes: [["s_ai", "s_scout"], ["s_scout", "s_border"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai, enemy],
      fleets: [scoutFleet, enemyFleet],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
      turn: 1,
    });
    // Confirm the scout's adjacency covers s_border and the
    // snapshot records the 5-ship fleet. The scout belongs to e_ai
    // (index 1 — player at 0, AI at 1, enemy at 2).
    const snap1 = turn1.empires[1].perception.snapshots["s_border"];
    expect(snap1).toBeDefined();
    expect(snap1.fleets).toEqual([{ empireId: "e_enemy", shipCount: 5 }]);

    // Turn 2: scout pulls back to home, enemy quadruples to 30
    // ships. Run updateVisibility to refresh sensor.
    const turn2 = produce(turn1, (draft) => {
      draft.turn = 2;
      draft.fleets["f_scout"].systemId = "s_ai";
      draft.fleets["f_enemy"].shipCount = 30;
      updateVisibility(draft);
    });
    expect(turn2.empires[1].perception.snapshots["s_border"].fleets).toEqual([
      { empireId: "e_enemy", shipCount: 5 },
    ]);

    // Threat estimate: scoreState should reflect 5 (stale), not 30 (live).
    // Compute the scores for two states differing only in the live count
    // at s_border, and verify they match — AI can't tell the difference.
    const livened30 = turn2;
    const livened3 = produce(turn2, (draft) => {
      draft.fleets["f_enemy"].shipCount = 3;
    });
    expect(score(livened30, "e_ai")).toBe(score(livened3, "e_ai"));
  });

  it("does not discover fleets reachable only through a lookahead sensor expansion", () => {
    // AI at s_ai considers moving to s_mid (discovered, 1 jump
    // away). In the projection, AI's sensor would expand to cover
    // s_mid's neighbour s_enemy. A leaky value function would pick
    // up a huge enemy fleet at s_enemy and refuse the move. A
    // fog-correct one reads perception frozen at plan-time and
    // doesn't see it — so the threat contribution from s_enemy is
    // identical between "huge hidden stack" and "no hidden stack."
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const enemyHome = makeSystem({ id: "s_enemy", bodyIds: ["b_enemy"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 20 });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const makeStateFor = (hiddenShips: number): GameState =>
      makeState({
        systems: [aiHome, mid, enemyHome],
        bodies: [aiBody, enemyBody],
        // s_ai — s_mid — s_enemy. s_enemy is 2 jumps out; outside
        // the AI's sensor ring at planning time.
        hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_enemy"]],
        empire: makeEmpire({ id: "e_player", systemIds: [] }),
        aiEmpires: [ai, enemy],
        fleets: [
          { id: "f_our", empireId: "e_ai", systemId: "s_ai", shipCount: 3 },
          { id: "f_hidden", empireId: "e_enemy", systemId: "s_enemy", shipCount: hiddenShips },
        ],
        wars: [["e_ai", "e_enemy"].sort() as [string, string]],
      });
    const bigHidden = makeStateFor(30);
    const noHidden = makeStateFor(0);
    expect(bigHidden.empires[0].perception.discovered).not.toContain("s_enemy");
    expect(noHidden.empires[0].perception.discovered).not.toContain("s_enemy");

    const bigDecision = runAiMoves(bigHidden, "e_ai").fleets["f_our"]?.destinationSystemId;
    const smallDecision = runAiMoves(noHidden, "e_ai").fleets["f_our"]?.destinationSystemId;
    expect(bigDecision).toBe(smallDecision);
  });

  it("sets a destination that lies on the fog boundary even though neighbours beyond are unknown", () => {
    // s_ai — s_border — s_beyond. AI owns s_ai, enemy owns s_border
    // (1 jump from home, discovered). s_beyond is 2 jumps away and
    // NOT discovered. The AI-at-war has a big fleet and a weak
    // defender is at s_border. The AI should choose s_border as
    // destination despite the fact that s_border sits on the edge
    // of known space with undiscovered hyperlane beyond.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const borderSys = makeSystem({ id: "s_border", bodyIds: ["b_border"], ownerId: "e_enemy" });
    const beyondSys = makeSystem({ id: "s_beyond", bodyIds: ["b_beyond"], ownerId: null });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const borderBody = makeBody({ id: "b_border", systemId: "s_border", pops: 20 });
    const beyondBody = makeBody({ id: "b_beyond", systemId: "s_beyond", pops: 0 });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
    });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_border",
      systemIds: ["s_border"],
    });
    const state = makeState({
      systems: [aiHome, borderSys, beyondSys],
      bodies: [aiBody, borderBody, beyondBody],
      hyperlanes: [["s_ai", "s_border"], ["s_border", "s_beyond"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai, enemy],
      fleets: [
        { id: "f_attacker", empireId: "e_ai", systemId: "s_ai", shipCount: 6 },
        { id: "f_weak", empireId: "e_enemy", systemId: "s_border", shipCount: 1 },
      ],
      wars: [["e_ai", "e_enemy"].sort() as [string, string]],
    });
    // Sanity: s_border is discovered (adjacent to own), s_beyond is not.
    expect(state.empires[1].perception.discovered).toContain("s_border");
    expect(state.empires[1].perception.discovered).not.toContain("s_beyond");

    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_attacker"]?.destinationSystemId).toBe("s_border");
  });
});

describe("fog of war: filterStateFor", () => {
  it("keeps acting empire fields intact but drops undiscovered systems", () => {
    // s_ai owned by AI; s_dark exists but AI has never discovered it.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const dark = makeSystem({ id: "s_dark", bodyIds: ["b_dark"], ownerId: null });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const darkBody = makeBody({ id: "b_dark", systemId: "s_dark", pops: 0 });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    // No hyperlane to s_dark → AI's sensor + discovered = {s_ai} only.
    const state = makeState({
      systems: [aiHome, dark],
      bodies: [aiBody, darkBody],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai],
    });
    const filtered = filterStateFor(state, "e_ai");
    expect(filtered.galaxy.systems).toHaveProperty("s_ai");
    expect(filtered.galaxy.systems).not.toHaveProperty("s_dark");
    expect(filtered.galaxy.bodies).toHaveProperty("b_ai");
    expect(filtered.galaxy.bodies).not.toHaveProperty("b_dark");
    // Acting empire passes through unchanged.
    const actingInFiltered = filtered.empires.find((e) => e.id === "e_ai");
    expect(actingInFiltered).toBe(state.empires[1]);
  });

  it("redacts private fields on empires other than the acting one", () => {
    // Player starts with political = 99 and a story modifier. From
    // the AI's point of view these are private — filterStateFor
    // should zero them out.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 10 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 10 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_home",
      systemIds: ["s_home"],
      resources: { political: 99, food: 0, energy: 0 },
      storyModifiers: { "origin:test": [{ kind: "flat", resource: "energy", value: 3 }] },
      completedProjects: ["foo"],
    });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const state = makeState({
      systems: [home, aiHome],
      bodies: [homeBody, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
    });
    const filtered = filterStateFor(state, "e_ai");
    // From the AI's view the player looks like a stub: known identity
    // fields, zeroed private state.
    const playerInFiltered = filtered.empires.find((e) => e.id === "e_player")!;
    expect(playerInFiltered.id).toBe("e_player");
    expect(playerInFiltered.name).toBe(state.empires[0].name);
    expect(playerInFiltered.political).toBe(0);
    expect(playerInFiltered.storyModifiers).toEqual({});
    expect(playerInFiltered.completedProjects).toEqual([]);
    expect(playerInFiltered.perception.discovered).toEqual([]);
  });

  it("replaces live fleets at stale-discovered systems with synthetic ones from the snapshot", () => {
    // Turn 1: AI has scout at s_mid, adjacent to s_far (enemy owned, 3 ships).
    // Turn 2: scout pulls home; enemy rebuilds to 30 ships. AI's
    // filtered view should still show the 3-ship stale snapshot at
    // s_far, not the 30-ship live fleet.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: ["b_far"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 10 });
    const farBody = makeBody({ id: "b_far", systemId: "s_far", pops: 10 });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_far",
      systemIds: ["s_far"],
    });
    const turn1 = makeState({
      systems: [aiHome, mid, far],
      bodies: [aiBody, farBody],
      hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_far"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai, enemy],
      fleets: [
        { id: "f_scout", empireId: "e_ai", systemId: "s_mid", shipCount: 1 },
        { id: "f_enemy", empireId: "e_enemy", systemId: "s_far", shipCount: 3 },
      ],
      turn: 1,
    });
    // Turn 2: scout retreats, enemy balloons.
    const turn2 = produce(turn1, (draft) => {
      draft.turn = 2;
      draft.fleets["f_scout"].systemId = "s_ai";
      draft.fleets["f_enemy"].shipCount = 30;
      updateVisibility(draft);
    });
    const filtered = filterStateFor(turn2, "e_ai");
    // s_far is still discovered but out of sensor.
    expect(filtered.galaxy.systems).toHaveProperty("s_far");
    // No live f_enemy fleet — AI can't see the 30-ship buildup.
    expect(filtered.fleets["f_enemy"]).toBeUndefined();
    // One synthetic fleet at s_far for e_enemy, with the stale count.
    const staleAtFar = Object.values(filtered.fleets).filter(
      (f) => f.systemId === "s_far" && f.empireId === "e_enemy",
    );
    expect(staleAtFar.length).toBe(1);
    expect(staleAtFar[0].shipCount).toBe(3);
  });
});

describe("fog of war: scouting reward", () => {
  function runAiMoves(state: GameState, empireId: string): GameState {
    return produce(state, (d) => {
      const emp = empireById(d, empireId);
      if (emp) aiPlanMoves(d, emp);
    });
  }

  it("pragmatist AI moves an idle fleet toward an unsurveyed discovered system", () => {
    // Quiet galaxy: AI owns s_ai with 1 ship, s_neighbor is adjacent
    // and discovered (neutral, empty). No enemies, no wars, no
    // colonisation targets. The scout-reach term is the only thing
    // differentiating "stay home (already surveyed)" from "move
    // to s_neighbor (adds to reach set)". Should tip the AI outward.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const neighbour = makeSystem({ id: "s_neighbor", bodyIds: [], ownerId: null });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 10 });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "pragmatist",
    });
    const state = makeState({
      systems: [aiHome, neighbour],
      bodies: [aiBody],
      hyperlanes: [["s_ai", "s_neighbor"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai],
      fleets: [
        { id: "f_scout", empireId: "e_ai", systemId: "s_ai", shipCount: 1 },
      ],
    });
    // s_neighbor is discovered (1-jump from own) but NOT yet surveyed
    // (fleet's never been there; empire doesn't own it).
    expect(state.empires[1].perception.discovered).toContain("s_neighbor");
    expect(state.empires[1].perception.surveyed).not.toContain("s_neighbor");

    const decided = runAiMoves(state, "e_ai");
    expect(decided.fleets["f_scout"]?.destinationSystemId).toBe("s_neighbor");
  });

  it("scouting reward does not change based on hidden-enemy presence (no leak)", () => {
    // s_ai — s_neighbor — s_hidden. AI owns s_ai. s_neighbor discovered,
    // s_hidden is not. Planning a move to s_neighbor would expand
    // sensor to s_hidden in the projection, but the scouting reward
    // only reads our own planned position. The decision must be the
    // same whether or not s_hidden contains a big enemy stack.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const neighbour = makeSystem({ id: "s_neighbor", bodyIds: [], ownerId: null });
    const hiddenSys = makeSystem({ id: "s_hidden", bodyIds: ["b_hidden"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 10 });
    const hiddenBody = makeBody({ id: "b_hidden", systemId: "s_hidden", pops: 10 });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "pragmatist",
    });
    const enemy = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_hidden",
      systemIds: ["s_hidden"],
    });
    const mk = (hiddenShips: number): GameState =>
      makeState({
        systems: [aiHome, neighbour, hiddenSys],
        bodies: [aiBody, hiddenBody],
        hyperlanes: [["s_ai", "s_neighbor"], ["s_neighbor", "s_hidden"]],
        empire: makeEmpire({ id: "e_player", systemIds: [] }),
        aiEmpires: [ai, enemy],
        fleets: [
          { id: "f_scout", empireId: "e_ai", systemId: "s_ai", shipCount: 1 },
          { id: "f_reserve", empireId: "e_enemy", systemId: "s_hidden", shipCount: hiddenShips },
        ],
        wars: [["e_ai", "e_enemy"].sort() as [string, string]],
      });
    const withBig = mk(30);
    const withNone = mk(0);
    expect(withBig.empires[0].perception.discovered).not.toContain("s_hidden");
    expect(withNone.empires[0].perception.discovered).not.toContain("s_hidden");
    const a = runAiMoves(withBig, "e_ai").fleets["f_scout"]?.destinationSystemId;
    const b = runAiMoves(withNone, "e_ai").fleets["f_scout"]?.destinationSystemId;
    expect(a).toBe(b);
  });
});

describe("shortestPathFor: peaceful transit rules", () => {
  it("returns null rather than routing through a third party's peaceful territory", () => {
    // s_us — s_peaceful — s_goal. s_peaceful is owned by a third
    // empire we're not at war with; walking our fleet through would
    // auto-declare war. Path should come back null so
    // processFleetOrders strands the fleet instead of starting a war.
    const us = makeSystem({ id: "s_us", bodyIds: ["b_us"], ownerId: "e_me" });
    const middle = makeSystem({ id: "s_peaceful", bodyIds: ["b_m"], ownerId: "e_third" });
    const goal = makeSystem({ id: "s_goal", bodyIds: [], ownerId: null });
    const usBody = makeBody({ id: "b_us", systemId: "s_us", pops: 5 });
    const mBody = makeBody({ id: "b_m", systemId: "s_peaceful", pops: 5 });
    const me = makeEmpire({ id: "e_me", capitalBodyId: "b_us", systemIds: ["s_us"] });
    const third = makeEmpire({
      id: "e_third",
      capitalBodyId: "b_m",
      systemIds: ["s_peaceful"],
    });
    const state = makeState({
      systems: [us, middle, goal],
      bodies: [usBody, mBody],
      hyperlanes: [["s_us", "s_peaceful"], ["s_peaceful", "s_goal"]],
      empire: me,
      aiEmpires: [third],
    });
    const path = shortestPathFor(state, "e_me", "s_us", "s_goal");
    expect(path).toBeNull();
  });

  it("does allow the destination itself to be foreign (that's how war declarations via movement happen)", () => {
    // s_us — s_enemy. shortestPathFor should include s_enemy as the
    // path's final hop even when peaceful — the caller's
    // maybeAutoDeclareWar handles the consequences.
    const us = makeSystem({ id: "s_us", bodyIds: ["b_us"], ownerId: "e_me" });
    const enemy = makeSystem({ id: "s_enemy", bodyIds: ["b_enemy"], ownerId: "e_foe" });
    const usBody = makeBody({ id: "b_us", systemId: "s_us", pops: 5 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 5 });
    const me = makeEmpire({ id: "e_me", capitalBodyId: "b_us", systemIds: ["s_us"] });
    const foe = makeEmpire({
      id: "e_foe",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const state = makeState({
      systems: [us, enemy],
      bodies: [usBody, enemyBody],
      hyperlanes: [["s_us", "s_enemy"]],
      empire: me,
      aiEmpires: [foe],
    });
    const path = shortestPathFor(state, "e_me", "s_us", "s_enemy");
    expect(path).toEqual(["s_enemy"]);
  });
});

describe("fleet auto-discover: destination picker", () => {
  it("picks the nearest unsurveyed system reachable through peaceful systems", () => {
    // Empire owns s_a (surveyed). s_b and s_c are discovered via
    // sensor from s_a's ring; neither is surveyed (no fleet has been
    // there). Nearest unsurveyed = s_b.
    const a = makeSystem({ id: "s_a", bodyIds: ["b_a"], ownerId: "e_me" });
    const b = makeSystem({ id: "s_b", bodyIds: [], ownerId: null });
    const c = makeSystem({ id: "s_c", bodyIds: [], ownerId: null });
    const aBody = makeBody({ id: "b_a", systemId: "s_a", pops: 5 });
    const me = makeEmpire({ id: "e_me", capitalBodyId: "b_a", systemIds: ["s_a"] });
    const fleet: Fleet = {
      id: "f_scout",
      empireId: "e_me",
      systemId: "s_a",
      shipCount: 1,
    };
    const state = makeState({
      systems: [a, b, c],
      bodies: [aBody],
      hyperlanes: [["s_a", "s_b"], ["s_b", "s_c"]],
      empire: me,
      fleets: [fleet],
    });
    expect(state.empires[0].perception.discovered).toContain("s_b");
    expect(state.empires[0].perception.surveyed).toContain("s_a");
    expect(state.empires[0].perception.surveyed).not.toContain("s_b");
    const dest = autoDiscoveryDestination(state, state.empires[0], state.fleets["f_scout"]);
    expect(dest).toBe("s_b");
  });

  it("refuses to route through a foreign-owned system (won't auto-declare war)", () => {
    // Layout: s_me — s_enemy — s_far. Enemy owns s_enemy; s_far is
    // discovered through sensor. BFS for unsurveyed MUST NOT cross
    // s_enemy (would auto-declare war on arrival). With no peaceful
    // path, the chooser returns null.
    const me = makeSystem({ id: "s_me", bodyIds: ["b_me"], ownerId: "e_me" });
    const enemy = makeSystem({ id: "s_enemy", bodyIds: ["b_enemy"], ownerId: "e_enemy" });
    const far = makeSystem({ id: "s_far", bodyIds: [], ownerId: null });
    const meBody = makeBody({ id: "b_me", systemId: "s_me", pops: 5 });
    const enemyBody = makeBody({ id: "b_enemy", systemId: "s_enemy", pops: 5 });
    const player = makeEmpire({ id: "e_me", capitalBodyId: "b_me", systemIds: ["s_me"] });
    const enemyEmp = makeEmpire({
      id: "e_enemy",
      capitalBodyId: "b_enemy",
      systemIds: ["s_enemy"],
    });
    const fleet: Fleet = {
      id: "f_scout",
      empireId: "e_me",
      systemId: "s_me",
      shipCount: 1,
    };
    const state = makeState({
      systems: [me, enemy, far],
      bodies: [meBody, enemyBody],
      hyperlanes: [["s_me", "s_enemy"], ["s_enemy", "s_far"]],
      empire: player,
      aiEmpires: [enemyEmp],
      fleets: [fleet],
    });
    // s_enemy must NEVER be returned, even though it's unsurveyed —
    // entering foreign territory auto-declares war and scouting
    // shouldn't do that.
    const dest = autoDiscoveryDestination(state, state.empires[0], state.fleets["f_scout"]);
    expect(dest).not.toBe("s_enemy");
    expect(dest).not.toBe("s_far");
  });
});

describe("fog of war: seenFlavour", () => {
  it("adds a flavour body to seenFlavour when the empire owns its system", () => {
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_player" });
    const homeBody = makeBody({
      id: "b_home",
      systemId: "s_home",
      flavorFlags: ["precursor_ruins"],
    });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_home", systemIds: ["s_home"] });
    const state = makeState({
      systems: [home],
      bodies: [homeBody],
      empire: player,
    });
    // makeState runs updateVisibility; owning the system should
    // be enough to mark its flavour body as seen.
    expect(state.empires[0].perception.seenFlavour).toContain("b_home");
  });

  it("adds a flavour body to seenFlavour once a fleet enters the system", () => {
    // s_home (AI owned, no flavour) — s_dig (neutral, flavour body).
    // Before the scout arrives, flavour is NOT in seenFlavour.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_home"], ownerId: "e_ai" });
    const dig = makeSystem({ id: "s_dig", bodyIds: ["b_dig"], ownerId: null });
    const homeBody = makeBody({ id: "b_home", systemId: "s_home", pops: 10 });
    const digBody = makeBody({
      id: "b_dig",
      systemId: "s_dig",
      flavorFlags: ["rare_crystals"],
    });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_home", systemIds: ["s_home"] });
    const state = makeState({
      systems: [home, dig],
      bodies: [homeBody, digBody],
      hyperlanes: [["s_home", "s_dig"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai],
      fleets: [
        { id: "f_scout", empireId: "e_ai", systemId: "s_home", shipCount: 1 },
      ],
    });
    // Scout at home; flavour should NOT be seen yet — sensor
    // reveals s_dig exists but flavour is visit-only.
    expect(state.empires[1].perception.seenFlavour).not.toContain("b_dig");
    // Move the scout into s_dig and re-update visibility.
    const visited = produce(state, (draft) => {
      draft.fleets["f_scout"].systemId = "s_dig";
      updateVisibility(draft);
    });
    expect(visited.empires[1].perception.seenFlavour).toContain("b_dig");
  });
});

describe("fog of war: AI decisions", () => {
  // Tiny shim so each test can run one empire's aiPlanMoves against
  // a prepared state and inspect the resulting destination orders.
  function runAiMoves(state: GameState, empireId: string): GameState {
    return produce(state, (d) => {
      const emp = empireById(d, empireId);
      if (emp) aiPlanMoves(d, emp);
    });
  }

  it("does not set a destination outside the AI's discovered set", () => {
    // s_ai — s_mid — s_far. AI owns s_ai only, so sensor = {s_ai,
    // s_mid} and s_far is undiscovered. A fleet at s_ai may target
    // s_mid but must never target s_far, regardless of how juicy
    // scoreState would rate it.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: ["b_far"], ownerId: null });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    // Lush target planet behind the fog — would be a strong candidate
    // if the AI could see it.
    const farBody = makeBody({
      id: "b_far",
      systemId: "s_far",
      habitability: "garden",
      maxPops: 150,
      pops: 0,
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai"],
      expansionism: "conqueror",
    });
    const fleet: Fleet = {
      id: "f_scout",
      empireId: "e_ai",
      systemId: "s_ai",
      shipCount: 2,
    };
    const state = makeState({
      systems: [aiHome, mid, far],
      bodies: [aiBody, farBody],
      hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_far"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai],
      fleets: [fleet],
    });
    // Sanity check the seeding: s_far is NOT in the AI's discovered.
    expect(state.empires[1].perception.discovered).not.toContain("s_far");

    const decided = runAiMoves(state, "e_ai");
    // Whatever destination the AI picks, it mustn't be s_far — that
    // system is simply not a candidate.
    expect(decided.fleets["f_scout"]?.destinationSystemId).not.toBe("s_far");
  });

  it("does not queue colonize on a body in an undiscovered system", () => {
    // Same s_ai — s_mid — s_far topology, but now we test project
    // enumeration: even a dream garden world behind the fog must not
    // be proposed as a colonize target.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: "e_ai" });
    const far = makeSystem({ id: "s_far", bodyIds: ["b_far"], ownerId: null });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const midBody = makeBody({ id: "b_mid", systemId: "s_mid", pops: 0 });
    const farBody = makeBody({
      id: "b_far",
      systemId: "s_far",
      habitability: "garden",
      maxPops: 150,
      pops: 0,
    });
    // Mid is owned by the AI so the game would let it colonize the
    // far body via lane-adjacency; the only thing stopping it is fog.
    mid.bodyIds = ["b_mid"];
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: ["s_ai", "s_mid"],
      expansionism: "conqueror",
    });
    // Give the AI enough pops and political to actually queue.
    const home = { ...aiBody, pops: 60 };
    const state = makeState({
      systems: [aiHome, mid, far],
      bodies: [home, midBody, farBody],
      hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_far"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai],
    });
    // s_far is 2 jumps from s_ai AND 1 jump from s_mid — so under
    // current fog rules s_far IS in discovered (mid owns adjacent).
    // We want the test to bite: force the AI not to have discovered
    // it by moving s_mid out of the AI's systemIds after updateVisibility.
    const hidden = produce(state, (draft) => {
      const aiDraft = draft.empires[1];
      aiDraft.perception.discovered = aiDraft.perception.discovered.filter((sid) => sid !== "s_far");
    });
    expect(hidden.empires[0].perception.discovered).not.toContain("s_far");

    const after = produce(hidden, (draft) => {
      const emp = empireById(draft, "e_ai");
      if (emp) aiPlanProject(draft, emp);
    });
    // No colonize order on b_far should appear in the AI's queue —
    // that body lives in an undiscovered system.
    const hasColonizeOrder = Object.values(after.galaxy.bodies).some((b) =>
      b.queue.some(
        (o) => o.kind === "colonize" && o.targetBodyId === "b_far",
      ),
    );
    expect(hasColonizeOrder).toBe(false);
  });

  it("threat term ignores enemy fleets in undiscovered systems", () => {
    // AI owns s_ai. s_mid and s_far are connected via s_mid but
    // s_far is out of the AI's sensor + discovered. Enemy parks
    // a big fleet at s_far — invisible from the AI's vantage.
    // scoreState's threat term should not react to it.
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const far = makeSystem({ id: "s_far", bodyIds: ["b_far"], ownerId: "e_enemy" });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const farBody = makeBody({ id: "b_far", systemId: "s_far", pops: 30 });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: ["s_ai"] });
    const enemy = makeEmpire({ id: "e_enemy", capitalBodyId: "b_far", systemIds: ["s_far"] });
    // 20 enemy ships hiding behind the fog.
    const hiddenStack: Fleet = {
      id: "f_enemy_big",
      empireId: "e_enemy",
      systemId: "s_far",
      shipCount: 20,
    };
    const stateAtPeace = makeState({
      systems: [aiHome, mid, far],
      bodies: [aiBody, farBody],
      hyperlanes: [["s_ai", "s_mid"], ["s_mid", "s_far"]],
      empire: makeEmpire({ id: "e_player", systemIds: [] }),
      aiEmpires: [ai, enemy],
      fleets: [hiddenStack],
    });
    // Force a war so the threat term fires. scoreState only applies
    // the enemy-ship cost for empires in enemiesOf(), which comes
    // from state.wars.
    const stateAtWar = { ...stateAtPeace, wars: [["e_ai", "e_enemy"] as [string, string]] };
    expect(stateAtWar.empires[0].perception.discovered).not.toContain("s_far");

    // Baseline score with the hidden stack in place.
    const scoreHidden = score(stateAtWar, "e_ai");
    // Score with the stack removed entirely — fog means the AI's
    // belief about the threat is the same either way.
    const revealed = produce(stateAtWar, (draft) => {
      delete draft.fleets["f_enemy_big"];
    });
    const scoreNoStack = score(revealed, "e_ai");
    expect(scoreHidden).toBe(scoreNoStack);
  });
});

describe("randomRollout", () => {
  it("runs a short headless game without crashing and produces sensible stats", async () => {
    // Smoke test for the rollout harness. Short cap so this stays
    // cheap in the regular test suite; actual balance sweeps live
    // outside of vitest (npm run rollout).
    const { randomRollout } = await import("./rollout");
    const result = randomRollout({ seed: 0xabcdef, maxTurns: 25 });
    expect(result.turns).toBeGreaterThan(0);
    expect(result.finalEmpires.length).toBeGreaterThanOrEqual(3); // player + 2 AIs
    // Every empire's stats are well-formed numbers.
    for (const e of result.finalEmpires) {
      expect(e.systems).toBeGreaterThanOrEqual(0);
      expect(e.pops).toBeGreaterThanOrEqual(0);
      expect(e.ships).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(e.score)).toBe(true);
    }
    // Either we hit the cap or someone got eliminated.
    expect(result.turns >= 25 || result.gameOver).toBe(true);
  });
});

describe("stationary defenders", () => {
  // Shared wartime setup: e_player owns s_home and has N defenders.
  // e_ai is at war; its fleet sits at s_home (no defending fleet).
  function defenderSetup(opts: { defenders: number; invaderShips: number }): GameState {
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_cap"],
      ownerId: "e_player",
      defenders: opts.defenders,
    });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const ai = makeEmpire({
      id: "e_ai",
      capitalBodyId: "b_ai",
      systemIds: [aiHome.id],
    });
    const invader: Fleet = {
      id: "f_invader",
      empireId: "e_ai",
      systemId: "s_home",
      shipCount: opts.invaderShips,
    };
    return makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [invader],
      wars: [["e_ai", "e_player"].sort() as [string, string]],
    });
  }

  it("block occupation tick while alive", () => {
    // 3 defenders vs 1 weak attacker — attacker can't break through.
    // Without defenders the single attacker would be enough to occupy
    // (s_home defence = 1 outpost + ceil(30/20) = 3; attacker has 1).
    // But defenders aren't gated by the traditional defence check;
    // they live on the system scalar and block occupation purely by
    // being > 0. Combat will happen (atWar + invader present), so we
    // also expect the 3 defenders (6 ship-equiv) to wipe the 1-ship
    // invader outright.
    const state = defenderSetup({ defenders: 3, invaderShips: 1 });
    const t1 = reduce(state, { type: "endTurn" });
    // Combat: 6 vs 1 → attacker wiped, defenders take ~0 losses
    // (sqrt(36-1) ≈ 5.9 ship-equiv survive → 3 defenders still).
    expect(t1.fleets["f_invader"]).toBeUndefined();
    expect(t1.galaxy.systems["s_home"]?.defenders).toBe(3);
    expect(t1.galaxy.systems["s_home"]?.occupation).toBeUndefined();
    expect(t1.galaxy.systems["s_home"]?.ownerId).toBe("e_player");
  });

  it("defender beats a lone frigate 1v1 but takes no casualties (K=2)", () => {
    // 1 defender (2 ship-equiv) vs 1 frigate. Lanchester: sqrt(4-1)
    // ≈ 1.73 ship-equiv survive → round(1.73/2) = 1 defender alive.
    const state = defenderSetup({ defenders: 1, invaderShips: 1 });
    const t1 = reduce(state, { type: "endTurn" });
    expect(t1.fleets["f_invader"]).toBeUndefined();
    expect(t1.galaxy.systems["s_home"]?.defenders).toBe(1);
  });

  it("big attacker crushes defenders and can then occupy", () => {
    // 2 defenders (4 ship-equiv) vs 10 frigates. Attacker wins with
    // sqrt(100-16) ≈ 9.2 ships; defenders wiped to 0. Occupation
    // starts on the same turn via processOccupation (after combat).
    const state = defenderSetup({ defenders: 2, invaderShips: 10 });
    const t1 = reduce(state, { type: "endTurn" });
    expect(t1.galaxy.systems["s_home"]?.defenders).toBeUndefined();
    // Occupation counter ticking now.
    expect(t1.galaxy.systems["s_home"]?.occupation?.empireId).toBe("e_ai");
    expect(t1.galaxy.systems["s_home"]?.occupation?.turns).toBe(1);
  });

  it("cleared to 0 on ownership flip", () => {
    // Attacker big enough to cleave defenders AND survive the flip
    // countdown. After 1 combat + 3 occupation turns, system flips;
    // post-flip defenders gone (they belonged to the ousted owner).
    let s = defenderSetup({ defenders: 1, invaderShips: 20 });
    for (let i = 0; i < 4; i++) s = reduce(s, { type: "endTurn" });
    expect(s.galaxy.systems["s_home"]?.ownerId).toBe("e_ai");
    expect(s.galaxy.systems["s_home"]?.defenders).toBeUndefined();
  });

  it("no combat when no war — defenders sit, foreign fleet can loiter", () => {
    // Peacetime friction: foreign fleet parked on your system without
    // a war declaration shouldn't trigger combat. Defenders remain
    // intact; foreign fleet stays intact; occupation doesn't tick
    // (not at war).
    const home = makeSystem({
      id: "s_home",
      bodyIds: ["b_cap"],
      ownerId: "e_player",
      defenders: 2,
    });
    const aiHome = makeSystem({ id: "s_ai", bodyIds: ["b_ai"], ownerId: "e_ai" });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const aiBody = makeBody({ id: "b_ai", systemId: "s_ai", pops: 30 });
    const player = makeEmpire({ id: "e_player", capitalBodyId: "b_cap", systemIds: [home.id] });
    const ai = makeEmpire({ id: "e_ai", capitalBodyId: "b_ai", systemIds: [aiHome.id] });
    const visitor: Fleet = {
      id: "f_visitor",
      empireId: "e_ai",
      systemId: "s_home",
      shipCount: 5,
    };
    // No wars — scenario set up pre-first-contact.
    const state = makeState({
      systems: [home, aiHome],
      bodies: [cap, aiBody],
      hyperlanes: [["s_home", "s_ai"]],
      empire: player,
      aiEmpires: [ai],
      fleets: [visitor],
    });
    const t1 = reduce(state, { type: "endTurn" });
    expect(t1.fleets["f_visitor"]?.shipCount).toBe(5);
    expect(t1.galaxy.systems["s_home"]?.defenders).toBe(2);
    expect(t1.galaxy.systems["s_home"]?.occupation).toBeUndefined();
  });
});

// =====================================================================
// Performance benchmark. Runs the full game loop (endTurn) across a
// realistic-size galaxy for several turns and reports the per-turn
// cost. Doesn't target a precise number — it exists so we can watch
// the trend while swapping in heavier AI lookahead (e.g., the
// planned 2-step look-ahead for war declarations) and so a future
// change that blows up the cost catastrophically fails loudly.
// =====================================================================
describe("perf: endTurn cost", () => {
  it("runs a realistic-size round within the budget", () => {
    // Seed a fresh game via the real newGame path so the galaxy has
    // content-driven size (~100 systems, 2 AIs, a few planets per
    // system on average). newGame ignores prior state, so the first
    // argument is just a type satisfier.
    const START_SEED = 0xc0ffee;
    let state = reduce({} as GameState, {
      type: "newGame",
      empireName: "Bench",
      originId: "steady_evolution",
      speciesId: "humans",
      seed: START_SEED,
      expansionism: "conqueror",
      politic: "centrist",
    });
    const TURNS = 30;
    // Warm-up turn so JIT overhead isn't counted.
    state = reduce(state, { type: "endTurn" });
    const start = performance.now();
    for (let i = 0; i < TURNS; i++) {
      state = reduce(state, { type: "endTurn" });
    }
    const elapsed = performance.now() - start;
    const perTurn = elapsed / TURNS;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] ${TURNS} turns in ${elapsed.toFixed(0)}ms (${perTurn.toFixed(1)}ms/turn)`,
    );
    // Loose ceiling. Current cost is typically a few ms/turn; this is
    // ~20× that, so a catastrophic regression (like accidentally
    // cubic AI search) trips it without flaking on CI.
    expect(perTurn).toBeLessThan(200);
  });

  it("breakdown: beginRound vs runPhase cycle", () => {
    // Splits the per-turn cost into two halves: beginRound (AI
    // project planning + tickEmpire for every empire) vs the
    // runPhase cycle (per-empire diplomacy + aiPlanMoves). Purely
    // informational — lets us see which half dominates when we
    // decide where to spend optimisation / parallelism effort.
    let state = reduce({} as GameState, {
      type: "newGame",
      empireName: "Bench",
      originId: "steady_evolution",
      speciesId: "humans",
      seed: 0xc0ffee,
      expansionism: "conqueror",
      politic: "centrist",
    });
    state = reduce(state, { type: "endTurn" }); // warm-up
    const TURNS = 30;
    let totalBegin = 0;
    let totalPhases = 0;
    BENCH.reset();
    for (let i = 0; i < TURNS; i++) {
      const t0 = performance.now();
      state = reduce(state, { type: "beginRound" });
      const t1 = performance.now();
      while (state.currentPhaseEmpireId) {
        state = reduce(state, { type: "runPhase" });
      }
      const t2 = performance.now();
      totalBegin += t1 - t0;
      totalPhases += t2 - t1;
    }
    const avgBegin = totalBegin / TURNS;
    const avgPhases = totalPhases / TURNS;
    const avgScore = BENCH.scoreStateCalls / TURNS;
    const avgScoreTime = BENCH.scoreStateTimeMs / TURNS;
    const avgCand = BENCH.moveCandidateCalls / TURNS;
    const avgCandTime = BENCH.moveCandidateTimeMs / TURNS;
    const avgProduce = BENCH.produceTimeMs / TURNS;
    const avgCombat = BENCH.resolveCombatTimeMs / TURNS;
    const avgOcc = BENCH.processOccupationTimeMs / TURNS;
    // eslint-disable-next-line no-console
    console.log(
      `[bench:breakdown] per turn avg:\n` +
        `  beginRound=${avgBegin.toFixed(1)}ms  runPhase-cycle=${avgPhases.toFixed(1)}ms\n` +
        `  scoreState calls=${avgScore.toFixed(0)} time=${avgScoreTime.toFixed(1)}ms (${(avgScoreTime / avgScore || 0).toFixed(3)}ms each)\n` +
        `  moveCandidate calls=${avgCand.toFixed(0)} time=${avgCandTime.toFixed(1)}ms (${(avgCandTime / avgCand || 0).toFixed(3)}ms each)\n` +
        `    ├ produce  ${avgProduce.toFixed(1)}ms (${(avgProduce / avgCand || 0).toFixed(3)}ms each)\n` +
        `    ├ combat   ${avgCombat.toFixed(1)}ms (${(avgCombat / avgCand || 0).toFixed(3)}ms each)\n` +
        `    └ occupy   ${avgOcc.toFixed(1)}ms (${(avgOcc / avgCand || 0).toFixed(3)}ms each)`,
    );
  });
});
