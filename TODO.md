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

- **AI reads its own snapshots, not true state.** `scoreState`,
  `aiPlanMoves`, `aiPlanProject` still see the full galaxy. For the
  surprise-attack / hidden-buildup gameplay to actually work, AI
  decisions have to route through each empire's fog view.
