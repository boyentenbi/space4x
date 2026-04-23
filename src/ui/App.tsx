import { useGame } from "../store";
import { NewGame } from "./NewGame";
import { MainScreen } from "./MainScreen";
import { empireById } from "../sim/reducer";

// Root UI router. Three legitimate states:
//   - no game in progress → show new-game screen
//   - game in progress and the human is alive → main screen
//   - game in progress but the human has been eliminated → game-over
//     screen with a "new game" button. MUST NOT render MainScreen
//     here: it reaches for humanEmpireOrThrow(state) at the top and
//     will throw if the human is gone (which was the mystery black
//     screen — the error hit the top-level render and the saved
//     state kept reloading into the same crash on refresh).
export function App() {
  const state = useGame((s) => s.state);
  const reset = useGame((s) => s.reset);
  const started = state.turn > 0 && state.empires.length > 0;
  const humanAlive =
    !!state.humanEmpireId && !!empireById(state, state.humanEmpireId);

  if (!started) return <div className="app"><NewGame /></div>;
  if (!humanAlive) {
    return (
      <div className="app">
        <div className="modal-scrim" style={{ backgroundColor: "rgba(0,0,0,0.85)" }}>
          <div className="modal">
            <h2>Your empire has fallen</h2>
            <div className="event-text">
              There is nothing left to command. The galaxy turns without you.
            </div>
            <button className="close-btn" onClick={reset}>
              New Game
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <div className="app"><MainScreen /></div>;
}
