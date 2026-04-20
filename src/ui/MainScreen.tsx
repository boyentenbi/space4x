import { useState } from "react";
import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import {
  bodyIncome,
  canColonize,
  colonizeOrderForTarget,
  COLONIZE_HAMMERS,
  COLONIZE_POLITICAL,
  perTurnIncome,
  totalPops,
} from "../sim/reducer";
import { RESOURCE_KEYS } from "../sim/events";
import type { Body, Resources, ResourceKey } from "../sim/types";
import { EventModal } from "./EventModal";
import { GalaxyMap } from "./GalaxyMap";
import { SystemScene } from "./SystemScene";
import { PortraitMenu } from "./PortraitMenu";
import { COMPUTE_ICON, HAMMERS_ICON, POPS_ICON, RESOURCE_ICON, planetSpriteFor } from "./icons";

const RESOURCE_ORDER: ResourceKey[] = ["food", "energy", "alloys", "political"];

// Matches SystemScene: planet sprite radius 13, moon radius 8.
// Scale both proportionally for the body-list thumbnails.
const BODY_THUMB_BASE = 26; // diameter of a planet in the list
const BODY_THUMB_MOON_RATIO = 8 / 13;

function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  return `${r}`;
}

function ResCell({
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
    <div className="res-cell">
      <img className="cell-icon" src={icon} alt="" />
      <span className="cell-value">{value}</span>
      {delta !== undefined && <span className={`cell-delta ${cls}`}>{fmtDelta(d)}</span>}
    </div>
  );
}

