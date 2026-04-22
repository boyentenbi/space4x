import type { EmpireProject } from "../sim/types";

export const EMPIRE_PROJECTS: EmpireProject[] = [
  {
    id: "build_outpost",
    name: "Build Outpost",
    description:
      "Construct an orbital outpost at the system's star. Claims the system for your empire; required before you can colonise any planet here.",
    hammersRequired: 120,
    scope: "body",
    bodyRequirement: "star",
    costs: { political: 3 },
    availability: {
      // Not repeatable per-star; canQueueProjectFor dedupes.
    },
    onComplete: {
      chronicle: "Outpost online.",
    },
  },
  {
    id: "build_frigate",
    name: "Build Frigate",
    description:
      "Assemble a frigate at this world's orbital yards. Joins the system's fleet on completion. The start of a navy.",
    hammersRequired: 200,
    scope: "body",
    bodyRequirement: "any_owned",
    costs: { political: 2 },
    repeatable: true,
    availability: {
      // Repeatable: multiple frigates can be queued on the same body.
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
];

export function empireProjectById(id: string): EmpireProject | undefined {
  return EMPIRE_PROJECTS.find((p) => p.id === id);
}
