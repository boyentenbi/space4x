import { useEffect, useState } from "react";
import { useGame } from "../store";
import { featureById, originById, speciesById } from "../sim/content";
import {
  allEmpires,
  allOrdersOf,
  atWar,
  hostileFleetsInSensor,
  availableBodyProjectsFor,
  ownedBodiesOf,
  bodyComputeOutput,
  bodyIncome,
  canColonize,
  ordersTargetingBody,
  computeBreakdownFor,
  COLONIZE_POP_COST,
  projectedFleetCompute,
  effectiveColonizeHammers,
  effectiveColonizePolitical,
  maxPopsFor,
  empireById,
  empireSpeciesName,
  fleetEtaTurns,
  empireResourceStock,
  expectedPopGrowth,
  fleetsInSystem,
  growthEstimate,
  HAMMERS_PER_POP,
  hammersBreakdownFor,
  hammersPerPopFor,
  humanEmpire,
  humanEmpireOrThrow,
  OCCUPATION_TURNS_TO_FLIP,
  perTurnIncome,
  popsBreakdownFor,
  resourceBreakdownAsStat,
  sensorSet,
  shortestPathFor,
  totalPops,
} from "../sim/reducer";
import type { StatBreakdown } from "../sim/reducer";
import { projectById } from "../sim/content";
import { RESOURCE_KEYS } from "../sim/events";
import type { Body, BuildOrder, GameState, Resources, ResourceKey } from "../sim/types";
import { ChronicleModal } from "./ChronicleModal";
import { EventModal } from "./EventModal";
import { GalaxyMap } from "./GalaxyMap";
import { SystemScene } from "./SystemScene";
import { PortraitMenu } from "./PortraitMenu";
import { EmpireProfileModal } from "./EmpireProfileModal";
import { EmpireRosterModal } from "./EmpireRosterModal";
import { FirstContactModal } from "./FirstContactModal";
import { WarDeclaredModal } from "./WarDeclaredModal";
import { FleetModal } from "./FleetModal";
import { ModifierChip } from "./modifierUi";
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

// What's blocking the big "Play" button from auto-advancing? Returned
// shape carries the minimum info the UI needs to focus the blocker
// when the player clicks. Priority order matches urgency:
//   1. gameOver (terminal)
//   2. first contact (narrative beat the player can't miss)
//   3. random event (ditto)
//   4. idle non-sleeping fleet (player has ships standing around)
//   5. empty build queue (nothing being produced)
//   6. none (autoplay can run)
//
// Keep in sync semantically with needsPlayerAttention() in the
// reducer — that gates autoplay; this gates the button's label.
type AttentionFocus =
  | { kind: "none" }
  | { kind: "gameOver" }
  | { kind: "firstContact" }
  | { kind: "event" }
  | { kind: "hostileFleet"; fleetId: string; systemId: string }
  | { kind: "idleFleet"; fleetId: string; systemId: string }
  | { kind: "emptyQueue"; systemId: string | null; bodyId: string | null };

function attentionFocus(state: GameState): AttentionFocus {
  if (state.gameOver) return { kind: "gameOver" };
  if (state.pendingFirstContacts.length > 0) return { kind: "firstContact" };
  if (state.eventQueue.length > 0) return { kind: "event" };
  // No human → nothing to focus on. (UI shouldn't render this branch
  // anyway, but be defensive.)
  const player = humanEmpire(state);
  if (!player) return { kind: "none" };
  // An at-war enemy fleet in sensor pauses autoplay so the player
  // can react. Peaceful foreign fleets passing through don't trip
  // this — they can't hurt us until they cross a border and auto-
  // declare war, at which point the pause fires on the same turn.
  const hostile = hostileFleetsInSensor(state, player);
  if (hostile.length > 0) {
    return { kind: "hostileFleet", fleetId: hostile[0].id, systemId: hostile[0].systemId };
  }
  for (const f of Object.values(state.fleets)) {
    if (f.empireId !== player.id) continue;
    if (f.shipCount <= 0) continue;
    if (f.destinationSystemId) continue;
    if (f.sleeping) continue;
    if (f.autoDiscover) continue;
    return { kind: "idleFleet", fleetId: f.id, systemId: f.systemId };
  }
  // Per-body idle — mirrors needsPlayerAttention. Return the specific
  // body so the UI can highlight it in the body list; otherwise the
  // player has to hunt for which body is wasting hammers when a
  // sibling in the same system is visibly building something.
  for (const body of ownedBodiesOf(state, player)) {
    if (body.pops <= 0) continue;
    if (body.queue.length > 0) continue;
    return { kind: "emptyQueue", systemId: body.systemId, bodyId: body.id };
  }
  return { kind: "none" };
}

function ResCell({
  icon,
  value,
  delta,
  onClick,
  emphasis,
}: {
  icon: string;
  value: string | number;
  delta?: number;
  onClick?: () => void;
  // "maxed" colours the value red to flag that the stock / capacity
  // has hit ceiling (pops at max on every body, for instance).
  emphasis?: "maxed";
}) {
  const d = delta ?? 0;
  const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
  const valueCls = emphasis === "maxed" ? "cell-value maxed" : "cell-value";
  const Tag: "button" | "div" = onClick ? "button" : "div";
  return (
    <Tag className="res-cell" onClick={onClick} type={onClick ? "button" : undefined}>
      <img className="cell-icon" src={icon} alt="" />
      <span className={valueCls}>{value}</span>
      {delta !== undefined && <span className={`cell-delta ${cls}`}>{fmtDelta(d)}</span>}
    </Tag>
  );
}


