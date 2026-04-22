import type { ReactNode } from "react";
import type { Modifier, ResourceKey } from "../sim/types";
import { HAMMERS_ICON, POPS_ICON, RESOURCE_ICON } from "./icons";

function ResIcon({ k }: { k: ResourceKey }) {
  return <img className="bonus-icon" src={RESOURCE_ICON[k]} alt={k} />;
}

export function isNegativeModifier(mod: Modifier): boolean {
  switch (mod.kind) {
    case "perPop":
    case "flat":
    case "hammersPerPopDelta":
    case "popGrowthAdd":
    case "habBonus":
    case "maxPopsDelta":
      return mod.value < 0;
    case "popGrowthMult":
    case "maxPopsMult":
      return mod.value < 1;
    case "colonizeHammerMult":
    case "colonizePoliticalMult":
      return mod.value > 1;
    case "foodUpkeepDelta":
      return mod.value > 0;
  }
}

export function renderModifier(mod: Modifier): ReactNode {
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  switch (mod.kind) {
    case "perPop":
      return (
        <>
          {signed(mod.value)} <ResIcon k={mod.resource} /> /pop
        </>
      );
    case "flat":
      return (
        <>
          {signed(mod.value)} <ResIcon k={mod.resource} /> /turn
        </>
      );
    case "popGrowthMult": {
      // A multiplier of exactly 0 means "no organic reproduction at
      // all" (e.g., Matriarchal Hive workers). "-100%" reads like a
      // bug; spell it out instead.
      if (mod.value === 0) {
        return (
          <>
            no organic <img className="bonus-icon" src={POPS_ICON} alt="" /> growth
          </>
        );
      }
      const pct = Math.round((mod.value - 1) * 100);
      return (
        <>
          {pct > 0 ? "+" : ""}{pct}% <img className="bonus-icon" src={POPS_ICON} alt="" /> growth
        </>
      );
    }
    case "popGrowthAdd": {
      return (
        <>
          {signed(mod.value)} <img className="bonus-icon" src={POPS_ICON} alt="" /> /turn (flat)
        </>
      );
    }
    case "maxPopsMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return (
        <>
          {pct > 0 ? "+" : ""}{pct}% max <img className="bonus-icon" src={POPS_ICON} alt="" />
        </>
      );
    }
    case "colonizeHammerMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return (
        <>
          {pct > 0 ? "+" : ""}{pct}% colonize <img className="bonus-icon" src={HAMMERS_ICON} alt="" />
        </>
      );
    }
    case "colonizePoliticalMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return (
        <>
          {pct > 0 ? "+" : ""}{pct}% colonize <img className="bonus-icon" src={RESOURCE_ICON.political} alt="" />
        </>
      );
    }
    case "foodUpkeepDelta":
      return (
        <>
          {signed(mod.value)} <ResIcon k="food" /> upkeep /pop
        </>
      );
    case "hammersPerPopDelta":
      return (
        <>
          {signed(mod.value)} <img className="bonus-icon" src={HAMMERS_ICON} alt="" /> /pop
        </>
      );
    case "habBonus":
      return (
        <>
          {signed(mod.value)} <ResIcon k={mod.resource} /> on {mod.habitability}
        </>
      );
    case "maxPopsDelta":
      return (
        <>
          {signed(mod.value)} max <img className="bonus-icon" src={POPS_ICON} alt="" />
        </>
      );
  }
}

export function ModifierChip({ mod }: { mod: Modifier }) {
  return (
    <span className={`bonus-chip ${isNegativeModifier(mod) ? "neg" : "pos"}`}>
      {renderModifier(mod)}
    </span>
  );
}
