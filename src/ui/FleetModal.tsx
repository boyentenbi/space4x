import { speciesById } from "../sim/content";
import { empireById } from "../sim/reducer";
import { useGame } from "../store";

// Read-only info view. Used for foreign fleets and for friendly fleets
// that can't move right now (already moved, zero ships). Actually
// moving is done via the galaxy-map move-mode flow, so no destination
// buttons live here.
export function FleetModal({ fleetId, onClose }: { fleetId: string; onClose: () => void }) {
  const state = useGame((s) => s.state);
  const fleet = state.fleets[fleetId];

  if (!fleet) {
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Fleet scattered</h2>
          <div className="event-text">That fleet is no longer in play.</div>
          <button className="close-btn" onClick={onClose}>close</button>
        </div>
      </div>
    );
  }

  const empire = empireById(state, fleet.empireId);
  const species = empire ? speciesById(empire.speciesId) : null;
  const system = state.galaxy.systems[fleet.systemId];
  const isPlayer = fleet.empireId === state.empire.id;

  const status = !isPlayer
    ? "Foreign fleet — cannot command."
    : fleet.movedTurn === state.turn
      ? "Already moved this turn."
      : fleet.shipCount <= 0
        ? "No ships left."
        : "Tap the fleet pill on the system view to move it.";

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal fleet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fleet-head">
          {species?.art && (
            <img
              className="fleet-portrait"
              src={empire?.portraitArt || species.art}
              alt=""
              style={{ borderColor: empire?.color ?? "var(--accent)" }}
            />
          )}
          <div>
            <div className="fleet-sub">{isPlayer ? "Your fleet" : "Rival fleet"} · {system?.name ?? ""}</div>
            <h2>
              <svg width="14" height="14" viewBox="0 0 10 10" style={{ verticalAlign: "middle", marginRight: 6 }}>
                <polygon points="5,1 9,9 1,9" fill={empire?.color ?? "var(--text)"} />
              </svg>
              {fleet.shipCount} ship{fleet.shipCount === 1 ? "" : "s"}
            </h2>
            <div className="fleet-empire">{empire?.name ?? "?"}</div>
          </div>
        </div>

        <div className="fleet-blocked">{status}</div>

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
