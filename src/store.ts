import { create } from "zustand";
import { initialState, reduce, type Action } from "./sim/reducer";
import { speciesById } from "./sim/content";
import type { GameState } from "./sim/types";

const STORAGE_KEY = "space4x:save:v15";

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (parsed.schemaVersion !== 15) return null;
    // Refresh species-derived fields so content tweaks (colors, portrait
    // art, etc.) propagate to existing saves without a schema bump.
    const species = speciesById(parsed.empire.speciesId);
    if (species) parsed.empire.color = species.color;
    return parsed;
  } catch {
    return null;
  }
}

function persist(state: GameState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or privacy mode; ignore */
  }
}

// Pacing between empire phases when the player presses End Turn.
// Keeps the round readable — you see each empire act in sequence.
const PHASE_DELAY_MS = 500;

interface Store {
  state: GameState;
  dispatch: (action: Action) => void;
  reset: () => void;
  // Paced end-turn: dispatches beginRound, then runPhase once per
  // empire with PHASE_DELAY_MS between each. Noop while a round is
  // already in progress (currentPhaseEmpireId set).
  endTurn: () => void;
}

export const useGame = create<Store>((set, get) => ({
  state: loadSaved() ?? initialState(),
  dispatch: (action) => {
    const next = reduce(get().state, action);
    persist(next);
    set({ state: next });
  },
  reset: () => {
    const next = initialState();
    persist(next);
    set({ state: next });
  },
  endTurn: () => {
    const startState = get().state;
    if (startState.currentPhaseEmpireId) return;
    if (startState.eventQueue.length > 0) return;
    if (startState.gameOver) return;

    // Begin the round synchronously.
    const afterBegin = reduce(startState, { type: "beginRound" });
    persist(afterBegin);
    set({ state: afterBegin });

    // Schedule each subsequent runPhase with pacing. Read current state
    // at each tick so an event mid-round (e.g., player eliminated)
    // halts the cascade cleanly.
    const step = () => {
      const s = get().state;
      if (!s.currentPhaseEmpireId) return;
      const next = reduce(s, { type: "runPhase" });
      persist(next);
      set({ state: next });
      if (next.currentPhaseEmpireId) {
        setTimeout(step, PHASE_DELAY_MS);
      }
    };
    setTimeout(step, PHASE_DELAY_MS);
  },
}));
