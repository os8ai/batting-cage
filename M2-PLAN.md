# M2 Execution Plan — Physics Showpieces ("it feels real")

Source of truth: `SPEC.md` §13 (M2 definition), with §7 (in-cage resolution), §10 (full audio set), §11 (netting & cloth), §12 (budgets) supplying the numbers. Builds on the M1 codebase (tag `m1` + the four owner-playtest fix commits); M1's 105 tests stay green throughout — with one deliberate, test-covered exception: M2 *extends* core collision events with impact payloads (position/speed), updating the affected suites in the same commit.

## 1. M2 objective & exit contract

Make the cage physically alive: the netting visibly catches every ball (Verlet cloth, the spec's signature beat), every surface responds with its own character (frame clang, guard rattle, pad thud, turf bounce-and-roll), balls pile up and get swept between rounds, and the full §10 soundscape lands each event at its true position in space.

**Exit criteria (verbatim from §13, expanded into checkable items):**

| # | Exit check | Verified by |
|---|---|---|
| E1 | Net reaction reads believably across the EV range (a 60 EV flare settles the net; a 102 EV rope makes it jump) | Scripted low/mid/high-EV screenshots via the pose/freeze harness + owner playtest |
| E2 | No frame spike > 10% on impact frames | `scripts/perf.mjs` extended: per-frame times bucketed around NET_HIT events over a 3-round GPU run; max(impact-frame) ≤ 1.1 × median |
| E3 | Whoosh / crack / rustle land in correct spatial positions | Headless cue-anchor test (every cue → expected anchor or impact position) + listening pass |
| E4 | Full §10 audio set wired for every event that exists pre-M3 | Cue inventory test: each §10 row → cue name → synth buffer (ceremony/count-up rows land with M3's pages, recorded as deferred) |
| E5 | Settled balls accumulate for the round; feeder-cart sweep clears them between rounds | Playtest + screenshot; pool cap 12 (§7) |
| E6 | Cloth is one-way coupled and never read by gameplay (§Architecture: "gameplay outcomes never read cloth state") | Determinism suite unchanged (bit-identical rounds with cloth on/off is structural: core/sim.ts never imports cloth.ts — boundary test extended to assert it) |
| E7 | Zero allocations in the cloth/audio hot loops; no GC pause > 2 ms mid-cycle (§12) | Chrome performance profile over 3 pitch cycles with impacts; typed-array audit |
| E8 | All M0/M1 suites green after the event-payload extension | `npm test` (suites updated where payload shape changed, same commit) |

## 2. Scope fences for M2

**In:** Verlet cloth solver (`core/physics/cloth.ts` — pure TS, headless-tested; *driven by presentation*, exactly as §Architecture/§Code-organization split it), `scene/actors/Net.ts` cloth-mesh binding replacing the M1 dynamic panels, impact-payload extension of collision domain events (position + speed on NET_HIT/BACKSTOP_HIT, new BALL_BOUNCE), §7 response polish in `core/physics/collision.ts` (steel frame e = 0.45 on uprights, machine-guard box e = 0.30, sphere-sphere nudges among settled balls), between-round feeder-cart sweep animation, the remaining §10 audio (whoosh w/ manual doppler, whiff swish, backstop thud, net rustle ×3 scaled by impact energy, turf bounce/roll, board tick, room tone) + a roving positional emitter for arbitrary impact points, board-reveal beat polish (tick + brightness pop on page flips), removal of the M1 net-blip placeholder (replaced by real cloth reaction), cloth quality config plumbed as constants (High = 4 panels @ 60 Hz × 2 substeps — preset *switching* is M3).

**Out (deferred):** recap/ceremony/attract/initials/coach board pages and their sounds — score count-up loop, medal stamp, unlock klaxon (M3, with the events that trigger them); scoring/persistence (M3); ESC sheet & quality preset UI + auto-detect (M3); Playwright acceptance scenarios (M3); window-blur audio suspend polish (M3 ESC/pause sheet); WebGPU path (post-v1).

**Kept from M1 (not placeholders):** the batted-ball tracer and high-ball shadow fade (owner-playtest readability fixes) stay — the cloth reaction complements them; the net-impact *blip* is deleted (the cloth IS the impact read).

## 3. Design notes (decisions the build hangs on)

1. **Solver placement.** `core/physics/cloth.ts` per §Code-organization: pure TS over preallocated Float32Arrays (positions, prev-positions, pin mask, constraint index/rest-length tables) — zero imports outside core, zero allocations per step. It is *not* called by `sim.ts`; `scene/actors/Net.ts` owns instances and steps them on the render loop's fixed 60 Hz sub-accumulator (2 substeps, §11). This honors both the file layout and the "visual-only, one-way coupled" architecture line. The boundary test gains an explicit assertion: `core/sim.ts` (and the files it imports) never reference `cloth.ts`.
2. **Impact payloads (core change, the milestone's one event-shape break).** `NET_HIT`/`BACKSTOP_HIT` gain `{px, py, pz, speedMps}` and a `panel` hint (far/left/right/ceiling/back); a new `BALL_BOUNCE {px, py, pz, speedMps}` event fires on turf bounces above a threshold (rolling stays silent until SETTLED). Presentation needs the position for cloth impulse injection and spatial one-shots; tests assert payloads match ball state at emission. Determinism suites re-baseline mechanically (same-run bit-identity is what they prove; they don't pin event shapes).
3. **Cloth panels (§11, sized to the M1 net segmentation):** far-end panel (14 × 12 ft), first 20 ft of both side panels (20 × 12 ft each), ceiling strip over the plate-to-machine lane (14 × 50 ft at coarser pitch), and the back panel behind the backstop (the "section nearest likely impacts" — wild MISS ricochets). Node pitch ~0.35 m (ceiling ~0.5 m) → ≈ 2.5 k nodes, ≈ 9 k constraints total; structural + shear constraints, edge nodes pinned to the frame, gravity sag + air damping so panels hang with believable belly at rest.
4. **Impulse injection.** On NET_HIT, Net.ts maps the impact position to the panel's nearest node and spreads the ball's pre-damp momentum over the 3×3 node neighborhood (§11), clamped so a 102 EV impact deforms ~0.5–0.7 m without tunneling; the solver's constraint passes pull the bulge back over ~1 s. The gameplay ball already got its damped-catch response in core — visual and gameplay never disagree about where the ball ends up.
5. **Whoosh & doppler.** Browsers removed automatic PannerNode doppler; implement manually — a looping synth whoosh on the roving ball emitter whose playbackRate bends with radial velocity toward the listener (clamped ±15%), gain scaled by tier (§5's "louder at higher tiers") and by proximity. Active during FLIGHT (pitch) and batted flight; stops on catch/settle.
6. **Mesh update cost.** Cloth → BufferGeometry position writes once per render frame (not per substep); normals via `computeVertexNormals` only on deformed panels with an "active" flag that decays after impacts settle — idle cloth costs sag-shader-level nothing. E2's spike budget is enforced by capping constraint iterations (2) and skipping normal recompute on quiet panels.
7. **Sweep animation.** Between rounds (TOKEN after a completed round), the feeder cart (M1 prop) slides a brush pass down the lane over ~2.5 s; settled balls translate toward the machine-end gutter and fade — purely presentational; the sim already cleared its pool at token (M0 behavior, unchanged). The sweep must not delay the §5 spin-up clock: it runs during SPINUP's 3 s.

## 4. Work breakdown

### Phase 0 — Core collision polish + impact payloads (~1 day)

1. Extend `DomainEvent`: NET_HIT/BACKSTOP_HIT `{px,py,pz,speedMps,panel}`, new `BALL_BOUNCE {px,py,pz,speedMps}` (threshold ~2 m/s vertical).
2. `core/physics/collision.ts`: steel-frame uprights as cylinder colliders (e = 0.45, narrow — rare clang), machine-guard AABB (e = 0.30) so balls can't pass through the machine, sphere-sphere position nudges among settled balls (no velocity exchange — §Architecture's "simple nudges").
3. Update `sim.ts` emission sites; update `collision.test.ts`, `determinism.test.ts`, `cueSchedule.test.ts` for the new shapes; add payload-accuracy tests (event position == ball state at emission).

**Done when:** all suites green; a scripted 90 mph round logs frame/guard/bounce events with sane positions.

### Phase 1 — Verlet cloth solver, headless (~1.5 days)

1. `core/physics/cloth.ts`: `createCloth(cols, rows, spacing, pins) → ClothState` (typed arrays); `stepCloth(state, dt, substeps)` — Verlet integrate (gravity, air damping ~0.02), structural + shear constraints, 2 relaxation passes, pinned nodes immovable; `applyImpulse(state, nodeIdx, vx, vy, vz)` spreading 3×3 (§11); `settleEnergy(state)` for the active-panel flag.
2. Tuning constants in `core/constants.ts` (TUNABLE block): node pitch, damping, constraint passes, impulse clamp, rest-sag.
3. `tests/cloth.test.ts`: pins never move; constraint lengths within 2% after settling; impulse spreads exactly 3×3; energy monotonically decays post-impulse (returns to rest, no NaN/explosion at a 50 m/s impulse — the 102 EV case); `stepCloth` is allocation-free (assert via captured array identities) and deterministic (two identical runs → identical Float32Array contents).

**Done when:** a simulated panel takes a 102 EV impulse and relaxes to rest, headless, bit-deterministically.

### Phase 2 — Net actor: cloth-mesh binding (~1.5 days)

1. `scene/actors/Net.ts`: builds the four §11 dynamic panels as cloth instances bound to BufferGeometry (M1's static planes for those sections are removed; the remaining netting keeps the sway shader); shares the M1 weave material; edge pins follow the frame.
2. 60 Hz × 2 substep sub-accumulator on the render loop; position writes once per frame; normals only while a panel's `settleEnergy` exceeds rest threshold.
3. NET_HIT subscription: event position → panel + nearest node → momentum impulse (pre-damp ball velocity reconstructed from `speedMps` + incoming direction), clamped per §3.4. Remove the M1 net-blip (CageScene + main wiring).
4. Ceiling-strip special case: the §7-confirmed common catch — verify the bulge reads from the play camera (the owner's "where did it go" fix becomes physical).

**Done when:** scripted low/mid/high-EV hits produce visibly proportional net reactions from the play camera; F3 shows no impact-frame spike > 10%.

### Phase 3 — Full audio set + spatial one-shots (~1.5 days)

1. `audio/synth.ts` additions: whoosh loop (filtered noise, loop-safe), whiff swish, backstop thud (deep, dead), net rustle ×3 (noise bursts through comb-ish filters, gain-scaled), turf bounce (short tick + low knock) + roll loop (kills on SETTLED), board tick, room tone (HVAC bed, loop-safe, Ambience bus).
2. `AudioEngine`: roving impact emitter (pool of PositionalAudio one-shots positioned per event payload), ball emitter that tracks the rendered ball for whoosh + manual doppler (§3.5), Ambience bus + room tone started at unlock.
3. `audio/cueMap.ts`: rows for RELEASE→whoosh-start (pitch), CONTACT→whoosh-rebase (batted), NET_HIT→rustle@impact (gain ∝ speed²), BACKSTOP_HIT→thud@impact, BALL_BOUNCE→bounce@point, BALL_SETTLED→roll-stop, SWING_JUDGED(MISS)→whiff@plate, BOARD_REVEAL/HOLD_END→board tick@board. Still pure — payload positions pass through untouched.
4. `tests/cueSchedule.test.ts` extension: anchor-correctness table (every cue → machine/plate/board/ball/impact anchor), rustle-gain monotonic in impact speed, whoosh present exactly during flight phases, cue set inventory vs the §10 table (with the M3-deferred rows listed).

**Done when:** a full round heard start-to-finish has every event sounding from its true location; E3/E4 tests green.

### Phase 4 — Sweep, settled-pile polish, reveal beat (~0.5 day)

1. Feeder-cart sweep on re-token (during the 3 s SPINUP): cart prop slides the lane, settled-ball meshes translate/fade to the gutter; cart returns. No sim involvement.
2. Settled-pile look: slight random roll-in rotations, the §4 "subtle roll/bounce decals" pass deferred to M4 texture work if budget-tight.
3. Board reveal beat: tick cue (Phase 3) + a 120 ms brightness pop on SWING_CARD/NO_DIST_CARD flips (LedBoard color scalar envelope — no canvas cost).

**Done when:** rounds end with a satisfying sweep; the reveal pops without a redraw.

### Phase 5 — Perf pass, integration & exit review (~1 day)

1. `scripts/perf.mjs` extension: per-frame timestamps tagged by proximity to NET_HIT events (page-side event log); assert impact-frame max ≤ 1.1 × median over 3 GPU rounds at 1080p (E2); overall 60 fps hold from M1 must not regress.
2. Allocation audit: Chrome heap/performance profile across 3 cycles with impacts — cloth step, cue dispatch, and mesh writes allocation-free (E7).
3. Full gate run (`test`, `typecheck`, `lint`, `build`), bundle delta check (synth additions are code-only; budget unaffected), owner playtest sign-off on E1/E5.
4. `M2-NOTES.md` (measured numbers, decisions, deferred-cue ledger), update memory, commit, tag `m2`.

## 5. Test inventory (additions/updates)

| Suite | Covers | Spec |
|---|---|---|
| `cloth.test.ts` (new) | Solver: pins, constraint convergence, 3×3 impulse spread, energy decay, no-alloc, determinism, 102 EV stability | §11, §12 |
| `collision.test.ts` (updated) | Frame e=0.45 / guard e=0.30 responses, settled nudges, BALL_BOUNCE threshold, payload accuracy | §7 |
| `cueSchedule.test.ts` (extended) | Cue→anchor table, rustle gain ∝ energy, whoosh lifecycle, §10 inventory completeness | §10, E3/E4 |
| `boundaries.test.ts` (extended) | core purity + sim never imports cloth (one-way coupling structural proof) | §Architecture, E6 |
| `determinism.test.ts` (re-baselined) | Bit-identical rounds with the extended event payloads | §14.1–.3 |
| Remaining M0/M1 suites | Unchanged | — |

## 6. Key risks & mitigations

1. **Cloth instability at 102 EV impulses** (stretching/tunneling/explosion): clamp injected impulse, 2 substeps at 60 Hz, constraint relaxation ×2, headless stability test at 50 m/s before any mesh work (Phase 1 gates Phase 2).
2. **Impact-frame spikes (E2):** normals recomputed only on active panels; position writes batched per frame; constraint counts fixed at build; if profiling still spikes, drop ceiling-strip resolution first (it's the largest panel and the least scrutinized).
3. **Event-shape change ripples** through 9 existing suites: do Phase 0 as one atomic commit with all suites updated; nothing else lands until green.
4. **Synth rustle/whoosh quality** (procedural may read cheap): same fallback ladder as M1 — ship synth, keep cue names stable for CC0 sample swaps later; rustle is the one most worth a real sample, note it for the owner.
5. **Manual doppler artifacts** (zipper noise on rate changes): smooth playbackRate with a one-pole filter per frame; clamp ±15%.
6. **Sweep vs. §5 clock**: the sweep is purely visual inside SPINUP's fixed 3 s — if the animation can't finish, shorten the animation, never the clock (the metronome is locked).

## 7. Sequencing & estimate

```
P0 core events/collision ── P1 cloth solver (headless) ── P2 Net actor ──┐
                            P3 audio set (after P0; ∥ P1–P2) ────────────┼── P4 sweep+beat ── P5 perf+exit
                                                                         ┘
```

P3 depends only on P0's payloads and can run parallel to P1/P2. Total ≈ **6–7 working days** single-developer, tests written alongside each phase. The headless cloth suite (P1) gates the visual work (P2) — the same "prove the math before the mesh" discipline that made M0→M1 safe.
