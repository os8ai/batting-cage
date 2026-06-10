# M0 Build Notes

Status: **M0 exit criteria met** (see checklist below). Built per `M0-PLAN.md` against `SPEC.md`.

## Run it

```bash
npm install
npm run dev        # dev server
npm test           # 93 headless Vitest tests
npm run build      # tsc + vite build → dist/
npm run preview    # serve the built artifact
```

Controls (M0): `SPACE` swing · `R` insert token · `1–6` machine speed (idle only, M0-DEBUG) · `F3` diagnostics.

## Exit checklist (M0-PLAN §1)

| # | Check | Result |
|---|---|---|
| E1 | 10-pitch round playable at all six tiers | Headless round runner at every tier + in-browser CDP smoke (boot → token → pitch 1 → judged swing → pitch 2) |
| E2 | Grade windows match §6 exactly | `timingWindows.test.ts` — every boundary, both signs |
| E3 | EV/LA/spray match §6 formulas | `contactModel.test.ts` — q anchors exact, EV table 92→102, LA 4°/25°/46°, foul always >45° |
| E4 | Projection within ±10 ft of §7 table | `projection.test.ts` — see calibration below |
| E5 | Pitch-cycle statechart matches §5 clock | `pitchCycle.test.ts` — RELEASE T+1.8 ±1 tick, FEED every 7.5 s, locked event order |
| E6 | Input→judgment < 2 ms on F3 | Judged synchronously at event arrival; F3 reads 0.000 ms in-browser; harness median ≪ 2 ms |
| E7 | §14.1–.6 determinism/timing | `determinism.test.ts` — bit-identical seeded rounds, 30 vs 144 fps identical, ε oracle <1 ms, plate 2.5 ft ±0.5 in |

## Calibration results (the §7 contract)

`Cd` tuned **0.33 → 0.40** (spec marks Cd TUNABLE; the calibration table is the
contract). Spec's 0.33 overshot every row by 35–40 ft — real batted balls fly
with a higher effective Cd (spin-dependent drag). Cl cap/slope and the spin
formula are unchanged from spec.

| Tier | EV | Carry (target) | Δ | Flight time (§5 table) | Elevation | Plate speed |
|---|---|---|---|---|---|---|
| 40 | 92 | 359 (352) | +7 | 0.844 s (0.82) | 12.38° (11.8°) | 36.7 mph |
| 50 | 94 | 369 (365) | +4 | 0.665 s (0.65) | 7.29° (7.0°) | 45.7 |
| 60 | 96 | 379 (378) | +1 | 0.551 s (0.54) | 4.64° (4.5°) | 54.7 |
| 70 | 98 | 389 (391) | −2 | 0.472 s (0.47) | 3.07° (3.0°) | 63.7 |
| 80 | 100 | 399 (404) | −5 | 0.412 s (0.41) | 2.05° (2.0°) | 72.7 |
| 90 | 102 | 408 (417) | −9 | 0.366 s (0.36) | 1.36° (1.3°) | 81.8 |

Every plate crossing is 2.500 ft (solved); speed bleed 8.2–9.1% (~spec's ~8%).
Flight times are derived values in the spec ("from the §7 model") — they track
the §5 table within 25 ms; §14 pins only the crossing height and the carries.

## Design notes (decisions tests depend on)

- **Sub-tick judgment:** `sim.queueSwing()` judges analytically the moment the
  input arrives (ε from the DOM timestamp vs the continuous schedule); only the
  physical contact waits for the next 120 Hz tick. This is why E6 is ~0 ms and
  why 30 fps and 144 fps runs are bit-identical.
- **Pitch solver steps at 120 Hz** (the live-ball rate) with crossing
  interpolation, so the schedule and the rendered ball are the same model — the
  visible pitch crosses at exactly the solved 2.5 ft.
- **CONTACT is applied before same-tick boundary events**, keeping the event
  order at the locked sequence (… SWING_JUDGED → CONTACT → PLATE_CROSS …).
- **Foul-band q** extends the GR→GD slope, clamped at 0.40 (spec leaves foul q
  open; fouls are never scored or projected).
- **Coordinate realization:** §4 states "+X toward the right-field side" with
  +Z toward the machine and +Y up — a left-handed frame. The engine
  (Three.js) is right-handed, so in-world **+X is the third-base / left-field
  side** and right field is −X. Righty batter box = +X, righty oppo = −X,
  camera mirrored to match (owner-playtest fix: the pitch now approaches the
  plate at the batter's right on screen, per the OTS framing intent).

## M0-DEBUG removal list (feeds M1/M3)

- `input/uiKeys.ts`: digits 1–6 tier select and `R` token → replaced by the
  diegetic machine panel + token slot (M1 model, M3 interaction). Direct tier
  keys are forbidden in the shipped game (§Inputs).
- `ui/overlay/DebugHud.ts`: entire file → LED board canvas pages (M1).
- `src/main.ts`: boots straight into the scene → splash + audio unlock (M1+);
  `Date.now()` session seed → save-id seed (M3).
- `scene/CageScene.ts` greybox meshes/lighting → §4 scene (M1); net-plane
  visual → Verlet cloth (M2). `core/physics/collision.ts` is the basic
  analytic version — M2 refines responses (frame e=0.45, machine guard e=0.30
  are constants already present but un-exercised).

## Gates

- `npm test` — 93/93 across 9 suites (incl. `boundaries.test.ts`, the core-purity gate; ESLint carries the same rule).
- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- Bundle: 537 kB / **137 kB gzip** (budget: ≤1.5 MB gz). Runtime deps: `three` only (`postprocessing` joins in M1; lockfile ceiling is two).
