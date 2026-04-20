export type ResourceKey = "energy" | "minerals" | "food" | "influence" | "research";
export type Resources = Record<ResourceKey, number>;

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
}

export interface Origin {
  id: string;
  name: string;
  description: string;
  startingResources: Partial<Resources>;
  startingPops: number;
  flagEvents?: string[];
}

export interface Empire {
  name: string;
  speciesId: string;
  originId: string;
  resources: Resources;
  pops: number;
  flags: string[];
}

export interface PendingEvent {
  eventId: string;
  seed: number;
}

export interface GameState {
  schemaVersion: 1;
  turn: number;
  rngSeed: number;
  empire: Empire;
  eventQueue: PendingEvent[];
  eventLog: Array<{ turn: number; eventId: string; choiceId: string | null; text: string }>;
  gameOver: boolean;
}

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
  | { kind: "addPops"; value: number }
  | { kind: "addFlag"; flag: string }
  | { kind: "removeFlag"; flag: string }
  | { kind: "logText"; text: string };
