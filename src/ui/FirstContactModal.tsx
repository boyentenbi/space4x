import { leaderContentById, speciesById } from "../sim/content";
import { empireById } from "../sim/reducer";
import { useGame } from "../store";

// Shown when the player's empire becomes hyperlane-adjacent to another
// empire for the first time. Pulls the other empire's portrait + leader
// manifesto so the meeting feels like meeting a character, not a
// faceless rival. One-shot per pair (the reducer flags "met:<id>" so it
// can't re-fire).
export function FirstContactModal({
  otherEmpireId,
  onDismiss,
}: {
  otherEmpireId: string;
  onDismiss: () => void;
}) {
  const state = useGame((s) => s.state);
  const other = empireById(state, otherEmpireId);
  if (!other) {
    return (
      <div className="modal-scrim" onClick={onDismiss}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Signal lost</h2>
          <button className="close-btn" onClick={onDismiss}>close</button>
        </div>
      </div>
    );
  }
  const species = speciesById(other.speciesId);
  const leader = other.leaderId ? leaderContentById(other.leaderId) : null;
  const portraitSrc = other.portraitArt || species?.art;

  return (
    <div className="modal-scrim" onClick={onDismiss}>
      <div className="modal first-contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-head">
          {portraitSrc && (
            <img
              className="profile-portrait"
              src={portraitSrc}
              alt=""
              style={{ borderColor: other.color }}
            />
          )}
          <div className="profile-title">
            <div className="profile-sub">First contact</div>
            <h2>{other.name}</h2>
            <div className="profile-archetype">
              <span className="archetype-tag">{species?.name ?? "?"}</span>
              <span className="archetype-tag">{other.expansionism}</span>
              <span className="archetype-tag">{other.politic}</span>
            </div>
          </div>
        </div>
        {leader?.manifesto && (
          <blockquote className="profile-manifesto">"{leader.manifesto}"</blockquote>
        )}
        <div className="event-text">
          Their borders now touch yours. What happens next is up to you.
        </div>
        <button className="close-btn" onClick={onDismiss}>acknowledged</button>
      </div>
    </div>
  );
}
