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

## Bugs

- **Conqueror throws a 1-ship fleet at a 5-ship defender.** Observed
  in play: an at-war conqueror with a single-ship fleet keeps
  setting its destination to a player system holding 5+ ships. The
  move is a guaranteed loss (Lanchester wipes the attacker); the
  value function should price it deep negative via the ship-loss
  and post-combat threat terms but apparently doesn't. Failing
  regression test pending; once it fails, whatever scoring tweak
  makes it pass will pin the fix.

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

