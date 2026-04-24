import type { GameEvent } from "../../sim/types";
import { BROOD_EVENTS } from "./brood";

// Aggregator for all origin-specific event packs. Each origin lives
// in its own file under this directory; register it here.
//
// Adding a new origin pack: create ./<origin>.ts exporting a named
// array (e.g. MACHINE_EVENTS), import it above, and spread it in
// below. No consumer changes required — `content/events.ts` used to
// live here as a single file, consumers imported from "./events"
// and that still resolves to this directory's index.
export const EVENTS: GameEvent[] = [
  ...BROOD_EVENTS,
];
