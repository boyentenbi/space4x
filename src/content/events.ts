import type { GameEvent } from "../sim/types";

export const EVENTS: GameEvent[] = [
  {
    id: "lost_colony_signal",
    title: "A Signal From Below",
    text: "Deep-scan surveys detect a rhythmic pulse beneath the old colony foundations. It predates your charter by several millennia.",
    requires: [{ kind: "originIs", originId: "lost_colony" }],
    choices: [
      {
        id: "excavate",
        text: "Commit engineers to excavate the source.",
        effects: [
          { kind: "addResource", resource: "minerals", value: -40 },
          { kind: "addResource", resource: "research", value: 30 },
          { kind: "addFlag", flag: "excavated_signal" },
          { kind: "logText", text: "Engineers uncover a half-functional data vault." },
        ],
      },
      {
        id: "seal",
        text: "Seal it. Some doors stay shut.",
        effects: [
          { kind: "addResource", resource: "influence", value: 5 },
          { kind: "addFlag", flag: "sealed_signal" },
          { kind: "logText", text: "The public is reassured by decisive silence." },
        ],
      },
    ],
  },
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
          { kind: "addResource", resource: "research", value: 40 },
          { kind: "addResource", resource: "food", value: -10 },
          { kind: "addFlag", flag: "ark_quarantined" },
        ],
      },
    ],
  },
  {
    id: "shattered_ring_salvage",
    title: "Salvage Rights",
    text: "A drifting ring-segment full of pre-collapse power cells enters reachable orbit. Rival clans eye it hungrily.",
    requires: [{ kind: "originIs", originId: "shattered_ring" }],
    choices: [
      {
        id: "claim",
        text: "Claim it first, ask forgiveness later.",
        effects: [
          { kind: "addResource", resource: "energy", value: 80 },
          { kind: "addResource", resource: "influence", value: -5 },
          { kind: "addFlag", flag: "ring_salvaged" },
        ],
      },
      {
        id: "share",
        text: "Propose a shared salvage compact.",
        effects: [
          { kind: "addResource", resource: "energy", value: 30 },
          { kind: "addResource", resource: "influence", value: 10 },
        ],
      },
    ],
  },
  {
    id: "void_refugees_memory",
    title: "A Memory Returns",
    text: "An elder wakes screaming from cold-sleep, insisting they remember what you fled. Others call it delirium.",
    requires: [{ kind: "originIs", originId: "void_refugees" }],
    choices: [
      {
        id: "believe",
        text: "Take the testimony seriously. Fortify.",
        effects: [
          { kind: "addResource", resource: "minerals", value: -30 },
          { kind: "addResource", resource: "research", value: 15 },
          { kind: "addFlag", flag: "fortifying" },
        ],
      },
      {
        id: "dismiss",
        text: "Dismiss. Stabilize morale.",
        effects: [
          { kind: "addResource", resource: "influence", value: 5 },
          { kind: "addFlag", flag: "denied_memory" },
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
          { kind: "addResource", resource: "influence", value: 8 },
          { kind: "addResource", resource: "research", value: 10 },
          { kind: "addFlag", flag: "probe_answered" },
        ],
      },
      {
        id: "ignore",
        text: "Track it. Say nothing.",
        effects: [
          { kind: "addResource", resource: "research", value: 5 },
          { kind: "addFlag", flag: "probe_ignored" },
        ],
      },
      {
        id: "destroy",
        text: "Destroy it. No unknowns in our skies.",
        effects: [
          { kind: "addResource", resource: "minerals", value: -20 },
          { kind: "addResource", resource: "influence", value: -10 },
          { kind: "addFlag", flag: "probe_destroyed" },
        ],
      },
    ],
  },
  {
    id: "labor_unrest",
    title: "Labor Unrest",
    text: "Mineral extraction guilds demand shorter shifts and a share of research revenue.",
    weight: 1,
    requires: [{ kind: "minResource", resource: "minerals", value: 50 }],
    choices: [
      {
        id: "concede",
        text: "Concede. A fair deal strengthens the state.",
        effects: [
          { kind: "addResource", resource: "minerals", value: -20 },
          { kind: "addResource", resource: "influence", value: 8 },
        ],
      },
      {
        id: "break",
        text: "Break the strike.",
        effects: [
          { kind: "addResource", resource: "minerals", value: 10 },
          { kind: "addResource", resource: "influence", value: -12 },
          { kind: "addFlag", flag: "broke_strike" },
        ],
      },
    ],
  },
];
