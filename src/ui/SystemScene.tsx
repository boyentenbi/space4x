import type { Body, HabitabilityTier, StarKind, StarSystem } from "../sim/types";

// Deterministic positions for bodies — each body gets a stable orbit index
// + phase derived from its id. Positions don't move yet, but the layout
// can be animated later by rotating the phase each turn.

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const STAR_SRC: Record<StarKind, string> = {
  yellow_main: "/stars/yellow_main.png",
  red_dwarf: "/stars/red_dwarf.png",
  blue_giant: "/stars/blue_giant.png",
};

const PLANET_SRC: Record<HabitabilityTier, string> = {
  garden: "/planets/garden.png",
  temperate: "/planets/temperate.png",
  harsh: "/planets/harsh.png",
  hellscape: "/planets/hellscape.png",
};

export function SystemScene({
  system,
  bodies,
  ownerColor,
  capitalBodyId,
  turn,
}: {
  system: StarSystem;
  bodies: Body[];
  ownerColor: string | null;
  capitalBodyId: string | null;
  turn: number;
}) {
  const width = 320;
  const height = 140;
  const sunX = 48;
  const sunY = height / 2;
  const sunR = 22;

  // Orbit radii stepped outward.
  const orbitBase = 50;
  const orbitStep = 34;

  // Scale ellipse y by 0.45 for a slight perspective tilt.
  const tiltY = 0.45;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="system-scene"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Faint orbit ellipses. */}
      {bodies.map((_b, i) => {
        const rx = orbitBase + i * orbitStep;
        return (
          <ellipse
            key={`orbit-${i}`}
            cx={sunX}
            cy={sunY}
            rx={rx}
            ry={rx * tiltY}
            fill="none"
            stroke="#2a3142"
            strokeWidth={0.6}
            strokeDasharray="2 3"
          />
        );
      })}

      {/* Sun sprite. */}
      <image
        href={STAR_SRC[system.starKind]}
        x={sunX - sunR * 1.6}
        y={sunY - sunR * 1.6}
        width={sunR * 3.2}
        height={sunR * 3.2}
        style={{ imageRendering: "pixelated" }}
      />

      {/* Bodies — stable orbit positions derived from id hash, advanced per turn.
          Inner orbits rotate faster than outer ones (Kepler-ish flavor). */}
      {bodies.map((body, i) => {
        const rx = orbitBase + i * orbitStep;
        const basePhase = ((hashCode(body.id) % 1000) / 1000) * Math.PI * 2;
        const orbitSpeed = 0.18 / (1 + i * 0.5);       // radians per turn
        const phase = basePhase + turn * orbitSpeed;
        const cx = sunX + rx * Math.cos(phase);
        const cy = sunY + rx * tiltY * Math.sin(phase);
        const isMoon = body.kind === "moon";
        const pr = isMoon ? 8 : 13;
        const isCapital = body.id === capitalBodyId;
        return (
          <g key={body.id}>
            <image
              href={PLANET_SRC[body.habitability]}
              x={cx - pr}
              y={cy - pr}
              width={pr * 2}
              height={pr * 2}
              style={{ imageRendering: "pixelated" }}
            />
            {isCapital && ownerColor && (
              <circle
                cx={cx}
                cy={cy}
                r={pr + 3}
                fill="none"
                stroke={ownerColor}
                strokeWidth={1.6}
              />
            )}
            {body.flavorFlags.length > 0 && (
              <circle
                cx={cx}
                cy={cy}
                r={pr + 5}
                fill="none"
                stroke="var(--warn)"
                strokeWidth={0.7}
                opacity={0.8}
              />
            )}
            <text
              x={cx}
              y={cy + pr + 12}
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
      <text x={6} y={12} fontSize={10} fill="var(--text-dim)" letterSpacing="0.08em">
        {system.name.toUpperCase()}
      </text>
      {ownerColor && (
        <circle cx={width - 10} cy={10} r={3.5} fill={ownerColor} />
      )}
    </svg>
  );
}
// Kept here rather than unused-imported: habitability tiers exist at the type level.
export type { HabitabilityTier };
