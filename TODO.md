# TODO / deferred work

Things we've consciously deferred. Not tracked as issues; add a line here
when you want to remember something later.

## Tech debt

- **Branded ID types** — introduce nominal types for `SystemId`, `EmpireId`,
  `BodyId`, `FleetId`, etc. so the compiler can tell them apart. Every ID
  field in `types.ts` is currently `string`, which makes code like
  `discovered: string[]` ambiguous at a glance (it's really a list of
  system IDs). Zero runtime cost; a few hundred trivial edits across the
  codebase.

## Design questions

- **Build ships in units of 10?** Small-battle granularity is weird
  — 1 vs 5 is a guaranteed wipe (Lanchester square), but so is 5
  vs 25, etc. If a frigate were a 10-ship squadron (tenfold
  hammer cost, tenfold effect in combat), small numeric differences
  between fleets would represent meaningful tactical variation
  instead of all-or-nothing outcomes. Might also let archetype ship
  mixes (scout-weight vs heavy) live as variants within a
  build order.

## Architecture

- **Fully-headless rollout.** Today `randomRollout` simulates by
  driving `state.empire` (the "player" slot) with the AI planners
  and dispatching `endTurn` through the regular reducer path. Works
  for batch sweeps but still threads through player-only concepts:
  random events queued for the player, first-contact modals for the
  player, the `state.empire` vs `state.aiEmpires` split, etc. The
  cleaner shape is "all empires are equivalent, none is special";
  rollouts and the UI session just differ in which empire (if any)
  has its decisions surfaced to a human. Refactor needed: collapse
  `state.empire` + `state.aiEmpires` into a single `empires: Empire[]`
  with an optional `humanEmpireId` for UI gating, and route random
  events / first contacts per-empire (or globally) instead of
  player-only. Worth doing before multiplayer / spectator views.


- **`filterStateFor` as a distinct type.** Today fog-correctness is
  enforced by nesting `perception` and relying on Immer's structural
  sharing — which works (the threat term can't leak because
  `produce()` never mutates `empire.perception`), plus an explicit
  own-presence-live vs snapshot-elsewhere split in the threat term.
  The cleaner architecture the user sketched: a `filter(state,
  empireId)` that produces a structurally distinct `PerceivedGameState`
  type where undiscovered systems simply aren't in the type, other
  empires' private fields (political, storyModifiers, etc.) are
  absent, and `scoreState`/`aiPlanMoves`/`aiPlanProject` refuse any
  other input shape. Big refactor — `resolveCombat`,
  `processOccupation`, every `apply*` handler either needs to work
  on both shapes (structural typing) or have two variants. Worth
  doing when fog touches more systems (UI spectator mode, multiplayer,
  replay). Companion: a regression test asserting `advance(state,
  action) == advance(filter(state, empireId), action)` on the
  subset advance writes, under identity-filter preconditions.

