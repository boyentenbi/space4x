import type { Galaxy, StarSystem } from "../sim/types";

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
// Edge 0 (30->90): upper-right  → (+1, -1)
// Edge 1 (90->150): upper-left   → ( 0, -1)
// Edge 2 (150->210): left         → (-1,  0)
// Edge 3 (210->270): lower-left  → (-1, +1)
// Edge 4 (270->330): lower-right → ( 0, +1)
// Edge 5 (330->30): right         → (+1,  0)
const EDGE_NEIGHBOR: Array<[number, number]> = [
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 0],
];

function polygonPoints(corners: Array<[number, number]>): string {
  return corners.map(([x, y]) => `${x},${y}`).join(" ");
}

export function GalaxyMap({
  galaxy,
  ownedSystemIds,
  ownerColor,
  selectedId,
  onSelect,
}: {
  galaxy: Galaxy;
  ownedSystemIds: string[];
  ownerColor: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const owned = new Set(ownedSystemIds);
  const systems = Object.values(galaxy.systems);

  // Lookup: "q,r" -> system, so we can check if a neighbor is owned.
  const byCoord = new Map<string, StarSystem>();
  for (const s of systems) byCoord.set(`${s.q},${s.r}`, s);
  function isOwnedAt(q: number, r: number): boolean {
    const s = byCoord.get(`${q},${r}`);
    return !!s && owned.has(s.id);
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

  // Build the set of perimeter edges across all owned hexes. Each edge is
  // drawn only when the neighbor on that side is not owned — so contiguous
  // owned regions render as a single outlined blob.
  const perimeterEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const sys of systems) {
    if (!owned.has(sys.id)) continue;
    const { x, y } = hexToPixel(sys.q, sys.r);
    const corners = hexCorners(x, y, HEX_SIZE - 1);
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = EDGE_NEIGHBOR[i];
      if (isOwnedAt(sys.q + dq, sys.r + dr)) continue;
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 6];
      perimeterEdges.push({ x1: ax, y1: ay, x2: bx, y2: by });
    }
  }

  return (
    <svg
      viewBox={`${minX} ${minY} ${w} ${h}`}
      className="galaxy-map"
      preserveAspectRatio="xMidYMid meet"
      onClick={() => onSelect(null)}
    >
      {/* Hyperlanes (behind everything else). */}
      <g className="hyperlanes">
        {galaxy.hyperlanes.map(([aId, bId], i) => {
          const a = galaxy.systems[aId];
          const b = galaxy.systems[bId];
          if (!a || !b) return null;
          const pa = hexToPixel(a.q, a.r);
          const pb = hexToPixel(b.q, b.r);
          const bothOwned = owned.has(aId) && owned.has(bId);
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={bothOwned ? ownerColor : "#3a4355"}
              strokeWidth={bothOwned ? 1.4 : 0.8}
              opacity={bothOwned ? 0.7 : 0.5}
            />
          );
        })}
      </g>

      {/* Owned territory: solid fill on every owned hex (no per-hex border),
          so adjacent hexes blend into one region. */}
      <g className="territory-fill">
        {systems.map((sys) => {
          if (!owned.has(sys.id)) return null;
          const { x, y } = hexToPixel(sys.q, sys.r);
          return (
            <polygon
              key={`fill-${sys.id}`}
              points={polygonPoints(hexCorners(x, y, HEX_SIZE - 1))}
              fill={`${ownerColor}22`}
              stroke="none"
            />
          );
        })}
      </g>

      {/* Perimeter outline: edges that face unowned neighbors. */}
      <g className="territory-border">
        {perimeterEdges.map((e, i) => (
          <line
            key={i}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={ownerColor}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        ))}
      </g>

      {/* Systems — star dot + optional selected highlight. */}
      {systems.map((sys) => {
        const { x, y } = hexToPixel(sys.q, sys.r);
        const isOwned = owned.has(sys.id);
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
