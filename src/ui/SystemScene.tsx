import type { Body, StarKind, StarSystem } from "../sim/types";

// Deterministic positions for bodies — each body gets a stable orbit index
// + phase derived from its id. Phase advances each turn so orbits actually
// rotate.

// Golden-ratio XOR-mult hash. Spreads close-input strings (body_0, body_1,
// body_2, ...) across the full output range, which matters because bodies
// within a system have sequential ids.
function hashCode(s: string): number {
  let h = 0x9e3779b9 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

const STAR_SRC: Record<StarKind, string> = {
  yellow_main: "/stars/yellow_main.png",
  red_dwarf: "/stars/red_dwarf.png",
  blue_giant: "/stars/blue_giant.png",
};

import { planetSpriteFor } from "./icons";

interface Placed {
  body: Body;
  i: number;
  cx: number;
  cy: number;
  depth: number;   // sin(phase): >0 = near side, <0 = far side
}

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
  const sunX = width / 2;
  const sunY = height / 2;
  const sunR = 22;

  const orbitBase = 44;
  const orbitStep = 30;
  const tiltY = 0.42;

  const placed: Placed[] = bodies.map((body, i) => {
    const rx = orbitBase + i * orbitStep;
    const basePhase = (hashCode(body.id) / 4294967296) * Math.PI * 2;
    const orbitSpeed = 0.18 / (1 + i * 0.5);
    const phase = basePhase + turn * orbitSpeed;
    return {
      body,
      i,
      cx: sunX + rx * Math.cos(phase),
      cy: sunY + rx * tiltY * Math.sin(phase),
      depth: Math.sin(phase),
    };
  });

  // Painter's order: far side -> sun -> near side. Within each group sort
  // by depth ascending so more-distant bodies render first.
  const backBodies = placed.filter((p) => p.depth < 0).sort((a, b) => a.depth - b.depth);
  const frontBodies = placed.filter((p) => p.depth >= 0).sort((a, b) => a.depth - b.depth);

  function renderBody(p: Placed) {
    const isMoon = p.body.kind === "moon";
    const pr = isMoon ? 8 : 13;
    const isCapital = p.body.id === capitalBodyId;
    return (
      <g key={p.body.id}>
        <image
          href={planetSpriteFor(p.body.id, p.body.habitability)}
          x={p.cx - pr}
          y={p.cy - pr}
          width={pr * 2}
          height={pr * 2}
          style={{ imageRendering: "pixelated" }}
        />
        {/* Ownership ring on every populated body in an owned system;
            capital ring is slightly thicker so you can tell it apart. */}
        {ownerColor && p.body.pops > 0 && (
          <circle
            cx={p.cx}
            cy={p.cy}
            r={pr + 3}
            fill="none"
            stroke={ownerColor}
            strokeWidth={isCapital ? 2.4 : 1.4}
          />
        )}
        {p.body.flavorFlags.length > 0 && (
          <circle
            cx={p.cx}
            cy={p.cy}
            r={pr + 5}
            fill="none"
            stroke="var(--warn)"
            strokeWidth={0.7}
            opacity={0.8}
          />
        )}
        <text
          x={p.cx}
          y={p.cy + pr + 12}
          textAnchor="middle"
          fontSize={8}
          fill="var(--text-dim)"
        >
          {p.body.name.split(" ").slice(-1)[0]}
        </text>
      </g>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="system-scene"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Orbit ellipses sit behind everything. */}
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

      {/* Far-side bodies draw first. */}
      {backBodies.map(renderBody)}

      {/* Sun renders between back and front bodies. */}
      <image
        href={STAR_SRC[system.starKind]}
        x={sunX - sunR * 1.6}
        y={sunY - sunR * 1.6}
        width={sunR * 3.2}
        height={sunR * 3.2}
        style={{ imageRendering: "pixelated" }}
      />

      {/* Near-side bodies draw last, on top of the sun. */}
      {frontBodies.map(renderBody)}
    </svg>
  );
}
