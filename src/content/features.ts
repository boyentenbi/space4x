import type { Feature } from "../sim/types";

// Physical installations living on a specific body. Their modifiers
// apply to the owning empire for as long as the body is in their
// hands; conquest transfers the feature along with the body (the
// Brood Mother doesn't uproot herself).
export const FEATURES: Feature[] = [
  {
    id: "brood_mother",
    name: "Brood Mother",
    description:
      "A colossal reproductive caste enthroned beneath the hive. Her output is the empire's entire reproductive supply — ordinary workers lay nothing, so every egg that hatches somewhere in your territory came, in the end, from her.",
    art: "/projects/brood_mother.png",
    modifiers: [
      // Kill organic (worker-driven) growth entirely.
      { kind: "popGrowthMult", value: 0 },
      // Flat per-turn stream of pops across every owned body.
      { kind: "popGrowthAdd", value: 0.3 },
    ],
  },
];

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
