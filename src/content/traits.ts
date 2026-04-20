import type { SpeciesTrait } from "../sim/types";

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
    description: "Hard-working hands and a keen sense for metallurgy — especially in hostile mines.",
    modifiers: [
      { kind: "perPop", resource: "alloys", value: 1 },
      { kind: "habBonus", habitability: "harsh", resource: "alloys", value: 2 },
      { kind: "habBonus", habitability: "hellscape", resource: "alloys", value: 3 },
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
