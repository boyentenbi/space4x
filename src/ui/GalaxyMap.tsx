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

export function GalaxyMap({
  galaxy,
  ownedSystemIds,
  selectedId,
  onSelect,
}: {
  galaxy: Galaxy;
  ownedSystemIds: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const owned = new Set(ownedSystemIds);
  const systems = Object.values(galaxy.systems);

  // Compute bounds.
  const pts = systems.map((s) => hexToPixel(s.q, s.r));
  const minX = Math.min(...pts.map((p) => p.x)) - HEX_SIZE;
  const maxX = Math.max(...pts.map((p) => p.x)) + HEX_SIZE;
  const minY = Math.min(...pts.map((p) => p.y)) - HEX_SIZE;
  const maxY = Math.max(...pts.map((p) => p.y)) + HEX_SIZE;
  const w = maxX - minX;
  const h = maxY - minY;

  function systemColor(sysId: string): string {
    if (sysId === selectedId) return "#ffd580";       // warm selection
    if (owned.has(sysId)) return "var(--accent)";     // owned = accent
    return "#4b5569";                                  // unclaimed = dim
  }

  function systemRadius(sys: { id: string; bodyIds: string[] }): number {
    // Slightly bigger for more bodies, bigger still if selected/owned.
    const base = 2 + sys.bodyIds.length * 0.8;
    if (sys.id === selectedId) return base + 2;
    if (owned.has(sys.id)) return base + 1;
    return base;
  }

  return (
    <svg
      viewBox={`${minX} ${minY} ${w} ${h}`}
      className="galaxy-map"
      preserveAspectRatio="xMidYMid meet"
      onClick={() => onSelect(null)}
    >
      {systems.map((sys) => {
        const { x, y } = hexToPixel(sys.q, sys.r);
        const hasFlavor = sys.bodyIds.some((bid) =>
          (galaxy.bodies[bid]?.flavorFlags.length ?? 0) > 0,
        );
        return (
          <g
            key={sys.id}
            transform={`translate(${x} ${y})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(sys.id === selectedId ? null : sys.id);
            }}
            style={{ cursor: "pointer" }}
          >
            {/* hit target */}
            <circle r={HEX_SIZE * 0.9} fill="transparent" />
            {hasFlavor && (
              <circle r={systemRadius(sys) + 3} fill="none" stroke="var(--warn)" strokeWidth={0.6} opacity={0.6} />
            )}
            <circle r={systemRadius(sys)} fill={systemColor(sys.id)} />
          </g>
        );
      })}
    </svg>
  );
}
