import { create } from "zustand";
import { initialState, reduce, type Action } from "./sim/reducer";
import { speciesById } from "./sim/content";
import type { GameState } from "./sim/types";

const STORAGE_KEY = "space4x:save:v22";

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (parsed.schemaVersion !== 22) return null;
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

interface Store {
  state: GameState;
  dispatch: (action: Action) => void;
  reset: () => void;
  // End-turn: dispatches beginRound and runs every empire's phase
  // back-to-back in a single synchronous pass. Noop while a round
  // is already in progress (currentPhaseEmpireId set).
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

    // Begin the round + run every phase in one synchronous burst.
    let s = reduce(startState, { type: "beginRound" });
    while (s.currentPhaseEmpireId) {
      s = reduce(s, { type: "runPhase" });
    }
    persist(s);
    set({ state: s });
  },
}));
