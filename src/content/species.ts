import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. Curious, argumentative, disproportionately fond of flags.",
    traitIds: ["charismatic"],
  },
  {
    id: "insectoid",
    name: "Insectoid",
    description:
      "A chitinous hive-species with synchronized shifts and an unsettling talent for agriculture.",
    traitIds: ["agrarian", "industrious"],
  },
  {
    id: "machine",
    name: "Machine Intelligence",
    description:
      "Networked synthetic minds. No food needed; no sleep either. Patient, precise, and legally complicated.",
    traitIds: ["solar_attuned", "intelligent"],
  },
];
