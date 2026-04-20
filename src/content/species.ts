import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. They fold into any biome, breed in any climate, and recover from setbacks faster than their neighbours realise. A loose constitutional habit keeps them arguing; the arguments keep them moving.",
    traitIds: ["charismatic"],
    art: "/portraits/humans.png",
    portraits: [
      "/portraits/humans.png",
      "/portraits/humans_2.png",
      "/portraits/humans_3.png",
    ],
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
    portraits: [
      "/portraits/insectoid.png",
      "/portraits/insectoid_2.png",
      "/portraits/insectoid_3.png",
    ],
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
      "Ruled by networked synthetic minds but populated by a biological workforce. AI administrators coordinate every shift, model every supply chain, and optimize production down to the joule — your people output more per head than any flesh-only rival. Biology still grows at biology's pace, and the machine networks deliberate slowly over any question not purely operational.",
    traitIds: ["solar_attuned", "efficient_cores"],
    art: "/portraits/machine.png",
    portraits: [
      "/portraits/machine.png",
      "/portraits/machine_2.png",
      "/portraits/machine_3.png",
    ],
    color: "#62d4e6",
    modifiers: [
      { kind: "hammersPerPopDelta", value: 0.5 },
      { kind: "popGrowthMult", value: 0.6 },
      { kind: "flat", resource: "political", value: -0.5 },
    ],
  },
];