// Build order + display metadata. An order appears on BOTH its
// target body's row and its host body's row when the two differ
// (outposts on adjacent stars are the canonical example: host is
// the capital, target is the remote star). The `perspective` field
// tells BodyQueueItem which side of the relationship this row
// represents so it can label itself appropriately.
interface BodyOrderEntry {
  order: BuildOrder;
  hostBodyId: string;
  hostBodyName: string;
  hostRate: number;
  // Target body — the thing being built for / at.
  targetBodyId: string;
  targetBodyName: string;
  // "target": this row's body IS the target. The host may be remote;
  //           when it is, show a "building at <hostBodyName>" note.
  // "host":   this row's body IS the host paying hammers. The target
  //           is elsewhere; show the target's name in the item title
  //           so the player knows what this queue slot is for.
  perspective: "target" | "host";
}

function orderLabel(order: BuildOrder, state: GameState): { name: string; art?: string } {
  if (order.kind === "colonize") {
    const body = state.galaxy.bodies[order.targetBodyId];
    return { name: `Colonize ${body?.name ?? "?"}` };
  }
  const proj = projectById(order.projectId);
  if (!proj) return { name: "?" };
  return { name: proj.name, art: proj.art };
}

function BodyQueueItem({
  entry,
  onCancel,
}: {
  entry: BodyOrderEntry;
  onCancel: (orderId: string) => void;
}) {
  const state = useGame((s) => s.state);
  const { order, hostBodyId, hostBodyName, hostRate, targetBodyId, targetBodyName, perspective } = entry;
  const { name, art } = orderLabel(order, state);
  const pct = Math.min(100, (order.hammersPaid / order.hammersRequired) * 100);
  const remaining = Math.max(0, order.hammersRequired - order.hammersPaid);
  const turns = hostRate > 0 ? Math.ceil(remaining / hostRate) : "—";
  const isCrossBody = hostBodyId !== targetBodyId;
  // Title line shows the project name plus, from the host's POV, the
  // target destination (so the player sees what their hammers are
  // being spent on: "Build Outpost · Sirius").
  const headLine =
    perspective === "host" && isCrossBody ? `${name} · ${targetBodyName}` : name;
  // Sub-line from the target's POV when the host is remote ("building
  // at Capital"): confirms where hammers are actually flowing from.
  const subLine =
    perspective === "target" && isCrossBody
      ? `building at ${hostBodyName}`
      : null;
  return (
    <div className="body-queue-item">
      {art && <img className="body-queue-art" src={art} alt="" />}
      <div className="body-queue-item-main">
        <div className="body-queue-item-head">
          <span className="body-queue-item-name">{headLine}</span>
          <button
            className="project-cancel"
            onClick={() => onCancel(order.id)}
            title="Cancel"
          >×</button>
        </div>
        {subLine && (
          <div className="body-queue-item-host">{subLine}</div>
        )}
        <div className="project-bar">
          <div className="project-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="project-stats">
          {order.hammersPaid}/{order.hammersRequired} · ~{turns}T
        </div>
      </div>
    </div>
  );
}

