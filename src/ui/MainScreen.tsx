import { useState } from "react";
import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import { bodyIncome, perTurnIncome, totalPops } from "../sim/reducer";
import { RESOURCE_KEYS } from "../sim/events";
import type { Body, ResourceKey } from "../sim/types";
import { EventModal } from "./EventModal";
import { GalaxyMap } from "./GalaxyMap";
import { SystemScene } from "./SystemScene";
import { ChronicleModal } from "./ChronicleModal";
import { PortraitMenu } from "./PortraitMenu";
import { COMPUTE_ICON, HAMMERS_ICON, RESOURCE_ICON } from "./icons";

const RESOURCE_ORDER: ResourceKey[] = ["food", "energy", "alloys", "political"];

function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  return `${r}`;
}

function FlowPill({
  icon,
  value,
  delta,
}: {
  icon: string;
  value: string | number;
  delta?: number;
}) {
  const d = delta ?? 0;
  const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
  return (
    <span className="flow-pill">
      <img className="pill-icon" src={icon} alt="" />
      <span>{value}</span>
      {delta !== undefined && <span className={`pill-delta ${cls}`}>{fmtDelta(d)}</span>}
    </span>
  );
}

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
        {RESOURCE_KEYS.filter((k) => k !== "political").map((k) => {
          const v = income[k] ?? 0;
          if (v === 0) return null;
          const cls = v > 0 ? "pos" : "neg";
          return (
            <span key={k} className={`chip ${cls}`}>
              <img className="chip-icon" src={RESOURCE_ICON[k]} alt="" />
              {v > 0 ? "+" : ""}{v}
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

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [chronicleOpen, setChronicleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const focusSystem = selectedSystemId
    ? state.galaxy.systems[selectedSystemId] ?? null
    : capitalSystem;
  const focusBodies = focusSystem
    ? focusSystem.bodyIds.map((bid) => state.galaxy.bodies[bid]).filter((b): b is Body => !!b)
    : [];
  const focusOwned = focusSystem
    ? state.empire.systemIds.includes(focusSystem.id)
    : false;

  const lastChronicle = state.eventLog.length > 0 ? state.eventLog[state.eventLog.length - 1] : null;

  return (
    <>
      {/* ===== Left sidebar ===== */}
      <div className="sidebar">
        {species?.art && (
          <button
            className="portrait-card"
            style={{ borderColor: state.empire.color }}
            title={`${species.name} · ${state.empire.name} — menu`}
            onClick={() => setMenuOpen(true)}
          >
            <img src={species.art} alt={species.name} />
          </button>
        )}
        <button
          className="endturn-card"
          onClick={() => dispatch({ type: "endTurn" })}
          disabled={!!pendingEvent}
          title="End turn"
        >
          <span className="turn-num">T{state.turn}</span>
          <span>End Turn</span>
        </button>
      </div>

      {/* ===== Main column ===== */}
      <div className="main-column">
        {/* Narrow flows strip */}
        <div className="flows-inline">
          {RESOURCE_ORDER.map((k) => (
            <FlowPill
              key={k}
              icon={RESOURCE_ICON[k]}
              value={Math.round(state.empire.resources[k])}
              delta={deltas[k]}
            />
          ))}
          <span className="flow-divider" />
          <FlowPill
            icon={COMPUTE_ICON}
            value={`${state.empire.compute.used}/${state.empire.compute.cap}`}
          />
          <FlowPill icon={HAMMERS_ICON} value={`${totalHammers}/t`} />
        </div>

        {/* System (left) + Galaxy (right), equal-width, equal-height. */}
        <div className="panels-row">
          <div className="system-panel">
            <div className="scene-wrap">
              <div className="panel-label">
                <span>
                  {focusSystem
                    ? `${focusSystem.name}${focusOwned && focusSystem.id !== capitalSystem?.id ? "" : focusOwned ? " · home" : " · unclaimed"}`
                    : "System"}
                </span>
                {selectedSystemId && (
                  <button className="deselect-btn" onClick={() => setSelectedSystemId(null)}>
                    home
                  </button>
                )}
              </div>
              {focusSystem ? (
                <SystemScene
                  system={focusSystem}
                  bodies={focusBodies}
                  ownerColor={focusOwned ? state.empire.color : null}
                  capitalBodyId={state.empire.capitalBodyId}
                  turn={state.turn}
                />
              ) : (
                <div className="scene-empty">Tap a star on the galaxy map.</div>
              )}
            </div>
            <div className="detail-scroll">
              {focusSystem ? (
                focusBodies.map((body) => (
                  <BodyRow
                    key={body.id}
                    body={body}
                    income={focusOwned ? bodyIncome(state, body) : {}}
                    isCapital={body.id === state.empire.capitalBodyId}
                  />
                ))
              ) : (
                <div className="empire-card">
                  <div><span className="stat-label">Species:</span> {species?.name ?? "?"}</div>
                  <div><span className="stat-label">Origin:</span> {origin?.name ?? "?"}</div>
                  <div><span className="stat-label">Population:</span> {totalPops(state)}</div>
                </div>
              )}
              <div className="chronicle-ticker" onClick={() => setChronicleOpen(true)}>
                <span className="ticker-label">Log</span>
                <span className="ticker-text">
                  {lastChronicle ? lastChronicle.text : "Nothing recorded yet."}
                </span>
                <span className="ticker-count">{state.eventLog.length}</span>
              </div>
            </div>
          </div>

          <div className="galaxy-panel">
            <span className="panel-label">Galaxy</span>
            <GalaxyMap
              galaxy={state.galaxy}
              ownedSystemIds={state.empire.systemIds}
              ownerColor={state.empire.color}
              selectedId={selectedSystemId}
              onSelect={setSelectedSystemId}
            />
            <span className="panel-stats">
              {state.empire.systemIds.length}/{Object.keys(state.galaxy.systems).length} yours
            </span>
          </div>
        </div>
      </div>

      {pendingEvent && <EventModal eventId={pendingEvent.eventId} />}
      {chronicleOpen && (
        <ChronicleModal log={state.eventLog} onClose={() => setChronicleOpen(false)} />
      )}
      {menuOpen && (
        <PortraitMenu onReset={reset} onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
}
