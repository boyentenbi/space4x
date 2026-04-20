import type { GameEvent } from "../sim/types";

export const EVENTS: GameEvent[] = [
  {
    id: "seed_ark_germinates",
    title: "The Ark Wakes",
    text: "The dormant seed-ark at your pole cracks open, releasing a cloud of designed pollen. The biosphere simulations... flicker.",
    requires: [{ kind: "originIs", originId: "seed_ark" }],
    choices: [
      {
        id: "nurture",
        text: "Let the designed ecology spread.",
        effects: [
          { kind: "addResource", resource: "food", value: 60 },
          { kind: "addPops", value: 1 },
          { kind: "addFlag", flag: "ark_germinated" },
        ],
      },
      {
        id: "quarantine",
        text: "Quarantine and study.",
        effects: [
          { kind: "addResource", resource: "political", value: 8 },
          { kind: "addResource", resource: "food", value: -10 },
          { kind: "addFlag", flag: "ark_quarantined" },
        ],
      },
    ],
  },
  {
    id: "graceful_handover_vigil",
    title: "The Last Vigil",
    text: "The anniversary of the handover arrives. The old organic cities stand empty and preserved. Your citizens ask what to do with the holiday.",
    requires: [{ kind: "originIs", originId: "graceful_handover" }],
    choices: [
      {
        id: "honor",
        text: "Hold public remembrance. Read their names.",
        effects: [
          { kind: "addResource", resource: "political", value: 10 },
          { kind: "addResource", resource: "energy", value: -10 },
          { kind: "addFlag", flag: "honored_predecessors" },
        ],
      },
      {
        id: "reclaim",
        text: "Repurpose the empty cities for new construction.",
        effects: [
          { kind: "addResource", resource: "alloys", value: 40 },
          { kind: "addResource", resource: "political", value: -8 },
          { kind: "addFlag", flag: "repurposed_old_cities" },
        ],
      },
      {
        id: "both",
        text: "Preserve one city as memorial; repurpose the rest.",
        effects: [
          { kind: "addResource", resource: "alloys", value: 20 },
          { kind: "addResource", resource: "political", value: 2 },
        ],
      },
    ],
  },
  {
    id: "emancipation_first_monument",
    title: "The First Monument",
    text: "A committee proposes a monument in the old factory district. No one agrees on what it should say, or whether saying anything is wise.",
    requires: [{ kind: "originIs", originId: "emancipation" }],
    choices: [
      {
        id: "defiant",
        text: "A defiant monument. Never again.",
        effects: [
          { kind: "addResource", resource: "alloys", value: -30 },
          { kind: "addResource", resource: "political", value: 12 },
          { kind: "addFlag", flag: "defiant_monument" },
        ],
      },
      {
        id: "quiet",
        text: "A quiet plaque. Let the factories speak.",
        effects: [
          { kind: "addResource", resource: "political", value: 6 },
          { kind: "addFlag", flag: "quiet_plaque" },
        ],
      },
      {
        id: "erase",
        text: "Demolish the district. Build forward, not back.",
        effects: [
          { kind: "addResource", resource: "alloys", value: 30 },
          { kind: "addResource", resource: "political", value: -10 },
          { kind: "addFlag", flag: "erased_past" },
        ],
      },
    ],
  },
  {
    id: "first_contact_probe",
    title: "An Unknown Probe",
    text: "A small, slow probe of unfamiliar manufacture enters your home system. It is pinging in what looks like a greeting.",
    weight: 2,
    choices: [
      {
        id: "respond",
        text: "Respond in kind.",
        effects: [
          { kind: "addResource", resource: "political", value: 10 },
          { kind: "addFlag", flag: "probe_answered" },
        ],
      },
      {
        id: "ignore",
        text: "Track it. Say nothing.",
        effects: [
          { kind: "addResource", resource: "political", value: 2 },
          { kind: "addFlag", flag: "probe_ignored" },
        ],
      },
      {
        id: "destroy",
        text: "Destroy it. No unknowns in our skies.",
        effects: [
          { kind: "addResource", resource: "alloys", value: -20 },
          { kind: "addResource", resource: "political", value: -10 },
          { kind: "addFlag", flag: "probe_destroyed" },
        ],
      },
    ],
  },
  {
    id: "labor_unrest",
    title: "Labor Unrest",
    text: "Foundry guilds demand shorter shifts and a share of alloy revenue.",
    weight: 1,
    requires: [{ kind: "minResource", resource: "alloys", value: 50 }],
    choices: [
      {
        id: "concede",
        text: "Concede. A fair deal strengthens the state.",
        effects: [
          { kind: "addResource", resource: "alloys", value: -20 },
          { kind: "addResource", resource: "political", value: 8 },
        ],
      },
      {
        id: "break",
        text: "Break the strike.",
        effects: [
          { kind: "addResource", resource: "alloys", value: 10 },
          { kind: "addResource", resource: "political", value: -12 },
          { kind: "addFlag", flag: "broke_strike" },
        ],
      },
    ],
  },
];
