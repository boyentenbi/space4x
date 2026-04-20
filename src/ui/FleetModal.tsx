import { useState } from "react";
import { speciesById } from "../sim/content";
import { empireById } from "../sim/reducer";
import { useGame } from "../store";

export function FleetModal({ fleetId, onClose }: { fleetId: string; onClose: () => void }) {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const fleet = state.fleets[fleetId];

  const [splitCount, setSplitCount] = useState(1);

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

  // Hyperlane-adjacent destinations.
  const adjacentSystemIds = new Set<string>();
  for (const [a, b] of state.galaxy.hyperlanes) {
    if (a === fleet.systemId) adjacentSystemIds.add(b);
    if (b === fleet.systemId) adjacentSystemIds.add(a);
  }
  const adjacent = Array.from(adjacentSystemIds)
    .map((id) => state.galaxy.systems[id])
    .filter((s): s is NonNullable<typeof s> => !!s);

  const canMove = isPlayer && fleet.movedTurn !== state.turn && fleet.shipCount > 0;
  const moveBlockedReason = !isPlayer
    ? "Foreign fleet — cannot command."
    : fleet.movedTurn === state.turn
      ? "Already moved this turn."
      : null;

  const splitClamped = Math.max(1, Math.min(fleet.shipCount - 1, splitCount));

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

        {moveBlockedReason && (
          <div className="fleet-blocked">{moveBlockedReason}</div>
        )}

        {isPlayer && (
          <>
            <div className="fleet-section">
              <div className="fleet-section-label">Move whole fleet</div>
              {adjacent.length === 0 && (
                <div className="policies-empty">No connected systems.</div>
              )}
              <div className="fleet-move-grid">
                {adjacent.map((sys) => (
                  <button
                    key={sys.id}
                    disabled={!canMove}
                    className="fleet-move-btn"
                    onClick={() => {
                      dispatch({ type: "moveFleet", fleetId: fleet.id, toSystemId: sys.id });
                      onClose();
                    }}
                  >
                    → {sys.name}
                  </button>
                ))}
              </div>
            </div>

            {fleet.shipCount > 1 && (
              <div className="fleet-section">
                <div className="fleet-section-label">Split and move</div>
                <div className="fleet-split-row">
                  <input
                    type="number"
                    min={1}
                    max={fleet.shipCount - 1}
                    value={splitCount}
                    onChange={(e) => setSplitCount(parseInt(e.target.value, 10) || 1)}
                  />
                  <span>of {fleet.shipCount}</span>
                </div>
                <div className="fleet-move-grid">
                  {adjacent.map((sys) => (
                    <button
                      key={sys.id}
                      disabled={!canMove}
                      className="fleet-move-btn"
                      onClick={() => {
                        dispatch({
                          type: "moveFleet",
                          fleetId: fleet.id,
                          toSystemId: sys.id,
                          count: splitClamped,
                        });
                        onClose();
                      }}
                    >
                      → {sys.name} ({splitClamped})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
