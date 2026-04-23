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

## Fog of war follow-ups

- **System detail panel respects fog.** The galaxy map hides / dims
  unseen systems, but clicking a stale system still opens its scene /
  side panel with fully-live data (pops, queued projects, fleets). The
  panel needs to read from `empire.snapshots[systemId]` when the system
  is out of sensor, and show a "last seen: turn N" banner.
- **AI reads its own snapshots, not true state.** `scoreState`,
  `aiPlanMoves`, `aiPlanProject` still see the full galaxy. For the
  surprise-attack / hidden-buildup gameplay to actually work, AI
  decisions have to route through each empire's fog view.
- **First-contact should fire on sensor entry, not hyperlane adjacency.**
  `detectFirstContacts` in reducer.ts uses owned-system adjacency, which
  matches the 1-jump sensor accidentally — but the right trigger is
  "empire X entered empire Y's sensor set" (covers scouting with fleets
  into unclaimed space, for example).
- **Last-seen indicator on map.** Stale systems dim to 55% opacity but
  there's no explicit "?" or clock icon. Worth considering once we see
  the fog in action.
