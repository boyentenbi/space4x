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

## UI

- **Show galaxy bounds on the map.** With fog hiding undiscovered
  systems, the early-game map looks like a scattering of dots with
  no sense of scale. A faint rectangle / outer ring marking the
  galaxy's actual extent (from `galaxy.width` × `galaxy.height` or
  the bounding box of all system coordinates) would help the player
  see how much of the galaxy they've charted vs. how much is still
  dark.
- **Move chronicle to a modal behind a button on the left sidebar.**
  Currently the chronicle log is always visible — give it its own
  modal gated by a button next to portrait/end-turn. Clears sidebar
  real estate and matches the pattern used by the other modals
  (empire profile, policies, stat breakdown).
- **Distinguish sensor-seen vs. visited on the galaxy map.** Right
  now a system that's currently in sensor but never surveyed looks
  identical to one a scout has actually been inside. Make the
  difference legible so the player can tell at a glance where they
  still need to send a fleet to reveal the next ring of hyperlanes
  (e.g. a dashed outer ring on "discovered-but-never-surveyed" and
  a solid one once a fleet has entered).
- **Keep ownership live for all discovered tiles.** Ownership
  changes slowly and is diplomatically "known" even at range — once
  the viewer has ever observed a system, let the galaxy map /
  system panel show the *current* owner regardless of whether the
  system is in sensor right now. Fleet composition and internal
  state stay snapshot-based; ownership gets bumped to live. Small
  relaxation of strict fog for better UX.

## Gameplay

- **Presence-score term.** Per-archetype bonus for each system the
  empire has active presence in (own system OR own fleet location).
  Rewards breadth / holding ground. Conqueror 150, pragmatist 80,
  isolationist 20. Separate commit once the fog work settles.
- **Scouting incentive.** If fleets don't move outward enough after
  presence is in, add a discovery reward that projects new sensor
  coverage from a candidate move. Count of newly-observed systems
  × per-archetype value, without peeking at their contents.

