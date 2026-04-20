import type { Empire, Galaxy, StarSystem } from "../sim/types";

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

export function GalaxyMap({
  galaxy,
  empires,
  selectedId,
  onSelect,
}: {
  galaxy: Galaxy;
  empires: Empire[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const systems = Object.values(galaxy.systems);

  // id -> empire, for ownerId -> color lookup.
  const empireById = new Map<string, Empire>();
  for (const e of empires) empireById.set(e.id, e);

  // Lookup: "q,r" -> system (for neighbor ownership check).
  const byCoord = new Map<string, StarSystem>();
  for (const s of systems) byCoord.set(`${s.q},${s.r}`, s);

  function ownerIdAt(q: number, r: number): string | null {
    const s = byCoord.get(`${q},${r}`);
    return s?.ownerId ?? null;
  }

  // Bounds for viewBox.
  const pts = systems.map((s) => hexToPixel(s.q, s.r));
  const pad = HEX_SIZE + 4;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const w = maxX - minX;
  const h = maxY - minY;

  // Per-empire perimeter + interior edges so each empire's territory
  // renders as one contiguous region with faint internal lines.
  const perimeterByOwner = new Map<string, Edge[]>();
  const interiorByOwner = new Map<string, Edge[]>();
  for (const sys of systems) {
    const ownerId = sys.ownerId;
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
          const pa = hexToPixel(a.q, a.r);
          const pb = hexToPixel(b.q, b.r);
          const sharedOwner = a.ownerId && a.ownerId === b.ownerId ? a.ownerId : null;
          const color = sharedOwner ? (empireById.get(sharedOwner)?.color ?? "#3a4355") : "#3a4355";
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

      {/* Territory fill: one translucent blob per owner. */}
      <g className="territory-fill">
        {systems.map((sys) => {
          if (!sys.ownerId) return null;
          const empire = empireById.get(sys.ownerId);
          if (!empire) return null;
          const { x, y } = hexToPixel(sys.q, sys.r);
          return (
            <polygon
              key={`fill-${sys.id}`}
              points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
              fill={`${empire.color}22`}
              stroke="none"
            />
          );
        })}
      </g>

      {/* Interior edges between hexes owned by the same empire — faint. */}
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

      {/* Perimeter outline per owner. */}
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

      {/* Systems — star dot + optional selected highlight. */}
      {systems.map((sys) => {
        const { x, y } = hexToPixel(sys.q, sys.r);
        const isOwned = !!sys.ownerId;
        const isSelected = sys.id === selectedId;
        const hasFlavor = sys.bodyIds.some((bid) =>
          (galaxy.bodies[bid]?.flavorFlags.length ?? 0) > 0,
        );
        const dotSize = 1.8 + sys.bodyIds.length * 0.6;

        return (
          <g
            key={sys.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(sys.id === selectedId ? null : sys.id);
            }}
            style={{ cursor: "pointer" }}
          >
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
            {/* Flavor-site ring halo. */}
            {hasFlavor && (
              <circle cx={x} cy={y} r={dotSize + 3} fill="none" stroke="var(--warn)" strokeWidth={0.6} opacity={0.7} />
            )}
            {/* Star dot. */}
            <circle cx={x} cy={y} r={dotSize} fill={isOwned ? "#fff" : "#8a96ab"} opacity={isOwned ? 0.95 : 0.7} />
            {/* Invisible larger hit target for mobile. */}
            <circle cx={x} cy={y} r={HEX_SIZE * 0.9} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
