// =====================================================================
// Resources
// =====================================================================
// Empire-wide stocks (accumulate across turns).
// Industrial output is tracked as hammers (flow resource) — alloys has
// been retired. Remaining stock resources: food, energy, political.
export type ResourceKey = "food" | "energy" | "political";
export type Resources = Record<ResourceKey, number>;

// Empire-wide flow (resets every turn — capacity, not stockpile).
export interface Compute {
  cap: number;      // Max compute this turn (sum of data-center output).
  used: number;     // Allocated this turn (research, events, etc).
}

// =====================================================================
// Map — one hex tile is one star system containing bodies.
// =====================================================================
export type HabitabilityTier =
  | "garden"
  | "temperate"
  | "harsh"
  | "frozen"
  | "molten"
  | "barren"
  | "stellar"; // reserved for the star body in each system

export type BodyKind = "star" | "planet" | "moon";

export type StarKind = "yellow_main" | "blue_giant" | "red_dwarf";

// =====================================================================
// Fleets — the first military layer. Each fleet is positioned at a
// single system, owned by a single empire, and for MVP just carries a
// ship count. Combat, movement, and composition come later.
// =====================================================================
export interface Fleet {
  id: string;
  empireId: string;
  systemId: string;
  shipCount: number;
  // Movement is exclusively an end-of-turn world-update now: players
  // and AIs set destinations via setFleetDestination and the auto-
  // stepper walks the fleet one hop per turn until it arrives or the
  // route becomes blocked.
  destinationSystemId?: string;
}

export interface Body {
  id: string;
  systemId: string;
  name: string;
  kind: BodyKind;
  habitability: HabitabilityTier;
  maxPops: number;         // Pop cap.
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
    }
  | {
      kind: "empire_project";
      id: string;
      projectId: string;            // refs an EmpireProject in content.
      hammersRequired: number;
      hammersPaid: number;
      // Present for body-scope projects; identifies the body hosting
      // the project (e.g., the capital for Brood Mother).
      targetBodyId?: string;
    };

export interface StarSystem {
  id: string;
  name: string;
  q: number;               // Axial hex coord.
  r: number;
  starKind: StarKind;
  bodyIds: string[];
  ownerId: string | null;  // Empire id, null = unclaimed.
  // Ongoing occupation by a foreign at-war fleet when the owner has
  // no defender present. Counts turns; at OCCUPATION_TURNS_TO_FLIP the
  // system transfers to the occupier and this field clears.
  occupation?: {
    empireId: string;
    turns: number;
  };
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
// Leader archetype axes. Two orthogonal 3-tier choices — the AI's
// disposition toward expansion, and its internal political flavour.
// =====================================================================
export type Expansionism = "conqueror" | "pragmatist" | "isolationist";
export type Politic = "collectivist" | "centrist" | "individualist";

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
  // Flat per-turn probability added to each body's growth roll before
  // multipliers. Used for things like a Brood Mother that provide a
  // steady baseline of growth even on near-full bodies.
  | { kind: "popGrowthAdd"; value: number }
  | { kind: "maxPopsMult"; value: number }
  | { kind: "colonizeHammerMult"; value: number }
  | { kind: "colonizePoliticalMult"; value: number }
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
  art?: string;                // Default portrait (first entry of portraits).
  portraits?: string[];        // All available portrait variants.
  color: string;
  modifiers: Modifier[];
  // Politics this species can adopt. Undefined means all three are OK.
  // Insectoids are hive-minded and cannot be individualist.
  allowedPolitics?: Politic[];
}

// Pre-written leaders used to seed AI empires. Each bundles a portrait
// with a fixed archetype + name + manifesto, so a machine's
// "Ascendant Directive" always plays as a Conqueror+Individualist,
// while a human can be mixed-and-matched by the player.
export interface Leader {
  id: string;
  speciesId: string;
  portraitPath: string;
  name: string;
  manifesto: string;
  expansionism: Expansionism;
  politic: Politic;
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
  // Optional story-modifier bundles applied at new game. Keyed by bundle
  // name so projects can later remove them by key.
  startingStoryModifiers?: Record<string, Modifier[]>;
  // Project id(s) auto-queued on the empire at game start — e.g. an
  // Emancipation empire begins already working toward completing it.
  startingProjectIds?: string[];
}

