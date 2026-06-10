# LICENSES — running inventory (started M1, finalized M4 per SPEC §14.21)

## Runtime npm dependencies (exactly two — SPEC §External dependencies)

| Package | Version | License |
|---|---|---|
| three | ~0.184 | MIT |
| postprocessing (pmndrs) | ^6.39 | Zlib |

## Shipped assets

All M1 assets are **procedurally generated in first-party code** (audio
synthesis in `src/audio/synth.ts`, canvas textures in `src/scene/textures.ts`,
the code-built batter rig and dot-matrix glyph set) — no third-party content
is embedded or fetched. They are covered by this project's own license.

Planned external content (recorded here when it lands):
- Mixamo batter rig/animations — royalty-free embedded use, raw files not redistributed (owner step, pending)
- ambientCG / Poly Haven CC0 PBR texture cooks (pending)
- DSEG fonts (OFL-1.1) for the LED board atlas (pending; M1 uses a code-defined 5×7 matrix face)
- Sonniss GDC / freesound CC0 SFX replacements for synthesized cues (pending)

## Dev-time only (not shipped)

typescript, vite, vitest, eslint, typescript-eslint, prettier, @types/* — MIT/Apache-2.0.
