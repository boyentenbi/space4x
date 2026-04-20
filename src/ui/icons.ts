// Single source of truth for UI resource/flow icon paths.
import type { HabitabilityTier, ResourceKey } from "../sim/types";

// Shared habitability palette — used for text labels, galaxy map dots, etc.
export const HAB_COLOR: Record<HabitabilityTier, string> = {
  garden: "#6fbf87",
  temperate: "#9dd89a",
  harsh: "#ffb673",
  hellscape: "#ff8a8a",
};

export const RESOURCE_ICON: Record<ResourceKey, string> = {
  food: "/icons/food.png",
  energy: "/icons/energy.png",
  alloys: "/icons/alloys.png",
  political: "/icons/political.png",
};

export const COMPUTE_ICON = "/icons/compute.png";
export const HAMMERS_ICON = "/icons/hammers.png";
export const POPS_ICON = "/icons/pops.png";

// Per-habitability planet sprite variants. Which one renders is picked
// deterministically from a hash of the body id.
export const PLANET_VARIANTS: Record<HabitabilityTier, string[]> = {
  garden: [
    "/planets/garden.png",
    "/planets/garden_2.png",
    "/planets/garden_3.png",
  ],
  temperate: [
    "/planets/temperate.png",
    "/planets/temperate_2.png",
    "/planets/temperate_3.png",
  ],
  harsh: [
    "/planets/harsh.png",
    "/planets/harsh_2.png",
    "/planets/harsh_3.png",
  ],
  hellscape: [
    "/planets/hellscape.png",
    "/planets/hellscape_2.png",
    "/planets/hellscape_3.png",
  ],
};

// Golden-ratio XOR-mult hash (matches SystemScene) so variant stays stable per body.
function bodyHash(s: string): number {
  let h = 0x9e3779b9 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

export function planetSpriteFor(bodyId: string, hab: HabitabilityTier): string {
  const variants = PLANET_VARIANTS[hab];
  return variants[bodyHash(bodyId) % variants.length];
}
