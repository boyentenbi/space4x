import { useState } from "react";
import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import {
  allEmpires,
  availableBodyProjectsFor,
  availableProjectsFor,
  bodyIncome,
  bodyProjectOrderFor,
  canColonize,
  colonizeOrderForTarget,
  computeBreakdownFor,
  effectiveColonizeHammers,
  effectiveColonizePolitical,
  effectiveSpace,
  empireById,
  expectedPopGrowth,
  fleetsInSystem,
  growthEstimate,
  HAMMERS_PER_POP,
  hammersBreakdownFor,
  perTurnIncome,
  popsBreakdownFor,
  resourceBreakdownAsStat,
  totalPops,
} from "../sim/reducer";
import type { StatBreakdown } from "../sim/reducer";
import { projectById } from "../sim/content";
import { RESOURCE_KEYS } from "../sim/events";
import type { Body, Resources, ResourceKey } from "../sim/types";
import { EventModal } from "./EventModal";
import { GalaxyMap } from "./GalaxyMap";
import { SystemScene } from "./SystemScene";
import { PortraitMenu } from "./PortraitMenu";
import { EmpireProfileModal } from "./EmpireProfileModal";
import { EmpireRosterModal } from "./EmpireRosterModal";
import { FleetModal } from "./FleetModal";
import { PoliciesModal } from "./PoliciesModal";
import { ProjectCompletionModal } from "./ProjectCompletionModal";
import { StatBreakdownModal } from "./StatBreakdownModal";
import { COMPUTE_ICON, HAMMERS_ICON, POPS_ICON, RESOURCE_ICON, planetSpriteFor } from "./icons";

const RESOURCE_ORDER: ResourceKey[] = ["food", "energy", "political"];

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
  onClick,
}: {
  icon: string;
  value: string | number;
  delta?: number;
  onClick?: () => void;
}) {
  const d = delta ?? 0;
  const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
  const Tag: "button" | "div" = onClick ? "button" : "div";
  return (
    <Tag className="res-cell" onClick={onClick} type={onClick ? "button" : undefined}>
      <img className="cell-icon" src={icon} alt="" />
      <span className="cell-value">{value}</span>
      {delta !== undefined && <span className={`cell-delta ${cls}`}>{fmtDelta(d)}</span>}
    </Tag>
  );
}

