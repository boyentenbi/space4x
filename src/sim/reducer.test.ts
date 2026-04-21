import { produce } from "immer";
import { describe, expect, it } from "vitest";
import {
  aiPlanMoves,
  atWar,
  availableBodyProjectsFor,
  canEnterSystem,
  empireById,
  reduce,
  scoreState,
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
    space: overrides.space ?? 10,
    pops: overrides.pops ?? 0,
    hammers: overrides.hammers ?? 0,
    queue: overrides.queue ?? [],
    flavorFlags: overrides.flavorFlags ?? [],
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

function makeEmpire(overrides: Partial<Empire> & { id: string }): Empire {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    speciesId: overrides.speciesId ?? "humans",
    originId: overrides.originId ?? "steady_evolution",
    color: overrides.color ?? "#7ec8ff",
    resources: overrides.resources ?? { food: 500, energy: 500, political: 20 },
    compute: overrides.compute ?? { cap: 0, used: 0 },
    expansionism: overrides.expansionism ?? "pragmatist",
    politic: overrides.politic ?? "centrist",
    capitalBodyId: overrides.capitalBodyId ?? null,
    systemIds: overrides.systemIds ?? [],
    projects: overrides.projects ?? [],
    storyModifiers: overrides.storyModifiers ?? {},
    completedProjects: overrides.completedProjects ?? [],
    adoptedPolicies: overrides.adoptedPolicies ?? [],
    flags: overrides.flags ?? [],
  };
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
  return {
    schemaVersion: 15,
    turn: overrides.turn ?? 1,
    rngSeed: 1,
    galaxy: {
      systems: Object.fromEntries(overrides.systems.map((s) => [s.id, s])),
      bodies: Object.fromEntries(overrides.bodies.map((b) => [b.id, b])),
      hyperlanes: overrides.hyperlanes ?? [],
      width: 10,
      height: 10,
    },
    empire: overrides.empire,
    aiEmpires: overrides.aiEmpires ?? [],
    fleets: fleetsRec,
    wars: overrides.wars ?? [],
    eventQueue: [],
    eventLog: [],
    projectCompletions: [],
    gameOver: false,
  };
}

// =====================================================================
// Tests
// =====================================================================

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

  it("blocks entry into neutral-owned systems", () => {
    const { state, moverId, targetId } = setup({ targetOwner: "e_other" });
    expect(canEnterSystem(state, moverId, targetId)).toBe(false);
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

  it("refuses a destination with no legal path (neutral territory)", () => {
    const { state, fleetId, destId } = twoSystemSetup({ destOwner: "e_other" });
    const next = reduce(state, {
      type: "setFleetDestination",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    expect(next.fleets[fleetId]?.destinationSystemId).toBeUndefined();
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
    // Player raw = 1 system × 200 = 200; occupation debit = 200 × 2/3
    // ≈ 133.3; + 15 political-flow baseline. So player score ≈ 82.
    const playerScore = scoreState(state, "e_player");
    expect(playerScore).toBeGreaterThan(75);
    expect(playerScore).toBeLessThan(90);
    // AI raw = 1 system × 200 + 1 ship × 200 = 400; occupation credit
    // ≈ 133.3; + 15 political-flow. So AI score ≈ 548.
    const aiScore = scoreState(state, "e_ai");
    expect(aiScore).toBeGreaterThan(540);
    expect(aiScore).toBeLessThan(555);
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
    // 1 system × 200 + 2 ships × 200 = 600 assets.
    // + 1 political/turn baseline × (FLOW_HORIZON 5 × political mult 3) = 15.
    // Total = 615.
    expect(scoreState(state, "e_player")).toBe(615);
  });

  it("scoreState increases after a round where a new system was colonised", () => {
    // Proxy test: if the AI's project search is functional it will
    // queue colonize and score higher on the next round.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const far = makeSystem({ id: "s_far", bodyIds: ["b_far"], ownerId: null });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const farBody = makeBody({ id: "b_far", systemId: "s_far", pops: 0 });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
      resources: { food: 500, energy: 500, political: 20 },
    });
    const state = makeState({
      systems: [home, far],
      bodies: [cap, farBody],
      hyperlanes: [["s_home", "s_far"]],
      empire,
    });
    const baseScore = scoreState(state, "e_player");
    // Queue the colonize directly (simulating what AI search would pick).
    const queued = reduce(state, {
      type: "queueColonize",
      byEmpireId: "e_player",
      targetBodyId: "b_far",
    });
    // With the project queued, score should rise by the partial-credit
    // weight (70% discount × initial progress).
    expect(scoreState(queued, "e_player")).toBeGreaterThan(baseScore);
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
    const next = reduce(state, { type: "endTurn" });
    const combat = next.eventLog.find((e) => e.eventId === "combat");
    expect(combat?.text).toContain("s_ai"); // system name fallback = id here
    expect(combat?.text).toContain("you 4→");
    expect(combat?.text).toContain("Rival Empire 3→");
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
    const targetBody = makeBody({ id: "b_target", systemId: "s_target", pops: 30 });
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
      shipCount: 1,
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
      shipCount: 2,
    };
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

    const next = reduce(state, { type: "endTurn" });
    // After one round the two 1-ship fleets should both be dead from
    // combat — pre-refactor they'd have passed through and survived.
    expect(next.fleets["f_player"]).toBeUndefined();
    expect(next.fleets["f_ai"]).toBeUndefined();
  });
});

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

    const t1 = reduce(state, { type: "endTurn" });
    // After one end-turn, fleet should be at mid, still routed to far.
    expect(t1.fleets["f1"]?.systemId).toBe("s_mid");
    expect(t1.fleets["f1"]?.destinationSystemId).toBe("s_far");

    const t2 = reduce(t1, { type: "endTurn" });
    // Arrived; destination cleared.
    expect(t2.fleets["f1"]?.systemId).toBe("s_far");
    expect(t2.fleets["f1"]?.destinationSystemId).toBeUndefined();
  });

  it("idles a fleet whose jump would exceed the compute budget", () => {
    // Empire owns one body → compute.cap = 1. A 3-ship fleet routed
    // to a neighbour costs 3 compute → can't afford, stays put.
    const home = makeSystem({ id: "s_home", bodyIds: ["b_cap"], ownerId: "e_player" });
    const mid = makeSystem({ id: "s_mid", bodyIds: [], ownerId: null });
    const cap = makeBody({ id: "b_cap", systemId: "s_home", pops: 30 });
    const empire = makeEmpire({
      id: "e_player",
      capitalBodyId: "b_cap",
      systemIds: [home.id],
    });
    const fleet: Fleet = {
      id: "f_big",
      empireId: "e_player",
      systemId: "s_home",
      shipCount: 3,
      destinationSystemId: "s_mid",
    };
    const state = makeState({
      systems: [home, mid],
      bodies: [cap],
      hyperlanes: [["s_home", "s_mid"]],
      empire,
      fleets: [fleet],
    });

    const next = reduce(state, { type: "endTurn" });
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
    const invader: Fleet = {
      id: "f_invader",
      empireId: "e_player",
      systemId: "s_target",
      shipCount: 1,
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
    expect(s.empire.systemIds).toContain("s_target");
    // AI is eliminated (lost its only system).
    expect(s.aiEmpires.find((e) => e.id === "e_ai")).toBeUndefined();
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
    const invader: Fleet = {
      id: "f_ai",
      empireId: "e_ai",
      systemId: "s_home",
      shipCount: 1,
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
    expect(s.empire.systemIds.length).toBe(0);
    expect(s.gameOver).toBe(true);
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

});
