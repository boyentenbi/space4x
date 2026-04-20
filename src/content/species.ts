import type { Species } from "../sim/types";

export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description: "Adaptable descendants of Old Earth, still arguing about everything.",
    traitIds: ["charismatic"],
  },
  {
    id: "xol",
    name: "Xol Collective",
    description: "Silicate hive-minds that sing in low-frequency radio.",
    traitIds: ["industrious", "intelligent"],
  },
  {
    id: "verdani",
    name: "Verdani",
    description: "Tree-like beings whose roots tap planetary nutrient grids.",
    traitIds: ["agrarian", "solar_attuned"],
  },
  {
    id: "tessari",
    name: "Tessari",
    description: "Six-limbed diplomats from a shattered home system.",
    traitIds: ["charismatic", "intelligent"],
  },
  {
    id: "korr",
    name: "Korr Ascendancy",
    description: "Endoskeletal miners with lungs that breathe volcanic ash.",
    traitIds: ["industrious"],
  },
];
