import type { PendingElimination } from "../sim/types";
import { useGame } from "../store";

// Shown each time an empire is eliminated (loses its last system).
// Queued in state.pendingEliminations; display fields are snapshotted
// at elimination time because the empire itself is already gone from
// state.empires. Dismissing shifts the queue so chain-reactions surface
// one modal at a time.
//
// When the fallen empire is the player's own, the modal takes the
// fullscreen .big-event-modal treatment — defeat is as climactic as
// victory and deserves the same visual weight. AI eliminations stay
// on the compact portrait layout shared with first-contact and war
// declarations, since they're frequent beats rather than endgame.
export function EliminationModal({ elimination }: { elimination: PendingElimination }) {
  const dispatch = useGame((s) => s.dispatch);
  const turn = useGame((s) => s.state.turn);
  const dismiss = () => dispatch({ type: "dismissElimination" });

  if (elimination.wasPlayer) {
    return (
      <div className="modal-scrim big-event-scrim" role="dialog" aria-modal="true">
        <div className="big-event-modal">
          {elimination.portraitArt && (
            <img className="big-event-art" src={elimination.portraitArt} alt="" />
          )}
          <div className="big-event-overlay">
            <h2 className="big-event-title">{elimination.empireName} has fallen</h2>
            <div className="big-event-text">
              The last of your systems is gone. Fleet orders will go unanswered,
              colonies unsupplied, allies unanswered. Turn {turn}. There is
              nothing left to command.
            </div>
            <div className="big-event-choices">
              <button className="big-event-choice" onClick={dismiss}>
                <span className="big-event-choice-text">Close the archive</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-scrim" onClick={dismiss}>
      <div className="modal first-contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-head">
          {elimination.portraitArt && (
            <img
              className="profile-portrait"
              src={elimination.portraitArt}
              alt=""
              style={{ borderColor: elimination.empireColor, opacity: 0.55, filter: "grayscale(0.6)" }}
            />
          )}
          <div className="profile-title">
            <div className="profile-sub" style={{ color: "var(--bad)" }}>Empire fallen</div>
            <h2>{elimination.empireName}</h2>
          </div>
        </div>
        <div className="event-text">
          {elimination.empireName} has lost its last system on turn {elimination.turn}.
          The galaxy is one voice quieter.
        </div>
        <button className="close-btn" onClick={dismiss}>acknowledged</button>
      </div>
    </div>
  );
}
