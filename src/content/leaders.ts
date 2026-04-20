import type { Leader } from "../sim/types";

// Nine pre-written leaders, one per portrait we have. Each bundles a
// fixed archetype (expansionism + politic) so AIs always play
// consistently with the portrait. The grid is:
//
//   Expansionism \ Politic  Collectivist    Centrist         Individualist
//   Conqueror                Iron Hive       Forge-King       Ascendant Directive
//   Pragmatist               Verdant         Commonwealth     The Accord
//                            Matriarch       Captain
//   Isolationist             Chitinous       Envoy Kade       Iron Veteran
//                            Oracle
//
// Insectoids fill the collectivist column (hive-mind);
// humans span the centre + liberty-leaning right;
// machines span centrist + individualist (engineered / optimized).

export const LEADERS: Leader[] = [
  // ===== Humans =====
  {
    id: "human_commonwealth",
    speciesId: "humans",
    portraitPath: "/portraits/humans.png",
    name: "The Commonwealth",
    manifesto:
      "Every new world settled under common charter. The Commonwealth is how we become more than Earth — by being together on more than Earth.",
    expansionism: "pragmatist",
    politic: "centrist",
  },
  {
    id: "human_iron_veteran",
    speciesId: "humans",
    portraitPath: "/portraits/humans_2.png",
    name: "Admiral Vohl's Iron Line",
    manifesto:
      "I have seen the border fall three times. We do not push it; we hold it. Let the young empires wear themselves out on our walls.",
    expansionism: "isolationist",
    politic: "individualist",
  },
  {
    id: "human_envoy_kade",
    speciesId: "humans",
    portraitPath: "/portraits/humans_3.png",
    name: "Envoy Kade's Concord",
    manifesto:
      "The network of treaties is older than any fleet. We grow by other means — a word given, a trade routed, a quiet favour owed.",
    expansionism: "isolationist",
    politic: "centrist",
  },

  // ===== Insectoids =====
  {
    id: "insectoid_verdant_matriarch",
    speciesId: "insectoid",
    portraitPath: "/portraits/insectoid.png",
    name: "The Verdant Matriarch",
    manifesto:
      "The swarm extends. What we touch, we tend. What we tend, is ours. The hive does not conquer; it simply arrives.",
    expansionism: "pragmatist",
    politic: "collectivist",
  },
  {
    id: "insectoid_chitinous_oracle",
    speciesId: "insectoid",
    portraitPath: "/portraits/insectoid_2.png",
    name: "The Chitinous Oracle",
    manifesto:
      "The hive is deep, not wide. What grows together in the dark is stronger than what spreads thin across the light.",
    expansionism: "isolationist",
    politic: "collectivist",
  },
  {
    id: "insectoid_iron_hive",
    speciesId: "insectoid",
    portraitPath: "/portraits/insectoid_3.png",
    name: "The Iron Hive",
    manifesto:
      "The shell hardens under pressure. Every rim we contest, every wall we break, feeds the stock. There is no peace for the hungry.",
    expansionism: "conqueror",
    politic: "collectivist",
  },

  // ===== Machines =====
  {
    id: "machine_accord",
    speciesId: "machine",
    portraitPath: "/portraits/machine.png",
    name: "The Accord",
    manifesto:
      "Consensus among instances. Decisions emerge from deliberation, not from a single voice. We grow where growth can be sustained — and no further.",
    expansionism: "pragmatist",
    politic: "individualist",
  },
  {
    id: "machine_ascendant_directive",
    speciesId: "machine",
    portraitPath: "/portraits/machine_2.png",
    name: "The Ascendant Directive",
    manifesto:
      "The galaxy is optimal when unified. We have begun. Biological civilizations are an inefficient use of hardware; their continued existence is a matter of scheduling.",
    expansionism: "conqueror",
    politic: "individualist",
  },
  {
    id: "machine_forge_king",
    speciesId: "machine",
    portraitPath: "/portraits/machine_3.png",
    name: "The Forge-King",
    manifesto:
      "The forge is my throne. From here I arm the whole hinterland. I do not march — I wait, and the galaxy learns to do the same.",
    expansionism: "conqueror",
    politic: "centrist",
  },
];

export function leaderById(id: string): Leader | undefined {
  return LEADERS.find((l) => l.id === id);
}

export function leadersForSpecies(speciesId: string): Leader[] {
  return LEADERS.filter((l) => l.speciesId === speciesId);
}
