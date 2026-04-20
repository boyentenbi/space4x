import type { SpeciesTrait } from "../sim/types";

// Traits are currently parked — species carry `traitIds: []` so none of
// these are applied in-game. Kept as content so a future player-pickable
// trait system can turn them back on.
export const TRAITS: SpeciesTrait[] = [
  {
    id: "agrarian",
    name: "Agrarian",
    description: "Ancient farming traditions flourish on any soil.",
    modifiers: [
      { kind: "perPop", resource: "food", value: 2 },
    ],
  },
  {
    id: "industrious",
    name: "Industrious",
    description: "Hard-working hands — more hammers per pop, and especially efficient on hostile worlds.",
    modifiers: [
      { kind: "hammersPerPopDelta", value: 0.25 },
    ],
  },
  {
    id: "charismatic",
    name: "Charismatic",
    description: "Diplomats talk their way into things. +1 political capital per turn at the empire level.",
    modifiers: [
      { kind: "flat", resource: "political", value: 1 },
    ],
  },
  {
    id: "solar_attuned",
    name: "Solar-Attuned",
    description: "Bodies that photosynthesize starlight directly. Bright suns help the most.",
    modifiers: [
      { kind: "perPop", resource: "energy", value: 1 },
      { kind: "habBonus", habitability: "temperate", resource: "energy", value: 1 },
    ],
  },
  {
    id: "efficient_cores",
    name: "Efficient Cores",
    description: "Dense computation runs cool. Lower pop upkeep, slower collective consensus.",
    modifiers: [
      { kind: "foodUpkeepDelta", value: -0.5 },
      { kind: "flat", resource: "political", value: -1 },
    ],
  },
];
