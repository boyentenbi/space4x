import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import {
  printRolloutSummary,
  randomRollout,
  type RolloutResult,
} from "../src/sim/rollout";

// CLI: `npm run rollout [seed] [maxTurns] [count]`. Single rollout
// runs in-process; multi-rollout sweeps fan out across worker
// child processes (vite-node, one per CPU). The vite-node startup
// cost amortizes across each worker's seed batch, so on a real
// sweep of N independent games we get ~min(cpu, N)× speedup.
// Sweep summary tallies winners by archetype.
const seedArg = process.argv[2];
const maxTurnsArg = process.argv[3];
const countArg = process.argv[4];

const baseSeed = seedArg ? Number(seedArg) >>> 0 : Date.now() >>> 0;
const maxTurns = maxTurnsArg ? Number(maxTurnsArg) : 200;
const count = countArg ? Number(countArg) : 1;

// Result shape returned from each worker. Strict subset of
// RolloutResult so the JSON over stdout stays small.
type SweepResult = Pick<
  RolloutResult,
  "seed" | "turns" | "gameOver" | "winner" | "finalEmpires"
>;

function runWorker(seeds: number[]): Promise<SweepResult[]> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL("./rollout-worker.ts", import.meta.url));
    // Reuse the same vite-node binary the parent is running on; it's
    // on PATH inside `npm run`. Spawning it directly lets us inherit
    // the parent's NODE_PATH / TS resolution without a new build.
    const proc = spawn(
      "npx",
      ["--no-install", "vite-node", workerPath, seeds.join(","), String(maxTurns)],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let buf = "";
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
      buf += chunk;
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`rollout-worker exited ${code}`));
        return;
      }
      const out: SweepResult[] = [];
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as SweepResult);
        } catch (e) {
          reject(new Error(`bad worker line: ${line}`));
          return;
        }
      }
      resolve(out);
    });
  });
}

async function main() {
  const t0 = performance.now();
  let results: SweepResult[];

  if (count <= 1) {
    // No fan-out worth doing. Stay in-process.
    const r = randomRollout({ seed: baseSeed, maxTurns });
    results = [r];
  } else {
    const seeds = Array.from({ length: count }, (_, i) => (baseSeed + i) >>> 0);
    const workers = Math.min(availableParallelism(), count);
    // Round-robin seeds across workers so each batch gets a similar
    // mix of game lengths (otherwise contiguous seeds can cluster
    // fast/slow runs unevenly across workers).
    const buckets: number[][] = Array.from({ length: workers }, () => []);
    for (let i = 0; i < seeds.length; i++) {
      buckets[i % workers].push(seeds[i]);
    }
    const batched = await Promise.all(
      buckets.filter((b) => b.length > 0).map(runWorker),
    );
    results = batched.flat();
    // Stable order for output.
    results.sort((a, b) => a.seed - b.seed);
  }

  const elapsed = performance.now() - t0;

  for (const r of results) {
    // printRolloutSummary expects RolloutResult; SweepResult is a
    // subset. Cast — finalState is the only missing field and the
    // printer doesn't read it.
    printRolloutSummary(r as RolloutResult);
  }

  if (count > 1) {
    /* eslint-disable no-console */
    const winsByArchetype: Record<string, number> = {};
    let elims = 0;
    for (const r of results) {
      if (r.winner) {
        const winnerEmpire = r.finalEmpires.find((e) => e.id === r.winner);
        const arch = winnerEmpire?.expansionism ?? "?";
        winsByArchetype[arch] = (winsByArchetype[arch] ?? 0) + 1;
      }
      if (r.gameOver) elims += 1;
    }
    console.log("");
    console.log(
      `Sweep summary over ${count} rollouts in ${(elapsed / 1000).toFixed(2)}s ` +
        `(${(elapsed / count).toFixed(1)}ms / rollout):`,
    );
    console.log(`  game-over: ${elims}/${count}`);
    for (const [arch, wins] of Object.entries(winsByArchetype)) {
      console.log(`  wins ${arch.padEnd(13)}: ${wins}`);
    }
    /* eslint-enable no-console */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
