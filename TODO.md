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

## UI polish

- **Reduce build-queue font size.** Body-queue items (BodyQueueItem)
  currently inherit fairly large font sizing; the progress bar row
  and stats feel chunky relative to the surrounding body-row content.
  Tighten item-name, item-host, and project-stats sizes so the queue
  reads as secondary info, not primary.

## Design questions

- **Build ships in units of 10?** Small-battle granularity is weird
  — 1 vs 5 is a guaranteed wipe (Lanchester square), but so is 5
  vs 25, etc. If a frigate were a 10-ship squadron (tenfold
  hammer cost, tenfold effect in combat), small numeric differences
  between fleets would represent meaningful tactical variation
  instead of all-or-nothing outcomes. Might also let archetype ship
  mixes (scout-weight vs heavy) live as variants within a
  build order.

- **Brood Mother gets a "feed me more" coupling.** We kept the
  exponential `rate × pops + add` growth model (Stellaris-style
  snowball) instead of switching to Civ-style food-drives-growth,
  because the snowball IS the fun. But there's room for *features*
  to introduce the food-as-strategic-resource flavour locally —
  e.g. the Brood Mother could scale its `popGrowthAdd` with the
  body's food surplus, or eat extra food per turn to pump out
  bigger broods. Choice without forcing it on the whole sim.

## Architecture

- **Per-empire policy abstraction.** State is now headless
  (`empires: Empire[]` + optional `humanEmpireId`), but the engine
  still has implicit knowledge of "this is an AI" (calls
  aiPlanProject / aiPlanMoves directly when current empire id ≠
  humanEmpireId) vs "this is the human" (skips the planners,
  expects UI dispatches to have queued actions). Wrapping that as
  an explicit `Policy { decide(perceived, empireId): Action[] }`
  interface, with one policy per empire, would unify the two
  paths. Rollout policies all = AI; live game = humanPolicy(empire)
  + aiPolicy(others); multiplayer = multiple humanPolicies.
  Smaller refactor than the state shape change was — the engine
  already routes by id, just needs the dispatch table.

- **Per-empire event queues.** `eventQueue` /
  `pendingFirstContacts` / `projectCompletions` are still top-
  level on state and assumed to be "for the human." Per-empire
  queues + a per-empire policy that decides how to resolve them
  (UI for human, auto-pick-choice-0 for AI) drops the last
  player-only assumption from the sim and lets events fire for
  AI empires too if we ever want that gameplay.


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

