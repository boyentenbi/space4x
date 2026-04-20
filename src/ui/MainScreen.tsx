import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import { totalPops } from "../sim/reducer";
import { ResourceBar } from "./ResourceBar";
import { EventModal } from "./EventModal";

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
  const ownedBodies = state.empire.systemIds
    .flatMap((sid) => state.galaxy.systems[sid]?.bodyIds ?? [])
    .map((bid) => state.galaxy.bodies[bid])
    .filter(Boolean);

  return (
    <>
      <div className="header">
        <h1>{state.empire.name}</h1>
        <span className="turn">Turn {state.turn}</span>
      </div>

      <ResourceBar resources={state.empire.resources} />

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
          <h2>Systems</h2>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {state.empire.systemIds.map((sid) => {
              const sys = state.galaxy.systems[sid];
              if (!sys) return null;
              const bodies = sys.bodyIds.map((bid) => state.galaxy.bodies[bid]).filter(Boolean);
              return (
                <div key={sid} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{sys.name}</div>
                  {bodies.map((b) => (
                    <div key={b.id} style={{ color: "var(--text-dim)", paddingLeft: 8 }}>
                      • {b.name} — {b.habitability}, pops {b.pops}/{b.space}
                      {b.flavorFlags.length > 0 && ` · ${b.flavorFlags.join(", ")}`}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
            {Object.keys(state.galaxy.systems).length} systems in the galaxy ·{" "}
            {ownedBodies.length} bodies yours
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
