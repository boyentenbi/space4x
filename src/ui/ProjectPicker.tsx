import { useMemo } from "react";
import type { GameState } from "../sim/types";
import { canColonize, COLONIZE_HAMMERS, COLONIZE_POLITICAL } from "../sim/reducer";

export function ProjectPicker({
  state,
  sourceBodyId,
  onQueue,
  onClose,
}: {
  state: GameState;
  sourceBodyId: string;
  onQueue: (targetBodyId: string) => void;
  onClose: () => void;
}) {
  const candidates = useMemo(() => {
    const out: { bodyId: string; systemName: string; bodyName: string; hab: string }[] = [];
    for (const body of Object.values(state.galaxy.bodies)) {
      if (!canColonize(state, body.id)) continue;
      const sys = state.galaxy.systems[body.systemId];
      if (!sys) continue;
      out.push({
        bodyId: body.id,
        systemName: sys.name,
        bodyName: body.name,
        hab: body.habitability,
      });
    }
    return out.sort((a, b) => a.systemName.localeCompare(b.systemName) || a.bodyName.localeCompare(b.bodyName));
  }, [state, sourceBodyId]);

  const sourceBody = state.galaxy.bodies[sourceBodyId];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Colonize</h2>
        <div className="event-text" style={{ fontSize: 13 }}>
          From <strong>{sourceBody?.name ?? "—"}</strong>.{" "}
          Cost: {COLONIZE_HAMMERS} hammers · {COLONIZE_POLITICAL} political capital on completion.
        </div>
        <div className="choices">
          {candidates.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
              No adjacent unclaimed bodies in reach. Expand through your hyperlane neighbors first.
            </div>
          )}
          {candidates.map((c) => (
            <button
              key={c.bodyId}
              onClick={() => {
                onQueue(c.bodyId);
                onClose();
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 500 }}>{c.bodyName}</span>
                <span className={`hab ${c.hab}`} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>{c.hab}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>in {c.systemName}</span>
            </button>
          ))}
        </div>
        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
