# M0 Execution Plan — Greybox Loop ("the game is fun ugly")

Source of truth: `SPEC.md` §13 (M0 definition), with §4–§8 supplying the numbers, §How supplying the architecture, and §14 supplying the acceptance tests M0 must seed.

## 1. M0 objective & exit contract

Build the complete deterministic game loop with placeholder visuals. When M0 is done:

- A 10-pitch round is playable at **every** tier (40–90 mph) in the browser with SPACE-only swing input.
- The **entire rules-of-the-game core** exists as pure TS (zero Three.js/DOM imports) and passes headless Vitest suites.
- Visuals are greybox: box cage, sphere ball, capsule batter, fixed OTS camera. No materials, no audio, no cloth, no LED board, no persistence — those are M1–M3.

**Exit criteria (verbatim from §13, expanded into checkable items):**

| # | Exit check | Verified by |
|---|---|---|
| E1 | 10-pitch round playable at all six tiers | Manual play + headless round runner |
| E2 | Vitest: per-tier grade windows match §6 table exactly | Table-driven suite |
| E3 | Vitest: EV/LA/spray mapping matches §6 formulas (q anchors, clamps, foul band) | Table-driven suite |
| E4 | Vitest: projection lands within ±10 ft of every §7 calibration row | Calibration suite |
| E5 | Vitest: pitch-cycle state machine transitions match §5 clock | Statechart suite |
| E6 | F3 overlay shows input→judgment latency < 2 ms | Manual + automated sampling |
| E7 | (Pulled forward from §14.1–.5) Determinism: same seed + scripted timestamps → bit-identical round, headless; pre-release presses ignored; plate crossing 2.5 ft ± 0.5 in | Determinism + schedule suites |

E7 is included in M0 deliberately: §14's determinism/timing criteria test only core code, all of which M0 builds — deferring those tests would just defer regressions.

## 2. Scope fences for M0

**In:** project scaffold/tooling, `core/` in full (statechart, ballistics, projection, contact model, windows, basic analytic collision, RNG), `app/` loop + clock, `input/swing.ts`, greybox `scene/`, HTML debug HUD, F3 diagnostics, headless test harness.

**Out (explicitly deferred):** scoring/medals/progression (`rules/scoring.ts`, `progression.ts` — M3, though §8 constants land in `constants.ts` now), persistence (M3), audio (M2), cloth/net visuals (M2), LED board & diegetic UI (M1), batter rig/animations (M1 — capsule swings nothing; the K = 150 ms offset is pure math in M0), quality presets/auto-detect (M3), Playwright scenarios (M3), `postprocessing` dependency (M1).

**M0-only scaffolding (flagged for removal):** debug tier-select keys and round-start key on the HUD. §What forbids direct tier-select keys in the shipped game (they bypass the diegetic panel); in M0 there is no panel, so a dev selector is the only way to satisfy "playable at every tier." All M0 tiers are unlocked — progression gating arrives with M3. Mark these with `// M0-DEBUG` comments.

## 3. Work breakdown

### Phase 0 — Scaffold & toolchain (~0.5 day)

1. `npm create vite@latest` (vanilla-ts), TypeScript 5.x `strict: true`, pin `three` (sole runtime dep in M0; `postprocessing` joins in M1 — lockfile stays at the §How "exactly two" ceiling).
2. ESLint + Prettier; configure the **import-boundary rule** now, while the tree is empty: `core/**` may import only from `core/**`; `scene/ui/audio` may import core types, never the reverse; only `persist/` (future) touches storage. This is the architecture's load-bearing constraint — cheapest to enforce from commit one.
3. Vitest configured to run `core/` suites in Node (no DOM, no canvas).
4. Directory skeleton exactly per §Code-organization: `src/main.ts`, `app/`, `core/{physics,contact,rules}`, `input/`, `scene/`, `ui/overlay/`, `tests/`.
5. `npm run` scripts: `dev`, `build`, `test`, `lint`, `typecheck`. Optional: a pre-commit hook running all three checks.

**Done when:** empty app boots in browser; `vitest` runs a placeholder core test headless; lint fails on a deliberate `core/ → three` import.

### Phase 1 — Core foundations: constants, RNG, ballistics, projection (~1.5 days)

