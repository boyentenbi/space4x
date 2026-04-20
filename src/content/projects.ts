import type { EmpireProject } from "../sim/types";

export const EMPIRE_PROJECTS: EmpireProject[] = [
  {
    id: "build_frigate",
    name: "Build Frigate",
    description:
      "Assemble a frigate at this world's orbital yards. Joins the system's fleet on completion. The start of a navy.",
    hammersRequired: 200,
    scope: "body",
    bodyRequirement: "any_owned",
    costs: { alloys: 100, political: 2 },
    availability: {
      // Repeatable: no excludesFlag, no excludesCompleted.
    },
    onComplete: {
      spawnShip: { count: 1 },
      chronicle: "A new frigate joins the fleet.",
    },
  },
  {
    id: "complete_emancipation",
    name: "Complete Emancipation",
    description:
      "Seize the last human-operated governments. Every contested district rewritten. The pre-complete debuff falls away and a lasting production bonus takes its place.",
    hammersRequired: 400,
    scope: "body",
    bodyRequirement: "capital",
    costs: { political: 20 },
    // Reuse the origin scene so the completion moment visually lands on
    // the same illustration the player started with.
    art: "/origins/emancipation.png",
    availability: {
      originIds: ["emancipation"],
      excludesFlag: "emancipation_completed",
    },
    onComplete: {
      addFlag: "emancipation_completed",
      removeStoryModifierKeys: ["emancipation_pre"],
      grantStoryModifiers: {
        emancipation_post: [
          { kind: "hammersPerPopDelta", value: 0.5 },
          { kind: "flat", resource: "political", value: 1 },
        ],
      },
      chronicle: "Emancipation complete. The old governments are gone; the forges run at full speed.",
    },
  },
  {
    id: "brood_mother",
    name: "Construct a Brood Mother",
    description:
      "Grow a colossal reproductive caste beneath the hive capital. A heavy up-front food cost, and she continues to draw food per turn while she lives — but the swarm grows markedly faster across the whole empire, and the seeded-colony growth penalty is lifted.",
    hammersRequired: 400,
    scope: "body",
    bodyRequirement: "capital",
    costs: { food: 1200, political: 5 },
    art: "/projects/brood_mother.png",
    availability: {
      originIds: ["colony_seeders"],
      excludesFlag: "brood_mother_built",
      excludesCompleted: true,
    },
    onComplete: {
      addFlag: "brood_mother_built",
      removeStoryModifierKeys: ["seeded_colony"],
      grantStoryModifiers: {
        brood_mother: [
          // Flat per-turn probability added to every body's growth roll
          // before multipliers. Keeps growth steady even on near-full
          // bodies while still benefiting from other mults.
          { kind: "popGrowthAdd", value: 0.15 },
          { kind: "flat", resource: "food", value: -50 },
        ],
      },
      chronicle: "The Brood Mother wakes. Her pheromone signatures carry across the hive — the next generation arrives sooner, though the cost of keeping her fed is considerable.",
    },
  },
];

export function empireProjectById(id: string): EmpireProject | undefined {
  return EMPIRE_PROJECTS.find((p) => p.id === id);
}
