# LICENSES — shipped-asset inventory (SPEC §14.21, finalized M4)

## Project

Batting Cage itself — all first-party code and procedurally generated
content in this repository — is licensed under **ISC** (see `package.json`).

## Runtime npm dependencies (exactly two — SPEC §External dependencies)

| Package | Version | License |
|---|---|---|
| three | ~0.184 | MIT |
| postprocessing (pmndrs) | ^6.39 | Zlib |

These are the only entries in the lockfile's runtime dependency tree
(§14.20: verifiable by auditing `package-lock.json`).

## Shipped assets

**Every shipped asset is procedurally generated in first-party code** — no
third-party content is embedded, vendored, or fetched at runtime:

| Asset class | Source |
|---|---|
| All audio cues (whirr, clunk, thwip, crack/ping, rustle, ceremonies, room tone…) | synthesized — `src/audio/synth.ts` |
| All textures (turf, concrete, pads, steel, plate mat) | canvas-generated — `src/scene/textures.ts` |
| Batter rig + animations | code-built — `src/scene/actors/Batter.ts` |
| LED board / monitor typography | code-defined 5×7 dot-matrix face — `src/ui/diegetic/dotFont.ts` |
| All models (machine, cage, facility, props) | code-built Three.js geometry |

They are covered by the project's ISC license.

## Considered, not shipped in v1

The M1 asset plan staged external content that the procedural set ended up
covering; the swaps remain optional post-v1 content changes (M1-NOTES — the
procedural set is the shipped design), not v1 gaps:

- Mixamo batter rig/animations (royalty-free embedded use; owner step)
- ambientCG / Poly Haven CC0 PBR texture cooks
- DSEG fonts (OFL-1.1) for the LED board atlas
- Sonniss GDC / freesound CC0 SFX replacements

None of these ship in v1.0; nothing from these sources is in `dist/`.

## Dev-time only (never in `dist/`)

| Package | License | Role |
|---|---|---|
| typescript, vite, vitest, eslint, typescript-eslint, prettier, @types/* | MIT / Apache-2.0 | toolchain |
| playwright-core | Apache-2.0 | acceptance/perf/smoke harnesses |
| lil-gui | MIT | `?tune=1` dev tuning panel (dead-code-eliminated from builds; absence asserted by `scripts/load-budget.mjs`) |