1. `core/constants.ts` — single source (§7 table): m = 0.145 kg, r = 0.0366 m, A = 4.20e-3 m², ρ = 1.205, Cd = 0.33, Cl cap 0.35 / slope 1.5, g = 9.81; cage geometry from §4 (release 46.0 ft / 3.5 ft high / centerline; plate crossing 2.5 ft; cage 70×14×12 ft; backstop 4 ft behind plate); tier table (release mph), pitch-clock timings (§5), §6 window tables, §8 multiplier/medal tables (stored now, consumed in M3). SI internally; ft/mph only at display boundaries. All TUNABLE values grouped and commented as such.
2. `core/rng.ts` — mulberry32, seeded by `(sessionSeed, roundCounter, pitchIndex)` per §6 Determinism (save id arrives in M3; M0 uses a session seed, fixed in tests).
3. `core/types.ts` — `Tier`, `Grade`, `Spray`, `SwingRecord {pitch, tier, epsMs, grade, spray, evMph, laDeg, carryFt}` (points field added in M3), domain events (`FEED, RELEASE, SWING_JUDGED, CONTACT, NET_HIT, ROUND_END` …), snapshot type.
4. `core/physics/ballistics.ts` — semi-implicit Euler step; acceleration = gravity + drag (+ Magnus when spin ≠ 0): `a_drag = −(ρCdA/2m)|v|v`, `a_magnus = (ρClA/2m)|v|²(ω̂×v̂)`, `Cl = min(0.35, 1.5·S)`, `S = r|ω|/|v|`. Allocation-free step API (mutate pooled vectors) — the §12 zero-alloc hot-loop budget starts here.
5. **Machine elevation solver** — §5's elevation column is *derived*, not authored: per tier, bisection on launch elevation θ integrating gravity+drag from the release aperture until the y-height at plate-z equals 2.5 ft. Computed once at boot into a per-tier table: `{elevationRad, flightTimeS, platePos}`. The continuous pitch schedule (release time → plate-crossing time) reads from this.
6. `core/physics/projection.ts` — from contact state (plate centerline, 2.5 ft, EV/LA/spray vector, backspin ω = max(300, 500 + 60·LA°) rpm, no sidespin), step the same model at **240 Hz** synchronously to touchdown y = 0; **carry = horizontal distance from plate, floored to whole feet** (carry only, no roll).
7. `core/physics/collision.ts` — basic analytic in-cage response (full polish is M2, but the core API ships now per §Architecture): damped catch at net planes (velocity → ~15%), turf e = 0.38 with rolling decay, backstop e = 0.10, sleep < 0.3 m/s, settled pool of 12. Greybox treats cage walls as AABB planes.

**Tests (Phase 1):**
- Solver: every tier crosses plate at 2.5 ft ± 0.5 in (§14.6); flight times match §5 table (0.82/0.65/0.54/0.47/0.41/0.36 s) within ±10 ms; at-plate speed ≈ release − ~8%.
- Projection vs §7 calibration table: all six rows within ±10 ft (§14.7). **If Cd = 0.33 misses, tune Cd/Cl/spin within §7's stated tolerances — the table is the contract, the constants are not.**
- Ballistics sanity: drag-only pitch is monotonic in v; Magnus lifts a backspun ball vs spinless control; projection is deterministic across runs.

### Phase 2 — Timing windows & contact model (~1 day)

1. `core/contact/timingWindows.ts` — §6 per-tier table (PERFECT/GREAT/GOOD/FOUL thresholds), data-driven so lil-gui can tune it in M4.
2. `core/contact/contactModel.ts` — pure function `(epsMs, tier, rng) → SwingOutcome`:
   - ε = t_press + 150 ms − t_plate (sign: + LATE / − EARLY).
   - Grade from |ε| vs tier windows; beyond FOUL → MISS.
   - q: piecewise-linear through q(0)=1.00 → q(W_P)=0.95 → q(W_GR)=0.82 → q(W_GD)=0.65.
   - EV = q × (1.2×70 + 0.2×v_release) × jitter[0.98, 1.02] seeded. Bat choice never affects EV (voice only).
   - LA = 25° + 21°·u + jitter(±3°) seeded, clamp [−5°, 55°], u = ε/W_GD.
   - Spray: fair |ε| ≤ W_GD → linear 0→40°; FOUL band (W_GD, W_FL] → 46°→70°; jitter ±2° seeded, never crossing the 6° fair/foul guard gap; sign from ε sign, mirrored by handedness; tag CENTER ≤ 8° else PULL/OPPO.

