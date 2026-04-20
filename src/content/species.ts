import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. Curious, argumentative, disproportionately fond of flags.",
    traitIds: ["charismatic"],
    art: "/portraits/humans.png",
    color: "#3578b0", // Navy blue of the bridge uniform.
  },
  {
    id: "insectoid",
    name: "Insectoid",
    description:
      "A chitinous hive-species with synchronized shifts and an unsettling talent for agriculture.",
    traitIds: ["agrarian", "industrious"],
    art: "/portraits/insectoid.png",
    color: "#8b5bc8", // Royal purple of the ceremonial robes.
  },
  {
    id: "machine",
    name: "Machine Intelligence",
    description:
      "Networked synthetic minds. No food needed; no sleep either. Patient, precise, and legally complicated.",
    traitIds: ["solar_attuned", "efficient_cores"],
    art: "/portraits/machine.png",
    color: "#62d4e6", // Cyan of the ocular slit.
  },
];
