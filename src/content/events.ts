import type { GameEvent } from "../sim/types";

// Origin-specific events have been removed for now — the event system is
// still wired through the reducer so new events can slot in later without
// code changes. Two generic random events remain as proof that events
// still fire.
export const EVENTS: GameEvent[] = [
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
