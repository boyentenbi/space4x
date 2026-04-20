import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import { bodyIncome, perTurnIncome, totalPops } from "../sim/reducer";
import { RESOURCE_KEYS } from "../sim/events";
import type { Body, ResourceKey } from "../sim/types";
import { ResourceBar } from "./ResourceBar";
import { EventModal } from "./EventModal";

const RES_LABEL: Record<ResourceKey, string> = {
  food: "food",
  energy: "energy",
  alloys: "alloys",
  influence: "infl",
};

function BodyRow({
  body,
  income,
  isCapital,
}: {
  body: Body;
  income: Partial<Record<ResourceKey, number>>;
  isCapital: boolean;
}) {
  return (
    <div className={`body-row ${isCapital ? "capital" : ""}`}>
      <div className="body-head">
        <span className="body-name">
          {body.name} {body.kind === "moon" ? "◐" : "●"}
        </span>
        <span className={`hab ${body.habitability}`}>{body.habitability}</span>
      </div>
      <div className="body-stats">
        <span>pops {body.pops}/{body.space}</span>
        <span>hammers +{body.hammers}</span>
      </div>
      <div className="chips">
        {RESOURCE_KEYS.filter((k) => k !== "influence").map((k) => {
          const v = income[k] ?? 0;
          if (v === 0) return null;
          const cls = v > 0 ? "pos" : "neg";
          return (
            <span key={k} className={`chip ${cls}`}>
              {v > 0 ? "+" : ""}{v} {RES_LABEL[k]}
            </span>
          );
        })}
        {body.flavorFlags.map((f) => (
          <span key={f} className="chip flavor">{f.replace(/_/g, " ")}</span>
        ))}
      </div>
    </div>
  );
}

export function MainScreen() {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const reset = useGame((s) => s.reset);

  const origin = originById(state.empire.originId);
  const species = speciesById(state.empire.speciesId);
  const pendingEvent = state.eventQueue[0] ?? null;

  const capital = state.empire.capitalBodyId
    ? state.galaxy.bodies[state.empire.capitalBodyId]
    : null;
  const capitalSystem = capital ? state.galaxy.systems[capital.systemId] : null;

  const deltas = perTurnIncome(state);
  const totalHammers = state.empire.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return sum + sys.bodyIds.reduce((s, bid) => s + (state.galaxy.bodies[bid]?.hammers ?? 0), 0);
  }, 0);

  return (
    <>
      <div className="header">
        <h1>{state.empire.name}</h1>
        <span className="turn">Turn {state.turn}</span>
      </div>

      <ResourceBar resources={state.empire.resources} deltas={deltas} />

      <div className="compute-strip">
        <span>Compute · Hammers</span>
        <span className="value">
          {state.empire.compute.used}/{state.empire.compute.cap}
          {" · "}
          {totalHammers}/turn
        </span>
      </div>

      <div className="main">
        <div className="panel">
          <h2>Empire</h2>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div>
              <span style={{ color: "var(--text-dim)" }}>Species:</span> {species?.name ?? "?"}
            </div>
            <div>
              <span style={{ color: "var(--text-dim)" }}>Origin:</span> {origin?.name ?? "?"}
            </div>
            <div>
              <span style={{ color: "var(--text-dim)" }}>Population:</span> {totalPops(state)}
            </div>
            <div>
              <span style={{ color: "var(--text-dim)" }}>Capital:</span>{" "}
              {capital ? `${capital.name} (${capitalSystem?.name ?? "?"})` : "—"}
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Systems ({state.empire.systemIds.length})</h2>
          {state.empire.systemIds.map((sid) => {
            const sys = state.galaxy.systems[sid];
            if (!sys) return null;
            return (
              <div key={sid} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{sys.name}</div>
                {sys.bodyIds.map((bid) => {
                  const body = state.galaxy.bodies[bid];
                  if (!body) return null;
                  return (
                    <BodyRow
                      key={bid}
                      body={body}
                      income={bodyIncome(state, body)}
                      isCapital={body.id === state.empire.capitalBodyId}
                    />
                  );
                })}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>
            {Object.keys(state.galaxy.systems).length} total systems in the galaxy
          </div>
        </div>

        <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <h2>Chronicle</h2>
          <div className="log">
            {state.eventLog.length === 0 && (
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
                Nothing worth recording yet. End a turn to see what happens.
              </div>
            )}
            {[...state.eventLog].reverse().map((entry, i) => (
              <div className="log-item" key={`${entry.turn}-${i}`}>
                <span className="turn-tag">T{entry.turn}</span>
                {entry.text}
              </div>
            ))}
          </div>
        </div>

        <div className="actions footer-btn">
          <button onClick={() => dispatch({ type: "endTurn" })} disabled={!!pendingEvent}>
            End Turn
          </button>
          <button onClick={reset} style={{ flex: 0, padding: "10px 14px" }}>
            Reset
          </button>
        </div>
      </div>

      {pendingEvent && <EventModal eventId={pendingEvent.eventId} />}
    </>
  );
}
