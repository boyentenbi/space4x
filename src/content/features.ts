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
      "A colossal reproductive caste enthroned beneath the hive. Her output is the empire's entire reproductive supply — ordinary workers lay nothing, so every egg that hatches somewhere in your territory came, in the end, from her. She eats accordingly.",
    art: "/projects/brood_mother.png",
    modifiers: [
      // Workers don't reproduce; the queen supplies everything.
      { kind: "popGrowthMult", value: 0 },
      // +1 pop/turn per body (throttled by headroom via the growth
      // formula). Roughly what a population of ~80 pops would produce
      // via organic growth at the baseline doubling time.
      { kind: "popGrowthAdd", value: 1 },
      // Calibrated so she eats roughly what it would cost to feed the
      // equivalent organic population (≈ target pop count × base
      // upkeep). Big drain, but not crippling on a well-fed garden.
      { kind: "flat", resource: "food", value: -40 },
    ],
  },
];

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
