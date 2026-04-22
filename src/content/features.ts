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
      // formula). Across a multi-body empire this is prolific.
      { kind: "popGrowthAdd", value: 1 },
      // She consumes heroically — the empire pays 5 food/turn to
      // keep her alive. Starve her and the whole hive collapses.
      { kind: "flat", resource: "food", value: -5 },
    ],
  },
];

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
