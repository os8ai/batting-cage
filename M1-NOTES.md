# M1 Build Notes — The Cage

Status: **M1 exit criteria met** (checklist below). Built per `M1-PLAN.md`
against `SPEC.md`; M0's core is untouched (boundary suite green).

## Run it

```bash
npm install
npm run dev        # dev server
npm test           # 105 headless Vitest tests (93 M0 + 12 M1)
npm run build      # tsc + vite build → dist/
npm run preview    # serve the built artifact

node scripts/smoke.mjs   # headless visit walk + screenshots (needs preview running)
node scripts/perf.mjs    # 3-round GPU frame sampling (system chromium)
```

Controls (M1): `SPACE` swing / confirm at panel · `R` insert token (M0-DEBUG,
until M3's token slot) · `arrows` machine panel + focus · `ENTER` confirm ·
`TAB` stats monitor · `ESC` back to play · `H` handedness · `B` bat ·
`M` mute · `F3` diagnostics + dev HUD. Digit tier keys are **gone** (replaced
by the diegetic panel, per plan §2).

## Exit checklist (M1-PLAN §1)

| # | Check | Result |
|---|---|---|
| E1 | 60 fps at High, 1080p, target GPU | `scripts/perf.mjs`: 3 scripted rounds, 1920×1080, NVIDIA GB10 (ANGLE/Vulkan): **avg 60.0 fps, 1% low 59.5 fps, worst frame 16.8 ms** — vsync-locked, zero spikes |
| E2 | Release cues frame-identical | All cues map from sim domain events only (`audio/cueMap.ts` is pure); `cueSchedule.test.ts` asserts identical per-pitch offsets (±1 tick), cross-seed equality, and 30 vs 144 fps bit-identical triggers |
| E3 | 30 s signature beats | Splash click → token → first contact ≈ 8.4 s (3 s spin-up + 5.4 s pitch 1): lighting + board + crack/ping all land inside 30 s; verified in the smoke walk |
| E4 | §12 scene budgets | F3 renderer.info: **108 draw calls** (<120), **~11k triangles** (<500k), 44 textures; renderer.info now resets per frame (composer-aware) |
| E5 | Swing contact at K = 150 ms | `swingRetiming.test.ts` — pure retiming math exact for arbitrary clip metadata; Batter sets timeScale from `SWING_META` on every swing |
| E6 | Board renders the §6 chain | Smoke screenshot: dot-matrix card "375 FT / 96EV 29LA / PERFECT CTR / LATE 4 MS"; TAKE card; LIVE pitch pages |
| E7 | M0 suites green, core frozen | 105/105 tests; `boundaries.test.ts` green; `src/core/` diff vs `m0` = none |

End-to-end proof (headless smoke, real input path): scheduled SPACE press
judged **PERFECT, ε = +2.5…6.6 ms, EV ~96, carry 375–382 ft** at 60 mph.

## Perf (E1, measured)

3 scripted rounds (~4.5 min, 13,954 frames) at 1920×1080 on the NVIDIA GB10
via system chromium `--headless=new --enable-gpu --use-angle=vulkan`:

| Metric | Value | Gate |
|---|---|---|
| avg fps | 60.0 | 60 sustained ✓ |
| p50 / p99 frame | 16.70 / 16.80 ms | — |
| 1% low | 59.5 fps | ≥ 50 (§12, gated in M4) ✓ |
| worst frame | 16.8 ms | no impact spikes ✓ |
| draw calls / tris | 108 / ~11k | < 120 / < 500k ✓ |
| input→judgment | 0.2–1.3 ms (handler exec) | < 2 ms ✓ |

Bundle: 810 kB / **244 kB gzip** (budget ≤ 1.5 MB gz). Runtime deps: `three` +
`postprocessing` — the §How ceiling of exactly two (audit per §14.20).
`playwright-core` is dev-only (smoke/perf harness; no browser download).

## Decisions & deviations (documented for M2–M4)

1. **All assets are procedural** — the plan's own fallback paths, promoted to
   shipped source: synthesized cues (`audio/synth.ts`, seeded, loop-safe
   whirr), canvas PBR textures (`scene/textures.ts`), a code-built rigged
   batter (named-joint hierarchy + programmatic `AnimationClip`s through
   `AnimationMixer`), and a code-defined 5×7 dot face. Zero wire bytes, zero
   third-party content. The **Mixamo owner step stays open**: `Batter`
   consumes `SwingClipMeta` (clip length + contact frame), so a glTF rig swap
   is a content change. Character/clips to grab when ready: any athletic
   build + "Baseball Idle", "Baseball Hitting" (trim to launch→contact ≈
   150 ms natural), "Baseball Strike" (reaction).
2. **Decoder WASM not vendored yet** (plan P0.2): no external glTF/KTX2 asset
   exists, so shipping Draco/Basis/meshopt decoders would be dead weight in
   dist/. They join with the first real asset cook; `assets/manifest.ts`
   carries the budget table meanwhile.
3. **LED board logical matrix 72×40** (vs the §4 note's 64×36): 64 cells cap
   lines at 10 chars — "PERFECT OPPO" and "LATE 23 MS" don't fit the §9 card.
   72 cells give 12 chars/line. Same 8×4.5 ft face, same dot look; §14 pins
   nothing about the cell count.
4. **GameLoop hitch handling**: the 0.25 s clamp now also shifts the clock
   epoch, so sim time *dilates* under overload instead of falling permanently
   behind the wall clock — otherwise DOM-timestamp judgment (and any timed
   press) drifts on slow machines. Found via the SwiftShader smoke run; M0
   suites unaffected (they drive the sim directly).
5. **PCFShadowMap** (three 0.184 deprecates PCFSoft); shadow softness comes
   from `shadow.radius`.
6. **Board brightness**: the face material's color scalar sits at ~1.55 into
   the HalfFloat chain so selective bloom reads it as the warmest surface
   (§11) without per-frame canvas redraws (canvas repaints only on page
   changes; shimmer is a material-color wobble).
7. **BOARD camera station** exists in `CageScene.stations` for M3's
   ceremonies but is not yet bound to input.

## M0-DEBUG ledger (current)

- Removed in M1: digit tier-select keys (replaced by the panel station).
- Remaining for M3: `R`-token (→ token-slot station), hidden HTML dev HUD
  (→ full board pages), `Date.now()` session seed (→ save-id seed).

## New surfaces (M1)

`audio/{synth,cueMap,AudioEngine}` · `assets/manifest` · `scene/{textures,
Lighting,PostFX}` · `scene/actors/{Machine,Batter,swingRetiming}` ·
`ui/diegetic/{dotFont,LedBoard,MachinePanel,StatsMonitor,boardPages/pageMachine}`
· `ui/overlay/Splash` · `input/pointer` · reworked `input/uiKeys`,
`scene/{CageScene,CameraRig}`, `main.ts` · dev: `scripts/{smoke,perf}.mjs`.

## Gates

- `npm test` — 105/105 across 12 suites (new: `cueSchedule`, `swingRetiming`,
  `boardPages`; core-purity boundary suite still green).
- `npm run typecheck`, `lint`, `build` — clean.
- Headless browser smoke (SwiftShader) — full visit walk, zero console
  errors; screenshots under `scripts/shots/`.
