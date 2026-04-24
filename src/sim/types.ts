// =====================================================================
// Resources
// =====================================================================
// Empire-wide stocks (accumulate across turns).
// Industrial output is tracked as hammers (flow resource) — alloys has
// been retired. Remaining stock resources: food, energy, political.
// All three pool empire-wide; the per-component "logistics layer" has
// been retired to keep the model simple while there's no gameplay
// loop (blockades, connectivity plays) that relies on it.
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
  // Movement is exclusively an end-of-turn world-update: players and
  // AIs set destinations via setFleetDestination and the auto-stepper
  // (processFleetOrders) accumulates hopProgress each turn, performing
  // a hop and resetting progress to 0 once it reaches TURNS_PER_HOP.
  // Setting/clearing destinationSystemId also resets hopProgress —
  // changing course aborts the in-flight jump.
  destinationSystemId?: string;
  // Turns of progress accumulated toward the next hop. Defaults to 0
  // when undefined (omitted to keep saves compact for fleets that
  // aren't moving).
  hopProgress?: number;
  // Player UI flag. A sleeping fleet is considered "handled" by
  // autoplay — it doesn't trigger the "idle fleet needs orders"
  // auto-stop condition. Pure UI state; the sim ignores it.
  sleeping?: boolean;
  // Auto-discover mode. Each turn the fleet's owning phase runs a
  // small chooser that sets a destination to the nearest discovered-
  // but-not-yet-surveyed system, pushing the frontier outward
  // without player intervention. Like `sleeping` it exempts the
  // fleet from the idle-fleet attention check; unlike sleeping it
  // actually drives movement.
  autoDiscover?: boolean;
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
  // Features installed on this body (e.g. "brood_mother"). Each
  // feature is content-defined in src/content/features.ts and
  // contributes its modifiers to the owning empire while the body is
  // in that empire's hands. Features survive ownership transfer
  // (the infrastructure is physically here). Defaults to [].
  features: string[];
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
  // Stationary garrison units owned by the system's owner. They don't
  // participate in fleet movement, stack with themselves (single count),
  // never stack with frigates. In combat each defender counts for
  // DEFENDER_SHIPS_EQUIV frigate-ship-equivalents. While any are alive
  // they block the occupation tick — an attacker must reduce this to 0
  // before the invader-occupies-my-system counter can advance. Cleared
  // to 0 on ownership flip.
  defenders?: number;
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
  // Flat add to a body's max-pops cap. Applies body-local when the
  // modifier comes from a Feature's bodyModifiers; applies empire-
  // wide to every body when in empireModifiers.
  | { kind: "maxPopsDelta"; value: number }
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
  // Pool of unique display names for empires of this species. newGame
  // picks one per empire (without replacement) so multiple human
  // empires read as distinct peoples ("Terrans" vs "Concordians")
  // rather than both being generically "Humans". When empty or the
  // pool is exhausted, UI falls back to the species' `name`.
  namePool?: string[];
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
  // Feature id(s) pre-installed on the empire's capital body at new
  // game — e.g. Matriarchal Hive spawns with a Brood Mother already
  // enthroned on the home world.
  startingFeatures?: string[];
}

// Content-defined policy. Adopted at empire level for a one-shot
// political capital cost that scales with the empire's hyperlane
// diameter (spread-out empires pay more). Modifiers layer into
// storyModifiers under the key "policy:<id>".
// Content-defined feature. Features are physical installations that
// live on a specific body — a Brood Mother, a Precursor Vault, an
// Orbital Habitat. Modifiers come in two scopes:
//   - empireModifiers: apply empire-wide while the feature is owned
//     (e.g. "all hive workers stop reproducing").
//   - bodyModifiers: apply only to calculations on the host body
//     (e.g. "this body gains +1 pop/turn flat" — the queen only
//     lays where she's enthroned).
// Features survive conquest (the infrastructure is physically there).
export interface Feature {
  id: string;
  name: string;
  description: string;
  art?: string;
  empireModifiers?: Modifier[];
  bodyModifiers?: Modifier[];
}

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
  bodyRequirement?: "capital" | "any_owned" | "star" | "owned_star";
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
    // Spawn N stationary defenders on the target body's system. The
    // defenders belong to the project-queueing empire (which must own
    // the system; enforced at completion time).
    spawnDefender?: { count: number };
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
  // Per-empire display name for this empire's species. Decoupled
  // from the template Species — newGame picks a unique name per
  // empire from a template-specific pool so e.g. two human empires
  // might be "Terrans" and "Concordians" rather than both "Humans".
  // When undefined, UI falls back to the template's `name`.
  speciesName?: string;
  originId: string;
  color: string;             // Territory/UI color. Derived from species at new game.
  // Empire-wide stocks. Flat (no per-component logistics layer).
  food: number;
  energy: number;
  political: number;
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
  storyModifiers: Record<string, Modifier[]>;
  // Optional expiry turn per storyModifier key. When state.turn
  // reaches or exceeds the stored value, applyBeginRound strips the
  // bundle from storyModifiers AND the entry here. Keys without an
  // expiry are permanent (the default). Shape is Record not Map so
  // JSON save/load keeps working.
  storyModifierExpiries?: Record<string, number>;
  completedProjects: string[];
  adoptedPolicies: string[];
  flags: string[];
  // All fog-of-war state lives here. Nested so produce() in lookahead
  // never touches it: scoring reads empire.perception.* from the
  // projection and gets the plan-time snapshot by structural sharing.
  perception: Perception;
}

