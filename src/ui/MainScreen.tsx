import { useEffect, useState } from "react";
import { useGame } from "../store";
import { originById, speciesById } from "../sim/content";
import {
  allEmpires,
  availableBodyProjectsFor,
  availableProjectsFor,
  bodyComputeOutput,
  bodyIncome,
  bodyProjectOrderFor,
  canColonize,
  colonizeOrderForTarget,
  computeBreakdownFor,
  projectedFleetCompute,
  effectiveColonizeHammers,
  effectiveColonizePolitical,
  effectiveSpace,
  empireById,
  expectedPopGrowth,
  fleetsInSystem,
  growthEstimate,
  HAMMERS_PER_POP,
  hammersBreakdownFor,
  OCCUPATION_TURNS_TO_FLIP,
  perTurnIncome,
  popsBreakdownFor,
  resourceBreakdownAsStat,
  shortestPathFor,
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
import { FirstContactModal } from "./FirstContactModal";
import { FleetModal } from "./FleetModal";
import { PoliciesModal } from "./PoliciesModal";
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

// Full build queue: every order in empire.projects in FIFO drain order,
// plus any empire-scope projects still available to start. Body-scope
// orders (colonize, outpost, frigate on a specific body) also appear
// on their own body row, but showing them here makes the "what finishes
// next, what's queued behind it" cadence legible.
function BuildQueueCard({
  state,
  projects,
  available,
  hammerRate,
  onQueue,
  onCancel,
}: {
  state: import("../sim/types").GameState;
  projects: import("../sim/types").BuildOrder[];
  available: ReturnType<typeof availableProjectsFor>;
  hammerRate: number;
  onQueue: (projectId: string) => void;
  onCancel: (orderId: string) => void;
}) {
  if (projects.length === 0 && available.length === 0) return null;

  // Sum hammers paid-ahead-of-this-order so we can show cumulative
  // turns-to-complete down the queue.
  let cumulativeRemaining = 0;

  function renderLabel(order: import("../sim/types").BuildOrder): {
    name: string;
    desc: string;
    art?: string;
  } {
    if (order.kind === "colonize") {
      const body = state.galaxy.bodies[order.targetBodyId];
      return {
        name: `Colonize ${body?.name ?? "?"}`,
        desc: body ? `${body.habitability} body — grant starter pops on completion.` : "",
      };
    }
    const proj = projectById(order.projectId);
    if (!proj) return { name: "?", desc: "" };
    const suffix = order.targetBodyId
      ? ` · ${state.galaxy.bodies[order.targetBodyId]?.name ?? ""}`
      : "";
    return {
      name: `${proj.name}${suffix}`,
      desc: proj.description,
      art: proj.art,
    };
  }

  return (
    <div className="empire-projects">
      <div className="projects-label">Build Queue</div>
      {projects.map((order) => {
        const { name, desc, art } = renderLabel(order);
        const pct = Math.min(100, (order.hammersPaid / order.hammersRequired) * 100);
        const selfRemaining = Math.max(0, order.hammersRequired - order.hammersPaid);
        cumulativeRemaining += selfRemaining;
        const turns = hammerRate > 0 ? Math.ceil(cumulativeRemaining / hammerRate) : "—";
        return (
          <div key={order.id} className="project-card in-flight">
            {art && <img className="project-art" src={art} alt="" />}
            <div className="project-card-body">
              <div className="project-card-head">
                <span className="project-name">{name}</span>
                <button className="project-cancel" onClick={() => onCancel(order.id)} title="Cancel">×</button>
              </div>
              <div className="project-card-desc">{desc}</div>
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
  // Star bodies get a simplified row — no pops/hab/income, just the
  // star thumb + any outpost-related project.
  if (body.kind === "star") {
    return (
      <div className="body-row star-row">
        <div className="body-head">
          <span className="body-name">
            <span
              className="body-thumb-wrap"
              style={{ width: BODY_THUMB_BASE, height: BODY_THUMB_BASE }}
            >
              <img
                className="body-thumb"
                src="/stars/yellow_main.png"
                alt=""
                style={{ width: BODY_THUMB_BASE, height: BODY_THUMB_BASE }}
              />
            </span>
            {body.name}
          </span>
          <span className="hab stellar">star</span>
        </div>

        {/* Offer Build Outpost when available. In-flight progress is
            shown in the empire-wide Build Queue card, not here. */}
        {!bodyProjectOrder && bodyProjects.map((proj) => {
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
        {owned && bodyComputeOutput(body) > 0 && (
          <span className="stat-pill" title="Compute produced per turn">
            <img className="stat-icon" src={COMPUTE_ICON} alt="" />
            +{bodyComputeOutput(body)}
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

      {/* Offer any body projects canQueueProjectFor says are legal.
          For repeatable projects (e.g. build_frigate) the button keeps
          showing even while another of the same is in flight. */}
      {owned && bodyProjects.map((proj) => {
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
  const endTurn = useGame((s) => s.endTurn);

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [profileEmpireId, setProfileEmpireId] = useState<string | null>(null);
  const [fleetModalId, setFleetModalId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<StatBreakdown | null>(null);
  // Move mode: a player fleet is selected; galaxy-map taps on adjacent
  // systems dispatch a move. `split` of null means "move all"; a number
  // means "split off that many ships".
  const [moveMode, setMoveMode] = useState<{
    fleetId: string;
    split: number | null;
  } | null>(null);

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

  // Resolve move mode: if the fleet vanished (combat, etc.) drop out.
  const moveFleet = moveMode ? state.fleets[moveMode.fleetId] ?? null : null;
  const moveFleetStale =
    !!moveMode &&
    (!moveFleet ||
      moveFleet.empireId !== state.empire.id ||
      moveFleet.shipCount <= 0);
  useEffect(() => {
    if (moveFleetStale) setMoveMode(null);
  }, [moveFleetStale]);
  const moveOwnerEmpire = moveFleet ? empireById(state, moveFleet.empireId) : null;
  const moveHighlight = moveOwnerEmpire?.color ?? "#ffd580";

  // Path of the currently-selected fleet's existing route, if any, for
  // drawing the dashed line on the galaxy map.
  const movePath: string[] = (() => {
    if (!moveFleet || moveFleetStale) return [];
    if (!moveFleet.destinationSystemId) return [];
    const p = shortestPathFor(
      state,
      moveFleet.empireId,
      moveFleet.systemId,
      moveFleet.destinationSystemId,
    );
    return p ?? [];
  })();

  function handleSystemSelect(id: string | null) {
    // In move mode, any reachable system is a legal order target.
    // Fleet stays selected after ordering so the path is visible; tap
    // another system to retarget, or tap empty space / pill to deselect.
    if (moveMode && moveFleet && !moveFleetStale && id && id !== moveFleet.systemId) {
      const path = shortestPathFor(state, moveFleet.empireId, moveFleet.systemId, id);
      if (path && path.length > 0) {
        const split = moveMode.split;
        const count =
          split === null
            ? null
            : Math.max(1, Math.min(moveFleet.shipCount - 1, split));
        if (count !== null) {
          dispatch({
            type: "splitFleet",
            byEmpireId: state.empire.id,
            fleetId: moveMode.fleetId,
            count,
            toSystemId: id,
          });
          // After a split the peel-off is a different fleet; exit move
          // mode so the user picks up whichever group they care about.
          setMoveMode(null);
        } else {
          dispatch({
            type: "setFleetDestination",
            byEmpireId: state.empire.id,
            fleetId: moveMode.fleetId,
            toSystemId: id,
          });
        }
        setSelectedSystemId(id);
        return;
      }
    }
    // Tap on origin, unreachable system, or empty space: exit move mode
    // and behave normally.
    if (moveMode) setMoveMode(null);
    setSelectedSystemId(id);
  }

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
          onClick={() => endTurn()}
          disabled={!!pendingEvent || !!state.currentPhaseEmpireId || state.gameOver}
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
            value={`${state.empire.compute.cap - projectedFleetCompute(state, state.empire)}/${state.empire.compute.cap}`}
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
                <button className="deselect-btn" onClick={() => handleSystemSelect(null)}>
                  home
                </button>
              )}
            </div>
            {focusSystem?.occupation && (() => {
              const occ = focusSystem.occupation;
              const occupier = empireById(state, occ.empireId);
              return (
                <div className="siege-banner">
                  <span>
                    Under siege by {occupier?.name ?? "unknown force"} — flips in{" "}
                    {OCCUPATION_TURNS_TO_FLIP - occ.turns} turn
                    {OCCUPATION_TURNS_TO_FLIP - occ.turns === 1 ? "" : "s"}
                  </span>
                  <span className="siege-meter">
                    {Array.from({ length: OCCUPATION_TURNS_TO_FLIP }).map((_, i) => (
                      <span
                        key={i}
                        className={`siege-pip ${i < occ.turns ? "filled" : ""}`}
                      />
                    ))}
                  </span>
                </div>
              );
            })()}
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
                    const isPlayer = f.empireId === state.empire.id;
                    const canMove = isPlayer && f.shipCount > 0;
                    const isMoving = moveMode?.fleetId === f.id;
                    const destSys = f.destinationSystemId
                      ? state.galaxy.systems[f.destinationSystemId] ?? null
                      : null;
                    return (
                      <button
                        key={f.id}
                        className={`fleet-pill fleet-pill-btn ${isMoving ? "moving" : ""}`}
                        style={{ borderColor: empire?.color ?? "var(--border)" }}
                        title={
                          empire
                            ? canMove
                              ? destSys
                                ? `${empire.name} · en route to ${destSys.name}`
                                : `${empire.name} · tap to move`
                              : `${empire.name} · tap for details`
                            : ""
                        }
                        onClick={() => {
                          if (canMove) {
                            // Toggle: tapping the active fleet pill exits move mode.
                            if (isMoving) {
                              setMoveMode(null);
                            } else {
                              setMoveMode({ fleetId: f.id, split: null });
                            }
                          } else {
                            setFleetModalId(f.id);
                          }
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                          <polygon
                            points="5,1 9,9 1,9"
                            fill={empire?.color ?? "var(--text)"}
                          />
                        </svg>
                        {f.shipCount}
                        {destSys && (
                          <span className="fleet-pill-route" style={{ color: empire?.color ?? "var(--text-dim)" }}>
                            → {destSys.name}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {focusSystem
              ? focusBodies.map((body) => {
                  const order = colonizeOrderForTarget(state, body.id);
                  // Body-scope projects are always queryable — canQueueProjectFor
                  // already enforces whether the target is legal. This is what
                  // lets the star row show "Build Outpost" in unclaimed systems.
                  const bodyProjects = availableBodyProjectsFor(state, state.empire, body.id);
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
                      bodyProjects={bodyProjects}
                      bodyProjectOrder={bodyProjectOrderFor(state.empire, body.id)}
                      hammerRate={totalHammers}
                      onColonize={() =>
                        dispatch({
                          type: "queueColonize",
                          byEmpireId: state.empire.id,
                          targetBodyId: body.id,
                        })
                      }
                      onQueueBodyProject={(projectId) =>
                        dispatch({
                          type: "queueEmpireProject",
                          byEmpireId: state.empire.id,
                          projectId,
                          targetBodyId: body.id,
                        })
                      }
                      onCancelOrder={(orderId) =>
                        dispatch({
                          type: "cancelOrder",
                          byEmpireId: state.empire.id,
                          orderId,
                        })
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

            {/* Full build queue — every queued order in FIFO drain
                order plus any empire-scope projects still available. */}
            <BuildQueueCard
              state={state}
              projects={state.empire.projects}
              available={availableProjectsFor(state, state.empire)}
              hammerRate={totalHammers}
              onQueue={(pid) =>
                dispatch({
                  type: "queueEmpireProject",
                  byEmpireId: state.empire.id,
                  projectId: pid,
                })
              }
              onCancel={(oid) =>
                dispatch({
                  type: "cancelOrder",
                  byEmpireId: state.empire.id,
                  orderId: oid,
                })
              }
            />
          </div>
        </div>

        <div className="right-column">
          <div className="galaxy-panel">
            <span className="panel-label">Galaxy</span>
            {state.currentPhaseEmpireId && (() => {
              const e = empireById(state, state.currentPhaseEmpireId);
              if (!e) return null;
              return (
                <div className="phase-banner" style={{ borderColor: e.color }}>
                  <span className="phase-banner-dot" style={{ background: e.color }} />
                  {e.id === state.empire.id ? "Your turn resolving…" : `${e.name} acting…`}
                </div>
              );
            })()}
            <GalaxyMap
              galaxy={state.galaxy}
              empires={allEmpires(state)}
              fleets={Object.values(state.fleets)}
              selectedId={selectedSystemId}
              onSelect={handleSystemSelect}
              moveMode={
                moveFleet && !moveFleetStale
                  ? {
                      originSystemId: moveFleet.systemId,
                      pathSystemIds: movePath,
                      highlightColor: moveHighlight,
                    }
                  : null
              }
            />
            {moveFleet && !moveFleetStale && (() => {
              const dest = moveFleet.destinationSystemId
                ? state.galaxy.systems[moveFleet.destinationSystemId] ?? null
                : null;
              return (
                <div className="move-bar" style={{ borderColor: moveHighlight }}>
                  <div className="move-bar-line">
                    <span className="move-bar-title">
                      <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginRight: 4 }}>
                        <polygon points="5,1 9,9 1,9" fill={moveHighlight} />
                      </svg>
                      Moving {moveMode?.split ?? moveFleet.shipCount}/{moveFleet.shipCount}
                    </span>
                    <button
                      className="move-bar-cancel"
                      onClick={() => setMoveMode(null)}
                    >
                      close
                    </button>
                  </div>
                  {moveFleet.shipCount > 1 && (
                    <div className="move-bar-split">
                      <button
                        type="button"
                        className={`move-seg ${moveMode?.split === null ? "on" : ""}`}
                        onClick={() =>
                          setMoveMode((m) => (m ? { ...m, split: null } : m))
                        }
                      >
                        all
                      </button>
                      <button
                        type="button"
                        className={`move-seg ${moveMode?.split !== null ? "on" : ""}`}
                        onClick={() =>
                          setMoveMode((m) =>
                            m
                              ? { ...m, split: m.split ?? Math.max(1, Math.floor(moveFleet.shipCount / 2)) }
                              : m,
                          )
                        }
                      >
                        split
                      </button>
                      {moveMode?.split !== null && moveMode?.split !== undefined && (
                        <input
                          className="move-bar-num"
                          type="number"
                          min={1}
                          max={moveFleet.shipCount - 1}
                          value={moveMode.split}
                          onChange={(e) => {
                            const raw = parseInt(e.target.value, 10);
                            const n = Number.isFinite(raw) ? raw : 1;
                            const clamped = Math.max(1, Math.min(moveFleet.shipCount - 1, n));
                            setMoveMode((m) => (m ? { ...m, split: clamped } : m));
                          }}
                        />
                      )}
                    </div>
                  )}
                  {dest && movePath.length > 0 ? (
                    <div className="move-bar-route">
                      <span>
                        → {dest.name} · {movePath.length}T
                      </span>
                      <button
                        type="button"
                        className="move-bar-clear"
                        onClick={() =>
                          dispatch({
                            type: "setFleetDestination",
                            byEmpireId: state.empire.id,
                            fleetId: moveFleet.id,
                            toSystemId: null,
                          })
                        }
                      >
                        cancel route
                      </button>
                    </div>
                  ) : (
                    <div className="move-bar-hint">Tap a system to send the fleet.</div>
                  )}
                </div>
              );
            })()}
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

      {state.pendingFirstContacts.length > 0 && (
        <FirstContactModal
          otherEmpireId={state.pendingFirstContacts[0].otherEmpireId}
          onDismiss={() => dispatch({ type: "dismissFirstContact" })}
        />
      )}
      {state.pendingFirstContacts.length === 0 && pendingEvent && (
        <EventModal eventId={pendingEvent.eventId} />
      )}
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
