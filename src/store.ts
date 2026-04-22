import { create } from "zustand";
import { initialState, reduce, type Action } from "./sim/reducer";
import { speciesById } from "./sim/content";
import type { GameState } from "./sim/types";

const STORAGE_KEY = "space4x:save:v22";

// Cap on the state history ring. Each end-turn + each dispatched
// action pushes one entry; 200 is enough for the player to scrub
// back across a meaningful chunk of play without bloating memory.
const HISTORY_MAX = 200;

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

// Push `next` onto the history, truncating any states past the
// current index (any time you take a new action after scrubbing back
// you're branching — future becomes lost). Ring-buffered at HISTORY_MAX.
function pushHistory(
  history: GameState[],
  index: number,
  next: GameState,
): { history: GameState[]; index: number } {
  const truncated = history.slice(0, index + 1);
  truncated.push(next);
  const overflow = Math.max(0, truncated.length - HISTORY_MAX);
  const trimmed = overflow > 0 ? truncated.slice(overflow) : truncated;
  return { history: trimmed, index: trimmed.length - 1 };
}

interface Store {
  // Full history of states; `state` is always history[historyIndex].
  // Scrubbing back/forward moves through the ring; any dispatch at a
  // mid-history index branches (truncates forward states).
  state: GameState;
  history: GameState[];
  historyIndex: number;
  // Autoplay: when on, endTurn loops every `autoplayIntervalMs`.
  autoplayOn: boolean;
  autoplayIntervalMs: number;
  dispatch: (action: Action) => void;
  reset: () => void;
  // End-turn: dispatches beginRound and runs every empire's phase
  // back-to-back in a single synchronous pass. Noop while a round
  // is already in progress (currentPhaseEmpireId set).
  endTurn: () => void;
  // Scrub through history. canGoBack/canGoForward exposed as booleans
  // so the UI can disable the buttons cleanly.
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  setAutoplay: (on: boolean) => void;
}

const initial = loadSaved() ?? initialState();

export const useGame = create<Store>((set, get) => ({
  state: initial,
  history: [initial],
  historyIndex: 0,
  autoplayOn: false,
  autoplayIntervalMs: 150,
  dispatch: (action) => {
    const next = reduce(get().state, action);
    persist(next);
    const { history, index } = pushHistory(
      get().history,
      get().historyIndex,
      next,
    );
    set({ state: next, history, historyIndex: index });
  },
  reset: () => {
    const next = initialState();
    persist(next);
    set({ state: next, history: [next], historyIndex: 0, autoplayOn: false });
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
    const { history, index } = pushHistory(
      get().history,
      get().historyIndex,
      s,
    );
    set({ state: s, history, historyIndex: index });
  },
  goBack: () => {
    const idx = get().historyIndex;
    if (idx <= 0) return;
    const nextIdx = idx - 1;
    const s = get().history[nextIdx];
    persist(s);
    set({ state: s, historyIndex: nextIdx });
  },
  goForward: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const s = history[nextIdx];
      persist(s);
      set({ state: s, historyIndex: nextIdx });
      return;
    }
    // Already at the newest state — "forward" advances time instead.
    get().endTurn();
  },
  canGoBack: () => get().historyIndex > 0,
  canGoForward: () => {
    const { history, historyIndex, state } = get();
    if (historyIndex < history.length - 1) return true;
    // At the latest state: "forward" would try endTurn. Same gating as
    // the endTurn method — no forward if a phase is mid-flight / there
    // are pending events / the game is over.
    return (
      !state.currentPhaseEmpireId &&
      state.eventQueue.length === 0 &&
      !state.gameOver
    );
  },
  setAutoplay: (on) => set({ autoplayOn: on }),
}));

// Autoplay loop: when the toggle is on, call endTurn every
// `autoplayIntervalMs`. Stops cleanly when the store flips off or
// when endTurn becomes a noop (pending events, game over, etc.).
if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const s = useGame.getState();
    if (!s.autoplayOn) {
      timer = null;
      return;
    }
    // If endTurn can't run right now (pending event, etc.) just wait
    // and retry next tick — user will have to resolve the event.
    if (s.canGoForward()) s.endTurn();
    timer = setTimeout(tick, s.autoplayIntervalMs);
  };
  useGame.subscribe((s, prev) => {
    if (s.autoplayOn && !prev.autoplayOn && timer === null) {
      timer = setTimeout(tick, s.autoplayIntervalMs);
    }
  });
}
