import { printRolloutSummary, randomRollout } from "../src/sim/rollout";

// Tiny CLI: `npm run rollout [seed] [maxTurns] [count]`. With `count`
// > 1 we sweep a contiguous range of seeds (seed, seed+1, ...) so
// repeat invocations are reproducible. Defaults to one game from a
// time-based seed.
const seedArg = process.argv[2];
const maxTurnsArg = process.argv[3];
const countArg = process.argv[4];

const baseSeed = seedArg ? Number(seedArg) >>> 0 : Date.now() >>> 0;
const maxTurns = maxTurnsArg ? Number(maxTurnsArg) : 200;
const count = countArg ? Number(countArg) : 1;

let winsByArchetype: Record<string, number> = {};
let elims = 0;

for (let i = 0; i < count; i++) {
  const seed = (baseSeed + i) >>> 0;
  const result = randomRollout({ seed, maxTurns });
  printRolloutSummary(result);
  if (result.winner) {
    const winnerEmpire = result.finalEmpires.find((e) => e.id === result.winner);
    const arch = winnerEmpire?.expansionism ?? "?";
    winsByArchetype[arch] = (winsByArchetype[arch] ?? 0) + 1;
  }
  if (result.gameOver) elims += 1;
}

if (count > 1) {
  /* eslint-disable no-console */
  console.log("");
  console.log(`Sweep summary over ${count} rollouts:`);
  console.log(`  game-over: ${elims}/${count}`);
  for (const [arch, wins] of Object.entries(winsByArchetype)) {
    console.log(`  wins ${arch.padEnd(13)}: ${wins}`);
  }
  /* eslint-enable no-console */
}
