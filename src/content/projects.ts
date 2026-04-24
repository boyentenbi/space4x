import type { EmpireProject } from "../sim/types";

export const EMPIRE_PROJECTS: EmpireProject[] = [
  {
    id: "build_outpost",
    name: "Build Outpost",
    description:
      "Construct an orbital outpost at the system's star. Claims the system for your empire; required before you can colonise any planet here.",
    hammersRequired: 3000,
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
    hammersRequired: 5000,
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
    id: "build_defender",
    name: "Build Defender",
    description:
      "Emplace a stationary defender on this system's star station. Can't move, but counts double in combat and blocks enemy occupation while it lives. Stacks with other defenders here. Available on any system you own — no colonised planet required.",
    hammersRequired: 5000,
    scope: "body",
    bodyRequirement: "owned_star",
    costs: { political: 2 },
    repeatable: true,
    availability: {},
    onComplete: {
      spawnDefender: { count: 1 },
      chronicle: "A new defender emplaces.",
    },
  },
];

export function empireProjectById(id: string): EmpireProject | undefined {
  return EMPIRE_PROJECTS.find((p) => p.id === id);
}
