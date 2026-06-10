# M2 Build Notes — Physics Showpieces

Status: **M2 exit criteria met** (checklist below). Built per `M2-PLAN.md`
against `SPEC.md` §7/§10/§11/§12/§13. One deliberate core change (the plan's
"one event-shape break"): collision domain events gained impact payloads;
the affected suites were updated in the same commit (P0).

## Run it

```bash
npm install
npm test           # 148 headless Vitest tests (105 M1 + 43 M2)
npm run dev        # dev server
npm run build      # tsc + vite build → dist/
npm run preview    # serve the built artifact

node scripts/smoke.mjs      # headless visit walk + screenshots (needs preview)
node scripts/perf.mjs       # 3-round GPU run: fps + E2 impact-spike gate
node scripts/net-shots.mjs  # E1 harness: low/mid/high-EV net reaction
```

## Exit checklist (M2-PLAN §1)

| # | Check | Result |
|---|---|---|
| E1 | Net reaction reads believably across the EV range | `scripts/net-shots.mjs` injects 60/96/102 EV impacts through the real actor pipeline: peak deflection **0.09 / 0.26 / 0.30 m**, monotonic in EV, decays back to rest (<5 cm residual); ceiling strip 0.35 m peak. Owner playtest pending sign-off |
| E2 | No frame spike > 10% on impact frames | `scripts/perf.mjs` (timed swings → 30 net/backstop impacts over 3 GPU rounds at 1080p, NVIDIA GB10/Vulkan): **max impact frame 16.8 ms = 1.006× median** (gate ≤ 1.1×); avg **60.0 fps**, 1% low 59.5, worst frame of the whole run 16.8 ms |
| E3 | Whoosh / crack / rustle land in correct spatial positions | Headless cue-anchor table over all 21 cues (machine/plate/ball/impact/board); impact one-shots assert payload-position passthrough; roving emitter pool + ball-tracking emitter with manual doppler. Listening pass: owner |
| E4 | Full §10 audio set wired for every pre-M3 event | `cueMap.ts` rows for every event; `synthInventory.test.ts` proves every cue → finite, audible, normalized buffer (loops click-free, variants distinct). **Deferred-cue ledger** below |
| E5 | Settled balls accumulate; feeder-cart sweep clears between rounds | Collision suite (pool cap 12, no interpenetration, clear on token) + scripted browser sweep check: pile pushed to the machine-end gutter, fades, cart parks home inside SPINUP's 3 s |
| E6 | Cloth one-way coupled, never read by gameplay | Structural: `boundaries.test.ts` walks `core/sim.ts`'s import closure and asserts it never reaches `cloth.ts`; determinism suites unchanged |
| E7 | Zero allocations in cloth/audio hot loops; no GC pause > 2 ms | `stepCloth` allocation-free by construction (preallocated typed arrays; test asserts array identities) and bit-deterministic; cue dispatch allocates only on sparse domain events, never per frame. Strongest runtime evidence: the 13,962-frame GPU run's worst frame is 16.8 ms — a >2 ms GC pause mid-cycle would show as ≥18.7 ms |
| E8 | All M0/M1 suites green after the payload extension | **148/148** across 14 suites; `typecheck`, `lint`, `build` clean |

## Measured numbers

| Metric | Value | Gate |
|---|---|---|
| avg fps (3 GPU rounds, 1080p) | 60.0 | 60 sustained ✓ |
| 1% low | 59.5 fps | ≥ 50 ✓ |
| worst frame (incl. 30 impact windows) | 16.8 ms | impact ≤ 1.1× median ✓ (1.006×) |
| draw calls / tris | 114 / ~12.1k | < 120 / < 500k ✓ |
| input→judgment | 1.1–1.3 ms (smoke) | < 2 ms ✓ |
| bundle | 827 kB / **250 kB gzip** (+6 kB vs M1) | ≤ 1.5 MB gz ✓ |
| cloth | 5 panels, ~1.2k nodes / ~4.6k constraints total | §11 sized ✓ |

## Decisions & deviations

1. **Five cloth panels, not four** — §11's "section nearest likely impacts"
   read as the back panel behind the backstop (wild MISS ricochets), added to
   far / left-near / right-near / ceiling-strip. Node count (~1.2k) is half
   the plan's ≈2.5k estimate; the §12 budget never noticed.
