import type { GameEvent, Origin, Species, SpeciesTrait } from "./types";
import originsData from "../content/origins.json";
import speciesData from "../content/species.json";
import traitsData from "../content/traits.json";
import eventsData from "../content/events.json";

export const ORIGINS: Origin[] = originsData as Origin[];
export const SPECIES: Species[] = speciesData as Species[];
export const TRAITS: SpeciesTrait[] = traitsData as SpeciesTrait[];
export const EVENTS: GameEvent[] = eventsData as GameEvent[];

export function originById(id: string): Origin | undefined {
  return ORIGINS.find((o) => o.id === id);
}
export function speciesById(id: string): Species | undefined {
  return SPECIES.find((s) => s.id === id);
}
export function traitById(id: string): SpeciesTrait | undefined {
  return TRAITS.find((t) => t.id === id);
}
export function eventById(id: string): GameEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}