// Content-defined policy. Adopted at empire level for a one-shot
// political capital cost that scales with the empire's hyperlane
// diameter (spread-out empires pay more). Modifiers layer into
// storyModifiers under the key "policy:<id>".
export interface Policy {
  id: string;
  name: string;
  description: string;
  // Before diameter scaling.
  basePoliticalCost: number;
  modifiers: Modifier[];
  availability?: {
    speciesIds?: string[];
    expansionism?: Expansionism[];
    politic?: Politic[];
    requiresFlag?: string;
    excludesFlag?: string;
  };
}

// Content-defined project template. Distinct from BuildOrder (which is
// the in-flight queue entry).
//
// `scope` controls where the project lives in the UI:
//  - "empire": shown in the empire projects card, no body required.
//  - "body":   attached to a specific owned body; shown on its row.
//              `bodyRequirement` gates which body can host it.
export interface EmpireProject {
  id: string;
  name: string;
  description: string;
  hammersRequired: number;
  scope: "empire" | "body";
  bodyRequirement?: "capital" | "any_owned" | "star";
  // When true, multiple copies of this project can be queued on the
  // same target — useful for things like frigates where you might
  // want to build three in a row. Default (false) enforces the old
  // one-of-per-(project, body) dedupe.
  repeatable?: boolean;
  costs?: Partial<Resources>;
  art?: string;
  availability: {
    speciesIds?: string[];
    originIds?: string[];
    requiresFlag?: string;
    excludesFlag?: string;
    excludesCompleted?: boolean;
  };
  onComplete: {
    addFlag?: string;
    grantStoryModifiers?: Record<string, Modifier[]>;
    removeStoryModifierKeys?: string[];
    // Spawn N ships at the target body's system (body-scope projects
    // only). Absent for non-ship projects.
    spawnShip?: { count: number };
    chronicle: string;
  };
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
  // Chosen portrait URL (from the species' portraits list). Falls back to
  // the species default if unset.
  portraitArt?: string;
  // Archetype axes — determine AI behaviour, diplomacy rules, and the
  // modifiers layered on top of species + traits + story bundles.
  expansionism: Expansionism;
  politic: Politic;
  // Optional id of the Leader content object this empire was seeded
  // from. Present on AI empires; absent on the player empire (the
  // player assembles their archetype manually).
  leaderId?: string;
  capitalBodyId: string | null;
  systemIds: string[];       // Owned systems.
  projects: BuildOrder[];    // Empire-level project queue (FIFO).
  storyModifiers: Record<string, Modifier[]>;
  completedProjects: string[];
  adoptedPolicies: string[];
  flags: string[];
}

export interface PendingEvent {
  eventId: string;
  seed: number;
}

export interface GameState {
  schemaVersion: 19;
  turn: number;
  rngSeed: number;
  galaxy: Galaxy;
  empire: Empire;           // The player's empire.
  aiEmpires: Empire[];      // AI-controlled rivals.
  fleets: Record<string, Fleet>;
  // Ordered pairs of warring empires. Each pair is sorted by id so
  // lookups are canonical; membership is symmetric.
  wars: Array<[string, string]>;
  // Whose phase is currently resolving during a round. Null/undefined
  // between rounds. The store orchestrates round progression by
  // dispatching runPhase actions with pacing, advancing this id through
  // the turn order until it wraps back to null at end-of-round.
  currentPhaseEmpireId?: string | null;
  eventQueue: PendingEvent[];
  eventLog: Array<{ turn: number; eventId: string; choiceId: string | null; text: string }>;
  // Modal queue: a project just finished for the player and we want to
  // show its completion panel before returning to the normal flow.
  projectCompletions: Array<{ projectId: string; turn: number }>;
  // First-contact events the player hasn't seen yet. Each entry pops
  // a modal (or chronicle highlight) introducing the rival empire.
  pendingFirstContacts: Array<{ otherEmpireId: string; turn: number }>;
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
