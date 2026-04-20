import type { Body, HabitabilityTier, StarSystem } from "../sim/types";

// Placeholder "system scene" — a sun and bodies arranged on an arc.
// Once we have real sprites this swaps out, but the layout already
// communicates the shape of a system.

const HAB_COLOR: Record<HabitabilityTier, string> = {
  garden: "#7cd1a0",
  temperate: "#78c0f0",
  harsh: "#d8a360",
  hellscape: "#d8786a",
};

export function SystemScene({
  system,
  bodies,
  ownerColor,
  capitalBodyId,
}: {
  system: StarSystem;
  bodies: Body[];
  ownerColor: string | null;
  capitalBodyId: string | null;
}) {
  const width = 280;
  const height = 100;
  const sunX = 32;
  const sunY = height / 2;
  const sunR = 14;

  // Evenly space bodies on an arc right of the sun.
  const innerX = 74;
  const outerX = width - 30;
  const stepX = bodies.length > 1 ? (outerX - innerX) / (bodies.length - 1) : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="system-scene"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Faint orbit arcs. */}
      {bodies.map((_b, i) => {
        const rx = innerX + i * stepX - sunX;
        return (
          <ellipse
            key={`orbit-${i}`}
            cx={sunX}
            cy={sunY}
            rx={rx}
            ry={rx * 0.32}
            fill="none"
            stroke="#2a3142"
            strokeWidth={0.6}
            strokeDasharray="2 3"
          />
        );
      })}

      {/* Sun. */}
      <circle cx={sunX} cy={sunY} r={sunR + 4} fill="#ffd07022" />
      <circle cx={sunX} cy={sunY} r={sunR} fill="#ffd070" />
      <circle cx={sunX} cy={sunY} r={sunR * 0.6} fill="#fff3a8" opacity={0.9} />

      {/* Bodies. */}
      {bodies.map((body, i) => {
        const cx = innerX + i * stepX;
        const isMoon = body.kind === "moon";
        const r = isMoon ? 4 : 7;
        const isCapital = body.id === capitalBodyId;
        return (
          <g key={body.id}>
            <circle
              cx={cx}
              cy={sunY}
              r={r}
              fill={HAB_COLOR[body.habitability]}
              stroke={isCapital && ownerColor ? ownerColor : "none"}
              strokeWidth={isCapital ? 1.8 : 0}
            />
            {body.flavorFlags.length > 0 && (
              <circle
                cx={cx}
                cy={sunY}
                r={r + 2.5}
                fill="none"
                stroke="var(--warn)"
                strokeWidth={0.6}
                opacity={0.8}
              />
            )}
            <text
              x={cx}
              y={sunY + r + 12}
              textAnchor="middle"
              fontSize={8}
              fill="var(--text-dim)"
            >
              {body.name.split(" ").slice(-1)[0]}
            </text>
          </g>
        );
      })}

      {/* System name & ownership pip. */}
      <text x={4} y={12} fontSize={10} fill="var(--text-dim)" letterSpacing="0.08em">
        {system.name.toUpperCase()}
      </text>
      {ownerColor && (
        <circle cx={width - 8} cy={10} r={3} fill={ownerColor} />
      )}
    </svg>
  );
}
