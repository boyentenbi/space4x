// Single source of truth for UI resource/flow icon paths.
import type { HabitabilityTier, ResourceKey } from "../sim/types";

// Shared habitability palette — used for text labels, galaxy map dots, etc.
export const HAB_COLOR: Record<HabitabilityTier, string> = {
  garden: "#6fbf87",
  temperate: "#9dd89a",
  harsh: "#ffb673",
  // Hellscape variants.
  frozen: "#8ab8e0", // icy blue
  molten: "#ff6a4a", // hot red-orange
  barren: "#c9b99a", // dusty tan
  stellar: "#ffe680", // star colour — rarely used, stars render via their own art
};

export const RESOURCE_ICON: Record<ResourceKey, string> = {
  food: "/icons/food.png",
  energy: "/icons/energy.png",
  political: "/icons/political.png",
};

export const COMPUTE_ICON = "/icons/compute.png";
export const HAMMERS_ICON = "/icons/hammers.png";
export const POPS_ICON = "/icons/pops.png";

// Per-habitability planet sprite variants. Which one renders is picked
// deterministically from a hash of the body id. Hellscape variants
// reuse the old hellscape art until we gen dedicated frames per type.
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
  frozen: [
    "/planets/hellscape_2.png",
    "/planets/hellscape_3.png",
  ],
  molten: [
    "/planets/hellscape.png",
  ],
  barren: [
    "/planets/hellscape_3.png",
  ],
  stellar: [
    "/planets/hellscape.png", // stars render via their own art; this shouldn't be hit
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

// Distinct palette for visualising the player empire's connected
// components. Shared between the galaxy map (ring per component) and
// the left-pane resource panel (per-component row) so visuals line up.
// Deliberately avoids overlap with empire colours.
export const COMPONENT_PALETTE = [
  "#f2d06b", // amber
  "#9ac94a", // lime
  "#e37c7c", // coral
  "#7fbfd9", // sky
  "#c98ae0", // lavender
  "#e8a850", // tangerine
];

function componentHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function componentColor(componentId: string): string {
  return COMPONENT_PALETTE[componentHash(componentId) % COMPONENT_PALETTE.length];
}
