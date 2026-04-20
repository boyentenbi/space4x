import type { EmpireProject, GameEvent, Leader, Origin, Species, SpeciesTrait } from "./types";
import { ORIGINS } from "../content/origins";
import { SPECIES } from "../content/species";
import { TRAITS } from "../content/traits";
import { EVENTS } from "../content/events";
import { EMPIRE_PROJECTS, empireProjectById } from "../content/projects";
import { LEADERS, leaderById, leadersForSpecies } from "../content/leaders";
import { POLICIES, policyById } from "../content/policies";

export { ORIGINS, SPECIES, TRAITS, EVENTS, EMPIRE_PROJECTS, LEADERS, POLICIES, empireProjectById, leaderById, leadersForSpecies, policyById };

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
export function projectById(id: string): EmpireProject | undefined {
  return empireProjectById(id);
}
export function leaderContentById(id: string): Leader | undefined {
  return leaderById(id);
}