function EmpireProjectsCard({
  projects,
  available,
  hammerRate,
  onQueue,
  onCancel,
}: {
  projects: import("../sim/types").BuildOrder[];
  available: ReturnType<typeof availableProjectsFor>;
  hammerRate: number;
  onQueue: (projectId: string) => void;
  onCancel: (orderId: string) => void;
}) {
  const inFlightEmpireOrders = projects.filter(
    (o): o is Extract<import("../sim/types").BuildOrder, { kind: "empire_project" }> =>
      o.kind === "empire_project" && !o.targetBodyId,
  );
  if (inFlightEmpireOrders.length === 0 && available.length === 0) return null;

  return (
    <div className="empire-projects">
      <div className="projects-label">Empire Projects</div>
      {inFlightEmpireOrders.map((order) => {
        const proj = projectById(order.projectId);
        if (!proj) return null;
        const pct = Math.min(100, (order.hammersPaid / order.hammersRequired) * 100);
        const remaining = Math.max(0, order.hammersRequired - order.hammersPaid);
        const turns = hammerRate > 0 ? Math.ceil(remaining / hammerRate) : "—";
        return (
          <div key={order.id} className="project-card in-flight">
            {proj.art && <img className="project-art" src={proj.art} alt="" />}
            <div className="project-card-body">
              <div className="project-card-head">
                <span className="project-name">{proj.name}</span>
                <button className="project-cancel" onClick={() => onCancel(order.id)} title="Cancel">×</button>
              </div>
              <div className="project-card-desc">{proj.description}</div>
              <div className="project-bar">
                <div className="project-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="project-stats">
                {order.hammersPaid}/{order.hammersRequired} · ~{turns}T
              </div>
            </div>
          </div>
        );
      })}
      {available.map((proj) => {
        const turns = hammerRate > 0 ? Math.ceil(proj.hammersRequired / hammerRate) : "—";
        return (
          <div key={proj.id} className="project-card available">
            {proj.art && <img className="project-art" src={proj.art} alt="" />}
            <div className="project-card-body">
              <div className="project-card-head">
                <span className="project-name">{proj.name}</span>
                <button className="project-start" onClick={() => onQueue(proj.id)}>Start</button>
              </div>
              <div className="project-card-desc">{proj.description}</div>
              <div className="project-stats">
                {proj.hammersRequired} hammers · ~{turns}T
                {proj.costs && Object.entries(proj.costs).map(([k, v]) =>
                  v ? <span key={k}> · {v} {k}</span> : null
                )}
              </div>
            </div>
          </div>
        );
      })}
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
  colonizeHammers,
  colonizePolitical,
  growth,
  bodyProjects,
  bodyProjectOrder,
  hammerRate,
  onColonize,
  onQueueBodyProject,
  onCancelOrder,
}: {
  body: Body;
  income: Partial<Record<ResourceKey, number>>;
  isCapital: boolean;
  owned: boolean;
  colonizable: boolean;
  activeOrder: { id: string; hammersPaid: number; hammersRequired: number } | null;
  colonizeTurns: number;
  colonizeHammers: number;
  colonizePolitical: number;
  growth: ReturnType<typeof growthEstimate> | null;
  bodyProjects: ReturnType<typeof availableBodyProjectsFor>;
  bodyProjectOrder: ReturnType<typeof bodyProjectOrderFor>;
  hammerRate: number;
  onColonize: () => void;
  onQueueBodyProject: (projectId: string) => void;
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
          <span className="stat-pill" title={`${HAMMERS_PER_POP} hammer per pop`}>
            <img className="stat-icon" src={HAMMERS_ICON} alt="" />
            +{body.hammers}
          </span>
        )}
        {owned && growth && growth.kind === "growing" && (
          <span className="stat-pill growth-pill" title="Turns until +1 pop (costs 5 food)">
            <img className="stat-icon" src={POPS_ICON} alt="" />
            +1 ~{growth.turns}T
          </span>
        )}
        {owned && growth && growth.kind === "starved" && (
          <span className="stat-pill growth-pill starved" title="Empire food is below the growth threshold">
            <img className="stat-icon" src={POPS_ICON} alt="" />
            starved
          </span>
        )}
        {owned && growth && growth.kind === "full" && (
          <span className="stat-pill growth-pill" title="No space for more pops on this body">
            <img className="stat-icon" src={POPS_ICON} alt="" />
            full
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
            {colonizeHammers}
            <img className="stat-icon" src={RESOURCE_ICON.political} alt="" />
            {colonizePolitical}
            <span className="colonize-turns">· {colonizeTurns}T</span>
          </span>
        </button>
      ) : null}

      {/* Body-scope empire projects (e.g., Brood Mother at the capital). */}
      {owned && bodyProjectOrder && (() => {
        const proj = projectById(bodyProjectOrder.projectId);
        if (!proj) return null;
        const pct = Math.min(
          100,
          (bodyProjectOrder.hammersPaid / bodyProjectOrder.hammersRequired) * 100,
        );
        const remaining = Math.max(
          0,
          bodyProjectOrder.hammersRequired - bodyProjectOrder.hammersPaid,
        );
        const turns = hammerRate > 0 ? Math.ceil(remaining / hammerRate) : "—";
        return (
          <div className="project-progress body-project">
            <div className="project-head">
              <span>{proj.name}</span>
              <button
                className="project-cancel"
                onClick={() => onCancelOrder(bodyProjectOrder.id)}
                title="Cancel"
              >
                ×
              </button>
            </div>
            <div className="project-bar">
              <div className="project-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="project-stats">
              {bodyProjectOrder.hammersPaid}/{bodyProjectOrder.hammersRequired} · ~{turns}T
            </div>
          </div>
        );
      })()}

      {owned && !bodyProjectOrder && bodyProjects.map((proj) => {
        const turns = hammerRate > 0 ? Math.ceil(proj.hammersRequired / hammerRate) : "—";
        return (
          <button
            key={proj.id}
            className="project-btn body-project-btn"
            onClick={() => onQueueBodyProject(proj.id)}
            title={proj.description}
          >
            <span>+ {proj.name}</span>
            <span className="colonize-cost">
              <img className="stat-icon" src={HAMMERS_ICON} alt="" />
              {proj.hammersRequired}
              {proj.costs?.food !== undefined && (
                <>
                  <img className="stat-icon" src={RESOURCE_ICON.food} alt="" />
                  {proj.costs.food}
                </>
              )}
              {proj.costs?.political !== undefined && (
                <>
                  <img className="stat-icon" src={RESOURCE_ICON.political} alt="" />
                  {proj.costs.political}
                </>
              )}
              <span className="colonize-turns">· {turns}T</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MainScreen() {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const reset = useGame((s) => s.reset);

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [profileEmpireId, setProfileEmpireId] = useState<string | null>(null);
  const [fleetModalId, setFleetModalId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<StatBreakdown | null>(null);

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
  // Effective cap accounts for species spaceMult (e.g. insectoid +50%),
  // matching what pop growth actually allows.
  const popsCap = state.empire.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return (
      sum +
      sys.bodyIds.reduce((s, bid) => {
        const body = state.galaxy.bodies[bid];
        return s + (body ? effectiveSpace(state.empire, body) : 0);
      }, 0)
    );
  }, 0);
  const colonizeHammerCost = effectiveColonizeHammers(state.empire);
  const colonizePoliticalCost = effectiveColonizePolitical(state.empire);
  // Turns to finish a new colonize project, given current hammer rate and
  // any existing FIFO queue already consuming from the pool.
  function turnsToColonize(): number {
    if (totalHammers <= 0) return Infinity;
    const backlogHammers = state.empire.projects.reduce(
      (s, o) => s + (o.hammersRequired - o.hammersPaid),
      0,
    );
    const totalNeed = backlogHammers + colonizeHammerCost;
    return Math.ceil(totalNeed / totalHammers);
  }
  const colonizeTurnEstimate = turnsToColonize();

  const focusSystem = selectedSystemId
    ? state.galaxy.systems[selectedSystemId] ?? null
    : capitalSystem;
  const focusBodies = focusSystem
    ? focusSystem.bodyIds.map((bid) => state.galaxy.bodies[bid]).filter((b): b is Body => !!b)
    : [];
  const focusOwnerEmpire = focusSystem?.ownerId
    ? empireById(state, focusSystem.ownerId)
    : null;
  const focusIsOurs = focusOwnerEmpire?.id === state.empire.id;
  const focusOwnerSpecies = focusOwnerEmpire
    ? speciesById(focusOwnerEmpire.speciesId)
    : null;

  return (
    <>
      {/* ===== Left sidebar ===== */}
      <div className="sidebar">
        {(state.empire.portraitArt || species?.art) && (
          <div
            className="portrait-card"
            style={{ borderColor: state.empire.color }}
            title={`${species?.name ?? ""} · ${state.empire.name}`}
          >
            <img src={state.empire.portraitArt || species?.art} alt={species?.name ?? ""} />
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
              onClick={() => setBreakdown(resourceBreakdownAsStat(state, state.empire, k))}
            />
          ))}
          <ResCell
            icon={COMPUTE_ICON}
            value={state.empire.compute.cap}
            onClick={() => setBreakdown(computeBreakdownFor(state, state.empire))}
          />
          <ResCell
            icon={HAMMERS_ICON}
            value={totalHammers}
            onClick={() => setBreakdown(hammersBreakdownFor(state, state.empire))}
          />
          <ResCell
            icon={POPS_ICON}
            value={`${popsNow}/${popsCap}`}
            delta={expectedPopGrowth(state, state.empire)}
            onClick={() => setBreakdown(popsBreakdownFor(state, state.empire))}
          />
        </div>

        <button className="menu-btn" onClick={() => setPoliciesOpen(true)}>
          Policies
        </button>
        <button className="menu-btn" onClick={() => setRosterOpen(true)}>
          Empires
        </button>
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
              <span className="panel-title-left">
                {focusOwnerEmpire && (focusOwnerEmpire.portraitArt || focusOwnerSpecies?.art) && (
                  <button
                    className="owner-portrait-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProfileEmpireId(focusOwnerEmpire.id);
                    }}
                    title={`${focusOwnerEmpire.name} — profile`}
                  >
                    <img
                      className="owner-portrait"
                      src={focusOwnerEmpire.portraitArt || focusOwnerSpecies?.art}
                      alt=""
                      style={{ borderColor: focusOwnerEmpire.color }}
                    />
                  </button>
                )}
                <span>
                  {focusSystem
                    ? `${focusSystem.name}${
                        focusIsOurs && focusSystem.id === capitalSystem?.id
                          ? " · home"
                          : focusOwnerEmpire
                            ? ` · ${focusOwnerEmpire.name}`
                            : " · unclaimed"
                      }`
                    : "System"}
                </span>
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
                ownerColor={focusOwnerEmpire?.color ?? null}
                capitalBodyId={focusOwnerEmpire?.capitalBodyId ?? null}
                turn={state.turn}
              />
            ) : (
              <div className="scene-empty">Tap a star on the galaxy map.</div>
            )}
          </div>
          <div className="detail-scroll">
            {focusSystem && (() => {
              const fleets = fleetsInSystem(state, focusSystem.id);
              if (fleets.length === 0) return null;
              return (
                <div className="fleet-strip">
                  <span className="fleet-strip-label">Fleets</span>
                  {fleets.map((f) => {
                    const empire = empireById(state, f.empireId);
                    return (
                      <button
                        key={f.id}
                        className="fleet-pill fleet-pill-btn"
                        style={{ borderColor: empire?.color ?? "var(--border)" }}
                        title={empire ? `${empire.name} · tap for fleet details` : ""}
                        onClick={() => setFleetModalId(f.id)}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                          <polygon
                            points="5,1 9,9 1,9"
                            fill={empire?.color ?? "var(--text)"}
                          />
                        </svg>
                        {f.shipCount}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {focusSystem
              ? focusBodies.map((body) => {
                  const order = colonizeOrderForTarget(state, body.id);
                  return (
                    <BodyRow
                      key={body.id}
                      body={body}
                      income={focusIsOurs ? bodyIncome(state, body) : {}}
                      isCapital={body.id === state.empire.capitalBodyId}
                      owned={focusIsOurs}
                      colonizable={canColonize(state, body.id)}
                      activeOrder={order}
                      colonizeTurns={colonizeTurnEstimate}
                      colonizeHammers={colonizeHammerCost}
                      colonizePolitical={colonizePoliticalCost}
                      growth={focusIsOurs ? growthEstimate(state, state.empire, body) : null}
                      bodyProjects={focusIsOurs ? availableBodyProjectsFor(state.empire, body.id) : []}
                      bodyProjectOrder={focusIsOurs ? bodyProjectOrderFor(state.empire, body.id) : null}
                      hammerRate={totalHammers}
                      onColonize={() =>
                        dispatch({ type: "queueColonize", targetBodyId: body.id })
                      }
                      onQueueBodyProject={(projectId) =>
                        dispatch({ type: "queueEmpireProject", projectId, targetBodyId: body.id })
                      }
                      onCancelOrder={(orderId) =>
                        dispatch({ type: "cancelOrder", orderId })
                      }
                    />
                  );
                })
              : (
                <div className="empire-card">
                  <div><span className="stat-label">Species:</span> {species?.name ?? "?"}</div>
                  <div><span className="stat-label">Origin:</span> {origin?.name ?? "?"}</div>
                  <div><span className="stat-label">Population:</span> {totalPops(state)}</div>
                </div>
              )}

            {/* Empire-level projects are always visible, regardless of
                which system you're inspecting. */}
            <EmpireProjectsCard
              projects={state.empire.projects}
              available={availableProjectsFor(state.empire)}
              hammerRate={totalHammers}
              onQueue={(pid) => dispatch({ type: "queueEmpireProject", projectId: pid })}
              onCancel={(oid) => dispatch({ type: "cancelOrder", orderId: oid })}
            />
          </div>
        </div>

        <div className="right-column">
          <div className="galaxy-panel">
            <span className="panel-label">Galaxy</span>
            <GalaxyMap
              galaxy={state.galaxy}
              empires={allEmpires(state)}
              fleets={Object.values(state.fleets)}
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

      {state.projectCompletions.length > 0 && (
        <ProjectCompletionModal
          projectId={state.projectCompletions[0].projectId}
          turn={state.projectCompletions[0].turn}
          onDismiss={() => dispatch({ type: "dismissProjectCompletion" })}
        />
      )}
      {state.projectCompletions.length === 0 && pendingEvent && <EventModal eventId={pendingEvent.eventId} />}
      {breakdown && (
        <StatBreakdownModal breakdown={breakdown} onClose={() => setBreakdown(null)} />
      )}
      {rosterOpen && (
        <EmpireRosterModal
          onPick={(id) => {
            setProfileEmpireId(id);
            setRosterOpen(false);
          }}
          onClose={() => setRosterOpen(false)}
        />
      )}
      {profileEmpireId && (
        <EmpireProfileModal
          empireId={profileEmpireId}
          onClose={() => setProfileEmpireId(null)}
        />
      )}
      {policiesOpen && <PoliciesModal onClose={() => setPoliciesOpen(false)} />}
      {fleetModalId && (
        <FleetModal fleetId={fleetModalId} onClose={() => setFleetModalId(null)} />
      )}
      {menuOpen && (
        <PortraitMenu onReset={reset} onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
}
