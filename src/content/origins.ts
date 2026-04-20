import type { Origin } from "../sim/types";

export const ORIGINS: Origin[] = [
  {
    id: "lost_colony",
    name: "Lost Colony",
    description:
      "Cut off from a long-fallen founder civilization. The old records are fragments, but the infrastructure still hums.",
    startingResources: { energy: 120, minerals: 120, food: 80, research: 20 },
    startingPops: 5,
    flagEvents: ["lost_colony_signal"],
  },
  {
    id: "seed_ark",
    name: "Seed Ark",
    description:
      "A living arkship seeded this world. Your biosphere is carefully curated, your scientists deeply reverent.",
    startingResources: { energy: 80, minerals: 60, food: 160, research: 40 },
    startingPops: 4,
    flagEvents: ["seed_ark_germinates"],
  },
  {
    id: "shattered_ring",
    name: "Shattered Ring",
    description:
      "You live on the surviving arc of a ring megastructure. The rest is debris, rumors, and unexploded weapons.",
    startingResources: { energy: 200, minerals: 40, food: 60, research: 40 },
    startingPops: 3,
    flagEvents: ["shattered_ring_salvage"],
  },
  {
    id: "diplomatic_compact",
    name: "Diplomatic Compact",
    description:
      "Your homeworld was founded by a treaty between three species. Arguing is a sacred tradition.",
    startingResources: { energy: 100, minerals: 80, food: 100, influence: 15 },
    startingPops: 4,
  },
  {
    id: "void_refugees",
    name: "Void Refugees",
    description:
      "You fled something terrible. No one agrees on what. Your fleet is hardy; your politics, tense.",
    startingResources: { energy: 60, minerals: 100, food: 60, research: 10 },
    startingPops: 6,
    flagEvents: ["void_refugees_memory"],
  },
];
