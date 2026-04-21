import { describe, expect, it } from "vitest";
import {
  atWar,
  availableBodyProjectsFor,
  canEnterSystem,
  reduce,
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
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    q: overrides.q ?? 0,
    r: overrides.r ?? 0,
    starKind: overrides.starKind ?? "yellow_main",
    bodyIds: overrides.bodyIds,
    ownerId: overrides.ownerId ?? null,
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

describe("moveFleet action", () => {
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

  it("moves a fleet one hop through an unowned destination", () => {
    const { state, fleetId, destId } = twoSystemSetup();
    const next = reduce(state, {
      type: "moveFleet",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    // Full-move deletes the source fleet and spawns a fresh one at the
    // destination, so look up by system rather than id.
    const fleetAtDest = Object.values(next.fleets).find((f) => f.systemId === destId);
    expect(fleetAtDest).toBeDefined();
    expect(fleetAtDest?.empireId).toBe("e_player");
    expect(fleetAtDest?.shipCount).toBe(3);
    expect(fleetAtDest?.movedTurn).toBe(state.turn);
    expect(next.fleets[fleetId]).toBeUndefined();
  });

  it("refuses a dispatch from an empire that doesn't own the fleet", () => {
    const { state, fleetId, destId } = twoSystemSetup();
    const next = reduce(state, {
      type: "moveFleet",
      byEmpireId: "e_other",
      fleetId,
      toSystemId: destId,
    });
    expect(next).toBe(state); // no-op
  });

  it("refuses to enter neutral territory", () => {
    const { state, fleetId, destId } = twoSystemSetup({ destOwner: "e_other" });
    const next = reduce(state, {
      type: "moveFleet",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    // Fleet stays home.
    expect(next.fleets[fleetId]?.systemId).toBe("s_home");
  });

  it("enters at-war territory", () => {
    const { state, fleetId, destId } = twoSystemSetup({
      destOwner: "e_other",
      wars: [["e_other", "e_player"].sort() as [string, string]],
    });
    const next = reduce(state, {
      type: "moveFleet",
      byEmpireId: "e_player",
      fleetId,
      toSystemId: destId,
    });
    const fleetAtDest = Object.values(next.fleets).find((f) => f.systemId === destId);
    expect(fleetAtDest).toBeDefined();
    expect(fleetAtDest?.empireId).toBe("e_player");
    expect(next.fleets[fleetId]).toBeUndefined();
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
