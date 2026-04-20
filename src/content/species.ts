import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. They fold into any biome, breed in any climate, and recover from setbacks faster than their neighbours realise. A loose constitutional habit keeps them arguing; the arguments keep them moving.",
    traitIds: ["charismatic"],
    art: "/portraits/humans.png",
    color: "#2a5a8c",
    modifiers: [
      // Adaptable: faster pop growth. Fleet bonus reserved for when fleets land.
      { kind: "popGrowthMult", value: 1.25 },
    ],
  },
  {
    id: "insectoid",
    name: "Insectoid",
    description:
      "A chitinous hive-species that nests vertically as well as horizontally. Cities fit more of them per acre than any other species can manage, and they subsist on less — synchronized shifts leave almost nothing on the plate. Surface-unfriendly worlds hold no terror for them.",
    traitIds: ["agrarian", "industrious"],
    art: "/portraits/insectoid.png",
    color: "#8b5bc8",
    modifiers: [
      { kind: "spaceMult", value: 1.5 },
      { kind: "foodUpkeepDelta", value: -0.25 },
    ],
  },
  {
    id: "machine",
    name: "Machine Intelligence",
    description:
      "Networked synthetic minds. Their mechanized bodies outwork any flesh crew in a foundry, but growing the population requires building it — patiently, instance by instance. Consensus across the network is slow and deliberate, and petitions take time to propagate.",
    traitIds: ["solar_attuned", "efficient_cores"],
    art: "/portraits/machine.png",
    color: "#62d4e6",
    modifiers: [
      { kind: "hammersPerPopDelta", value: 0.5 },
      { kind: "popGrowthMult", value: 0.6 },
      { kind: "flat", resource: "political", value: -0.5 },
    ],
  },
];
