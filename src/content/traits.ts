import type { SpeciesTrait } from "../sim/types";

export const TRAITS: SpeciesTrait[] = [
  {
    id: "industrious",
    name: "Industrious",
    description: "Hard-working hands and deep mineral intuition.",
    modifiers: { minerals: 2 },
  },
  {
    id: "intelligent",
    name: "Intelligent",
    description: "Rapid insight accelerates research.",
    modifiers: { research: 2 },
  },
  {
    id: "agrarian",
    name: "Agrarian",
    description: "Ancient farming traditions flourish on any soil.",
    modifiers: { food: 2 },
  },
  {
    id: "charismatic",
    name: "Charismatic",
    description: "A natural talent for diplomacy and influence.",
    modifiers: { influence: 1 },
  },
  {
    id: "solar_attuned",
    name: "Solar-Attuned",
    description: "Bodies that photosynthesize starlight directly.",
    modifiers: { energy: 2 },
  },
];
