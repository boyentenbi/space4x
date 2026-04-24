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
      "A colossal reproductive caste enthroned beneath the hive. Her output is the empire's entire reproductive supply — ordinary workers lay nothing, so every egg that hatches somewhere in your territory came, in the end, from her. She gives the swarm a decisive early lead, but her flat output doesn't scale; the only path past her is to absorb species that can breed on their own.",
    art: "/projects/brood_mother.png",
    empireModifiers: [
      // Workers empire-wide don't reproduce — no hive can breed
      // without her. Organic growth is zeroed everywhere.
      { kind: "popGrowthMult", value: 0 },
    ],
    bodyModifiers: [
      // She lays eggs where she lives, not in every nest. +1 pop/
      // turn only on the body she's installed on. Linear with
      // feature count (i.e. currently 1), so an organic empire
      // compounding over its pops will eventually overtake this.
      { kind: "popGrowthAdd", value: 1 },
      // The capital becomes a megacolony to house the queen's
      // output — +200 max pops on the host body only.
      { kind: "maxPopsDelta", value: 200 },
    ],
  },
  {
    id: "super_brood_mother",
    name: "Great Matriarch",
    description:
      "The Brood Mother you kept. The pretender's body was folded into hers; her output tripled. The hive's entire future flows from one chamber, and the empire's fortunes with it. Rivals who expected the split to weaken you find the opposite.",
    art: "/projects/brood_mother.png",
    empireModifiers: [
      { kind: "popGrowthMult", value: 0 },
    ],
    bodyModifiers: [
      { kind: "popGrowthAdd", value: 3 },
      { kind: "maxPopsDelta", value: 400 },
    ],
  },
];

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
