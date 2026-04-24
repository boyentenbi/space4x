import type { GameEvent } from "../../sim/types";

// ============================================================
// Brood Mother origin events
//
// The matriarchal_hive origin starts crippled by a single-queen
// bottleneck: empire-wide pop growth is zero, all new pops come
// from the Brood Mother on the capital. These events are the
// narrative that lets the player live inside — or climb out of —
// that constraint. Each fires at most once per game (the event
// engine dedupes by id via state.eventLog). Flags gate the
// dependencies: "brood_rival_resolved" in particular must be set
// (via the Exile branch of the Rival event) before The Sacrifice's
// split-vs-merge endgame becomes available.
//
// Turn beats match the standard origin-arc pacing:
//   Early   ≥ T100   (First Hatch)
//   Mid     ≥ T250   (Rival)
//   Late    ≥ T375   (Pheromone Bloom)
//   Climax  ≥ T500   (Sacrifice)
// ============================================================

const BROOD_ORIGIN = "matriarchal_hive";

export const BROOD_EVENTS: GameEvent[] = [
  // 1. The First Hatch — early reward, lets the player pick how
  //    the hive specializes its opening turns. Early beat at T100+.
  {
    id: "brood_first_hatch",
    title: "The First Hatch",
    text:
      "Beneath the capital's spires, the Brood Mother's first full cycle crests. Egg cases crack in their thousands — wet, raw, staring at a world they've never seen. The caste they mature into depends on which pheromone the hive releases in the next hour.",
    requires: [
      { kind: "originIs", originId: BROOD_ORIGIN },
      { kind: "turnAtLeast", value: 100 },
      { kind: "lacksFlag", flag: "brood_first_hatch_done" },
    ],
    weight: 3,
    art: "/events/brood/first_hatch.png",
    choices: [
      {
        id: "workers",
        text: "Workers — the hive grows, the factories hum.",
        effects: [
          { kind: "addPops", value: 20 },
          { kind: "addFlag", flag: "brood_first_hatch_done" },
          { kind: "logText", text: "The first hatching brings a generation of workers. The capital swells." },
        ],
      },
      {
        id: "warriors",
        text: "Warriors — the nest's defenders, strong-jawed and loyal.",
        effects: [
          { kind: "addDefenders", value: 3 },
          { kind: "addFlag", flag: "brood_first_hatch_done" },
          { kind: "logText", text: "The first hatching pours out warriors. They take station at the capital." },
        ],
      },
      {
        id: "drones",
        text: "Drones — voidworthy, restless, bred to scout and bite.",
        effects: [
          { kind: "addShips", value: 2 },
          { kind: "addFlag", flag: "brood_first_hatch_done" },
          { kind: "logText", text: "The first hatching yields a drone wing. Two frigates lift from the capital." },
        ],
      },
    ],
  },

  // 2. The Rival — mid-game critical decision point. Exile unlocks
  //    the Sacrifice endgame via the brood_rival_resolved flag; the
  //    other branches close that door. popsAtCapital ≥ 100 gates so
  //    the rival only appears after the queen has produced enough
  //    offspring to make a pretender plausible.
  {
    id: "brood_rival",
    title: "A Rival Hatches",
    text:
      "Deep in the capital's warren, a second reproductive form has pupated. She is smaller than the Matriarch, but fertile — and the attendants who found her did not kill her on sight. They are waiting for your word.",
    requires: [
      { kind: "originIs", originId: BROOD_ORIGIN },
      { kind: "turnAtLeast", value: 250 },
      { kind: "popsAtCapitalAtLeast", value: 100 },
      { kind: "lacksFlag", flag: "brood_rival_done" },
    ],
    weight: 3,
    art: "/events/brood/rival.png",
    choices: [
      {
        id: "kill",
        text: "Kill her in the chamber. There can be only one.",
        effects: [
          { kind: "addResource", resource: "political", value: -5 },
          { kind: "addFlag", flag: "brood_rival_done" },
          { kind: "logText", text: "The pretender is dismembered. Some attendants refuse to work for a week." },
        ],
      },
      {
        id: "exile",
        text: "Exile her to a second hive. Cost: 30 pops to seed it.",
        effects: [
          { kind: "addPops", value: -30 },
          { kind: "grantFeatureOnSecondBody", featureId: "brood_mother" },
          { kind: "addFlag", flag: "brood_rival_done" },
          { kind: "addFlag", flag: "brood_rival_resolved" },
          { kind: "logText", text: "Thirty pops leave with the pretender. A second queen is installed on a distant nest." },
        ],
      },
      {
        id: "accept",
        text: "Accept her in the Matriarch's chamber. Two queens, one throne.",
        effects: [
          { kind: "addFlag", flag: "brood_rival_done" },
          { kind: "addFlag", flag: "brood_coregency" },
          // Temporary 20-turn stress: laying stalls while the queens
          // jockey for pheromone dominance. popGrowthAdd=-1 exactly
          // cancels the Brood Mother's +1, freezing the capital.
          {
            kind: "grantStoryModifier",
            key: "brood_coregency_stress",
            modifiers: [{ kind: "popGrowthAdd", value: -1 }],
            durationTurns: 20,
          },
          { kind: "logText", text: "Two queens share the throne. Laying stalls for twenty turns while they vie for dominance." },
        ],
      },
    ],
  },

  // 3. The Pheromone Bloom — temporary relief from the single-queen
  //    bottleneck. TTL-decaying modifier means the hive briefly
  //    behaves like an ordinary species. Narrative call whether you
  //    want the hive to change or stay pure.
  {
    id: "brood_pheromone_bloom",
    title: "A Pheromone Bloom",
    text:
      "Something in the atmosphere has changed. Workers on every owned world are, impossibly, laying. The Matriarch's attendants call it heresy and demand you suppress it. The laying workers call it the future.",
    requires: [
      { kind: "originIs", originId: BROOD_ORIGIN },
      { kind: "turnAtLeast", value: 375 },
      { kind: "lacksFlag", flag: "brood_pheromone_bloom_done" },
    ],
    weight: 2,
    art: "/events/brood/pheromone_bloom.png",
    choices: [
      {
        id: "accept",
        text: "Accept it. Every world lays for twenty turns.",
        effects: [
          // Override the brood_mother's empire-wide popGrowthMult=0
          // with a normal-species rate during the TTL window, plus
          // a small flat bonus that adds up across many bodies. When
          // the modifier expires, the hive snaps back to
          // single-queen mode.
          {
            kind: "grantStoryModifier",
            key: "brood_pheromone_bloom",
            modifiers: [
              { kind: "popGrowthMult", value: 1.0 },
              { kind: "popGrowthAdd", value: 0.3 },
            ],
            durationTurns: 20,
          },
          { kind: "addFlag", flag: "brood_pheromone_bloom_done" },
          { kind: "logText", text: "The bloom spreads. For twenty turns, every hive lays." },
        ],
      },
      {
        id: "suppress",
        text: "Suppress it. The Matriarch is the only breeder.",
        effects: [
          { kind: "addResource", resource: "political", value: 3 },
          { kind: "addFlag", flag: "brood_pheromone_bloom_done" },
          { kind: "logText", text: "The heretics are purged. The attendants are pleased; politics strengthens." },
        ],
      },
    ],
  },

  // 4. The Sacrifice — endgame culmination. Only available after
  //    the Exile branch of The Rival created a second Brood Mother.
  //    Forces a commitment: concentrate everything on one
  //    super-queen, or dissolve the single-queen model entirely.
  {
    id: "brood_the_sacrifice",
    title: "The Sacrifice",
    text:
      "The two queens cannot share a galaxy forever. One must be folded into the other — or both must give themselves up so every hive can breed on its own. The swarm is waiting to hear which future you will choose.",
    requires: [
      { kind: "originIs", originId: BROOD_ORIGIN },
      { kind: "turnAtLeast", value: 500 },
      { kind: "hasFlag", flag: "brood_rival_resolved" },
      { kind: "featureCountAtLeast", featureId: "brood_mother", value: 2 },
      { kind: "lacksFlag", flag: "brood_sacrifice_done" },
    ],
    weight: 5,
    art: "/events/brood/sacrifice.png",
    choices: [
      {
        id: "merge",
        text: "Merge. The pretender feeds the Matriarch. Her output triples.",
        effects: [
          // Strip the brood_mother feature from the capital, then
          // plant a super_brood_mother in its place. The second
          // body's brood_mother is intentionally left behind — the
          // v1 event engine can't surgically remove it from an
          // arbitrary body. In practice the Great Matriarch (+3
          // growth, +400 maxPops) dominates the output so the
          // residual one just adds a small +1 bonus on the second
          // body, which narratively reads fine as "the merger
          // preserved some of her residue there."
          { kind: "removeFeatureFromCapital", featureId: "brood_mother" },
          { kind: "grantFeatureOnCapital", featureId: "super_brood_mother" },
          { kind: "addFlag", flag: "brood_sacrifice_done" },
          { kind: "addFlag", flag: "brood_merged" },
          { kind: "logText", text: "The pretender is consumed. The Great Matriarch rises — she lays three eggs for every one before." },
        ],
      },
      {
        id: "scatter",
        text: "Scatter. Both queens die. Every hive lays from now on.",
        effects: [
          { kind: "removeFeatureFromCapital", featureId: "brood_mother" },
          // Permanent story modifier: every owned body gets a small
          // steady trickle, and the capital-side empire-wide
          // popGrowthMult=0 from brood_mother is gone. The second
          // body's brood_mother still contributes its popGrowthMult=0
          // empire-wide until the engine gains a "remove feature
          // from any body" effect. The empire-wide modifier here
          // overrides that back toward 1.0 via summation.
          {
            kind: "grantStoryModifier",
            key: "brood_scattered",
            modifiers: [
              { kind: "popGrowthMult", value: 1.0 },
              { kind: "popGrowthAdd", value: 0.3 },
            ],
          },
          { kind: "addFlag", flag: "brood_sacrifice_done" },
          { kind: "addFlag", flag: "brood_scattered" },
          { kind: "logText", text: "Both queens are dissolved. The swarm is different now — every hive lays. It is quieter than anyone expected." },
        ],
      },
    ],
  },
];
