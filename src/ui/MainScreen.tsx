import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import { ResourceBar } from "./ResourceBar";
import { EventModal } from "./EventModal";

export function MainScreen() {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const reset = useGame((s) => s.reset);

  const origin = originById(state.empire.originId);
  const species = speciesById(state.empire.speciesId);
  const pendingEvent = state.eventQueue[0] ?? null;

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
              <span style={{ color: "var(--text-dim)" }}>Population:</span> {state.empire.pops}
            </div>
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
