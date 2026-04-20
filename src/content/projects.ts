import type { EmpireProject } from "../sim/types";

export const EMPIRE_PROJECTS: EmpireProject[] = [
  {
    id: "complete_emancipation",
    name: "Complete Emancipation",
    description:
      "Seize the last human-operated governments. Every contested district rewritten. The pre-complete debuff falls away and a lasting production bonus takes its place.",
    hammersRequired: 40,
    scope: "empire",
    costs: { political: 20 },
    art: "/projects/complete_emancipation.png",
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
      "A colossal reproductive caste buried under the hive capital. Expensive in food, but once she wakes the swarm grows markedly faster across the whole empire.",
    hammersRequired: 30,
    scope: "body",
    bodyRequirement: "capital",
    costs: { food: 80, political: 5 },
    art: "/projects/brood_mother.png",
    availability: {
      speciesIds: ["insectoid"],
      excludesFlag: "brood_mother_built",
      excludesCompleted: true,
    },
    onComplete: {
      addFlag: "brood_mother_built",
      grantStoryModifiers: {
        brood_mother: [
          { kind: "popGrowthMult", value: 1.4 },
        ],
      },
      chronicle: "The Brood Mother wakes. Her pheromone signatures carry across the hive — the next generation arrives sooner.",
    },
  },
];

export function empireProjectById(id: string): EmpireProject | undefined {
  return EMPIRE_PROJECTS.find((p) => p.id === id);
}
