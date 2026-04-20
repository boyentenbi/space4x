import { useGame } from "../store";
import { resourceBreakdownFor } from "../sim/reducer";
import type { ResourceKey } from "../sim/types";
import { RESOURCE_ICON } from "./icons";

const RESOURCE_NAME: Record<ResourceKey, string> = {
  food: "Food",
  energy: "Energy",
  alloys: "Alloys",
  political: "Political Capital",
};

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  return `${r}`;
}

export function ResourceBreakdownModal({
  resource,
  onClose,
}: {
  resource: ResourceKey;
  onClose: () => void;
}) {
  const state = useGame((s) => s.state);
  const breakdown = resourceBreakdownFor(state, state.empire, resource);

  const perBody = breakdown.perBody.filter((r) => r.contribution !== 0);
  const flat = breakdown.flat.filter((r) => r.value !== 0);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal breakdown-modal" onClick={(e) => e.stopPropagation()}>
        <div className="breakdown-head">
          <img src={RESOURCE_ICON[resource]} alt="" className="breakdown-icon" />
          <div>
            <div className="breakdown-label">This turn</div>
            <h2>
              {RESOURCE_NAME[resource]}{" "}
              <span className={`breakdown-total ${breakdown.total > 0 ? "pos" : breakdown.total < 0 ? "neg" : ""}`}>
                {signed(breakdown.total)}
              </span>
            </h2>
          </div>
        </div>

        {perBody.length > 0 && (
          <div className="breakdown-section">
            <div className="breakdown-section-label">Per body</div>
            {perBody.map((row) => (
              <div key={row.bodyId} className="breakdown-row">
                <span className="breakdown-row-name">{row.bodyName}</span>
                <span className="breakdown-row-detail">
                  {row.pops} <span className="breakdown-hab">{row.habitability}</span> ·{" "}
                  {row.upkeep > 0
                    ? `(${row.perPop} − ${row.upkeep}) × ${row.pops}`
                    : `${row.perPop} × ${row.pops}`}
                </span>
                <span className={`breakdown-row-value ${row.contribution > 0 ? "pos" : row.contribution < 0 ? "neg" : ""}`}>
                  {signed(row.contribution)}
                </span>
              </div>
            ))}
          </div>
        )}

        {flat.length > 0 && (
          <div className="breakdown-section">
            <div className="breakdown-section-label">Empire-wide</div>
            {flat.map((row, i) => (
              <div key={i} className="breakdown-row">
                <span className="breakdown-row-name">{row.label}</span>
                <span className={`breakdown-row-value ${row.value > 0 ? "pos" : row.value < 0 ? "neg" : ""}`}>
                  {signed(row.value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {perBody.length === 0 && flat.length === 0 && (
          <div className="event-text" style={{ color: "var(--text-dim)" }}>
            No contributions to show. Colonize a body to start producing.
          </div>
        )}

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
