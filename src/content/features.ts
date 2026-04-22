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
    modifiers: [
      // Workers don't reproduce; the queen supplies everything.
      // Organic growth is zeroed empire-wide, so the only way to
      // grow past the queen's flat output is to conquer another
      // species whose pops can reproduce.
      { kind: "popGrowthMult", value: 0 },
      // +1 pop/turn per body. Fantastic early-game (a 3-body hive
      // sees +3 pops/turn out of a starting 30), but linear with
      // body count — an organic empire compounding over pops will
      // overtake this once it's established.
      { kind: "popGrowthAdd", value: 1 },
      // No food upkeep: she's meant to be a generous early-game
      // boost, not a costly investment. Her limit is structural
      // (she doesn't scale), not economic.
    ],
  },
];

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
