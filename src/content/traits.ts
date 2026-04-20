import type { SpeciesTrait } from "../sim/types";

export const TRAITS: SpeciesTrait[] = [
  {
    id: "industrious",
    name: "Industrious",
    description: "Hard-working hands and a keen sense for metallurgy.",
    modifiers: { alloys: 2 },
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
  {
    id: "efficient_cores",
    name: "Efficient Cores",
    description: "Dense computation with minimal waste heat.",
    modifiers: {},
  },
];
