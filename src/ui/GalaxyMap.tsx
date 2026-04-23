import type { Empire, Fleet, Galaxy, StarSystem, SystemSnapshot } from "../sim/types";
import { HAB_COLOR } from "./icons";

const HEX_SIZE = 16;       // radius of each hex
const SQRT_3 = Math.sqrt(3);

// Pointy-top axial -> pixel.
function hexToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT_3 * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

// Six corner angles (pointy-top): 30, 90, 150, 210, 270, 330 degrees.
// corners[i] + corners[i+1] define edge i.
// Edge i corresponds to the neighbor on one of six axial directions.
function hexCorners(cx: number, cy: number, size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i + 30) * Math.PI) / 180;
    out.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return out;
}

// Neighbor direction for each edge, in the same order as corners[i] -> corners[i+1].
// SVG y is down, so sin(30)=+0.5 actually places that corner BELOW center —
// the edge labels below reflect on-screen position, not math convention.
// Edge 0 (30->90):   lower-right edge -> (0, +1) neighbor
// Edge 1 (90->150):  lower-left edge  -> (-1, +1)
// Edge 2 (150->210): left edge        -> (-1,  0)
// Edge 3 (210->270): upper-left edge  -> (0, -1)
// Edge 4 (270->330): upper-right edge -> (+1, -1)
// Edge 5 (330->30):  right edge       -> (+1,  0)
const EDGE_NEIGHBOR: Array<[number, number]> = [
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [1, 0],
];

function polygonPoints(corners: Array<[number, number]>): string {
  return corners.map(([x, y]) => `${x},${y}`).join(" ");
}