2. **Zero-copy mesh binding** — each panel's BufferGeometry position
   attribute IS the solver's `Float32Array` (no per-frame copy); normals
   recompute only while `settleEnergy` exceeds rest, idle panels aren't even
   stepped. `frustumCulled = false` on panels (bounds change per impact; the
   cage is always in view).
3. **Impulse clamp 40 m/s** (constants TUNABLE): at 34 the 96-EV and 102-EV
   reactions were near-identical through the browser pipeline; 40 restores
   visible separation and the solver is stable there (headless 102 EV test:
   bounded bulge, energy envelope monotonically decaying, NaN-free).
4. **Impact speeds are pre-response** — collision captures ball speed at
   impact (before damping) into the hit record; cloth impulse and rustle gain
   (∝ speed², saturating at 40 m/s) scale by it. Event positions are the
   post-clamp contact point and equal the live ball state at emission
   (payload-accuracy test).
5. **FRAME_HIT / GUARD_HIT events added** beyond the plan's NET/BACKSTOP/
   BOUNCE list — "every surface responds with its own character" needed the
   clang and the rattle to be event-driven like everything else. Guard AABB
   is active for batted balls only (`sim.batted`); the pitched ball exits
   through the guard aperture unimpeded.
6. **Settled-pile nudges run to convergence at park time** (capped 40
   passes): tight 10-ball clusters at the far net need more than a fixed
   handful of relaxation passes; live-ball-vs-pile nudges run per tick.
7. **Manual doppler** on the whoosh loop (browsers removed PannerNode
   doppler): playbackRate bends with radial velocity toward the listener,
   clamped ±15%, one-pole smoothed (dt·10) against zipper noise. Whoosh gain
   steps with tier (§5 "louder at higher tiers").
8. **−0/+0 Verlet pitfall**: constraint relaxation must skip zero-weight
   (pinned) writes — `(-0) + 0 === +0` breaks bit-exact pin assertions.
9. **Owner-playtest fix (post-exit): the side nets read as solid black.**
   Three stacked occluders, each masking the next (which is why no single
   change showed until all three fell): (a) the M1 "sibling cage silhouette"
   was two SOLID 3.4×14 m slabs walling off the whole aisle — replaced with
   an open post-and-rail frame on BOTH sides plus a turf lane and a soft
   transparent veil (alpha-tested weave mips read solid at aisle distances);
   (b) the facility side walls/pads had outward normals — backface-culled
   from inside since M1, the "walls" were the void; (c) the pad texture's
   navy base was ~2% linear albedo — black under any light (lifted to
   ~[88,100,134] + tint/sheen). Aisle treatment: 6 house fixtures (dim,
   NON-bloomed lenses — the cage stays the warmest thing in frame, §11) with
   aimed SpotLight pools on the sibling lanes. Re-verified after: 60.0 fps,
   impact ratio 1.006×, 116 draw calls, all 148 tests green.

## Deferred-cue ledger (→ M3, with the pages/events that trigger them)

- score count-up loop (RECAP), medal stamp, unlock klaxon (CEREMONY)
- window-blur audio suspend polish (ESC/pause sheet)
- ESC-sheet volume buses (Master/SFX/Ambience sliders) — room tone currently
  fixed at 0.16 on its own Audio node; M mute still master-wide
- net rustle is the cue most worth a real CC0 sample later (plan risk 4);
  cue names are stable for drop-in replacement

## M0-DEBUG ledger (current)

- Remaining for M3: `R`-token (→ token-slot station), hidden HTML dev HUD
  (→ full board pages), `Date.now()` session seed (→ save-id seed).

## New surfaces (M2)

`core/physics/cloth.ts` · `scene/actors/Net.ts` · extended
`core/physics/collision.ts` (frame cylinders, guard AABB, settled nudges,
bounce threshold) · extended `audio/{synth,cueMap,AudioEngine}` (10 new
voices, roving impact pool, ball emitter, room tone) · sweep + reveal beat in
`scene/CageScene.ts` / `ui/diegetic/LedBoard.ts` · dev: `scripts/net-shots.mjs`,
`scripts/perf.mjs` (timed swinger + impact-spike gate) · tests:
`cloth.test.ts`, `synthInventory.test.ts`, extended `collision/cueSchedule/
boundaries` suites.
