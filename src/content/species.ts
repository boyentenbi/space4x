import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. Curious, argumentative, disproportionately fond of flags.",
    traitIds: ["charismatic"],
    art: "/portraits/humans.png",
    color: "#2a5a8c",
    modifiers: [
      // Adaptable: faster pop growth. Fleet bonus coming when fleets land.
      { kind: "popGrowthMult", value: 1.25 },
    ],
  },
  {
    id: "insectoid",
    name: "Insectoid",
    description:
      "A chitinous hive-species with synchronized shifts and an unsettling talent for agriculture.",
    traitIds: ["agrarian", "industrious"],
    art: "/portraits/insectoid.png",
    color: "#8b5bc8",
    modifiers: [
      // Hive compactness: more pops fit per body, and they eat less.
      { kind: "spaceMult", value: 1.5 },
      { kind: "foodUpkeepDelta", value: -0.25 },
    ],
  },
  {
    id: "machine",
    name: "Machine Intelligence",
    description:
      "Networked synthetic minds. Patient, precise, and legally complicated.",
    traitIds: ["solar_attuned", "efficient_cores"],
    art: "/portraits/machine.png",
    color: "#62d4e6",
    modifiers: [
      // Higher per-pop output via mechanization...
      { kind: "hammersPerPopDelta", value: 0.5 },
      // ...but slower political consensus and slower biomass growth.
      { kind: "popGrowthMult", value: 0.6 },
      { kind: "flat", resource: "political", value: -0.5 },
    ],
  },
];
