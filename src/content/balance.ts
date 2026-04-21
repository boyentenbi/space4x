// Game-balance tuning knobs that should live as content, not as
// code constants — edit these to rebalance without touching the
// simulation layer.
//
// When we grow to multiple ship types or outpost tiers, the cleanest
// migration is to move each field onto the relevant content entity
// (e.g. `build_frigate.onComplete.spawnShip.upkeep`). Until then a
// single flat file keeps the balance numbers legible in one place.

export const BALANCE = {
  // Energy drained from the empire stockpile each turn per ship, per
  // owned system's outpost. If the stockpile goes to 0 or below, the
  // fleet is "out of fuel" — it can't move and deals 0 combat damage
  // until the deficit is repaired.
  shipEnergyUpkeep: 1,
  outpostEnergyUpkeep: 1,
} as const;
