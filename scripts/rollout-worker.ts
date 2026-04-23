import { randomRollout, type RolloutResult } from "../src/sim/rollout";

// Worker driver. Accepts a comma-separated list of seeds and a
// maxTurns value via argv:
//   vite-node scripts/rollout-worker.ts 1,2,3 200
// Prints one JSON line per rollout to stdout. Parent assembles.

const seedsArg = process.argv[2] ?? "";
const maxTurns = Number(process.argv[3] ?? 200);

const seeds = seedsArg
  .split(",")
  .filter((s) => s.length > 0)
  .map((s) => Number(s) >>> 0);

type SerialisableRolloutResult = Pick<
  RolloutResult,
  "seed" | "turns" | "gameOver" | "winner" | "finalEmpires"
>;

for (const seed of seeds) {
  const r = randomRollout({ seed, maxTurns });
  const serial: SerialisableRolloutResult = {
    seed: r.seed,
    turns: r.turns,
    gameOver: r.gameOver,
    winner: r.winner,
    finalEmpires: r.finalEmpires,
  };
  process.stdout.write(JSON.stringify(serial) + "\n");
}