// Small n-armed star glyph at (cx,cy). Used to mark flavor sites.
function starGlyphPoints(cx: number, cy: number, outerR: number, innerR: number, arms: number): string {
  const pts: string[] = [];
  for (let i = 0; i < arms * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / arms - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

// Chain individual edge segments into connected polylines so strokes at
// corners miter cleanly. Two edges are considered connected if they share
// an endpoint (matched at 2-decimal precision to survive float drift).
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function buildPolylines(edges: Edge[]): Array<Array<[number, number]>> {
  const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    const k1 = key(e.x1, e.y1);
    const k2 = key(e.x2, e.y2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push(e);
    adj.get(k2)!.push(e);
  }

  const used = new Set<Edge>();
  const lines: Array<Array<[number, number]>> = [];

  for (const start of edges) {
    if (used.has(start)) continue;
    // Try to extend in both directions from `start` to capture open chains too.
    const forward = walk(start, [start.x1, start.y1], [start.x2, start.y2]);
    const backward = walk(start, [start.x2, start.y2], [start.x1, start.y1]).slice(1);
    const combined: Array<[number, number]> = backward.reverse().concat(forward);
    lines.push(combined);
  }

  function walk(
    firstEdge: Edge,
    startPt: [number, number],
    secondPt: [number, number],
  ): Array<[number, number]> {
    const points: Array<[number, number]> = [startPt, secondPt];
    used.add(firstEdge);
    let currentPt = secondPt;
    while (true) {
      const k = key(currentPt[0], currentPt[1]);
      const candidates = (adj.get(k) || []).filter((e) => !used.has(e));
      if (candidates.length === 0) break;
      const next = candidates[0];
      used.add(next);
      const nextPt: [number, number] = key(next.x1, next.y1) === k
        ? [next.x2, next.y2]
        : [next.x1, next.y1];
      points.push(nextPt);
      currentPt = nextPt;
    }
    return points;
  }

  return lines;
}

function polylineD(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  // Close the loop with Z if first and last point coincide (perimeter loops).
  const last = points[points.length - 1];
  const isClosed =
    points.length > 2 &&
    Math.abs(first[0] - last[0]) < 0.01 &&
    Math.abs(first[1] - last[1]) < 0.01;
  const body = rest.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} ${body}${isClosed ? " Z" : ""}`;
}

// Distinct palette for visualising the player empire's connected
// components. Hash the component id into this list so colours are
// stable across renders. Deliberately avoids the player's own empire
// colour so the badge reads as "component" vs "ownership".
const COMPONENT_PALETTE = [
  "#f2d06b", // amber
  "#9ac94a", // lime
  "#e37c7c", // coral
  "#7fbfd9", // sky
  "#c98ae0", // lavender
  "#e8a850", // tangerine
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function componentColor(componentId: string): string {
  return COMPONENT_PALETTE[hashStr(componentId) % COMPONENT_PALETTE.length];
}

// Fog display state for one system from the viewer's perspective.
//   live   — in sensor right now; show true state.
//   stale  — discovered before, out of sensor now; show the last snapshot
//            we took, dimmed. No occupation ring, no live fleet data.
//   hidden — never discovered; omit the system from rendering entirely.
// When no viewerEmpire is supplied, every system is treated as live
// (dev/spectator view — no fog applied).
type DisplayKind = "live" | "stale" | "hidden";

interface DisplayFleet {
  key: string;
  empireId: string;
  shipCount: number;
}

interface SystemDisplay {
  kind: DisplayKind;
  ownerId: string | null;
  fleets: DisplayFleet[];
  showOccupation: boolean;
  // When stale, reads the snapshot turn for UI hints / future "last seen".
  snapshotTurn?: number;
}

export function GalaxyMap({
  galaxy,
  empires,
  fleets,
  selectedId,
  onSelect,
  moveMode,
  playerComponents,
  viewerEmpire,
  sensor,
}: {
  galaxy: Galaxy;
  empires: Empire[];
  fleets: Fleet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Active when a player fleet is selected for movement. `pathSystemIds`
  // is the committed route (if any) in order after the origin — drawn
  // as a dashed line in the highlight colour.
  moveMode?: {
    originSystemId: string;
    pathSystemIds: string[];
    highlightColor: string;
  } | null;
  // Map systemId → componentId for the player empire's owned systems.
  // Multiple componentIds mean the empire is split; each component gets
  // a distinct tint so the player can see the logistics topology at a
  // glance.
  playerComponents?: Map<string, string>;
  // Fog of war: whose perspective we're rendering from, and which
  // systems are currently in that empire's sensor range. Both must be
  // supplied together; omitting them renders every system live.
  viewerEmpire?: Empire | null;
  sensor?: Set<string> | null;
}) {
  const systems = Object.values(galaxy.systems);

  // id -> empire, for ownerId -> color lookup.
  const empireById = new Map<string, Empire>();
  for (const e of empires) empireById.set(e.id, e);

  // Fleets by system: { [sysId]: Array<{empire, count}> }.
  const fleetsBySystem = new Map<string, Fleet[]>();
  for (const f of fleets) {
    const arr = fleetsBySystem.get(f.systemId) ?? [];
    arr.push(f);
    fleetsBySystem.set(f.systemId, arr);
  }

  // Per-system fog resolution. Unexplored → hidden; in sensor → live;
  // else → stale (from snapshot). Done once up front so every render
  // branch can just look up by systemId.
  const fogActive = !!(viewerEmpire && sensor);
  const discovered = fogActive ? new Set(viewerEmpire!.discovered) : null;
  const snapshots = fogActive ? viewerEmpire!.snapshots : null;
  const displayBySystem = new Map<string, SystemDisplay>();
  for (const sys of systems) {
    if (!fogActive) {
      const liveFleets: DisplayFleet[] = (fleetsBySystem.get(sys.id) ?? []).map((f) => ({
        key: f.id,
        empireId: f.empireId,
        shipCount: f.shipCount,
      }));
      displayBySystem.set(sys.id, {
        kind: "live",
        ownerId: sys.ownerId,
        fleets: liveFleets,
        showOccupation: true,
      });
      continue;
    }
    if (!discovered!.has(sys.id)) {
      displayBySystem.set(sys.id, {
        kind: "hidden",
        ownerId: null,
        fleets: [],
        showOccupation: false,
      });
      continue;
    }
    if (sensor!.has(sys.id)) {
      const liveFleets: DisplayFleet[] = (fleetsBySystem.get(sys.id) ?? []).map((f) => ({
        key: f.id,
        empireId: f.empireId,
        shipCount: f.shipCount,
      }));
      displayBySystem.set(sys.id, {
        kind: "live",
        ownerId: sys.ownerId,
        fleets: liveFleets,
        showOccupation: true,
      });
      continue;
    }
    // Stale — fall back to the last snapshot we took of this system.
    const snap: SystemSnapshot | undefined = snapshots![sys.id];
    const staleFleets: DisplayFleet[] = (snap?.fleets ?? []).map((f, idx) => ({
      key: `stale-${sys.id}-${f.empireId}-${idx}`,
      empireId: f.empireId,
      shipCount: f.shipCount,
    }));
    displayBySystem.set(sys.id, {
      kind: "stale",
      ownerId: snap?.ownerId ?? null,
      fleets: staleFleets,
      showOccupation: false,
      snapshotTurn: snap?.turn,
    });
  }

  // Systems actually rendered this frame (hidden ones drop out).
  const visibleSystems = systems.filter((s) => displayBySystem.get(s.id)!.kind !== "hidden");

  // Lookup: "q,r" -> system (for neighbor ownership check). Limited to
  // visibleSystems so an unexplored neighbour reads as "outside" — we
  // don't leak its true ownership into the border of a visible hex.
  const byCoord = new Map<string, StarSystem>();
  for (const s of visibleSystems) byCoord.set(`${s.q},${s.r}`, s);

  function ownerIdAt(q: number, r: number): string | null {
    const s = byCoord.get(`${q},${r}`);
    if (!s) return null;
    return displayBySystem.get(s.id)?.ownerId ?? null;
  }

  // Bounds for viewBox. Use only visibleSystems so early-game (when we
  // have ~7 systems discovered) the viewport actually fits what we've
  // found, rather than zooming out over a vast empty galaxy.
  const pts = (visibleSystems.length > 0 ? visibleSystems : systems).map((s) => hexToPixel(s.q, s.r));
  const pad = HEX_SIZE + 4;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const w = maxX - minX;
  const h = maxY - minY;

  // Per-empire perimeter + interior edges so each empire's territory
  // renders as one contiguous region with faint internal lines.
  // perimeterSegments also keeps the originating systemId alongside
  // each edge, which the split-component renderer uses to colour the
  // outline per-region instead of per-empire.
  const perimeterByOwner = new Map<string, Edge[]>();
  const interiorByOwner = new Map<string, Edge[]>();
  const perimeterSegments: Array<{ sysId: string; x1: number; y1: number; x2: number; y2: number }> = [];
  for (const sys of visibleSystems) {
    const ownerId = displayBySystem.get(sys.id)!.ownerId;
    if (!ownerId) continue;
    const { x, y } = hexToPixel(sys.q, sys.r);
    const corners = hexCorners(x, y, HEX_SIZE - 1);
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = EDGE_NEIGHBOR[i];
      const nq = sys.q + dq;
      const nr = sys.r + dr;
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 6];
      const neighborOwnerId = ownerIdAt(nq, nr);
      if (neighborOwnerId === ownerId) {
        if (sys.q < nq || (sys.q === nq && sys.r < nr)) {
          if (!interiorByOwner.has(ownerId)) interiorByOwner.set(ownerId, []);
          interiorByOwner.get(ownerId)!.push({ x1: ax, y1: ay, x2: bx, y2: by });
        }
      } else {
        if (!perimeterByOwner.has(ownerId)) perimeterByOwner.set(ownerId, []);
        perimeterByOwner.get(ownerId)!.push({ x1: ax, y1: ay, x2: bx, y2: by });
        perimeterSegments.push({ sysId: sys.id, x1: ax, y1: ay, x2: bx, y2: by });
      }
    }
  }

  return (
    <svg
      viewBox={`${minX} ${minY} ${w} ${h}`}
      className="galaxy-map"
      preserveAspectRatio="xMidYMid meet"
      onClick={() => onSelect(null)}
    >
      {/* Hyperlanes (behind everything else). Color a lane with the
          common owner when both endpoints share one. */}
      <g className="hyperlanes">
        {galaxy.hyperlanes.map(([aId, bId], i) => {
          const a = galaxy.systems[aId];
          const b = galaxy.systems[bId];
          if (!a || !b) return null;
          // Only draw a hyperlane if the viewer has discovered both
          // endpoints. One endpoint discovered isn't enough — we don't
          // know what's on the other side, so the lane isn't known to us.
          const da = displayBySystem.get(aId);
          const db = displayBySystem.get(bId);
          if (!da || !db || da.kind === "hidden" || db.kind === "hidden") return null;
          const pa = hexToPixel(a.q, a.r);
          const pb = hexToPixel(b.q, b.r);
          const aOwner = da.ownerId;
          const bOwner = db.ownerId;
          const sharedOwner = aOwner && aOwner === bOwner ? aOwner : null;
          const color = sharedOwner
            ? (empireById.get(sharedOwner)?.color ?? "#3a4355")
            : "#3a4355";
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={color}
              strokeWidth={sharedOwner ? 1.4 : 0.8}
              opacity={sharedOwner ? 0.7 : 0.5}
            />
          );
        })}
      </g>

      {/* Selected fleet's committed route — dashed line in the empire
          colour, drawn above hyperlanes but below systems. */}
      {moveMode && moveMode.pathSystemIds.length > 0 && (() => {
        const origin = galaxy.systems[moveMode.originSystemId];
        if (!origin) return null;
        const points: Array<[number, number]> = [];
        const o = hexToPixel(origin.q, origin.r);
        points.push([o.x, o.y]);
        for (const sid of moveMode.pathSystemIds) {
          const s = galaxy.systems[sid];
          if (!s) continue;
          const p = hexToPixel(s.q, s.r);
          points.push([p.x, p.y]);
        }
        if (points.length < 2) return null;
        const d = points
          .map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
          .join(" ");
        return (
          <g className="move-path">
            <path
              d={d}
              fill="none"
              stroke={moveMode.highlightColor}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="3 2"
              opacity={0.9}
            />
          </g>
        );
      })()}

      {/* Component coloring: when the player empire is split into 2+
          connected regions, each region gets its own tint on the
          territory fill and perimeter instead of the empire's base
          colour. For single-component empires (and for every other
          empire), ownership colour is used unchanged. */}
      {(() => {
        const splitIntoComponents =
          !!playerComponents && new Set(playerComponents.values()).size >= 2;
        // Resolve the color used to fill / outline the given system.
        // Owner comes from the fog-adjusted display state so stale
        // hexes paint with their last-seen owner's colour.
        const colorFor = (sys: StarSystem): string | null => {
          const ownerId = displayBySystem.get(sys.id)?.ownerId ?? null;
          if (!ownerId) return null;
          const empire = empireById.get(ownerId);
          if (!empire) return null;
          if (splitIntoComponents) {
            const cid = playerComponents?.get(sys.id);
            if (cid) return componentColor(cid);
          }
          return empire.color;
        };
        return (
          <>
            {/* Territory fill: one translucent blob per owner/component. */}
            <g className="territory-fill">
              {visibleSystems.map((sys) => {
                const c = colorFor(sys);
                if (!c) return null;
                const stale = displayBySystem.get(sys.id)?.kind === "stale";
                const { x, y } = hexToPixel(sys.q, sys.r);
                return (
                  <polygon
                    key={`fill-${sys.id}`}
                    points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
                    fill={`${c}${stale ? "1a" : "33"}`}
                    stroke="none"
                  />
                );
              })}
            </g>

            {/* Interior edges: one faint line per cross-hex edge, coloured
                by the owning empire (or per-component when split). Edges
                between two different-component hexes are left empire-
                coloured so the split reads visually through the boundary. */}
            <g className="territory-interior">
              {Array.from(interiorByOwner.entries()).flatMap(([ownerId, edges]) => {
                const empire = empireById.get(ownerId);
                if (!empire) return [];
                return buildPolylines(edges).map((pl, i) => (
                  <path
                    key={`${ownerId}-i-${i}`}
                    d={polylineD(pl)}
                    fill="none"
                    stroke={empire.color}
                    strokeWidth={0.6}
                    strokeLinejoin="round"
                    opacity={0.35}
                  />
                ));
              })}
            </g>

            {/* Perimeter: outline per system. For the player-when-split
                case we render per-hex outline segments keyed by each
                system's component colour, so the border visibly changes
                between regions. Otherwise fall back to the empire-wide
                polyline outline the map has always used. */}
            {splitIntoComponents ? (
              <g className="territory-border">
                {perimeterSegments.map(({ sysId, x1, y1, x2, y2 }, i) => {
                  const sys = galaxy.systems[sysId];
                  if (!sys) return null;
                  const c = colorFor(sys);
                  if (!c) return null;
                  return (
                    <line
                      key={`border-seg-${i}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={c}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  );
                })}
              </g>
            ) : (
              <g className="territory-border">
                {Array.from(perimeterByOwner.entries()).flatMap(([ownerId, edges]) => {
                  const empire = empireById.get(ownerId);
                  if (!empire) return [];
                  return buildPolylines(edges).map((pl, i) => (
                    <path
                      key={`${ownerId}-p-${i}`}
                      d={polylineD(pl)}
                      fill="none"
                      stroke={empire.color}
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ));
                })}
              </g>
            )}
          </>
        );
      })()}

      {/* Systems — star dot + optional selected highlight. */}
      {visibleSystems.map((sys) => {
        const display = displayBySystem.get(sys.id)!;
        const { x, y } = hexToPixel(sys.q, sys.r);
        const isOwned = !!display.ownerId;
        const isStale = display.kind === "stale";
        const isSelected = sys.id === selectedId;
        const isMoveOrigin = moveMode?.originSystemId === sys.id;
        const isMoveDest =
          !!moveMode &&
          moveMode.pathSystemIds.length > 0 &&
          moveMode.pathSystemIds[moveMode.pathSystemIds.length - 1] === sys.id;
        const hasFlavor = sys.bodyIds.some((bid) =>
          (galaxy.bodies[bid]?.flavorFlags.length ?? 0) > 0,
        );

        return (
          <g
            key={sys.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(sys.id === selectedId ? null : sys.id);
            }}
            style={{ cursor: "pointer", opacity: isStale ? 0.55 : 1 }}
          >
            {/* Move-mode origin ring — dashed, highlight colour. */}
            {isMoveOrigin && moveMode && (
              <polygon
                points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
                fill="none"
                stroke={moveMode.highlightColor}
                strokeWidth={2}
                strokeDasharray="2 2"
                strokeLinejoin="round"
                opacity={0.85}
              />
            )}
            {/* Move-mode destination ring — solid highlight, at the far
                end of the committed path. */}
            {isMoveDest && moveMode && (
              <polygon
                points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
                fill="none"
                stroke={moveMode.highlightColor}
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={0.9}
              />
            )}
            {/* Selection highlight draws per-hex regardless of ownership. */}
            {isSelected && (
              <polygon
                points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
                fill="none"
                stroke="#ffd580"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
            {/* Occupation ring — pulsing red, reads unambiguously as
                "your system is being taken" regardless of who's doing it.
                Gated on display.showOccupation: stale views can't peek
                at live siege state. */}
            {sys.occupation && display.showOccupation && (
              <polygon
                className="siege-ring"
                points={polygonPoints(hexCorners(x, y, HEX_SIZE - 0.5))}
                fill="none"
                stroke="#ff5a5a"
                strokeWidth={1.6}
                strokeDasharray="2.5 1.5"
                strokeLinejoin="round"
                opacity={0.85}
              />
            )}
            {/* Flavor-site star glyph — small, above the main star dot. */}
            {hasFlavor && (
              <polygon
                points={starGlyphPoints(x + 5, y - 4, 2, 0.9, 5)}
                fill="var(--warn)"
                opacity={0.95}
              />
            )}
            {/* Star dot (centered on the hex). */}
            <circle cx={x} cy={y} r={2.2} fill={isOwned ? "#fff" : "#8a96ab"} opacity={isOwned ? 0.95 : 0.7} />
            {/* Fleet indicators — small triangles in the upper-left
                corner of the hex, one per empire with a fleet here,
                coloured by empire. Tiny text for ship count >= 2.
                Stale systems draw from the snapshot's aggregated
                per-empire counts; live systems draw from the real
                fleets list. Either way the display shape is the same. */}
            {(() => {
              const sysFleets = display.fleets;
              if (sysFleets.length === 0) return null;
              return sysFleets.map((f, idx) => {
                const empire = empireById.get(f.empireId);
                if (!empire) return null;
                const baseX = x - HEX_SIZE * 0.6;
                const baseY = y - HEX_SIZE * 0.35 + idx * 4.5;
                return (
                  <g key={f.key}>
                    <polygon
                      points={`${baseX},${baseY - 1.8} ${baseX + 3.2},${baseY + 1.6} ${baseX - 3.2},${baseY + 1.6}`}
                      fill={empire.color}
                      opacity={0.95}
                    />
                    {f.shipCount > 1 && (
                      <text
                        x={baseX + 4.5}
                        y={baseY + 1.4}
                        fontSize={3.5}
                        fill={empire.color}
                      >
                        {f.shipCount}
                      </text>
                    )}
                  </g>
                );
              });
            })()}

            {/* Body dots — habitability-colored row under the star.
                Only temperate for now (habitable planets are the only
                thing worth previewing). */}
            {(() => {
              const highlighted = sys.bodyIds
                .map((bid) => galaxy.bodies[bid])
                .filter((b): b is NonNullable<typeof b> => !!b && b.habitability === "temperate");
              const n = highlighted.length;
              const spacing = 2.8;
              return highlighted.map((body, i) => {
                const offsetX = (i - (n - 1) / 2) * spacing;
                return (
                  <circle
                    key={body.id}
                    cx={x + offsetX}
                    cy={y + 5.5}
                    r={1.2}
                    fill={HAB_COLOR[body.habitability]}
                    opacity={0.95}
                  />
                );
              });
            })()}
            {/* Invisible larger hit target for mobile. */}
            <circle cx={x} cy={y} r={HEX_SIZE * 0.9} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
