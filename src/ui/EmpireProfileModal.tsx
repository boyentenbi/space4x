import { useGame } from "../store";
import { leaderContentById, speciesById } from "../sim/content";
import { atWar, empireById, empireModifiers, empireSpeciesName, totalPopsOf } from "../sim/reducer";
import type { Expansionism, Politic } from "../sim/types";
import { ModifierChip } from "./modifierUi";

const EXPANSIONISM_BLURB: Record<Expansionism, string> = {
  conqueror:
    "Pushes borders aggressively. Refuses pacts and trade. Expect war on contact.",
  pragmatist:
    "Expands when profitable. Open to pacts and trade when the math works.",
  isolationist:
    "Dug in. Rarely pushes past current borders. Accepts pacts readily.",
};

const POLITIC_BLURB: Record<Politic, string> = {
  collectivist:
    "State over individual — authority is centralized, dissent rare. Mass mobilisation is its strength.",
  centrist: "Balanced — neither state nor atomized.",
  individualist:
    "Individual over state — personal liberty is prized and decisions are decentralized.",
};

export function EmpireProfileModal({
  empireId,
  onClose,
}: {
  empireId: string;
  onClose: () => void;
}) {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const empire = empireById(state, empireId);
  if (!empire) {
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Unknown empire</h2>
          <button className="close-btn" onClick={onClose}>close</button>
        </div>
      </div>
    );
  }

  const species = speciesById(empire.speciesId);
  const leader = empire.leaderId ? leaderContentById(empire.leaderId) : null;
  const portraitSrc = empire.portraitArt || species?.art;
  const playerId = state.humanEmpireId;
  const isPlayer = !!playerId && empireId === playerId;
  const modifiers = empireModifiers(empire);
  const pops = totalPopsOf(state, empire);
  const systemsOwned = empire.systemIds.length;
  const isAtWar = !!playerId && !isPlayer && atWar(state, playerId, empire.id);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal empire-profile" onClick={(e) => e.stopPropagation()}>
        <div className="profile-head">
          {portraitSrc && (
            <img
              className="profile-portrait"
              src={portraitSrc}
              alt=""
              style={{ borderColor: empire.color }}
            />
          )}
          <div className="profile-title">
            <div className="profile-sub">
              {isPlayer ? "Your empire" : "Rival empire"} · {empireSpeciesName(empire)}
            </div>
            <h2>{empire.name || (isPlayer ? "Unnamed" : "Unknown")}</h2>
            <div className="profile-archetype">
              <span className="archetype-tag">{empire.expansionism}</span>
              <span className="archetype-tag">{empire.politic}</span>
            </div>
          </div>
        </div>

        {leader?.manifesto && (
          <blockquote className="profile-manifesto">"{leader.manifesto}"</blockquote>
        )}

        <div className="profile-section">
          <div className="profile-section-label">Disposition</div>
          <div className="profile-disposition">
            <div>{EXPANSIONISM_BLURB[empire.expansionism]}</div>
            <div>{POLITIC_BLURB[empire.politic]}</div>
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-label">Stats</div>
          <div className="profile-stats">
            <span>{systemsOwned} system{systemsOwned === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{Math.floor(pops)} pops</span>
          </div>
        </div>

        {modifiers.length > 0 && (
          <div className="profile-section">
            <div className="profile-section-label">Active modifiers</div>
            <div className="profile-modifiers">
              {modifiers.map((m, i) => (
                <ModifierChip key={i} mod={m} />
              ))}
            </div>
          </div>
        )}

        {!isPlayer && (
          <div className="profile-section">
            <div className="profile-section-label">Diplomacy</div>
            <div className="profile-diplomacy">
              <span className={`diplomacy-status ${isAtWar ? "war" : "peace"}`}>
                {isAtWar ? "At war" : "At peace"}
              </span>
              {isAtWar ? (
                <button
                  className="diplomacy-btn peace-btn"
                  onClick={() => {
                    dispatch({
                      type: "makePeace",
                      byEmpireId: playerId!,
                      targetEmpireId: empire.id,
                    });
                    onClose();
                  }}
                >
                  Make peace
                </button>
              ) : (
                <button
                  className="diplomacy-btn war-btn"
                  onClick={() => {
                    dispatch({
                      type: "declareWar",
                      byEmpireId: playerId!,
                      targetEmpireId: empire.id,
                    });
                    onClose();
                  }}
                >
                  Declare war
                </button>
              )}
            </div>
          </div>
        )}

        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