export interface PendingEvent {
  eventId: string;
  seed: number;
}

// Per-empire fog-of-war record: the last-seen state of one system.
// Refreshed each turn the system is in sensor range; otherwise stale.
export interface SystemSnapshot {
  turn: number;                       // Turn this snapshot was taken.
  ownerId: string | null;             // Last-seen owner.
  // Aggregated by empire — we don't track individual fleet ids in the
  // snapshot, just totals per empire present in the system.
  fleets: Array<{ empireId: string; shipCount: number }>;
  // Last-seen garrison count (belongs to ownerId). Feeds AI threat
  // estimation for systems the empire isn't currently present in.
  defenders?: number;
}

// Per-empire perception: everything about "what this empire knows",
// kept together in one sub-object so lookahead can reason about it as
// a unit. Immer's structural sharing means that if a produce() block
// never mutates `perception`, the projected state's perception is
// literally the same reference as baseline's — so reads inside
// scoreState are automatically frozen at plan-time. This is the
// foundation of the no-info-leak guarantee.
export interface Perception {
  // Every system this empire has ever observed (monotonic).
  discovered: string[];
  // Last-seen state of each discovered system.
  snapshots: Record<string, SystemSnapshot>;
  // Body ids whose flavour flags the empire has seen (requires a
  // fleet to have been physically in that body's system at least
  // once — precursor ruins and rare crystals aren't detectable from
  // orbit).
  seenFlavour: string[];
  // System ids this empire has ever physically touched (owned OR
  // had a fleet inside). Distinct from `discovered` — this is a
  // *presence* record, not a *sensor* record. The scouting term in
  // scoreState reads from surveyed because it's leak-free under
  // lookahead: the projection can't silently expand it the way
  // sensor does (updateVisibility doesn't run inside produce()).
  surveyed: string[];
}

// Brand type for the output of `filterStateFor`. Runtime shape is
// identical to GameState (same field layout; redaction zeroes other
// empires' private fields for defense-in-depth), but the compiler
// treats it as a distinct type. Callers of scoreState /
// aiEnumerateProjectActions cannot pass a raw GameState — they must
// go through `filterStateFor`, which is where all fog gating lives.
// The brand carries the empire id it was filtered for so we can
// assert matching context when needed.
declare const __perceivedBrand: unique symbol;
export type PerceivedGameState = GameState & {
  readonly [__perceivedBrand]: { readonly empireId: string };
};

