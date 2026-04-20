import { mulberry32 } from "./rng";
import type {
  Body,
  BodyKind,
  Galaxy,
  HabitabilityTier,
  Hyperlane,
  StarKind,
  StarSystem,
} from "./types";

// Greek-letter stars with Latin suffixes — enough for a standard galaxy.
const STAR_PREFIXES = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
  "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi",
  "Rho", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega",
];

const STAR_SUFFIXES = [
  "Corvi", "Draconis", "Lyrae", "Cygni", "Aquilae", "Centauri",
  "Persei", "Orionis", "Leonis", "Ursae", "Pavonis", "Herculis",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

type Rand = () => number;

function pick<T>(r: Rand, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

// Only harsh / hellscape in the random roll — temperate bodies are scarce
// and placed explicitly afterwards (see SCATTER_TEMPERATE_COUNT). Gardens
// disabled for now.
function rollHabitability(r: Rand): HabitabilityTier {
  const roll = r();
  if (roll < 0.55) return "harsh";
  return "hellscape";
}

function rollStarKind(r: Rand): StarKind {
  const roll = r();
  if (roll < 0.55) return "yellow_main";
  if (roll < 0.85) return "red_dwarf";
  return "blue_giant";
}

// Space cap per body depends on habitability. Pops only fit comfortably
// on temperate (and gardens when they come back). Harsh worlds host a
// mining outpost (1-2 pops); hellscapes are uninhabitable — owned for
// territory, not population.
const SPACE_BY_HAB: Record<HabitabilityTier, [number, number]> = {
  garden: [8, 12],
  temperate: [4, 7],
  harsh: [1, 2],
  hellscape: [0, 0],
};

function rollSpace(r: Rand, hab: HabitabilityTier): number {
  const [lo, hi] = SPACE_BY_HAB[hab];
  return lo + Math.floor(r() * (hi - lo + 1));
}

function rollBodyCount(r: Rand): number {
  const roll = r();
  if (roll < 0.2) return 1;
  if (roll < 0.6) return 2;
  if (roll < 0.9) return 3;
  return 4;
}

function rollFlavorFlags(r: Rand): string[] {
  // Unique sites are scarce — only ~2% of bodies get one.
  if (r() > 0.02) return [];
  return [pick(r, ["precursor_ruins", "rare_crystals", "exotic_atmosphere", "ancient_monolith"])];
}

function bodyNameFor(systemName: string, index: number): string {
  return `${systemName} ${ROMAN[index] ?? `${index + 1}`}`;
}

function systemName(r: Rand, taken: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const name = `${pick(r, STAR_PREFIXES)} ${pick(r, STAR_SUFFIXES)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  // Fallback — should never hit.
  return `System-${taken.size}`;
}

export interface GenOptions {
  width: number;   // Hex columns.
  height: number;  // Hex rows.
  density: number; // 0..1, fraction of cells that have a system.
  seed: number;
}

// Axial hex distance: 1 means immediate neighbor on the grid.
function axialDist(a: StarSystem, b: StarSystem): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Only connect immediate hex neighbors (axial distance 1). Within that
// constrained graph we take an MST-ish set of edges for connectivity,
// then sprinkle a few extras so chokepoints emerge organically.
// Systems with no hex-neighbor system in the galaxy stay as unreachable
// islands — that's geography, not a bug.
function generateHyperlanes(systems: StarSystem[], rand: () => number): Hyperlane[] {
  if (systems.length < 2) return [];
  type Edge = { a: string; b: string };

  // Build adjacency list of strictly-adjacent system pairs (distance == 1).
  const pairs: Edge[] = [];
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      if (axialDist(systems[i], systems[j]) === 1) {
        pairs.push({ a: systems[i].id, b: systems[j].id });
      }
    }
  }
  // Randomize order so MST pick is not biased by q,r iteration order.
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }

  // Union-find for MST across the adjacency graph.
  const parent: Record<string, string> = {};
  for (const s of systems) parent[s.id] = s.id;
  const find = (x: string): string => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: string, b: string): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };

  const edges: Hyperlane[] = [];
  const inMst = new Set<number>();
  for (let i = 0; i < pairs.length; i++) {
    if (union(pairs[i].a, pairs[i].b)) {
      edges.push([pairs[i].a, pairs[i].b]);
      inMst.add(i);
    }
  }

  // Sprinkle additional adjacency edges for chokepoint variety.
  const EXTRA_CHANCE = 0.4;
  for (let i = 0; i < pairs.length; i++) {
    if (inMst.has(i)) continue;
    if (rand() < EXTRA_CHANCE) {
      edges.push([pairs[i].a, pairs[i].b]);
    }
  }
  return edges;
}

// Hex distance between two axial coords (in hex cells).
function axialDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function generateGalaxy(opts: GenOptions): Galaxy {
  const rand = mulberry32(opts.seed);
  const systems: Record<string, StarSystem> = {};
  const bodies: Record<string, Body> = {};
  const takenNames = new Set<string>();
  let systemCounter = 0;
  let bodyCounter = 0;

  // Shape the galaxy as a rough disc with a soft, noisy edge.
  const centerQ = (opts.width - 1) / 2;
  const centerR = (opts.height - 1) / 2;
  const radius = Math.min(opts.width, opts.height) / 2;
  const softEdge = 1.0;  // cells over which the probability decays to 0

  for (let r = 0; r < opts.height; r++) {
    for (let q = 0; q < opts.width; q++) {
      const d = axialDistance(q, r, centerQ, centerR);
      // Probability falls off as we approach and cross the radius.
      let shapeP = 1;
      if (d > radius - softEdge) {
        shapeP = Math.max(0, 1 - (d - (radius - softEdge)) / softEdge);
      }
      if (rand() > shapeP) continue;
      if (rand() > opts.density) continue;
      const sysId = `sys_${systemCounter++}`;
      const name = systemName(rand, takenNames);
      const bodyCount = rollBodyCount(rand);
      const bodyIds: string[] = [];
      for (let i = 0; i < bodyCount; i++) {
        const bodyId = `body_${bodyCounter++}`;
        const kind: BodyKind = i === 0 ? "planet" : rand() < 0.5 ? "planet" : "moon";
        const habitability = rollHabitability(rand);
        const space = rollSpace(rand, habitability);
        bodies[bodyId] = {
          id: bodyId,
          systemId: sysId,
          name: bodyNameFor(name, i),
          kind,
          habitability,
          space,
          pops: 0,
          hammers: 0,
          queue: [],
          flavorFlags: rollFlavorFlags(rand),
        };
        bodyIds.push(bodyId);
      }
      systems[sysId] = {
        id: sysId,
        name,
        q,
        r,
        starKind: rollStarKind(rand),
        bodyIds,
        ownerId: null,
      };
    }
  }

  const hyperlanes = generateHyperlanes(Object.values(systems), rand);

  // Scatter temperate bodies across the galaxy, proportional to system
  // count. Starter bodies (one per empire) are force-temperate
  // separately in the reducer. Gardens disabled for now.
  const systemCount = Object.keys(systems).length;
  const SCATTER_TEMPERATE_COUNT = Math.max(2, Math.round(systemCount * 0.12));
  const bodyIds = Object.keys(bodies);
  for (let i = 0; i < SCATTER_TEMPERATE_COUNT && bodyIds.length > 0; i++) {
    const pick = bodyIds[Math.floor(rand() * bodyIds.length)];
    const body = bodies[pick];
    body.habitability = "temperate";
    const [lo, hi] = SPACE_BY_HAB.temperate;
    if (body.space < lo) body.space = lo + Math.floor(rand() * (hi - lo + 1));
    body.kind = "planet";
  }

  return {
    systems,
    bodies,
    hyperlanes,
    width: opts.width,
    height: opts.height,
  };
}

// Place a guaranteed garden home world for the player.
// Picks an unowned interior system, force-upgrades its first body to a garden.
export function assignStarterSystem(
  galaxy: Galaxy,
  empireId: string,
  startingPops: number,
  seed: number,
): { galaxy: Galaxy; capitalBodyId: string; systemId: string } {
  const rand = mulberry32(seed);
  const candidates = Object.values(galaxy.systems).filter((s) => !s.ownerId);
  if (candidates.length === 0) {
    throw new Error("No unclaimed systems available for starter");
  }
  // Prefer systems not on the very edge.
  const interior = candidates.filter(
    (s) =>
      s.q > 0 &&
      s.q < galaxy.width - 1 &&
      s.r > 0 &&
      s.r < galaxy.height - 1,
  );
  const pool = interior.length > 0 ? interior : candidates;
  const chosen = pool[Math.floor(rand() * pool.length)];

  const nextSystems = { ...galaxy.systems };
  const nextBodies = { ...galaxy.bodies };

  const starterBodyId = chosen.bodyIds[0];
  const starter = nextBodies[starterBodyId];
  // Force starter body to a garden with generous space — the player needs a home.
  nextBodies[starterBodyId] = {
    ...starter,
    habitability: "garden",
    kind: "planet",
    space: Math.max(starter.space, 10),
    pops: startingPops,
  };
  nextSystems[chosen.id] = {
    ...chosen,
    ownerId: empireId,
  };

  return {
    galaxy: { ...galaxy, systems: nextSystems, bodies: nextBodies },
    capitalBodyId: starterBodyId,
    systemId: chosen.id,
  };
}
