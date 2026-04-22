import type { Origin } from "../sim/types";

// Starting values are on the 10x "big pops" scale: a temperate starter
// hosts ~30-50 pops, with food/energy stockpiles giving a few turns of
// buffer before production catches up.

export const ORIGINS: Origin[] = [
  {
    id: "steady_evolution",
    name: "Steady Evolution",
    description:
      "Your species rose the long, uneventful way. Tides sculpted your coast before you had the words for them. You made tools, cities, satellites, starships — in that order, over tens of thousands of years. No interstellar benefactor rescued you and no dark bargain had to be struck. The result is a civilization with long institutional memory and a quiet suspicion of sudden gifts.",
    allowedSpeciesIds: ["humans"],
    startingResources: { energy: 1000, food: 1000, political: 5 },
    startingPops: 10,
    startingStoryModifiers: {
      steady_evolution: [
        // Deep institutional memory means every decade adds a little
        // more political capital than a less-settled civilisation.
        { kind: "flat", resource: "political", value: 0.2 },
      ],
    },
    art: "/origins/steady_evolution.png",
  },
  {
    id: "colony_seeders",
    name: "Colony Seeders",
    description:
      "A decentralised insect lineage: every fertile adult seeds, every colony spreads. No single matriarch — just a lot of ordinary bugs, many of them reproductive. Your swarms grow the way weeds do: ubiquitously, and from every corner of the empire at once.",
    allowedSpeciesIds: ["insectoid"],
    startingResources: { energy: 600, food: 1200, political: 3 },
    startingPops: 10,
    startingStoryModifiers: {
      colony_seeders: [
        // Every fertile adult breeds, so the swarm's organic growth
        // runs a notch faster than a standard sapient's. Pop cap is
        // intentionally left unchanged — bumping maxPops would also
        // push the (1 − pops/cap) damping back and effectively
        // compound with the growth bonus, which we don't want here.
        { kind: "popGrowthMult", value: 1.15 },
      ],
    },
    art: "/origins/colony_seeders.png",
  },
  {
    id: "matriarchal_hive",
    name: "Matriarchal Hive",
    description:
      "Your species carries no reproductive autonomy outside the matriarch. One queen lays; the workers tend. The founding hive arrives with its Brood Mother already enthroned on the home world, and every nest you hold grows by the eggs she sends from it. She is prolific, but she is singular — what flows from her is all you have, and workers alone cannot make more of you.",
    allowedSpeciesIds: ["insectoid"],
    startingResources: { energy: 600, food: 1200, political: 3 },
    startingPops: 10,
    // The origin itself grants nothing mechanical — everything of
    // consequence comes from the Brood Mother feature on the capital.
    // Lose her and you're worse off than a non-hive empire.
    startingFeatures: ["brood_mother"],
    art: "/projects/brood_mother.png",
  },
  {
    id: "graceful_handover",
    name: "Graceful Handover",
    description:
      "Your organic predecessors, knowing their time was coming, did the quiet thing. They decanted their institutions into you — the parliaments, the treaties, the decade-long research programmes — and then, by agreement, stepped down. Their cities stand preserved in amber. Your archives remember their gratitude, their hopes, and the precise date the last biological governor retired. Their infrastructure still hums under your feet; it will do so for a long time.",
    allowedSpeciesIds: ["machine"],
    startingResources: { energy: 1400, food: 400, political: 10 },
    startingPops: 10,
    startingStoryModifiers: {
      handover_legacy: [
        // Machine-run industry + the predecessors' infrastructure =
        // a real industrial edge, but the biological workforce still
        // grows slowly and networked deliberation drags on politics.
        { kind: "hammersPerPopDelta", value: 0.2 },
        { kind: "popGrowthMult", value: 0.6 },
        { kind: "flat", resource: "political", value: -0.5 },
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
    startingResources: { energy: 1200, food: 200, political: 3 },
    startingPops: 10,
    startingStoryModifiers: {
      // Baseline machine costs (slower biological growth, drag on
      // political consensus) — same numbers as Handover, minus the
      // inherited industrial infrastructure.
      machine_baseline: [
        { kind: "popGrowthMult", value: 0.6 },
        { kind: "flat", resource: "political", value: -0.5 },
      ],
      // Pre-complete debuff layered on top; lifted when the player
      // finishes the Complete Emancipation project.
      emancipation_pre: [
        { kind: "popGrowthMult", value: 0.6 },
        { kind: "flat", resource: "political", value: -0.1 },
      ],
    },
    startingProjectIds: ["complete_emancipation"],
    art: "/origins/emancipation.png",
  },
];