function BodyRow({
  body,
  income,
  isCapital,
  owned,
  colonizable,
  orders,
  colonizeTurns,
  colonizeHammers,
  colonizePolitical,
  growth,
  bodyProjects,
  hammerRate,
  onColonize,
  onQueueBodyProject,
  onCancelOrder,
  flavourSeen,
  highlighted,
  expanded,
  onToggle,
}: {
  body: Body;
  income: Partial<Record<ResourceKey, number>>;
  isCapital: boolean;
  owned: boolean;
  colonizable: boolean;
  // All orders targeting this body, whether hosted here or elsewhere.
  // Replaces the old activeOrder / bodyProjectOrder single-slot props.
  orders: BodyOrderEntry[];
  colonizeTurns: number;
  colonizeHammers: number;
  colonizePolitical: number;
  growth: ReturnType<typeof growthEstimate> | null;
  bodyProjects: ReturnType<typeof availableBodyProjectsFor>;
  hammerRate: number;
  onColonize: () => void;
  onQueueBodyProject: (projectId: string) => void;
  onCancelOrder: (orderId: string) => void;
  // Whether the viewer has actually seen this body's flavour flags.
  // Flavour (precursor ruins, rare crystals) is hidden on the surface
  // and not detectable from orbit — requires a fleet visit or
  // ownership. When false, flavour chips are suppressed.
  flavourSeen: boolean;
  // When true, the "Queue Build" attention focus has targeted this
  // specific body — draw an outline so the player can see which of
  // several bodies in the system is wasting hammers this turn.
  highlighted?: boolean;
  // Expand/collapse state for the body's build queue + offer buttons.
  // Collapsed by default (via empty Set in parent); click the body
  // header to toggle. "Queue Build" attention auto-expands the target.
  expanded: boolean;
  onToggle: () => void;
}) {
  // Star bodies get a simplified row — no pops/hab/income, just the
  // star thumb + any orders targeting the star (build_outpost on
  // unowned stars, build_defender on owned stars). Queue + offer
  // buttons live inside the expand toggle.
  if (body.kind === "star") {
    const hasContent = orders.length > 0 || bodyProjects.length > 0;
    return (
      <div
        className={`body-row star-row${highlighted ? " highlighted" : ""}`}
        data-body-id={body.id}
      >
        <div
          className={`body-head${hasContent ? " clickable" : ""}`}
          onClick={hasContent ? onToggle : undefined}
          role={hasContent ? "button" : undefined}
        >
          <span className="body-name">
            {hasContent && (
              <span className="body-expand-caret">{expanded ? "▾" : "▸"}</span>
            )}
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
            {orders.length > 0 && (
              <span className="body-queue-count">{orders.length}</span>
            )}
          </span>
          <span className="hab stellar">star</span>
        </div>

        {expanded && (
          <>
            {/* Offer buttons ABOVE the queue so repeat-clicking doesn't
                shift the button as new orders pile up below it. */}
            {bodyProjects.map((proj) => {
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
            {orders.length > 0 && (
              <div className="body-queue">
                {orders.map((o) => (
                  <BodyQueueItem key={o.order.id} entry={o} onCancel={onCancelOrder} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const thumbSize =
    body.kind === "moon" ? BODY_THUMB_BASE * BODY_THUMB_MOON_RATIO : BODY_THUMB_BASE;
  const hasQueueContent =
    orders.length > 0 ||
    (colonizable && owned) ||
    (owned && bodyProjects.length > 0) ||
    (!owned && colonizable);
  return (
    <div
      className={`body-row ${isCapital ? "capital" : ""}${highlighted ? " highlighted" : ""}`}
      data-body-id={body.id}
    >
      <div
        className={`body-head${hasQueueContent ? " clickable" : ""}`}
        onClick={hasQueueContent ? onToggle : undefined}
        role={hasQueueContent ? "button" : undefined}
      >
        <span className="body-name">
          {hasQueueContent && (
            <span className="body-expand-caret">{expanded ? "▾" : "▸"}</span>
          )}
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
          {orders.length > 0 && (
            <span className="body-queue-count">{orders.length}</span>
          )}
        </span>
        <span className={`hab ${body.habitability}`}>{body.habitability}</span>
      </div>
      <div className="body-stats">
        <span className="stat-pill">
          <img className="stat-icon" src={POPS_ICON} alt="" />
          {Math.floor(body.pops)}/{body.maxPops}
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
          <span className="stat-pill growth-pill" title="Pops gained per turn (costs 50 food per pop)">
            <img className="stat-icon" src={POPS_ICON} alt="" />
            +{growth.perTurn.toFixed(2)}/T
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
          {flavourSeen && body.flavorFlags.map((f) => (
            <span key={f} className="chip flavor">{f.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}

      {/* Features installed on this body — each shows the name,
          a thumbnail, and the modifiers it contributes so the
          player can see what it's actually doing. */}
      {body.features.length > 0 && (
        <div className="body-features">
          {body.features.map((fid) => {
            const feat = featureById(fid);
            if (!feat) return null;
            const allMods = [
              ...(feat.empireModifiers ?? []),
              ...(feat.bodyModifiers ?? []),
            ];
            return (
              <div key={fid} className="feature-card" title={feat.description}>
                <div className="feature-card-head">
                  {feat.art && (
                    <img className="feature-card-icon" src={feat.art} alt="" />
                  )}
                  <span className="feature-card-name">{feat.name}</span>
                </div>
                {allMods.length > 0 && (
                  <div className="feature-card-mods">
                    {allMods.map((m, i) => (
                      <ModifierChip key={i} mod={m} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!owned && flavourSeen && body.flavorFlags.length > 0 && (
        <div className="chips">
          {body.flavorFlags.map((f) => (
            <span key={f} className="chip flavor">{f.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}

      {expanded && (
        <>
          {/* Offer buttons above the queue so repeat-clicking them
              doesn't shift the button down as orders accumulate. */}
          {orders.length === 0 && colonizable && (
            <button className="project-btn colonize-btn" onClick={onColonize}>
              <span>+ Colonize</span>
              <span className="colonize-cost">
                <img className="stat-icon" src={HAMMERS_ICON} alt="" />
                {colonizeHammers}
                <img className="stat-icon" src={RESOURCE_ICON.political} alt="" />
                {colonizePolitical}
                <img className="stat-icon" src={POPS_ICON} alt="" />
                {COLONIZE_POP_COST}
                <span className="colonize-turns">· {colonizeTurns}T</span>
              </span>
            </button>
          )}

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

          {orders.length > 0 && (
            <div className="body-queue">
              {orders.map((o) => (
                <BodyQueueItem key={o.order.id} entry={o} onCancel={onCancelOrder} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MainScreen() {
  const state = useGame((s) => s.state);
  const dispatch = useGame((s) => s.dispatch);
  const reset = useGame((s) => s.reset);
  const goBack = useGame((s) => s.goBack);
  const goForward = useGame((s) => s.goForward);
  const autoplayOn = useGame((s) => s.autoplayOn);
  const setAutoplay = useGame((s) => s.setAutoplay);
  const historyIndex = useGame((s) => s.historyIndex);
  const historyLen = useGame((s) => s.history.length);
  const canGoBack = historyIndex > 0;
  const canGoForward =
    historyIndex < historyLen - 1 ||
    (!state.currentPhaseEmpireId && state.eventQueue.length === 0 && !state.gameOver);

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  // Mobile drill-down: narrow screens show ONE main pane at a time —
  // either the galaxy map or the focused system's panel. Desktop
  // shows both side-by-side and this state is effectively ignored
  // (see the .mobile-view-* CSS — no hiding rules fire above the
  // breakpoint). Tapping a system swaps to "system"; tapping the
  // "Galaxy" back button (or entering move mode) swaps to "galaxy".
  const [mobileView, setMobileView] = useState<"galaxy" | "system">("galaxy");
  // Body id to highlight in the body list — used by the "Queue Build"
  // attention focus to point the player at the specific idle body.
  // Cleared when the focus target changes (useEffect below) or when
  // the user queues something on any body.
  const [highlightBodyId, setHighlightBodyId] = useState<string | null>(null);
  // Per-body build queue expand/collapse state. Bodies default to
  // collapsed — clicking the body header toggles. The "Queue Build"
  // attention flow adds the target body to this set so the queue +
  // offer buttons are already visible when the player arrives.
  const [expandedBodyIds, setExpandedBodyIds] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [chronicleOpen, setChronicleOpen] = useState(false);
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
  // Pending "declare war on arrival" confirmation. When the player
  // picks a destination whose path passes through or lands on one or
  // more foreign empires we're not at war with, we stash the move
  // here and show a modal instead of dispatching immediately.
  const [pendingWarMove, setPendingWarMove] = useState<{
    fleetId: string;
    toSystemId: string;
    splitCount: number | null;
    enemiesToDeclare: string[]; // empire ids we'd end up at war with
  } | null>(null);

  // The UI assumes a human-controlled empire is always present.
  // Bind it once so we don't need humanEmpireOrThrow(state) on every
  // line; this replaces what used to be `player`.
  const player = humanEmpireOrThrow(state);
  const origin = originById(player.originId);
  const species = speciesById(player.speciesId);
  const pendingEvent = state.eventQueue[0] ?? null;

  // Arrow-key navigation: hold left to step backwards through history,
  // hold right to step forward (scrubbing history, or advancing a new
  // turn when already at the head). Uses our own keydown→interval
  // repeat (OS auto-repeat is typically a 300-500ms delay then ~30/s,
  // too slow for scrubbing dozens of turns). Step every 40ms while
  // held — ~25 turns/second.
  useEffect(() => {
    const STEP_INTERVAL_MS = 40;
    const held: Record<string, ReturnType<typeof setInterval> | null> = {
      ArrowLeft: null,
      ArrowRight: null,
    };
    const stepFor = (key: string) => {
      if (key === "ArrowLeft") goBack();
      else if (key === "ArrowRight") goForward();
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (held[e.key]) return; // ignore OS auto-repeats while held
      stepFor(e.key);
      held[e.key] = setInterval(() => stepFor(e.key), STEP_INTERVAL_MS);
    };
    const onUp = (e: KeyboardEvent) => {
      const timer = held[e.key];
      if (timer) {
        clearInterval(timer);
        held[e.key] = null;
      }
    };
    const onBlur = () => {
      for (const k of Object.keys(held)) {
        const timer = held[k];
        if (timer) clearInterval(timer);
        held[k] = null;
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      onBlur();
    };
  }, [goBack, goForward]);

  const capital = player.capitalBodyId
    ? state.galaxy.bodies[player.capitalBodyId]
    : null;
  const capitalSystem = capital ? state.galaxy.systems[capital.systemId] : null;

  const deltas: Resources = perTurnIncome(state);
  const totalHammers = player.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return sum + sys.bodyIds.reduce((s, bid) => s + (state.galaxy.bodies[bid]?.hammers ?? 0), 0);
  }, 0);
  const popsNow = totalPops(state);
  // Effective cap accounts for species maxPopsMult (e.g. insectoid +50%),
  // matching what pop growth actually allows.
  const popsCap = player.systemIds.reduce((sum, sid) => {
    const sys = state.galaxy.systems[sid];
    if (!sys) return sum;
    return (
      sum +
      sys.bodyIds.reduce((s, bid) => {
        const body = state.galaxy.bodies[bid];
        return s + (body ? maxPopsFor(player, body) : 0);
      }, 0)
    );
  }, 0);
  const colonizeHammerCost = effectiveColonizeHammers(player);
  const colonizePoliticalCost = effectiveColonizePolitical(player);
  // Turns to finish a new colonize project, given current hammer rate and
  // any existing FIFO queue already consuming from the pool.
  function turnsToColonize(): number {
    if (totalHammers <= 0) return Infinity;
    const backlogHammers = allOrdersOf(state, player).reduce(
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
      moveFleet.empireId !== player.id ||
      moveFleet.shipCount <= 0);
  useEffect(() => {
    if (moveFleetStale) setMoveMode(null);
  }, [moveFleetStale]);
  // Mobile drill-down: entering move mode from the system pane needs
  // to swap back to the galaxy view since that's where the target is
  // picked. Desktop shows both panes so this is a no-op visually.
  useEffect(() => {
    if (moveMode) setMobileView("galaxy");
  }, [moveMode]);
  // Clear the "Queue Build" body highlight once the player has
  // actually queued something on it (its queue goes non-empty).
  // Also clear if the body vanishes or flips owners.
  useEffect(() => {
    if (!highlightBodyId) return;
    const body = state.galaxy.bodies[highlightBodyId];
    if (!body || body.queue.length > 0) setHighlightBodyId(null);
  }, [highlightBodyId, state]);
  // Scroll the highlighted body into view whenever the highlight
  // changes. The body-row carries a data-body-id attribute; we just
  // find and call scrollIntoView on it. Runs in a rAF to give React
  // a frame to render the expanded queue first so the scroll target
  // has its final size.
  useEffect(() => {
    if (!highlightBodyId) return;
    const id = highlightBodyId;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-body-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightBodyId]);
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

  // Walk a path (excluding origin) and collect every foreign empire
  // we aren't already at war with. These are the empires the move
  // would declare war on by entering their space.
  function enemiesAlongPath(path: string[]): string[] {
    const uniq = new Set<string>();
    for (const sid of path) {
      const sys = state.galaxy.systems[sid];
      if (!sys || !sys.ownerId) continue;
      if (sys.ownerId === player.id) continue;
      if (atWar(state, player.id, sys.ownerId)) continue;
      uniq.add(sys.ownerId);
    }
    return [...uniq];
  }

  function dispatchCommitMove(
    fleetId: string,
    toSystemId: string,
    splitCount: number | null,
  ) {
    if (splitCount !== null) {
      dispatch({
        type: "splitFleet",
        byEmpireId: player.id,
        fleetId,
        count: splitCount,
        toSystemId,
      });
      // After a split the peel-off is a different fleet; exit move
      // mode so the user picks up whichever group they care about.
      setMoveMode(null);
    } else {
      dispatch({
        type: "setFleetDestination",
        byEmpireId: player.id,
        fleetId,
        toSystemId,
      });
    }
  }

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
        const enemies = enemiesAlongPath(path);
        if (enemies.length > 0) {
          // Foreign territory on the way — stash the commit so the
          // player can confirm the war declaration.
          setPendingWarMove({
            fleetId: moveMode.fleetId,
            toSystemId: id,
            splitCount: count,
            enemiesToDeclare: enemies,
          });
        } else {
          dispatchCommitMove(moveMode.fleetId, id, count);
        }
        setSelectedSystemId(id);
        return;
      }
    }
    // Tap on origin, unreachable system, or empty space: exit move mode
    // and behave normally.
    if (moveMode) setMoveMode(null);
    setSelectedSystemId(id);
    // Mobile drill-down: picking a system takes you to the system pane
    // (desktop shows both panes anyway, so this state is inert there).
    // Empty-space taps (id === null) keep you on galaxy view.
    if (id) setMobileView("system");
  }

  // Fog layer: compute once, share between the galaxy map prop and the
  // system-detail panel. If the player selected a system that's never
  // been discovered (shouldn't happen via map clicks — those systems
  // aren't rendered — but could survive across saves), fall back to
  // the capital as if nothing were selected.
  const playerSensor = sensorSet(state, player.id);
  const playerDiscovered = new Set(player.perception.discovered);
  const rawFocus = selectedSystemId
    ? state.galaxy.systems[selectedSystemId] ?? null
    : capitalSystem;
  const focusUnknown = !!rawFocus && !playerDiscovered.has(rawFocus.id);
  const focusSystem = focusUnknown ? capitalSystem : rawFocus;
  // Stale focus: discovered but no longer in sensor. The panel reads
  // ownership + fleets from the snapshot and hides live-only info
  // (siege, colonize buttons, income, growth, build queue on bodies).
  const focusStale =
    !!focusSystem && !playerSensor.has(focusSystem.id) && playerDiscovered.has(focusSystem.id);
  const focusSnapshot = focusStale && focusSystem
    ? player.perception.snapshots[focusSystem.id] ?? null
    : null;
  const focusBodies = focusSystem
    ? focusSystem.bodyIds.map((bid) => state.galaxy.bodies[bid]).filter((b): b is Body => !!b)
    : [];
  // Effective owner: snapshot-last-seen when stale, live otherwise.
  const focusOwnerId = focusStale
    ? focusSnapshot?.ownerId ?? null
    : focusSystem?.ownerId ?? null;
  const focusOwnerEmpire = focusOwnerId
    ? empireById(state, focusOwnerId)
    : null;
  const focusIsOurs = focusOwnerEmpire?.id === player.id;
  const focusOwnerSpecies = focusOwnerEmpire
    ? speciesById(focusOwnerEmpire.speciesId)
    : null;

  return (
    <>
      {/* ===== Left sidebar ===== */}
      <div className="sidebar">
        {(player.portraitArt || species?.art) && (
          <div
            className="portrait-card"
            style={{ borderColor: player.color }}
            title={`${empireSpeciesName(player)} · ${player.name}`}
          >
            <img src={player.portraitArt || species?.art} alt={empireSpeciesName(player)} />
          </div>
        )}
        {(() => {
          // Big primary-action button. It morphs based on state:
          //   - autoplay running → pause control
          //   - nothing blocking → "play" = start autoplay
          //   - something needs attention → focus-the-blocker label +
          //     click action that jumps the UI to it (select the
          //     idle fleet's system, the capital for an empty build
          //     queue, etc.). Modal-backed blockers show the label
          //     but the click is inert because the modal is already
          //     in front of the user.
          const focus = attentionFocus(state);
          if (autoplayOn) {
            return (
              <button
                className="endturn-card autoplay-on"
                onClick={() => setAutoplay(false)}
                title="Pause autoplay"
              >
                <span className="turn-num">T{state.turn}</span>
                <span>Pause</span>
              </button>
            );
          }
          if (focus.kind === "none") {
            return (
              <button
                className="endturn-card"
                onClick={() => setAutoplay(true)}
                title="Auto-advance until something needs you"
              >
                <span className="turn-num">T{state.turn}</span>
                <span>Play</span>
              </button>
            );
          }
          const modalOwned = focus.kind === "gameOver" || focus.kind === "firstContact" || focus.kind === "event";
          const label =
            focus.kind === "gameOver" ? "Game Over" :
            focus.kind === "firstContact" ? "First Contact" :
            focus.kind === "event" ? "Event" :
            focus.kind === "hostileFleet" ? "Hostile Fleet" :
            focus.kind === "idleFleet" ? "Route Fleet" :
            focus.kind === "emptyQueue" ? "Queue Build" :
            "Attention";
          return (
            <button
              className={`endturn-card attention ${focus.kind}`}
              disabled={modalOwned}
              onClick={() => {
                if (focus.kind === "hostileFleet") {
                  // No dismiss — alert persists until the fleet is
                  // actually handled (gone from sensor, peace, etc.).
                  // Click just jumps the map to the threat.
                  setSelectedSystemId(focus.systemId);
                  setMobileView("galaxy");
                } else if (focus.kind === "idleFleet") {
                  setSelectedSystemId(focus.systemId);
                  setMoveMode({ fleetId: focus.fleetId, split: null });
                  // setMoveMode effect flips us to galaxy already.
                } else if (focus.kind === "emptyQueue" && focus.systemId) {
                  setSelectedSystemId(focus.systemId);
                  setHighlightBodyId(focus.bodyId);
                  setMobileView("system");
                  if (focus.bodyId) {
                    // Open that body's queue section so the offer
                    // buttons are visible right away; the scroll
                    // effect below handles positioning.
                    const bid = focus.bodyId;
                    setExpandedBodyIds((s) => {
                      if (s.has(bid)) return s;
                      const next = new Set(s);
                      next.add(bid);
                      return next;
                    });
                  }
                }
              }}
              title={label}
            >
              <span className="turn-num">T{state.turn}</span>
              <span>{label}</span>
            </button>
          );
        })()}

        {/* Back/forward time-scrubbing. Forward also advances time
            when already at the head of history (single-step without
            engaging autoplay). Keyboard: hold ← / → to scrub without
            clicking. */}
        <div className="time-controls">
          <button
            className="time-btn"
            onClick={goBack}
            disabled={!canGoBack}
            title="Back one turn (←)"
          >
            ←
          </button>
          <button
            className="time-btn"
            onClick={goForward}
            disabled={!canGoForward}
            title="Forward one turn (→)"
          >
            →
          </button>
        </div>

        <div className="res-grid">
          {RESOURCE_ORDER.map((k) => (
            <ResCell
              key={k}
              icon={RESOURCE_ICON[k]}
              value={Math.round(empireResourceStock(player, k))}
              delta={deltas[k]}
              onClick={() => setBreakdown(resourceBreakdownAsStat(state, player, k))}
            />
          ))}
          <ResCell
            icon={COMPUTE_ICON}
            value={`${player.compute.cap - projectedFleetCompute(state, player)}/${player.compute.cap}`}
            onClick={() => setBreakdown(computeBreakdownFor(state, player))}
          />
          <ResCell
            icon={HAMMERS_ICON}
            value={totalHammers}
            onClick={() => setBreakdown(hammersBreakdownFor(state, player))}
          />
          <ResCell
            icon={POPS_ICON}
            value={`${Math.floor(popsNow)}/${popsCap}`}
            delta={expectedPopGrowth(state, player)}
            onClick={() => setBreakdown(popsBreakdownFor(state, player))}
            emphasis={popsCap > 0 && Math.floor(popsNow) >= popsCap ? "maxed" : undefined}
          />
        </div>

        <button className="menu-btn" onClick={() => setPoliciesOpen(true)}>
          Policies
        </button>
        <button className="menu-btn" onClick={() => setRosterOpen(true)}>
          Empires
        </button>
        <button className="menu-btn" onClick={() => setChronicleOpen(true)}>
          Chronicle
          {state.eventLog.length > 0 && (
            <span className="menu-btn-count">{state.eventLog.length}</span>
          )}
        </button>
        <button className="menu-btn" onClick={() => setMenuOpen(true)}>
          Menu
        </button>

        <div className="version-tag" title="Build version">
          {__APP_VERSION__}
        </div>
      </div>

      {/* ===== Main ===== */}
      <div className={`main-column mobile-view-${mobileView}`}>
        <div className="system-panel">
          <div className="scene-wrap">
            <div className="panel-label">
              <button
                className="mobile-back-btn"
                onClick={() => setMobileView("galaxy")}
                title="Back to galaxy"
              >
                ← Galaxy
              </button>
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
            {focusSystem?.occupation && !focusStale && (() => {
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
                // Stale systems suppress ownership/capital rings — those
                // draw off live `body.pops`, which isn't known to us
                // once the system leaves sensor range.
                ownerColor={focusStale ? null : focusOwnerEmpire?.color ?? null}
                capitalBodyId={focusStale ? null : focusOwnerEmpire?.capitalBodyId ?? null}
                turn={state.turn}
                seenFlavourIds={new Set(player.perception.seenFlavour)}
              />
            ) : (
              <div className="scene-empty">Tap a star on the galaxy map.</div>
            )}
          </div>
          <div className="detail-scroll">
            {focusSystem && focusStale && focusSnapshot && focusSnapshot.fleets.length > 0 && (
              <div className="fleet-strip">
                <span className="fleet-strip-label">Fleets (last seen T{focusSnapshot.turn})</span>
                {focusSnapshot.fleets.map((f, idx) => {
                  const empire = empireById(state, f.empireId);
                  return (
                    <span
                      key={`stale-${focusSystem.id}-${f.empireId}-${idx}`}
                      className="fleet-pill"
                      style={{
                        borderColor: empire?.color ?? "var(--border)",
                        opacity: 0.6,
                      }}
                      title={empire ? `${empire.name} · last seen ${f.shipCount} ships` : ""}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <polygon
                          points="5,1 9,9 1,9"
                          fill={empire?.color ?? "var(--text)"}
                        />
                      </svg>
                      {f.shipCount}
                    </span>
                  );
                })}
              </div>
            )}
            {focusSystem && !focusStale && (() => {
              const fleets = fleetsInSystem(state, focusSystem.id);
              if (fleets.length === 0) return null;
              return (
                <div className="fleet-strip">
                  <span className="fleet-strip-label">Fleets</span>
                  {fleets.map((f) => {
                    const empire = empireById(state, f.empireId);
                    const isPlayer = f.empireId === player.id;
                    const canMove = isPlayer && f.shipCount > 0;
                    const isMoving = moveMode?.fleetId === f.id;
                    const destSys = f.destinationSystemId
                      ? state.galaxy.systems[f.destinationSystemId] ?? null
                      : null;
                    const eta = destSys ? fleetEtaTurns(state, f) : null;
                    return (
                      <button
                        key={f.id}
                        className={`fleet-pill fleet-pill-btn ${isMoving ? "moving" : ""}`}
                        style={{ borderColor: empire?.color ?? "var(--border)" }}
                        title={
                          empire
                            ? canMove
                              ? destSys
                                ? `${empire.name} · en route to ${destSys.name}${eta != null ? ` (ETA ${eta}t)` : ""}`
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
                            {eta != null && <span className="fleet-pill-eta"> {eta}t</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {focusStale ? (
              <div className="empire-card">
                <div>
                  <span className="stat-label">Last seen:</span>{" "}
                  T{focusSnapshot?.turn ?? "?"}
                </div>
                <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
                  Outside sensor range. Move a fleet adjacent to refresh intel.
                </div>
              </div>
            ) : focusSystem
              ? focusBodies.map((body) => {
                  // Orders to show on this body's row come from two
                  // angles — both sides of a host/target relationship:
                  //   - target perspective: orders targeting this body
                  //     (wherever they're hosted). Outposts on this
                  //     body's own star, for example, land here.
                  //   - host perspective: orders hosted on this body
                  //     but targeting ELSEWHERE (outposts on adjacent
                  //     unowned stars typically host on the capital).
                  //     Without this pass, the player can't see what
                  //     their capital's hammers are going into.
                  // Same-body orders (host === target) only surface
                  // from the target side, so no double-rendering.
                  const orders: BodyOrderEntry[] = [];
                  // Target-side
                  for (const { order, hostBodyId, hostEmpireId } of ordersTargetingBody(state, body.id)) {
                    if (hostEmpireId !== player.id) continue;
                    const hostBody = state.galaxy.bodies[hostBodyId];
                    const hostRate = hostBody
                      ? Math.floor(hostBody.pops * hammersPerPopFor(player, hostBody))
                      : 0;
                    orders.push({
                      order,
                      hostBodyId,
                      hostBodyName: hostBody?.name ?? "?",
                      hostRate,
                      targetBodyId: body.id,
                      targetBodyName: body.name,
                      perspective: "target",
                    });
                  }
                  // Host-side — orders this body's queue is paying for
                  // but that target a different body.
                  const selfBody = state.galaxy.bodies[body.id];
                  if (selfBody) {
                    const hostRate = Math.floor(body.pops * hammersPerPopFor(player, body));
                    for (const order of selfBody.queue) {
                      const tgt =
                        order.kind === "colonize"
                          ? order.targetBodyId
                          : order.targetBodyId;
                      if (!tgt || tgt === body.id) continue;
                      const targetBody = state.galaxy.bodies[tgt];
                      orders.push({
                        order,
                        hostBodyId: body.id,
                        hostBodyName: body.name,
                        hostRate,
                        targetBodyId: tgt,
                        targetBodyName: targetBody?.name ?? "?",
                        perspective: "host",
                      });
                    }
                  }
                  const bodyProjects = availableBodyProjectsFor(state, player, body.id);
                  return (
                    <BodyRow
                      key={body.id}
                      body={body}
                      income={focusIsOurs ? bodyIncome(state, body) : {}}
                      isCapital={body.id === player.capitalBodyId}
                      owned={focusIsOurs}
                      colonizable={canColonize(state, body.id)}
                      orders={orders}
                      colonizeTurns={colonizeTurnEstimate}
                      colonizeHammers={colonizeHammerCost}
                      colonizePolitical={colonizePoliticalCost}
                      growth={focusIsOurs ? growthEstimate(state, player, body) : null}
                      bodyProjects={bodyProjects}
                      hammerRate={totalHammers}
                      flavourSeen={player.perception.seenFlavour.includes(body.id)}
                      highlighted={highlightBodyId === body.id}
                      expanded={expandedBodyIds.has(body.id)}
                      onToggle={() => {
                        setExpandedBodyIds((s) => {
                          const next = new Set(s);
                          if (next.has(body.id)) next.delete(body.id);
                          else next.add(body.id);
                          return next;
                        });
                      }}
                      onColonize={() =>
                        dispatch({
                          type: "queueColonize",
                          byEmpireId: player.id,
                          targetBodyId: body.id,
                        })
                      }
                      onQueueBodyProject={(projectId) =>
                        dispatch({
                          type: "queueEmpireProject",
                          byEmpireId: player.id,
                          projectId,
                          targetBodyId: body.id,
                        })
                      }
                      onCancelOrder={(orderId) =>
                        dispatch({
                          type: "cancelOrder",
                          byEmpireId: player.id,
                          orderId,
                        })
                      }
                    />
                  );
                })
              : (
                <div className="empire-card">
                  <div><span className="stat-label">Species:</span> {empireSpeciesName(player)}</div>
                  <div><span className="stat-label">Origin:</span> {origin?.name ?? "?"}</div>
                  <div><span className="stat-label">Population:</span> {totalPops(state)}</div>
                </div>
              )}

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
                  {e.id === player.id ? "Your turn resolving…" : `${e.name} acting…`}
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
              viewerEmpire={player}
              sensor={playerSensor}
              hostileEmpireIds={(() => {
                const s = new Set<string>();
                for (const e of allEmpires(state)) {
                  if (e.id === player.id) continue;
                  if (atWar(state, player.id, e.id)) s.add(e.id);
                }
                return s;
              })()}
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
                            byEmpireId: player.id,
                            fleetId: moveFleet.id,
                            toSystemId: null,
                          })
                        }
                      >
                        cancel route
                      </button>
                    </div>
                  ) : (
                    <div className="move-bar-hint">Tap a system to send the fleet, or sleep it so autoplay skips over it.</div>
                  )}
                  <div className="move-bar-route">
                    <button
                      type="button"
                      className="move-bar-clear"
                      onClick={() => {
                        dispatch({
                          type: "setFleetAutoDiscover",
                          byEmpireId: player.id,
                          fleetId: moveFleet.id,
                          autoDiscover: !moveFleet.autoDiscover,
                        });
                        setMoveMode(null);
                      }}
                    >
                      {moveFleet.autoDiscover ? "stop auto-discover" : "auto-discover"}
                    </button>
                    <button
                      type="button"
                      className="move-bar-clear"
                      onClick={() => {
                        dispatch({
                          type: "setFleetSleep",
                          byEmpireId: player.id,
                          fleetId: moveFleet.id,
                          sleeping: !moveFleet.sleeping,
                        });
                        setMoveMode(null);
                      }}
                    >
                      {moveFleet.sleeping ? "wake fleet" : "sleep fleet"}
                    </button>
                  </div>
                </div>
              );
            })()}
            <span className="panel-stats">
              {player.systemIds.length}/{Object.keys(state.galaxy.systems).length} yours
            </span>
          </div>
        </div>
      </div>

      {state.pendingFirstContacts.length > 0 && (
        <FirstContactModal
          otherEmpireId={state.pendingFirstContacts[0].otherEmpireId}
          onDismiss={() => dispatch({ type: "dismissFirstContact" })}
        />
      )}
      {state.pendingFirstContacts.length === 0 &&
        state.pendingWarDeclarations.length > 0 && (
          <WarDeclaredModal
            aggressorEmpireId={state.pendingWarDeclarations[0].aggressorEmpireId}
            onDismiss={() => dispatch({ type: "dismissWarDeclaration" })}
          />
        )}
      {state.pendingFirstContacts.length === 0 &&
        state.pendingWarDeclarations.length === 0 &&
        pendingEvent && <EventModal eventId={pendingEvent.eventId} />}
      {breakdown && (
        <StatBreakdownModal breakdown={breakdown} onClose={() => setBreakdown(null)} />
      )}
      {pendingWarMove && (
        <div className="modal-scrim" onClick={() => setPendingWarMove(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Declare war?</h2>
            <div className="event-text">
              This move will cross into foreign territory. By sending this
              fleet onwards you will declare war on:
            </div>
            <ul style={{ margin: "8px 0 12px 20px" }}>
              {pendingWarMove.enemiesToDeclare.map((eid) => {
                const e = empireById(state, eid);
                return (
                  <li key={eid} style={{ color: e?.color ?? undefined }}>
                    {e?.name ?? eid}
                  </li>
                );
              })}
            </ul>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="close-btn"
                onClick={() => setPendingWarMove(null)}
              >
                cancel
              </button>
              <button
                className="close-btn"
                style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                onClick={() => {
                  dispatchCommitMove(
                    pendingWarMove.fleetId,
                    pendingWarMove.toSystemId,
                    pendingWarMove.splitCount,
                  );
                  setPendingWarMove(null);
                }}
              >
                declare war
              </button>
            </div>
          </div>
        </div>
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
      {chronicleOpen && (
        <ChronicleModal
          log={state.eventLog}
          onClose={() => setChronicleOpen(false)}
        />
      )}
      {fleetModalId && (
        <FleetModal fleetId={fleetModalId} onClose={() => setFleetModalId(null)} />
      )}
      {menuOpen && (
        <PortraitMenu onReset={reset} onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
}
