import type { GameEvent } from "../../sim/types";
import { BROOD_EVENTS } from "./brood";
import { MACHINE_EVENTS } from "./machine";

// Aggregator for all origin-specific event packs. Each origin lives
// in its own file under this directory; register it here.
//
// Adding a new origin pack: create ./<origin>.ts exporting a named
// array (e.g. VERDANT_EVENTS), import it above, and spread it in
// below. No consumer changes required.
export const EVENTS: GameEvent[] = [
  ...BROOD_EVENTS,
  ...MACHINE_EVENTS,
];
