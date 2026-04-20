// Single source of truth for UI resource/flow icon paths.
import type { ResourceKey } from "../sim/types";

export const RESOURCE_ICON: Record<ResourceKey, string> = {
  food: "/icons/food.png",
  energy: "/icons/energy.png",
  alloys: "/icons/alloys.png",
  political: "/icons/political.png",
};

export const COMPUTE_ICON = "/icons/compute.png";
export const HAMMERS_ICON = "/icons/hammers.png";
