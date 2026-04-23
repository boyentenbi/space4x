import { produce } from "immer";
import {
  filterStateFor,
  initialState,
  reduce,
  scoreState,
  totalFleetShipsFor,
  totalPopsOf,
} from "./reducer";
import type { Empire, Expansionism, GameState, Politic } from "./types";

// One empire's stats at some moment in a rollout. Snapshot, not a
// simulation handle — safe to keep across turns / serialise to JSON.
export interface EmpireSnapshot {
  id: string;
  name: string;
  expansionism: Expansionism;
  politic: Politic;
  speciesId: string;
  systems: number;
  pops: number;
  ships: number;
  // Same scoreState the AI uses for decisions; useful as a single
  // "how is this empire doing" number across runs.
  score: number;
  alive: boolean;
}

export interface RolloutResult {
  seed: number;
  turns: number;
  gameOver: boolean;
  // Empire id with the highest final score (or null if all dead).
  winner: string | null;
  finalEmpires: EmpireSnapshot[];
  // Optional per-end-of-turn score snapshot. Heavy if recorded;
  // only on when caller explicitly opts in.
  history?: Array<{ turn: number; empires: EmpireSnapshot[] }>;
  // Final state — handed back so callers can poke around (e.g. for
  // a deeper analysis / unit-test assertions). Don't keep across
  // many rollouts in memory if you care about footprint.
  finalState: GameState;
}

export interface RolloutOptions {
  seed: number;
  // Caps the loop. A real game tends to terminate before this via
  // gameOver (someone gets eliminated and the player loses their
  // last system); maxTurns is the safety belt against infinite
  // games (or just to bound runtime in batch sweeps).
  maxTurns?: number;
  // Player-empire seed values. Defaults give a neutral baseline so
  // `randomRollout({ seed })` works as a one-liner.
  empireName?: string;
  originId?: string;
  speciesId?: string;
  expansionism?: Expansionism;
  politic?: Politic;
  // When true, every end-of-turn pushes a per-empire snapshot to
  // result.history. Off by default — costs O(empires) per turn.
  recordHistory?: boolean;
}

function snapshotEmpires(state: GameState): EmpireSnapshot[] {
  const empires: Empire[] = state.empires;
  return empires.map((e) => ({
    id: e.id,
    name: e.name,
    expansionism: e.expansionism,
    politic: e.politic,
    speciesId: e.speciesId,
    systems: e.systemIds.length,
    pops: Math.round(totalPopsOf(state, e)),
    ships: totalFleetShipsFor(state, e),
    score: scoreState(filterStateFor(state, e.id), e.id),
    alive: e.systemIds.length > 0,
  }));
}

// Runs a full game with NO human input. We bootstrap a state through
// the regular newGame action (which seeds one empire as "human") then
// immediately strip humanEmpireId, putting the sim in headless mode:
// no events fire, no first-contact modals queue, and every empire
// gets its phase planned by aiPlanProject / aiPlanMoves through the
// regular reducer. Termination = state.empires.length <= 1 (someone
// won outright), or hitting maxTurns.
export function randomRollout(opts: RolloutOptions): RolloutResult {
  const maxTurns = opts.maxTurns ?? 200;
  let state = reduce(initialState(), {
    type: "newGame",
    empireName: opts.empireName ?? "Bot",
    originId: opts.originId ?? "steady_evolution",
    speciesId: opts.speciesId ?? "humans",
    seed: opts.seed,
    expansionism: opts.expansionism ?? "pragmatist",
    politic: opts.politic ?? "centrist",
  });
  // Headless: drop the human flag. With it gone the begin-round /
  // run-phase loops treat every empire identically — the AI planners
  // run for all of them, no events queue, no first contact queues.
  state = produce(state, (d) => {
    d.humanEmpireId = undefined;
  });

  const history: Array<{ turn: number; empires: EmpireSnapshot[] }> = [];

  let stuckCount = 0;
  let lastTurn = state.turn;

  while (state.turn < maxTurns && state.empires.length > 1) {
    state = reduce(state, { type: "endTurn" });

    if (opts.recordHistory) {
      history.push({ turn: state.turn, empires: snapshotEmpires(state) });
    }

    if (state.turn === lastTurn) {
      stuckCount += 1;
      if (stuckCount > 100) break;
    } else {
      stuckCount = 0;
      lastTurn = state.turn;
    }
  }

  const finalEmpires = snapshotEmpires(state);
  let winner: string | null = null;
  let topScore = -Infinity;
  for (const e of finalEmpires) {
    if (!e.alive) continue;
    if (e.score > topScore) {
      topScore = e.score;
      winner = e.id;
    }
  }

  return {
    seed: opts.seed,
    turns: state.turn,
    gameOver: state.empires.length <= 1,
    winner,
    finalEmpires,
    history: opts.recordHistory ? history : undefined,
    finalState: state,
  };
}

// One-line summary printer for the script driver. Format is fixed-
// width column layout so a sweep of N rollouts reads at a glance.
export function printRolloutSummary(result: RolloutResult): void {
  const winState = result.gameOver ? "GAME OVER" : "cap";
  /* eslint-disable no-console */
  console.log(
    `seed=${String(result.seed).padStart(10)} ` +
      `turn=${String(result.turns).padStart(3)} ` +
      `${winState.padEnd(9)} ` +
      `winner=${result.winner ?? "—"}`,
  );
  for (const e of result.finalEmpires) {
    const tag = e.id === result.winner ? "★" : " ";
    console.log(
      `  ${tag} ${e.name.padEnd(28)} ${e.expansionism.padEnd(13)} ` +
        `sys=${String(e.systems).padStart(2)} ` +
        `pops=${String(e.pops).padStart(4)} ` +
        `ships=${String(e.ships).padStart(3)} ` +
        `score=${e.score.toFixed(0).padStart(7)}`,
    );
  }
  /* eslint-enable no-console */
}
