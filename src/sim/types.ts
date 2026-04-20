// =====================================================================
// Resources
// =====================================================================
// Empire-wide stocks (accumulate across turns).
export type ResourceKey = "food" | "energy" | "alloys" | "political";
export type Resources = Record<ResourceKey, number>;

// Empire-wide flow (resets every turn — capacity, not stockpile).
export interface Compute {
  cap: number;      // Max compute this turn (sum of data-center output).
  used: number;     // Allocated this turn (research, events, etc).
}

// =====================================================================
// Map — one hex tile is one star system containing bodies.
// =====================================================================
export type HabitabilityTier = "garden" | "temperate" | "harsh" | "hellscape";

export type BodyKind = "planet" | "moon";

export type StarKind = "yellow_main" | "blue_giant" | "red_dwarf";

export interface Body {
  id: string;
  systemId: string;
  name: string;
  kind: BodyKind;
  habitability: HabitabilityTier;
  space: number;           // Pop cap.
  pops: number;            // Current population.
  hammers: number;         // Per-turn production flow (resets each tick).
  queue: BuildOrder[];     // Projects hammers flow into.
  flavorFlags: string[];   // e.g. "precursor_ruins", "rare_crystals".
}

// Discriminated union so future project types (data center, fleet, etc.)
// slot in without changing callers.
export type BuildOrder =
  | {
      kind: "colonize";
      id: string;
      targetBodyId: string;
      hammersRequired: number;
      hammersPaid: number;
      politicalCost: number;
    };

export interface StarSystem {
  id: string;
  name: string;
  q: number;               // Axial hex coord.
  r: number;
  starKind: StarKind;
  bodyIds: string[];
  ownerId: string | null;  // Empire id, null = unclaimed.
}

// Hyperlanes connect systems. Undirected; stored as unordered pairs of system ids.
export type Hyperlane = [string, string];

export interface Galaxy {
  systems: Record<string, StarSystem>;
  bodies: Record<string, Body>;
  hyperlanes: Hyperlane[];
  width: number;           // Hex grid bounds (inclusive).
  height: number;
}

// =====================================================================
// Species / Origins / Traits
// =====================================================================
// =====================================================================
// Modifiers — the effect primitives shared by species + traits.
// Species and traits both carry a list of Modifier objects; the reducer
// sums them to compute per-turn rates, caps, and costs.
// =====================================================================
export type Modifier =
  // Per-pop per-turn resource yield on any body.
  | { kind: "perPop"; resource: ResourceKey; value: number }
  // Flat per-turn empire income (not scaled by pops).
  | { kind: "flat"; resource: ResourceKey; value: number }
  // Multiplicative: 1.25 = +25%, 0.8 = -20%.
  | { kind: "popGrowthMult"; value: number }
  | { kind: "spaceMult"; value: number }
  | { kind: "colonizeHammerMult"; value: number }
  // Additive deltas on per-pop costs/yields that don't fit the resource model.
  | { kind: "foodUpkeepDelta"; value: number }        // default upkeep is 1
  | { kind: "hammersPerPopDelta"; value: number }     // default hammer yield is 1
  // Conditional bonus: resource yield per pop on bodies of a given hab tier.
  | { kind: "habBonus"; habitability: HabitabilityTier; resource: ResourceKey; value: number };

export interface SpeciesTrait {
  id: string;
  name: string;
  description: string;
  modifiers: Modifier[];
}

export interface Species {
  id: string;
  name: string;
  description: string;
  traitIds: string[];
  art?: string;
  color: string;
  // Species-level innate modifiers (applied before traits).
  modifiers: Modifier[];
}

export interface Origin {
  id: string;
  name: string;
  description: string;
  startingResources: Partial<Resources>;
  startingPops: number;
  allowedSpeciesIds?: string[];
  flagEvents?: string[];
  art?: string;
}

// =====================================================================
// Empire + game state
// =====================================================================
export interface Empire {
  id: string;
  name: string;
  speciesId: string;
  originId: string;
  color: string;             // Territory/UI color. Derived from species at new game.
  resources: Resources;
  compute: Compute;
  capitalBodyId: string | null;
  systemIds: string[];       // Owned systems.
  projects: BuildOrder[];    // Empire-level project queue (FIFO).
  flags: string[];
}

export interface PendingEvent {
  eventId: string;
  seed: number;
}

export interface GameState {
  schemaVersion: 7;
  turn: number;
  rngSeed: number;
  galaxy: Galaxy;
  empire: Empire;           // The player's empire.
  aiEmpires: Empire[];      // AI-controlled rivals.
  eventQueue: PendingEvent[];
  eventLog: Array<{ turn: number; eventId: string; choiceId: string | null; text: string }>;
  gameOver: boolean;
}

// =====================================================================
// Events
// =====================================================================
export interface EventChoice {
  id: string;
  text: string;
  effects: Effect[];
}

export interface GameEvent {
  id: string;
  title: string;
  text: string;
  weight?: number;
  requires?: Condition[];
  choices: EventChoice[];
}

export type Condition =
  | { kind: "hasFlag"; flag: string }
  | { kind: "lacksFlag"; flag: string }
  | { kind: "minResource"; resource: ResourceKey; value: number }
  | { kind: "originIs"; originId: string };

export type Effect =
  | { kind: "addResource"; resource: ResourceKey; value: number }
  | { kind: "addPops"; value: number }        // Added to capital body.
  | { kind: "addFlag"; flag: string }
  | { kind: "removeFlag"; flag: string }
  | { kind: "logText"; text: string };
