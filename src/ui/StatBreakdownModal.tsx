import type { StatBreakdown } from "../sim/reducer";

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  return `${r}`;
}

export function StatBreakdownModal({
  breakdown,
  onClose,
}: {
  breakdown: StatBreakdown;
  onClose: () => void;
}) {
  const { title, iconSrc, unit, total, sections } = breakdown;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal breakdown-modal" onClick={(e) => e.stopPropagation()}>
        <div className="breakdown-head">
          <img src={iconSrc} alt="" className="breakdown-icon" />
          <div>
            <div className="breakdown-label">{unit ? "This turn" : "Current"}</div>
            <h2>
              {title}{" "}
              <span className={`breakdown-total ${total > 0 ? "pos" : total < 0 ? "neg" : ""}`}>
                {unit === "/turn" ? signed(total) : total}
                {unit && <span className="breakdown-unit">{unit}</span>}
              </span>
            </h2>
          </div>
        </div>

        {sections.map((section, i) => (
          <div key={i} className="breakdown-section">
            <div className="breakdown-section-label">{section.label}</div>
            {section.rows.map((row, j) => (
              <div key={j} className="breakdown-row">
                <span className="breakdown-row-name">{row.name}</span>
                <span className="breakdown-row-detail">
                  {row.habitability && <span className="breakdown-hab">{row.habitability} · </span>}
                  {row.detail}
                </span>
                <span className={`breakdown-row-value ${row.value > 0 ? "pos" : row.value < 0 ? "neg" : ""}`}>
                  {unit === "/turn" ? signed(row.value) : row.value}
                </span>
              </div>
            ))}
          </div>
        ))}

        {sections.length === 0 && (
          <div className="event-text" style={{ color: "var(--text-dim)" }}>
            No contributions to show yet.
          </div>
        )}

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
