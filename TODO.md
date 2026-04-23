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

## Gameplay

- **Presence-score term.** Per-archetype bonus for each system the
  empire has active presence in (own system OR own fleet location).
  Rewards breadth / holding ground. Conqueror 150, pragmatist 80,
  isolationist 20. Separate commit once the fog work settles.
- **Scouting incentive.** If fleets don't move outward enough after
  presence is in, add a discovery reward that projects new sensor
  coverage from a candidate move. Count of newly-observed systems
  × per-archetype value, without peeking at their contents.

