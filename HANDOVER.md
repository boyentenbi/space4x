# space4x — session handover

## Project

Mobile-first Stellaris-inspired 4X. RP/event-first MVP; hex map + fleets come later.
Priority: a pure, serializable simulation core so the game is deterministic,
testable, and easy to port to Rust later if perf demands.

## Live preview

- Production URL: https://space4x.vercel.app (Vercel auto-redeploys on push).
- Deploys from branch `claude/mobile-space-game-9WgSo` (currently the only branch and the default).

## Stack

- Vite + React 18 + TypeScript (strict).
- zustand + immer for the game store.
- PixiJS installed but not yet used — reserved for the hex star map.
- localStorage for save game.
- Vercel for hosting; PWA manifest + SVG icon in `public/`.

## Architecture (read before changing things)

- **Pure functional sim**: `src/sim/reducer.ts` exposes `reduce(state, action) => state`.
  The entire game state is one serializable `GameState` value. `tick` is pure;
  immer gives us ergonomic immutable updates without copying by hand.
- **Content as TS modules**, not JSON, for compile-time safety on the
  discriminated `Effect` and `Condition` unions (`src/sim/types.ts`).
- **Schema versioning**: `GameState.schemaVersion` + matching `STORAGE_KEY`
  in `src/store.ts` discard stale saves on load. Bump both if you change
  state shape incompatibly.

## File map

```
src/
  sim/
    types.ts      GameState, Effect, Condition, Species, Origin, ...
    reducer.ts    reduce(state, action), perTurnIncome
    events.ts     eventEligible, pickRandomEvent, resolveEventChoice
    content.ts    re-exports content + lookup helpers
    rng.ts        mulberry32 seeded RNG
  content/
    species.ts    3 species: humans, insectoid, machine
    origins.ts    4 origins, gated by Origin.allowedSpeciesIds
    traits.ts     5 traits
    events.ts     5 events (origin-specific + general)
  ui/
    App.tsx         routes New Game ↔ Main
    NewGame.tsx     species-first chooser; filters origins by species
    MainScreen.tsx  header, resource bar, chronicle log, End Turn
    EventModal.tsx  bottom-sheet choice UI with effect chips
    ResourceBar.tsx 5-slot resource readout
    Thumb.tsx       pixelated thumbnail with onError fallback
    styles.css
  store.ts          zustand store; persists to localStorage v2
  main.tsx

public/
  icon.svg
  manifest.webmanifest
  portraits/        (empty — waiting on art)
  origins/          (empty — waiting on art)

scripts/
  gen-art.mjs       calls Retro Diffusion API, writes PNGs

.github/workflows/
  gen-art.yml       workflow_dispatch wrapper for gen-art.mjs (overkill, can remove)

.claude/
  settings.json     inner-sandbox allowlist for api.retrodiffusion.ai
```

## Immediate next step: generate art

The reason for this handover. Current container's outer firewall blocks
`api.retrodiffusion.ai`. In a more permissive container:

```bash
echo 'RD_API_KEY=rdpk-c3534b89a4b3c4c1461dd7674390cb2b' > .env.local
node scripts/gen-art.mjs
git add public/portraits public/origins
git commit -m "Generate pixel art"
git push
```

Expected output: 7 PNGs (3 species portraits, 4 origin scenes), 256×256,
`rd_pro__default` style. UI already references these paths; placeholder
squares show until they land. Prompts are in `scripts/gen-art.mjs`.

**Rotate the API key after use** — it has appeared in chat history.

## Content to expand next (after art lands)

User's north star: RP depth backed by stats. Good expansion order:

1. **More events** — currently 5, need 20+ for a single playthrough to feel
   varied. Follow existing discriminated-union patterns in `src/content/events.ts`.
   Consider chained events (flags gate follow-ups).
2. **Ascension perks** — Stellaris-style mid-game choices. New type
   `Ascension` with modifiers + flavor; unlock at turn milestones or
   research thresholds.
3. **Hex star map** — PixiJS canvas rendering systems as dots + lines.
   Keep it stateless; systems/fleets live in `GameState`.
4. **Fleets + tactical layer** — text-resolved battles first ("rolls and
   modifiers" style), visual polish later. Fleet state is plain data too.

## Gotchas

- Don't put content in JSON; the `Effect`/`Condition` discriminated unions
  need compile-time checking (typos fail silently in JSON).
- `pickRandomEvent` filters out events already in `eventLog`, so each
  event only fires once per game. Change if you want repeats.
- `perTurnIncome` treats food as a resource for machine species too —
  fine for MVP, but special-case once consumption exists.
- The GitHub Action at `.github/workflows/gen-art.yml` is overkill for
  a one-off generation; safe to delete if you generate art locally.

## Open questions for the user

- Should food go away for Machine Intelligence, or keep it as abstract
  "biomass/fuel"?
- Hex map scope for first pass: single-system zoomed view or full galaxy?
- Art style: 256×256 `rd_pro__default` feels right for portraits but may
  be too detailed for tiny map markers — probably want a separate
  lower-res style for sprites.
