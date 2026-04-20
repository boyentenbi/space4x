import { create } from "zustand";
import { initialState, reduce, type Action } from "./sim/reducer";
import type { GameState } from "./sim/types";

const STORAGE_KEY = "space4x:save:v1";

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (parsed.schemaVersion !== 1) return null;
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
}));