**Tests (Phase 2):** table-driven over every tier × every window boundary (±1 ms each side); q anchor values exact; max-EV column matches §6 (92→102 mph at q=1, jitter off); LA extremes (edge-of-GOOD early ≈ 4°, late ≈ 46°, PERFECT ≈ 22–28°); FOUL spray always > 45°, fair never (§14.9); jitter bounds and seed-reproducibility; normalized curves identical across tiers (fence 2: only windows differ).

### Phase 3 — Pitch-cycle statechart, round runner & determinism harness (~1.5 days)

1. `core/pitchCycle.ts` — the locked statechart on the §5 clock: ARMED → FEED (T+0) → LOAD (T+0.9) → **RELEASE (T+1.8, the timing anchor)** → FLIGHT → PLATE (T+1.8+tf) → OUTCOME → RESOLUTION → BOARD_REVEAL (T+2.4+tf, 1.5 s hold) → ARMED → next FEED at T+7.5. Fixed 7.5 s cycle, zero jitter, all tiers. Token/round-start → 3.0 s spin-up → first FEED.
2. Input rules in core (§6): accept window = RELEASE → plate + 200 ms grace; presses before RELEASE ignored (never consume the swing, §14.5); first in-window press is the swing; lockout until next ARMED; no press → TAKE.
3. `core/rules/round.ts` — 10-pitch round container: pitch counter, per-pitch `SwingRecord` log, `ROUND_END` event. (Score stays zero/absent until M3.)
4. **Sub-tick analytic judgment:** ε computed from the DOM-event timestamp against the *continuous* schedule — never quantized by the 120 Hz tick or frame rate. Design note: judge the swing synchronously when the event enters the core queue (the schedule is analytic, so no tick is needed); the physical contact/flight then spawns on the next tick. This is what makes E6 (< 2 ms) trivially achievable and §14.2 provable.
5. **Headless harness** (`tests/harness.ts`): drives the core with a scripted clock and timestamped synthetic keypresses, no DOM — runs full rounds and returns the event/record stream.

**Tests (Phase 3):** statechart transition table incl. blur/void-and-refeed hook (full blur behavior wires up in Phase 4); RELEASE at T+1.8 s ± 1 tick every pitch (§14.4); pre-release press ignored, post-grace press ignored, double-press lockout, TAKE on silence; **determinism: same seed + same scripted timestamps → bit-identical round** (§14.1); **frame-rate independence: the same timestamped inputs fed via simulated 30 fps and 144 fps frame batching grade identically** (§14.2); reported ε equals oracle within 1 ms (§14.3).

### Phase 4 — App shell: loop, clock, input, events (~1 day)

1. `app/events.ts` — typed event bus (core domain events → presentation/diagnostics subscribers).
2. `app/GameLoop.ts` — rAF + **120 Hz fixed-dt accumulator** (Gaffer pattern), emitting interpolation alpha; core advances only via accumulator; snapshots N-1/N retained for render interpolation.
3. Platform clock adapter — maps `performance.now()` to sim time; the pitch schedule is anchored in this timeline so DOM event timestamps and plate-crossing times share one clock.
4. `input/swing.ts` — SPACE keydown handler: timestamp at DOM event time, ignore `event.repeat`, debounce, enqueue-and-judge (Phase 3 design note). `input/uiKeys.ts` — only F3 + the M0-DEBUG keys for now.
5. Window-blur handling: auto-pause, void in-flight pitch, re-feed on resume at no penalty (§Inputs).
6. `app/Diagnostics.ts` + F3 overlay: fps, frame time, **input→judgment latency** (judgment-complete `performance.now()` minus event timestamp).

**Done when:** a headless-style round runs in-browser against the real clock with HUD numbers (Phase 5 renders it); F3 latency reads well under 2 ms.

### Phase 5 — Greybox scene & debug HUD (~1.5 days)

