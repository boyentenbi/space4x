import { useGame } from "../store";
import { speciesById } from "../sim/content";
import { allEmpires, atWar } from "../sim/reducer";

export function EmpireRosterModal({
  onPick,
  onClose,
}: {
  onPick: (empireId: string) => void;
  onClose: () => void;
}) {
  const state = useGame((s) => s.state);
  const empires = allEmpires(state);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal empire-roster" onClick={(e) => e.stopPropagation()}>
        <h2>Empires</h2>
        <div className="roster-list">
          {empires.map((e) => {
            const species = speciesById(e.speciesId);
            const portraitSrc = e.portraitArt || species?.art;
            const isPlayer = e.id === state.empire.id;
            return (
              <button
                key={e.id}
                className="roster-row"
                onClick={() => onPick(e.id)}
                style={{ borderLeftColor: e.color }}
              >
                {portraitSrc && (
                  <img
                    className="roster-portrait"
                    src={portraitSrc}
                    alt=""
                    style={{ borderColor: e.color }}
                  />
                )}
                <div className="roster-body">
                  <div className="roster-name">
                    {e.name || (isPlayer ? "Your empire" : "Unknown")}
                    {!isPlayer && atWar(state, state.empire.id, e.id) && (
                      <span className="roster-war-tag">at war</span>
                    )}
                  </div>
                  <div className="roster-meta">
                    {species?.name ?? "?"} · {e.expansionism} · {e.politic}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
