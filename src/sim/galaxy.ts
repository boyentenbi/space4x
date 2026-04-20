import { mulberry32 } from "./rng";
import type {
  Body,
  BodyKind,
  Galaxy,
  HabitabilityTier,
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

function rollHabitability(r: Rand): HabitabilityTier {
  const roll = r();
  if (roll < 0.1) return "garden";
  if (roll < 0.35) return "temperate";
  if (roll < 0.7) return "harsh";
  return "hellscape";
}

// Space cap per body depends on habitability.
const SPACE_BY_HAB: Record<HabitabilityTier, [number, number]> = {
  garden: [8, 12],
  temperate: [4, 7],
  harsh: [2, 4],
  hellscape: [1, 2],
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
  // ~5% of bodies get a unique site.
  if (r() > 0.05) return [];
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

export function generateGalaxy(opts: GenOptions): Galaxy {
  const rand = mulberry32(opts.seed);
  const systems: Record<string, StarSystem> = {};
  const bodies: Record<string, Body> = {};
  const takenNames = new Set<string>();
  let systemCounter = 0;
  let bodyCounter = 0;

  for (let r = 0; r < opts.height; r++) {
    for (let q = 0; q < opts.width; q++) {
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
        bodyIds,
        ownerId: null,
      };
    }
  }

  return {
    systems,
    bodies,
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