1. `scene/CageScene.ts` — greybox per §4 dimensions: wireframe/flat-shaded box cage (70×14×12 ft) inside a larger dim shell box, plane turf, box machine at 47.5 ft with a small sphere "status light" (amber blink at FEED, **snap green at RELEASE** — the depth-cue anchor exists even in greybox), capsule batter in either batter's box, sphere ball.
2. `scene/CameraRig.ts` — locked OTS framing: 4.5 ft behind batter, 2.0 ft outside back shoulder, 5.9 ft high, vFOV 50°, look-at pinned to the release aperture. No station moves yet (M1).
3. Ball rendering driven by interpolated snapshots (pitch flight, batted flight, settle); soft contact ground-shadow blob under the ball (a locked depth cue, cheap even in greybox); settled balls remain for the round, pool of 12, instant clear between rounds (sweep animation is M2).
4. `ui/overlay/DebugHud.ts` (HTML, M0-only styling): tier, pitch n/10, last-swing card (signed ε ms — "LATE 23 ms" format, grade, spray tag, EV, LA, **carry ft headline**), per-round strip of 10 results. M0-DEBUG controls legend: tier keys, R = insert token/start round.
5. `src/main.ts` — boots straight into the scene (splash/audio-unlock is M1+; no audio exists yet).

**Done when:** a full 10-pitch round at each tier plays with readable timing (release light + ball growth + shadow), and the HUD prints the full §6/§7 output chain per swing.

### Phase 6 — Integration hardening & exit review (~0.5 day)

1. Run the E1–E7 checklist top to bottom; fix gaps.
2. Latency sampling: scripted run logging F3 latency over 60+ swings; assert max < 2 ms.
3. Hot-loop allocation pass: Chrome performance profile of three pitch cycles; eliminate per-frame allocations in ballistics/render paths (pooled vectors), per §12.
4. Tag repo `m0`; write `M0-NOTES.md` with measured calibration results (final Cd/Cl/spin), latency stats, and the M0-DEBUG removal list feeding M1/M3.

## 4. Test inventory (Vitest, all headless)

| Suite | Covers | Spec |
|---|---|---|
| `timingWindows.test.ts` | All tier×grade boundaries, ±1 ms edges | §6, §14.8 |
| `contactModel.test.ts` | q anchors, EV table, LA map+clamp, spray fair/foul, jitter seeding | §6, §14.8–.9 |
| `ballistics.test.ts` | Drag/Magnus behavior, integrator stability | §7 |
| `pitchSchedule.test.ts` | Elevation solver: 2.5 ft ± 0.5 in crossing, §5 flight times, ~8% speed bleed | §5, §14.6 |
| `projection.test.ts` | Six calibration rows ± 10 ft; floor-to-feet; carry-only | §7, §14.7 |
| `pitchCycle.test.ts` | Statechart transitions, 7.5 s clock, RELEASE ± 1 tick, input window/lockout/TAKE | §5–6, §14.4–.5 |
| `determinism.test.ts` | Bit-identical seeded rounds; 30 vs 144 fps equivalence; ε oracle ± 1 ms | §14.1–.3 |
| `collision.test.ts` | Damped net catch, settle/sleep, pool cap | §7 in-cage |

## 5. Key technical risks & mitigations

1. **Calibration miss (E4):** Cd = 0.33 may not land all six carries within ±10 ft. Mitigation: spec explicitly allows tuning Cd/Cl/spin to fit; write the calibration test first and tune constants against it (the table is the contract). Budgeted inside Phase 1.
2. **Latency through the tick boundary (E6):** judging at the next 120 Hz tick risks ~8 ms worst case. Mitigation: the Phase 3 design note — synchronous analytic judgment at event arrival; only the physical resolution waits for the tick.
3. **Clock-domain drift:** schedule anchored in `performance.now()` vs accumulator sim-time divergence over a round. Mitigation: single clock adapter owns the mapping; schedule times stored in the event-timestamp domain; determinism suite catches regressions.
4. **Greybox timing readability:** without the real machine model/audio, 90 mph (0.36 s flight) may feel unreadable and invite premature window re-tuning. Mitigation: keep §6 launch values frozen through M0 — tuning is M4's job behind the §14.22–.24 targets; M0 only proves the loop works.
5. **Scope creep into M1:** no materials, lighting passes, or board work in M0. The debug HUD is disposable HTML; resist making it pretty.

## 6. Sequencing & estimate

Phases 0→1→2→3 are strictly ordered (each builds on the last). Phase 4 can start in parallel with Phase 3 after the statechart API stabilizes. Phase 5 needs 3+4. Total: **~7 working days** single-developer, including tests written alongside each phase (not batched at the end — the determinism harness in Phase 3 is what makes Phases 4–5 safe to iterate on).

```
P0 scaffold ── P1 physics/projection ── P2 contact ── P3 statechart+harness ──┐
                                                      P4 app shell (overlap) ─┴─ P5 greybox+HUD ── P6 exit review
```
