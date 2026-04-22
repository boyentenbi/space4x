// Game-balance tuning knobs that should live as content, not as
// code constants — edit these to rebalance without touching the
// simulation layer.
//
// When we grow to multiple ship types or outpost tiers, the cleanest
// migration is to move each field onto the relevant content entity
// (e.g. `build_frigate.onComplete.spawnShip.upkeep`). Until then a
// single flat file keeps the balance numbers legible in one place.

export const BALANCE = {
  // Energy drained from each owned system's component pool each turn
  // for outpost maintenance. Cutting a region off means it has to
  // sustain its own outposts from local food/energy production.
  outpostEnergyUpkeep: 1,
} as const;
