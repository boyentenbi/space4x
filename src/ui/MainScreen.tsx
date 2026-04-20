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
import type { Body, HabitabilityTier, Resources, ResourceKey } from "../sim/types";
import { EventModal } from "./EventModal";
import { GalaxyMap } from "./GalaxyMap";
import { SystemScene } from "./SystemScene";
import { PortraitMenu } from "./PortraitMenu";
import { COMPUTE_ICON, HAMMERS_ICON, RESOURCE_ICON } from "./icons";

const RESOURCE_ORDER: ResourceKey[] = ["food", "energy", "alloys", "political"];

const PLANET_SRC: Record<HabitabilityTier, string> = {
  garden: "/planets/garden.png",
  temperate: "/planets/temperate.png",
  harsh: "/planets/harsh.png",
  hellscape: "/planets/hellscape.png",
};

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
  onColonize,
  onCancelOrder,
}: {
  body: Body;
  income: Partial<Record<ResourceKey, number>>;
  isCapital: boolean;
  owned: boolean;
  colonizable: boolean;
  activeOrder: { id: string; hammersPaid: number; hammersRequired: number } | null;
  onColonize: () => void;
  onCancelOrder: (orderId: string) => void;
}) {
  return (
    <div className={`body-row ${isCapital ? "capital" : ""}`}>
      <div className="body-head">
        <span className="body-name">
          <img className="body-thumb" src={PLANET_SRC[body.habitability]} alt="" />
          {body.name} {body.kind === "moon" ? "◐" : ""}
        </span>
        <span className={`hab ${body.habitability}`}>{body.habitability}</span>
      </div>
      <div className="body-stats">
        <span>pops {body.pops}/{body.space}</span>
        {owned && <span>hammers +{body.hammers}</span>}
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
        <button className="project-btn" onClick={onColonize}>
          + Colonize · {COLONIZE_HAMMERS}⚒ {COLONIZE_POLITICAL}P
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
          <ResCell
            icon={COMPUTE_ICON}
            value={`${state.empire.compute.used}/${state.empire.compute.cap}`}
          />
          <ResCell icon={HAMMERS_ICON} value={`${totalHammers}/t`} />
        </div>

        <button className="menu-btn" onClick={() => setMenuOpen(true)}>
          Menu
        </button>
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
                    colonizable={!focusOwned && canColonize(state, body.id)}
                    activeOrder={order}
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
