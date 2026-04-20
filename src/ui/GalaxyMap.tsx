import type { Galaxy } from "../sim/types";

const HEX_SIZE = 16;       // radius of each hex
const SQRT_3 = Math.sqrt(3);

// Pointy-top axial -> pixel.
function hexToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT_3 * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

function hexCorners(cx: number, cy: number, size: number): string {
  // Pointy-top: corner angles are 30, 90, 150, 210, 270, 330 degrees.
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i + 30) * Math.PI) / 180;
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
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

  // Bounds for viewBox.
  const pts = systems.map((s) => hexToPixel(s.q, s.r));
  const pad = HEX_SIZE + 4;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const w = maxX - minX;
  const h = maxY - minY;

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

      {/* Systems — hex outline + star dot. */}
      {systems.map((sys) => {
        const { x, y } = hexToPixel(sys.q, sys.r);
        const isOwned = owned.has(sys.id);
        const isSelected = sys.id === selectedId;
        const hasFlavor = sys.bodyIds.some((bid) =>
          (galaxy.bodies[bid]?.flavorFlags.length ?? 0) > 0,
        );
        const dotSize = 1.8 + sys.bodyIds.length * 0.6;

        // Stroke rules: owned = territory color, selected = warm highlight,
        // else = transparent (no hex outline for neutral space).
        let stroke = "none";
        let strokeWidth = 0;
        let fill = "none";
        if (isOwned) {
          stroke = ownerColor;
          strokeWidth = 1.6;
          fill = `${ownerColor}22`;
        }
        if (isSelected) {
          stroke = "#ffd580";
          strokeWidth = 2;
        }

        return (
          <g
            key={sys.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(sys.id === selectedId ? null : sys.id);
            }}
            style={{ cursor: "pointer" }}
          >
            {/* Hex fill/border. */}
            <polygon
              points={hexCorners(x, y, HEX_SIZE - 1)}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
            {/* Flavor-site ring halo. */}
            {hasFlavor && (
              <circle cx={x} cy={y} r={dotSize + 3} fill="none" stroke="var(--warn)" strokeWidth={0.6} opacity={0.7} />
            )}
            {/* Star dot (neutral color). */}
            <circle cx={x} cy={y} r={dotSize} fill={isOwned ? "#fff" : "#8a96ab"} opacity={isOwned ? 0.95 : 0.7} />
            {/* Invisible larger hit target for mobile. */}
            <circle cx={x} cy={y} r={HEX_SIZE * 0.9} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