export interface GameState {
  schemaVersion: 31;
  turn: number;
  rngSeed: number;
  galaxy: Galaxy;
  // All empires in play. The sim treats every empire identically;
  // there's no "player slot." Whether any of them is human-driven
  // is signalled by `humanEmpireId` below — used only for things
  // that genuinely need to know (random events / first-contact
  // modals fire only for the human; chronicle phrasing uses "you"
  // for the human; gameOver fires when the human is eliminated).
  // When humanEmpireId is undefined, the sim runs fully headless
  // (rollouts) and those player-only paths are inert.
  empires: Empire[];
  // Optional id of the empire under human control. Off → headless.
  humanEmpireId?: string;
  fleets: Record<string, Fleet>;
  // Ordered pairs of warring empires. Each pair is sorted by id so
  // lookups are canonical; membership is symmetric.
  wars: Array<[string, string]>;
  // Whose phase is currently resolving during a round. Null/undefined
  // between rounds. The store orchestrates round progression by
  // dispatching runPhase actions with pacing, advancing this id through
  // the turn order until it wraps back to null at end-of-round.
  currentPhaseEmpireId?: string | null;
  // Random events queued for the human empire. Headless → empty
  // (no events fire when there's nobody to surface them to).
  eventQueue: PendingEvent[];
  eventLog: Array<{ turn: number; eventId: string; choiceId: string | null; text: string }>;
  // Modal queue: a project just finished for the human empire.
  projectCompletions: Array<{ projectId: string; turn: number }>;
  // First-contact events the human empire hasn't seen yet.
  pendingFirstContacts: Array<{ otherEmpireId: string; turn: number }>;
  // Wars declared ON the human that haven't been acknowledged yet.
  // Only populated when the human is the *defender* (when they're
  // the aggressor they already know — they just clicked the button).
  // aggressorEmpireId is the empire that declared war on us.
  pendingWarDeclarations: Array<{ aggressorEmpireId: string; turn: number }>;
  // True once the human empire has lost its last system. In headless
  // mode (no human), use external termination criteria instead
  // (e.g. last empire standing).
  gameOver: boolean;
  // True once the human empire is the last one standing. Permanent
  // truth like gameOver — blocks further turns. Headless games never
  // set this (no human to win).
  victory: boolean;
  // Player has dismissed the victory modal. Separate from `victory`
  // so the modal only fires once even though the win flag is sticky.
  victoryAcknowledged: boolean;
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
  // When true, this event is pushed into eventQueue at newGame time
  // for every empire where `requires` is met — bypassing the end-of-
  // round random roll. Used for opening-scene events that set up an
  // origin's premise (e.g. the Handover modal explaining the machine
  // bloc's founding compact). Exactly one per origin is the pattern.
  startOfGame?: boolean;
  // Optional near-fullscreen art shown at the top of the modal.
  // When set, EventModal renders its "big" variant — art fills most
  // of the screen with text + choices overlaid at the bottom, for
  // climactic moments (rival hatches, the sacrifice, first contact-
  // grade events). When absent, the standard compact modal layout
  // is used.
  art?: string;
}

export type Condition =
  | { kind: "hasFlag"; flag: string }
  | { kind: "lacksFlag"; flag: string }
  | { kind: "minResource"; resource: ResourceKey; value: number }
  | { kind: "originIs"; originId: string }
  | { kind: "turnAtLeast"; value: number }
  // True when the empire has `value` or more colonised pops on its
  // capital body. Useful for "the hive is big enough now" gates.
  | { kind: "popsAtCapitalAtLeast"; value: number }
  // True when the empire has `value` or more bodies carrying the
  // given feature across its territory. Used for end-game Brood
  // Mother events that only fire after a rival queen has been
  // exiled into a second body.
  | { kind: "featureCountAtLeast"; featureId: string; value: number }
  // True when the empire's food stockpile is below `value`.
  | { kind: "foodBelow"; value: number };

export type Effect =
  | { kind: "addResource"; resource: ResourceKey; value: number }
  | { kind: "addPops"; value: number }        // Added to capital body.
  | { kind: "addFlag"; flag: string }
  | { kind: "removeFlag"; flag: string }
  | { kind: "logText"; text: string }
  // Spawn frigate-class ships at the empire's capital system.
  | { kind: "addShips"; value: number }
  // Add stationary defenders to the capital system.
  | { kind: "addDefenders"; value: number }
  // Install a feature on the capital body. No-op if the feature is
  // already installed there.
  | { kind: "grantFeatureOnCapital"; featureId: string }
  // Remove a feature from the capital body. No-op if absent.
  | { kind: "removeFeatureFromCapital"; featureId: string }
  // Spread a feature across the empire: try the capital first, then
  // any other owned body that doesn't already have it — pick the
  // most-populated eligible body. No-op if every owned body already
  // has it or the empire has no other bodies.
  | { kind: "grantFeatureOnSecondBody"; featureId: string }
  // Install a story-modifier bundle keyed by `key`. When
  // `durationTurns` is set, the bundle is recorded in
  // storyModifierExpiries and automatically lifted at state.turn
  // reaching `state.turn + durationTurns` in a later applyBeginRound.
  // Absent duration = permanent (lifted only by an explicit lift).
  | { kind: "grantStoryModifier"; key: string; modifiers: Modifier[]; durationTurns?: number }
  // Explicitly remove a story-modifier bundle by key.
  | { kind: "liftStoryModifier"; key: string };
