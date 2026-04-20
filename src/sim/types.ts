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

// Placeholder — real build orders land in M2+.
export interface BuildOrder {
  id: string;
  label: string;
  hammersRequired: number;
  hammersPaid: number;
}

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
export interface SpeciesTrait {
  id: string;
  name: string;
  description: string;
  modifiers: Partial<Record<ResourceKey, number>>;
}

export interface Species {
  id: string;
  name: string;
  description: string;
  traitIds: string[];
  art?: string;
  color: string;           // Hex color used for empire territory/UI.
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
  flags: string[];
}

export interface PendingEvent {
  eventId: string;
  seed: number;
}

export interface GameState {
  schemaVersion: 4;
  turn: number;
  rngSeed: number;
  galaxy: Galaxy;
  empire: Empire;
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