function BodyRow({
  body,
  income,
  isCapital,
  owned,
  colonizable,
  activeOrder,
  colonizeTurns,
  onColonize,
  onCancelOrder,
}: {
  body: Body;
  income: Partial<Record<ResourceKey, number>>;
  isCapital: boolean;
  owned: boolean;
  colonizable: boolean;
  activeOrder: { id: string; hammersPaid: number; hammersRequired: number } | null;
  colonizeTurns: number;
  onColonize: () => void;
  onCancelOrder: (orderId: string) => void;
}) {
  const thumbSize =
    body.kind === "moon" ? BODY_THUMB_BASE * BODY_THUMB_MOON_RATIO : BODY_THUMB_BASE;
  return (
    <div className={`body-row ${isCapital ? "capital" : ""}`}>
      <div className="body-head">
        <span className="body-name">
          <span
            className="body-thumb-wrap"
            style={{ width: BODY_THUMB_BASE, height: BODY_THUMB_BASE }}
          >
            <img
              className="body-thumb"
              src={planetSpriteFor(body.id, body.habitability)}
              alt=""
              style={{ width: thumbSize, height: thumbSize }}
            />
          </span>
          {body.name}
        </span>
        <span className={`hab ${body.habitability}`}>{body.habitability}</span>
      </div>
      <div className="body-stats">
        <span className="stat-pill">
          <img className="stat-icon" src={POPS_ICON} alt="" />
          {body.pops}/{body.space}
        </span>
        {owned && body.hammers > 0 && (
          <span className="stat-pill">
            <img className="stat-icon" src={HAMMERS_ICON} alt="" />
            +{body.hammers}
          </span>
        )}
      </div>
      {owned && (
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
      )}

      {!owned && body.flavorFlags.length > 0 && (
        <div className="chips">
          {body.flavorFlags.map((f) => (
            <span key={f} className="chip flavor">{f.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}

      {activeOrder ? (
        <div className="project-progress">
          <div className="project-head">
            <span>Colonizing</span>
            <button
              className="project-cancel"
              onClick={() => onCancelOrder(activeOrder.id)}
              title="Cancel"
            >
              ×
            </button>
          </div>
          <div className="project-bar">
            <div
              className="project-bar-fill"
              style={{ width: `${Math.min(100, (activeOrder.hammersPaid / activeOrder.hammersRequired) * 100)}%` }}
            />
          </div>
          <div className="project-stats">
            {activeOrder.hammersPaid}/{activeOrder.hammersRequired}
          </div>
        </div>
      ) : colonizable ? (
        <button className="project-btn colonize-btn" onClick={onColonize}>
          <span>+ Colonize</span>
          <span className="colonize-cost">
            <img className="stat-icon" src={HAMMERS_ICON} alt="" />
            {COLONIZE_HAMMERS}
            <img className="stat-icon" src={RESOURCE_ICON.political} alt="" />
            {COLONIZE_POLITICAL}
            <span className="colonize-turns">· {colonizeTurns}T</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function MainScreen() {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const reset = useGame((s) => s.reset);

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const origin = originById(state.empire.originId);
  const species = speciesById(state.empire.speciesId);
  const pendingEvent = state.eventQueue[0] ?? null;

  const capital = state.empire.capitalBodyId
    ? state.galaxy.bodies[state.empire.capitalBodyId]
    : null;
  const capitalSystem = capital ? state.galaxy.systems[capital.systemId] : null;

  const deltas: Resources = perTurnIncome(state);
  const totalHammers = state.empire.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return sum + sys.bodyIds.reduce((s, bid) => s + (state.galaxy.bodies[bid]?.hammers ?? 0), 0);
  }, 0);
  const popsNow = totalPops(state);
  const popsCap = state.empire.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return sum + sys.bodyIds.reduce((s, bid) => s + (state.galaxy.bodies[bid]?.space ?? 0), 0);
  }, 0);
  // Turns to finish a new colonize project, given current hammer rate and
  // any existing FIFO queue already consuming from the pool.
  function turnsToColonize(): number {
    if (totalHammers <= 0) return Infinity;
    const backlogHammers = state.empire.projects.reduce(
      (s, o) => s + (o.hammersRequired - o.hammersPaid),
      0,
    );
    const totalNeed = backlogHammers + COLONIZE_HAMMERS;
    return Math.ceil(totalNeed / totalHammers);
  }
  const colonizeTurnEstimate = turnsToColonize();

  const focusSystem = selectedSystemId
    ? state.galaxy.systems[selectedSystemId] ?? null
    : capitalSystem;
  const focusBodies = focusSystem
    ? focusSystem.bodyIds.map((bid) => state.galaxy.bodies[bid]).filter((b): b is Body => !!b)
    : [];
  const focusOwned = focusSystem
    ? state.empire.systemIds.includes(focusSystem.id)
    : false;

  return (
    <>
      {/* ===== Left sidebar ===== */}
      <div className="sidebar">
        {species?.art && (
          <div
            className="portrait-card"
            style={{ borderColor: state.empire.color }}
            title={`${species.name} · ${state.empire.name}`}
          >
            <img src={species.art} alt={species.name} />
          </div>
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

        <div className="res-grid">
          {RESOURCE_ORDER.map((k) => (
            <ResCell
              key={k}
              icon={RESOURCE_ICON[k]}
              value={Math.round(state.empire.resources[k])}
              delta={deltas[k]}
            />
          ))}
          <ResCell icon={COMPUTE_ICON} value={state.empire.compute.cap} />
          <ResCell icon={HAMMERS_ICON} value={totalHammers} />
          <ResCell icon={POPS_ICON} value={`${popsNow}/${popsCap}`} />
        </div>

        <button className="menu-btn" onClick={() => setMenuOpen(true)}>
          Menu
        </button>

        <div className="version-tag" title="Build version">
          {__APP_VERSION__}
        </div>
      </div>

      {/* ===== Main ===== */}
      <div className="main-column">
        <div className="system-panel">
          <div className="scene-wrap">
            <div className="panel-label">
              <span>
                {focusSystem
                  ? `${focusSystem.name}${focusOwned && focusSystem.id === capitalSystem?.id ? " · home" : focusOwned ? "" : " · unclaimed"}`
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
              focusBodies.map((body) => {
                const order = colonizeOrderForTarget(state, body.id);
                return (
                  <BodyRow
                    key={body.id}
                    body={body}
                    income={focusOwned ? bodyIncome(state, body) : {}}
                    isCapital={body.id === state.empire.capitalBodyId}
                    owned={focusOwned}
                    colonizable={canColonize(state, body.id)}
                    activeOrder={order}
                    colonizeTurns={colonizeTurnEstimate}
                    onColonize={() =>
                      dispatch({ type: "queueColonize", targetBodyId: body.id })
                    }
                    onCancelOrder={(orderId) =>
                      dispatch({ type: "cancelOrder", orderId })
                    }
                  />
                );
              })
            ) : (
              <div className="empire-card">
                <div><span className="stat-label">Species:</span> {species?.name ?? "?"}</div>
                <div><span className="stat-label">Origin:</span> {origin?.name ?? "?"}</div>
                <div><span className="stat-label">Population:</span> {totalPops(state)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="right-column">
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

          <div className="chronicle-panel">
            <div className="panel-label">
              <span>Chronicle</span>
              <span className="count">{state.eventLog.length}</span>
            </div>
            <div className="log-scroll">
              {state.eventLog.length === 0 ? (
                <div className="log-empty">Nothing recorded yet. End a turn to see what happens.</div>
              ) : (
                [...state.eventLog].reverse().map((entry, i) => (
                  <div key={`${entry.turn}-${i}`} className="log-item">
                    <span className="turn-tag">T{entry.turn}</span>
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {pendingEvent && <EventModal eventId={pendingEvent.eventId} />}
      {menuOpen && (
        <PortraitMenu onReset={reset} onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
}
