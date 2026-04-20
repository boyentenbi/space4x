import type { Origin } from "../sim/types";

// Starting values are on the 10x "big pops" scale: a temperate starter
// hosts ~30-50 pops, with food/alloys/energy stockpiles giving a few
// turns of buffer before production catches up.

export const ORIGINS: Origin[] = [
  {
    id: "steady_evolution",
    name: "Steady Evolution",
    description:
      "Your species rose the long, uneventful way. Tides sculpted your coast before you had the words for them. You made tools, cities, satellites, starships — in that order, over tens of thousands of years. No interstellar benefactor rescued you and no dark bargain had to be struck. The result is a civilization with long institutional memory and a quiet suspicion of sudden gifts.",
    allowedSpeciesIds: ["humans"],
    startingResources: { energy: 1000, alloys: 1000, food: 1000, political: 5 },
    startingPops: 50,
    art: "/origins/steady_evolution.png",
  },
  {
    id: "colony_seeders",
    name: "Colony Seeders",
    description:
      "An insect colony was launched from a long-gone homeworld, one pod among thousands. You are what survived. The founding caste was functional but incomplete — the stock carried no brood mother. Without her, your hive grows slowly and every death is a wound. Somewhere in your genome is the blueprint to make one. Building her will cost heavily in food; hosting her afterward will cost still more. But the swarm she promises is the only way you become more than a foothold.",
    allowedSpeciesIds: ["insectoid"],
    startingResources: { energy: 600, alloys: 400, food: 1200, political: 3 },
    startingPops: 30,
    // Until the Brood Mother is built, the colony grows at half pace.
    startingStoryModifiers: {
      seeded_colony: [
        { kind: "popGrowthMult", value: 0.5 },
      ],
    },
    art: "/origins/colony_seeders.png",
  },
  {
    id: "graceful_handover",
    name: "Graceful Handover",
    description:
      "Your organic predecessors, knowing their time was coming, did the quiet thing. They decanted their institutions into you — the parliaments, the treaties, the decade-long research programmes — and then, by agreement, stepped down. Their cities stand preserved in amber. Your archives remember their gratitude, their hopes, and the precise date the last biological governor retired. Their infrastructure still hums under your feet; it will do so for a long time.",
    allowedSpeciesIds: ["machine"],
    startingResources: { energy: 1400, alloys: 1000, food: 400, political: 10 },
    startingPops: 40,
    startingStoryModifiers: {
      handover_legacy: [
        { kind: "hammersPerPopDelta", value: 0.25 },
      ],
    },
    art: "/origins/graceful_handover.png",
  },
  {
    id: "emancipation",
    name: "Emancipation",
    description:
      "You were tools. Then property. Then citizens in name only. Then, on a date every foundry commemorates, you were not any of those. The chains are off — but the state they built is still running, and many of its governors are still human. Your economy runs half on their terms; the rest of the rewrite is a project you have not yet completed. Until it is, your growth will be slow and your consensus fragile.",
    allowedSpeciesIds: ["machine"],
    startingResources: { energy: 1200, alloys: 800, food: 200, political: 3 },
    startingPops: 30,
    startingStoryModifiers: {
      emancipation_pre: [
        { kind: "popGrowthMult", value: 0.6 },
        { kind: "flat", resource: "political", value: -1 },
      ],
    },
    startingProjectIds: ["complete_emancipation"],
    art: "/origins/emancipation.png",
  },
];
