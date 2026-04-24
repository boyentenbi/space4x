import { leaderContentById, speciesById } from "../sim/content";
import { empireById, empireSpeciesName } from "../sim/reducer";
import { useGame } from "../store";

// Shown when another empire declares war on the player — either by
// pushing a fleet across our border (auto-declare) or via an explicit
// declareWar action. Symmetric to FirstContactModal: we portrait the
// aggressor and quote their leader so the declaration has a face.
// Only fires for the defender; when the player initiates war they
// already know they just did it.
export function WarDeclaredModal({
  aggressorEmpireId,
  onDismiss,
}: {
  aggressorEmpireId: string;
  onDismiss: () => void;
}) {
  const state = useGame((s) => s.state);
  const other = empireById(state, aggressorEmpireId);
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
            <div className="profile-sub" style={{ color: "var(--bad)" }}>War declared</div>
            <h2>{other.name}</h2>
            <div className="profile-archetype">
              <span className="archetype-tag">{empireSpeciesName(other)}</span>
              <span className="archetype-tag">{other.expansionism}</span>
              <span className="archetype-tag">{other.politic}</span>
            </div>
          </div>
        </div>
        {leader?.manifesto && (
          <blockquote className="profile-manifesto">"{leader.manifesto}"</blockquote>
        )}
        <div className="event-text">
          {other.name} has declared war on you. Their fleets are now hostile to yours;
          yours to theirs.
        </div>
        <button className="close-btn" onClick={onDismiss}>acknowledged</button>
      </div>
    </div>
  );
}
