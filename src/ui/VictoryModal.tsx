import { humanEmpire } from "../sim/reducer";
import { useGame } from "../store";

const VICTORY_ART = "/events/victory.png";

// Shown once when the human empire is the last one standing — every
// rival has been eliminated. Reuses the .big-event-modal layout used
// by climactic story events so the win moment gets the same fullscreen
// art treatment instead of being squeezed into a small dialog.
export function VictoryModal() {
  const dispatch = useGame((s) => s.dispatch);
  const state = useGame((s) => s.state);
  const player = humanEmpire(state);

  const dismiss = () => dispatch({ type: "dismissVictory" });

  return (
    <div className="modal-scrim big-event-scrim" role="dialog" aria-modal="true">
      <div className="big-event-modal">
        <img className="big-event-art" src={VICTORY_ART} alt="" />
        <div className="big-event-overlay">
          <h2 className="big-event-title">Galactic Hegemony</h2>
          <div className="big-event-text">
            Every rival empire has fallen. {player?.name ?? "Your empire"} stands
            alone among the stars — the only authority left to set the future of
            this galaxy. Turn {state.turn}.
          </div>
          <div className="big-event-choices">
            <button className="big-event-choice" onClick={dismiss}>
              <span className="big-event-choice-text">Take in the silence</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
