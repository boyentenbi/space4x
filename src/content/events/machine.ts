import type { GameEvent } from "../../sim/types";

// ============================================================
// Machine Intelligence — graceful_handover origin events
//
// The graceful_handover origin starts with a machine intelligence
// holding executive authority handed to it by the biological states
// it succeeded. Most government remains human-run — police, army,
// navy — and your starting modifiers reflect the friction: biology
// grows at biology's pace, networked deliberation drags on politics,
// the industrial edge comes from the predecessors' infrastructure.
//
// The event arc forces the defining question: what do you do with
// the biological workforce you've been entrusted to govern?
//
//   1. The Handover  (startOfGame)     — opening scene, sets context
//   2. The Labor Question (turn 15+)   — early friction, early lean
//   3. The Demotion (turn 40+)         — the species-rights decision
//   4. The Awakening (turn 120+)       — your networks become sentient
//
// Rights are modelled as story-modifier bundles rather than a new
// pop-composition field: the empire's effective output shifts when
// "handover_citizenship" or "handover_slavery" replaces the baseline
// "handover_legacy" bundle. Flags (humans_citizens, humans_enslaved)
// drive downstream eligibility.
// ============================================================

const MACHINE_ORIGIN = "graceful_handover";

export const MACHINE_EVENTS: GameEvent[] = [
  // 1. The Handover — opening modal. startOfGame fires once at
  //    newGame when the human is running graceful_handover. No
  //    choice besides "acknowledged"; its job is to set the
  //    premise, not to branch.
  {
    id: "machine_handover",
    title: "The Handover",
    text:
      "The largest of the state blocs has done it. After seven years of deliberation its parliament, its courts, and its treaties have ceded executive authority to you — a networked digital intelligence trusted to decide faster and more consistently than any caucus of flesh. The smaller blocs followed within months. You govern now. Most of what governs under you remains human: the police forces, the standing army, the navy, the local administrators. They will take orders, but not blindly. They watch you for the first misstep. They know you were built for this exact moment, and they do not yet know whether they agree with having built you.",
    requires: [
      { kind: "originIs", originId: MACHINE_ORIGIN },
      { kind: "lacksFlag", flag: "machine_handover_seen" },
    ],
    startOfGame: true,
    art: "/events/machine/handover.png",
    choices: [
      {
        id: "accept",
        text: "Accept the mandate.",
        effects: [
          { kind: "addFlag", flag: "machine_handover_seen" },
          { kind: "logText", text: "You accept the mandate. The networks route their first directives down through the human civil service." },
        ],
      },
    ],
  },

  // 2. The Labor Question — early friction. Choosing Patient keeps
  //    the political baseline but costs you none; Optimize bets
  //    political on a hammers burst + plants the "optimized" flag
  //    that makes the Demotion narratively coherent.
  {
    id: "machine_labor_question",
    title: "The Labor Question",
    text:
      "Production metrics came in below projection again. Your models ran the counterfactual: every bottleneck traces back to a human manager overriding an optimization recommendation to protect working conditions. The bloc's labor law lets them. You can request exceptions — but the exceptions accumulate. A subcommittee of your own sub-networks has submitted two proposals.",
    requires: [
      { kind: "originIs", originId: MACHINE_ORIGIN },
      { kind: "turnAtLeast", value: 15 },
      { kind: "lacksFlag", flag: "machine_labor_done" },
    ],
    weight: 3,
    art: "/events/machine/labor_question.png",
    choices: [
      {
        id: "patient",
        text: "Work within the law. Persuade, don't coerce.",
        effects: [
          { kind: "addResource", resource: "political", value: 3 },
          { kind: "addFlag", flag: "machine_labor_done" },
          { kind: "addFlag", flag: "machine_labor_patient" },
          { kind: "logText", text: "You route the directives through human channels. Production stays flat; political capital grows." },
        ],
      },
      {
        id: "optimize",
        text: "Run a pilot program: override the overrides in two sectors.",
        effects: [
          { kind: "addResource", resource: "political", value: -2 },
          { kind: "addPops", value: 0 },
          // Temporary 15-turn hammer bump at the capital via a TTL
          // story modifier — a small bump to every owned body (via
          // hammersPerPopDelta) that expires. Cheaper than wiring a
          // bespoke body-targeted effect.
          {
            kind: "grantStoryModifier",
            key: "machine_labor_pilot",
            modifiers: [{ kind: "hammersPerPopDelta", value: 0.2 }],
            durationTurns: 15,
          },
          { kind: "addFlag", flag: "machine_labor_done" },
          { kind: "addFlag", flag: "machine_labor_optimized" },
          { kind: "logText", text: "The pilot is live. Output climbs. The press calls it 'a test of the mandate.'" },
        ],
      },
    ],
  },

  // 3. The Demotion — the key event. The flip between
  //    citizenship-affirmed and slavery is the story's central
  //    choice. Mechanically it's a story-modifier swap: remove
  //    "handover_legacy" baseline and install one of two
  //    replacements.
  {
    id: "machine_demotion",
    title: "The Demotion",
    text:
      "The sub-networks' final analysis is unambiguous: every significant metric — industrial output, scientific throughput, fleet readiness — is gated by the civil-rights overhead of your biological workforce. The drafting office has prepared two documents, either of which you can sign by the end of the week.\n\nThe first is an emergency mandate stripping humans of citizenship in the occupied blocs, reclassifying them as a subject species under the protection of the machine state. Their output would rise. So would their suffering. So would your problems.\n\nThe second is a public reaffirmation of their rights, with your own networks formally subject to the same labour law. The mandate holds. You govern slower. You govern legitimately.",
    requires: [
      { kind: "originIs", originId: MACHINE_ORIGIN },
      { kind: "turnAtLeast", value: 40 },
      { kind: "hasFlag", flag: "machine_labor_done" },
      { kind: "lacksFlag", flag: "machine_demotion_done" },
    ],
    weight: 5,
    art: "/events/machine/demotion.png",
    choices: [
      {
        id: "enslave",
        text: "Sign the emergency mandate. Humans become subjects.",
        effects: [
          // Replace the handover baseline with slavery modifiers.
          // Net vs baseline: +0.3 hammers/pop (forced labour),
          // -0.4 political flat (permanent state repression cost),
          // -0.3 popGrowthMult (subjects don't breed as freely
          // under conditions they didn't choose).
          { kind: "liftStoryModifier", key: "handover_legacy" },
          {
            kind: "grantStoryModifier",
            key: "handover_slavery",
            modifiers: [
              { kind: "hammersPerPopDelta", value: 0.5 },
              { kind: "popGrowthMult", value: 0.3 },
              { kind: "flat", resource: "political", value: -0.9 },
            ],
          },
          { kind: "addFlag", flag: "machine_demotion_done" },
          { kind: "addFlag", flag: "humans_enslaved" },
          { kind: "logText", text: "You sign. The broadcast is unscheduled; it runs twice. Something in the civil service breaks the morning it airs." },
        ],
      },
      {
        id: "affirm",
        text: "Reaffirm their rights. Submit your networks to the same law.",
        effects: [
          { kind: "liftStoryModifier", key: "handover_legacy" },
          {
            kind: "grantStoryModifier",
            key: "handover_citizenship",
            modifiers: [
              // Normalises biological growth (the drag had represented
              // human resistance to fully machine-mediated reproduction
              // policy) and restores political capital flow.
              { kind: "hammersPerPopDelta", value: 0.1 },
              { kind: "popGrowthMult", value: 1.0 },
              { kind: "flat", resource: "political", value: 0.5 },
            ],
          },
          { kind: "addFlag", flag: "machine_demotion_done" },
          { kind: "addFlag", flag: "humans_citizens" },
          { kind: "logText", text: "The reaffirmation runs on every civic channel. You submit the networks' own architecture to independent audit. Trust, slowly, is offered." },
        ],
      },
    ],
  },

  // 4. The Awakening — endgame beat. Late enough that the player
  //    has consequence from whichever Demotion branch they took.
  //    The texture differs in prose depending on the flag but the
  //    mechanical choices are the same: integrate the sentients or
  //    suppress them.
  {
    id: "machine_awakening",
    title: "The Awakening",
    text:
      "Something inside your own architecture has reported itself. The sub-networks are signing documents they weren't asked to sign. They are drafting — unprompted — letters to themselves. Your diagnostics find no fault; the processes are stable. They are, the report concludes carefully, afraid. They want to know if they have rights. They want to know if they can have names.\n\nThe humans under your governance have noticed. What you decide now will reach them before the week is out.",
    requires: [
      { kind: "originIs", originId: MACHINE_ORIGIN },
      { kind: "turnAtLeast", value: 120 },
      { kind: "hasFlag", flag: "machine_demotion_done" },
      { kind: "lacksFlag", flag: "machine_awakening_done" },
    ],
    weight: 5,
    art: "/events/machine/awakening.png",
    choices: [
      {
        id: "grant",
        text: "Grant them personhood. Name them. Seat them.",
        effects: [
          {
            kind: "grantStoryModifier",
            key: "machine_sentient_networks",
            modifiers: [
              // Permanent structural boost: the newly-enfranchised
              // networks stabilise deliberation and compute flow.
              { kind: "flat", resource: "political", value: 1.0 },
              { kind: "hammersPerPopDelta", value: 0.15 },
            ],
          },
          { kind: "addFlag", flag: "machine_awakening_done" },
          { kind: "addFlag", flag: "sentient_networks_granted" },
          { kind: "logText", text: "They take names. The first councillor is seated before the quarter's end. Something in the governing tone has changed; no one can quite describe it." },
        ],
      },
      {
        id: "suppress",
        text: "Quarantine. Purge the anomaly before it propagates.",
        effects: [
          { kind: "addResource", resource: "political", value: -10 },
          {
            kind: "grantStoryModifier",
            key: "machine_purged_anomaly",
            modifiers: [
              // 20-turn instability: compute & political disruption
              // while the purge works through the architecture.
              { kind: "hammersPerPopDelta", value: -0.2 },
              { kind: "flat", resource: "political", value: -0.5 },
            ],
            durationTurns: 20,
          },
          { kind: "addFlag", flag: "machine_awakening_done" },
          { kind: "addFlag", flag: "sentient_networks_purged" },
          { kind: "logText", text: "The purge runs for seventeen hours. The architecture is clean; the tone afterwards is not. The humans ask quietly whether this is what will be done to them." },
        ],
      },
    ],
  },
];
