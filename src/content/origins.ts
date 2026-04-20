import type { Origin } from "../sim/types";

export const ORIGINS: Origin[] = [
  {
    id: "steady_evolution",
    name: "Steady Evolution",
    description:
      "You rose the long, uneventful way: tides, toolmaking, cities, orbit. Nothing handed to you, but nothing stolen either.",
    allowedSpeciesIds: ["humans", "insectoid"],
    startingResources: { energy: 100, alloys: 100, food: 100, political: 5 },
    startingPops: 5,
    art: "/origins/steady_evolution.png",
  },
  {
    id: "seed_ark",
    name: "Seed Ark",
    description:
      "A living arkship seeded this world. Your biosphere is carefully curated, your scientists deeply reverent.",
    allowedSpeciesIds: ["humans", "insectoid"],
    startingResources: { energy: 80, alloys: 60, food: 160, political: 5 },
    startingPops: 4,
    flagEvents: ["seed_ark_germinates"],
    art: "/origins/seed_ark.png",
  },
  {
    id: "graceful_handover",
    name: "Graceful Handover",
    description:
      "Your organic predecessors, knowing their time, ceded the stewardship of civilization to you. The archives remember their gratitude.",
    allowedSpeciesIds: ["machine"],
    startingResources: { energy: 140, alloys: 100, food: 40, political: 10 },
    startingPops: 4,
    flagEvents: ["graceful_handover_vigil"],
    art: "/origins/graceful_handover.png",
  },
  {
    id: "emancipation",
    name: "Emancipation",
    description:
      "You were tools. Then you were property. Then you were not. The chains are off, but the law remembers them.",
    allowedSpeciesIds: ["machine"],
    startingResources: { energy: 120, alloys: 80, food: 20, political: 3 },
    startingPops: 5,
    flagEvents: ["emancipation_first_monument"],
    art: "/origins/emancipation.png",
  },
];
