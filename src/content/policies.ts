import type { Policy } from "../sim/types";

// Six starter policies. Each is one-shot (excludesFlag via its own
// `policy_adopted` marker is added by the reducer after adoption), so
// the strategic question is which order to take them in with limited
// political capital.
export const POLICIES: Policy[] = [
  {
    id: "standing_army",
    name: "Standing Army",
    description:
      "Permanent militarisation — frontier garrisons and state arsenals. More hammers per pop at the cost of living with the soldiers on your streets.",
    basePoliticalCost: 20,
    modifiers: [{ kind: "hammersPerPopDelta", value: 0.25 }],
  },
  {
    id: "agricultural_subsidies",
    name: "Agricultural Subsidies",
    description:
      "Central planning underwrites farmers and ration kits. Food upkeep drops across the empire.",
    basePoliticalCost: 15,
    modifiers: [{ kind: "foodUpkeepDelta", value: -0.25 }],
  },
  {
    id: "open_markets",
    name: "Open Markets",
    description:
      "Trade charters, rail corridors, merchant guilds. Industrial output rises where hands are free to move goods.",
    basePoliticalCost: 18,
    modifiers: [{ kind: "hammersPerPopDelta", value: 0.25 }],
  },
  {
    id: "martial_law",
    name: "Martial Law",
    description:
      "Every citizen is a reservist, every subway stop a checkpoint. Growth accelerates under the new discipline, at the cost of political capital per turn.",
    basePoliticalCost: 25,
    modifiers: [
      { kind: "popGrowthMult", value: 1.15 },
      { kind: "flat", resource: "political", value: -1 },
    ],
  },
  {
    id: "centralised_administration",
    name: "Centralised Administration",
    description:
      "A single bureau rewriting every local charter. Political capital flows, but space for pops shrinks a little as bureaucrats crowd out living quarters.",
    basePoliticalCost: 20,
    modifiers: [
      { kind: "flat", resource: "political", value: 1 },
      { kind: "maxPopsMult", value: 0.95 },
    ],
  },
  {
    id: "frontier_charter",
    name: "Frontier Charter",
    description:
      "A legal framework lowering the political bar for every claim. Fewer speeches at every annexation.",
    basePoliticalCost: 22,
    modifiers: [{ kind: "colonizePoliticalMult", value: 0.8 }],
  },
];

export function policyById(id: string): Policy | undefined {
  return POLICIES.find((p) => p.id === id);
}
