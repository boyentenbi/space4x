import { policyById } from "../sim/content";
import { availablePoliciesFor, empireDiameter } from "../sim/reducer";
import { useGame } from "../store";
import { ModifierChip } from "./modifierUi";
import { RESOURCE_ICON } from "./icons";

export function PoliciesModal({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const empire = state.empire;
  const available = availablePoliciesFor(state, empire);
  const adopted = empire.adoptedPolicies
    .map((id) => policyById(id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const diameter = empireDiameter(state, empire);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal policies-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Policies</h2>
        <div className="policies-subtitle">
          Empire diameter <strong>{diameter}</strong> · each step raises policy cost by 15%.
          Current political capital: {Math.round(empire.political)}.
        </div>

        {adopted.length > 0 && (
          <div className="policies-section">
            <div className="policies-section-label">Adopted</div>
            {adopted.map((p) => (
              <div key={p.id} className="policy-card adopted">
                <div className="policy-card-head">
                  <span className="policy-name">{p.name}</span>
                </div>
                <div className="policy-card-desc">{p.description}</div>
                <div className="policy-mods">
                  {p.modifiers.map((m, i) => (
                    <ModifierChip key={i} mod={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="policies-section">
          <div className="policies-section-label">Available</div>
          {available.length === 0 && (
            <div className="policies-empty">No further policies available.</div>
          )}
          {available.map(({ policyId, cost, affordable }) => {
            const p = policyById(policyId);
            if (!p) return null;
            return (
              <div key={p.id} className="policy-card available">
                <div className="policy-card-head">
                  <span className="policy-name">{p.name}</span>
                  <button
                    className="policy-adopt"
                    disabled={!affordable}
                    onClick={() =>
                      dispatch({
                        type: "adoptPolicy",
                        byEmpireId: empire.id,
                        policyId: p.id,
                      })
                    }
                    title={
                      !affordable
                        ? `Requires ${cost} political capital (you have ${Math.round(empire.political)}).`
                        : `Costs ${cost} political capital.`
                    }
                  >
                    Adopt · {cost}
                    <img className="stat-icon" src={RESOURCE_ICON.political} alt="" />
                  </button>
                </div>
                <div className="policy-card-desc">{p.description}</div>
                <div className="policy-mods">
                  {p.modifiers.map((m, i) => (
                    <ModifierChip key={i} mod={m} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
