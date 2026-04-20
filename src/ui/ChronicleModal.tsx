import type { GameState } from "../sim/types";

export function ChronicleModal({
  log,
  onClose,
}: {
  log: GameState["eventLog"];
  onClose: () => void;
}) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Chronicle</h2>
        <div className="log-list">
          {log.length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
              Nothing recorded yet.
            </div>
          )}
          {[...log].reverse().map((entry, i) => (
            <div className="log-item" key={`${entry.turn}-${i}`}>
              <span className="turn-tag">T{entry.turn}</span>
              {entry.text}
            </div>
          ))}
        </div>
        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
