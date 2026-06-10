# M1 Execution Plan — The Cage ("it looks like the fantasy")

Source of truth: `SPEC.md` §13 (M1 definition), §4 (world/scene), §5 (machine cues), §9 (board inventory), §10 (audio cues — subset), §11 (visual direction), §12 (budgets). Builds on the M0 codebase (tag `m0`); M0's 93 headless tests stay green throughout — M1 touches presentation, never `core/`.

## 1. M1 objective & exit contract

Replace every greybox element with the §4/§11 fantasy: the realistic indoor facility, dramatic cage lighting, the modeled pitching machine with full cadence cues, a rigged animated batter with a visible bat, and the dot-matrix LED board as the primary play surface. When M1 is done, the first 30 seconds of play deliver the signature beats.

**Exit criteria (verbatim from §13, expanded into checkable items):**

| # | Exit check | Verified by |
|---|---|---|
| E1 | 60 fps sustained at High, 1080p, on target hardware | F3 sampling over 3 rounds (scripted); §12: 1% low ≥ 50 fps informally tracked now, gated in M4 |
| E2 | Release cues frame-identical across pitches | All cues driven by sim domain events (deterministic clock), never rAF time; verified by event-timestamp test + slow-mo screen capture |
| E3 | 30-second signature-beats gate: dramatic lighting, LED-board readout, wood crack / metal ping all land within 30 s of play | Timed manual run from splash click + owner playtest |
| E4 | Full §4 scene at §12 scene budgets (< 120 draw calls, < 500k tris, < 500 MB GPU) | F3 extended with renderer.info counters |
| E5 | Batter swing animation reaches the contact pose exactly K = 150 ms after keydown | Headless unit test on the animation-controller math + frame-step visual check |
| E6 | LED board live + swing-card pages render the full §6 chain (DIST headline → EV/LA/grade/spray/ms) | Playtest + screenshot review |
| E7 | All M0 suites still pass; core/ untouched (boundary test green) | `npm test` |

**Notes on scope boundaries set by other milestones:** cloth-sim netting is M2 (M1 nets are static mesh + subtle vertex-sway shader, per §11's split); full §10 audio set is M2 — but §13's M1 exit explicitly includes crack/ping and the §5 cadence cues, so M1 ships a working AudioEngine with the machine + contact subset; recap/ceremony/attract/initials board pages, FTUE coaching, quality presets/auto-detect, ESC sheet, and persistence are M3. M1 builds and tunes at the High preset only.

## 2. Scope fences for M1

**In:** `postprocessing` dependency (the second and final runtime dep), asset pipeline (glTF + Draco/KTX2/meshopt, vendored decoder WASM), full §4 scene geometry & PBR materials, §4 lighting rig + ACES/selective-bloom/SMAA chain, splash overlay with audio unlock, AudioEngine + cue subset (whirr loop pitch-shifted per tier with LOAD dip, feed clunk, release thwip, wood crack ×3 / metal ping ×3, panel click), machine actor with §5 cadence animations, Mixamo-pipeline batter rig (idle / load / swing / reaction) with wood/metal bat props and handedness mirroring, LED board (dot-matrix canvas shader, DSEG atlas, LIVE + SWING CARD + TAKE/MISS pages), camera director with station moves + glowing focus highlight, machine panel as a visible interactive station (arrows + SPACE/ENTER, click confirm), stats monitor + bat rack + token slot as physical placeholders (full behavior M3), `H`/`B` accelerator keys, `M` mute, TAB monitor snap.

**Out (deferred):** Verlet cloth + ball↔net coupling (M2), whoosh/net-rustle/turf/board-tick/ceremony audio (M2), board recap/ceremony/attract/initials/coach pages (M3), scoring/persistence/unlock-driven panel lights (M3 — in M1 all six tier buttons read unlocked/green), ESC sheet & quality presets (M3), WebGPU flag path (post-v1).

**M0-DEBUG retirement:** digit keys 1–6 are removed when the machine panel becomes interactive (this milestone); `R`-token and the HTML debug HUD remain until M3's token slot + full board pages, but the HUD shrinks to a corner fallback once the LED board renders the swing card (it is the F3-adjacent dev surface, hidden by default).

## 3. Asset plan (the critical path)

All content-time sources per §External dependencies; everything vendored same-origin; running `LICENSES.md` inventory starts now (finalized M4). Budget checkpoints: critical path ≤ 15 MB Brotli, audio ≤ 3 MB encoded, batter 15–25k tris.

| Asset | Source (primary) | Fallback | Acquisition |
|---|---|---|---|
| Batter rig + 4 animation states | Mixamo (generic athlete + helmet; idle, bat-low waggle, swing, recoil) → Blender retarget/cleanup → glTF+meshopt | CC0 rigged humanoid (Quaternius Universal Animation Library) — fully scriptable download | **Owner step**: Mixamo needs an Adobe login in a browser; I'll stage exact character/clip names and Blender export settings. If not provided within the milestone, ship the CC0 fallback and swap later — the animation controller is source-agnostic |
| Bat props (wood, metal) | Modeled procedurally in Blender script or simple lathe geometry in code | — | Scriptable |
| Machine, guard, hopper, panel pedestal, rack, bench, cart, signage | Built from primitives + PBR materials in Blender (low-poly hard-surface) → glTF+Draco | Keep as refined in-code geometry where cheaper (guard = wire mesh alpha texture) | Scriptable |
| PBR texture sets: turf, black netting weave (alpha-tested), galvanized steel, pads/vinyl, painted concrete | ambientCG / Poly Haven (CC0, direct URLs) → KTX2 (UASTC normals, ETC1S albedo) via @gltf-transform/toktx | Plain compressed PNG first pass; KTX2 cook before exit (load budget) | Scriptable |
| DSEG font atlas (board) + 5×7 matrix face | DSEG (OFL-1.1) — rendered to a glyph atlas at build time | — | Scriptable |
| SFX subset: whirr loop, clunk, thwip, crack ×3, ping ×3, panel click | Kenney audio packs / OpenGameArt CC0; thwip + whirr candidates also synthesizable (filtered noise + pitch shift) | Procedural Web Audio synthesis stubs (keeps E3 testable while better samples are sourced) | Scriptable |
| Decoder WASM: Draco, KTX2/Basis, meshopt | three/examples/jsm vendored copies into `public/assets/decoders/` | — | Scriptable |

## 4. Work breakdown

### Phase 0 — Pipeline & boot flow (~1 day)

1. `npm i postprocessing` (pin); confirm lockfile = exactly two runtime deps (§14.20 audit).
2. `assets/manifest.ts` + `assets/loaders.ts`: GLTFLoader with DRACOLoader/KTX2Loader/meshopt wired to vendored same-origin decoders; typed manifest of every model/texture/audio/font with byte budgets; loading is fully async with progress.
3. `ui/overlay/Splash.ts`: the one-click "STEP INTO THE CAGE" splash (Flow 2) — the click unlocks the AudioContext and overlaps remaining decode (Slow-Roads-style); cage fades in. Boot order in `main.ts`: splash → assets → scene → loop.
4. `audio/AudioEngine.ts` + `audio/cueMap.ts`: one AudioContext, decoded buffers, Master/SFX/Ambience gain buses (M key = mute), three.js AudioListener on the camera + PositionalAudio sources (machine, plate, panel). Cue map subscribes to the existing domain-event bus — **cues fire from sim events only** (E2's frame-identical guarantee: the §5 clock is already deterministic in core).
5. Begin `LICENSES.md` inventory.

**Done when:** splash → fade-in works; a placeholder click cue plays positionally after unlock; budgets visible in a build report.

### Phase 1 — Scene geometry, materials, lighting, post (~2.5 days)

1. Rebuild `scene/CageScene.ts` into §4: facility shell (90×40×18 ft, padded lower walls, dark sibling cage silhouette, EXIT door, bench, ball cart, safety signage), cage tunnel (70×14×12 ft netting on steel frame, uprights every 10 ft, door flap), worn turf with lane decals, plate + mat + boxes, backstop pad, LED board housing (8×4.5 ft, 8 ft up, tilted 8°), stats monitor (32" LCD, 12 ft from plate), panel pedestal + token slot, bat rack with both bats.
2. Netting (M1 version): alpha-tested weave texture + cloth normal detail on static mesh, subtle vertex-sway shader (§11) — sized/segmented so M2's Verlet panels can replace the four dynamic sections without re-modeling.
3. `scene/Lighting.ts`: six high-bay fixtures in a line; **two real shadow casters** (2048 key over plate, 1024 fill over machine, soft), four emissive-only; light pools on turf, near-dark facility falloff; dust motes in the two key beams (GPU particles — High preset feature).
4. `scene/PostFX.ts`: pmndrs `postprocessing` merged-pass chain — ACES filmic tonemapping, **selective bloom** (board, status light, fixtures), SMAA.
5. Extend F3 with `renderer.info` (draw calls, triangles, GPU memory estimate) → E4 continuously observable. Target: < 120 draw calls via merged static geometry + shared materials.

**Done when:** the empty cage reads as the §11 palette ("the board is the warmest thing in frame"), budgets hold, 60 fps at 1080p on the dev machine.

### Phase 2 — Machine actor & cadence cues (~1 day)

1. `scene/actors/Machine.ts`: two-wheel machine on tripod, 12-ball hopper, steel mesh guard, status light at batter's eye line. Owns meshes/clips/cues, zero rules logic (§Code organization).
2. Animation synced to domain events (FEED: feeder arm clunk + ball drops to wheels; LOAD: ball enters throat, wheels visually loaded; RELEASE: light snaps green + ball leaves aperture). The rendered machine ball handoff: hopper ball → throat → the sim's live ball spawns at RELEASE (existing logic).
3. Audio cues: whirr loop pitch-shifted per tier (an audible difficulty cue, §5), dips under LOAD; feed clunk; release thwip synced to the light snap. Token clink + 3 s spin-up ramp (wheels rise to tier pitch).
4. **E2 test**: a Vitest suite over the event stream asserting cue-trigger timestamps are identical (± 1 tick) across all 10 pitches and across seeds; plus a 120 fps screen-capture spot check.

**Done when:** watching the machine alone telegraphs the §5 metronome at every tier.

### Phase 3 — Batter rig, bats, handedness (~2 days, parallel with Phase 2)

1. Acquire rig + clips per §3 (owner Mixamo step or CC0 fallback). Blender pass: single skeleton, 4 clips (relaxed idle / load-waggle loop / swing / reaction-recoil), helmet, ≤ 25k tris, meshopt-compressed glTF.
2. `scene/actors/Batter.ts`: AnimationMixer state machine driven by sim events — idle ↔ load (ARMED→FEED), swing on SWING_JUDGED, reaction on CONTACT grade. **The K = 150 ms anchor:** the swing clip's contact frame is identified once (per-clip metadata in the manifest); playback rate is set so keydown→contact-frame = exactly 150 ms, matching `core`'s `SWING_CONTACT_OFFSET_S`. Headless unit test on the retiming math (clip length, contact frame, rate → 150 ms).
3. Bat props: wood + metal meshes parented to the hand bone; `B` swaps prop + contact voice (crack vs ping); `H` mirrors the rig and switches batter's boxes (the existing handedness logic, now with a body). Both keys animate through the same diegetic states the rack/box walk will use in M3 (§Inputs: accelerators, not bypasses).
4. Contact audio: wood crack ×3 / metal ping ×3 round-robin at the plate position; PERFECT adds the low-end thump layer (§10).

**Done when:** you watch your batter load, swing on your keypress, and the contact sound matches the bat in his hands; E5 test green.

### Phase 4 — LED board (~1.5 days)

1. `ui/diegetic/LedBoard.ts`: 1024×576 canvas → texture on the board mesh; custom dot-matrix shader (64×36 logical cells, amber-on-near-black, refresh shimmer, glass glare per §9); DSEG glyph atlas + 5×7 matrix face renderer.
2. `ui/diegetic/boardPages/`: page framework (M3 adds the rest) with three pages now — LIVE header (PITCH n/10 · SCORE placeholder), SWING CARD (carry headline → EV / LA / grade / spray / signed ms line, the §5 reveal beat at plate + 0.6 s with 1.5 s hold), TAKE/MISS card. Driven by BOARD_REVEAL/BOARD_HOLD_END events the core already emits.
3. Selective bloom inclusion + emissive tuning so the board reads as the warmest object (§11); canvas re-render only on page changes + a low-rate shimmer tick (not per frame) to protect the frame budget.
4. Demote the HTML debug HUD to a hidden dev fallback (toggled with F3).

**Done when:** the climax beat of every pitch cycle is the board lighting up with the §6 numbers, in dot-matrix.

### Phase 5 — Camera director, station moves, panel interaction (~1.5 days)

1. `scene/CameraRig.ts` → full director: locked OTS play camera (existing framing) plus **0.8 s eased dollies** to stations (machine panel, bat rack, board push-in, stats monitor via TAB) with a glowing focus highlight on the active station and an audio confirm on every selection (§UX, the HRD-VR answer).
2. Contact feel: 80–140 ms shake scaled by EV + 4° FOV kick on PERFECT (§4 camera spec).
3. `ui/diegetic/MachinePanel.ts`: six lit tier buttons on the pedestal (all green/unlocked in M1; red/locked states + stenciled requirements are wired to progression in M3), arrows move focus, SPACE/ENTER confirms with the physical click cue; selecting a tier calls the existing `sim.selectTier`. **Digit keys 1–6 removed** (M0-DEBUG retired).
4. Stats monitor: powered-on dark page with a "STATS — COMING SOON" idle glow (real pages M3); TAB snaps the camera to it and back.

**Done when:** Pass-the-keyboard flow minus persistence works diegetically: arrows to the panel, pick a speed, R-token, play, all with camera moves + clicks.

### Phase 6 — Integration, perf pass & exit review (~1 day)

1. KTX2 cook of all textures; meshopt/Draco everything; build-size report vs the 15 MB critical path.
2. Perf pass to E1/E4: scripted 3-round F3 sampling on the dev machine (real GPU via local Chromium, not SwiftShader); merge draw calls, instance the settled-ball pool, confirm zero per-frame allocations in render paths and canvas updates.
3. E3 timed run: splash click → token → first crack/ping + board reveal, stopwatch ≤ 30 s of play.
4. Full gate run (`test`, `typecheck`, `lint`, `build`) + owner playtest sign-off; update `M0-NOTES.md` → `NOTES.md` pattern with measured M1 numbers; tag `m1`.

## 5. Test inventory (additions)

| Suite | Covers | Spec |
|---|---|---|
| `cueSchedule.test.ts` | Cue-trigger event timestamps identical across pitches/seeds (E2, headless over the bus) | §5, §13 |
| `swingRetiming.test.ts` | Clip retiming math: contact frame lands at 150 ms ± 1 frame for any clip metadata | §6 K anchor |
| `boardPages.test.ts` | Page-state machine: LIVE ↔ SWING CARD ↔ TAKE/MISS transitions on BOARD_REVEAL/HOLD_END events (logic only, no canvas) | §9 |
| Existing 93 M0 tests | Unchanged — `core/` is frozen this milestone | §13 |

## 6. Key risks & mitigations

1. **Mixamo is a manual, owner-gated step** (Adobe login; raw files can't be fetched headlessly). Mitigation: CC0 fallback rig keeps the milestone unblocked; the Batter actor consumes manifest metadata, so swapping rigs is a content change, not code. I'll list the exact Mixamo character + clips to grab.
2. **Swing-clip retiming to K = 150 ms** may fight clip aesthetics (too fast/slow looks wrong). Mitigation: choose/trim a clip whose natural launch-to-contact ≈ 150 ms (spec: matches a real swing); retime only the launch segment; the contact instant is already gameplay-correct in core regardless of visuals.
3. **Selective bloom + 2 shadow casters + canvas texture board** are the three likely frame-budget eaters. Mitigation: F3 renderer.info from Phase 1 onward; board canvas updates event-driven; bloom on a selective layer only; §11 gives the Medium/Low fallbacks but M1 only must hit High on target hardware.
4. **Asset quality variance (CC0 sourcing)** could undercut "visually premium." Mitigation: §11's palette does the heavy lifting (lighting + bloom + dot-matrix board are procedural); textures are commodity PBR; the batter is the only hero asset — hence the Mixamo-first plan.
5. **Frame-identical cues regression risk** if any presentation code keys off rAF time. Mitigation: lint-level convention + the cueSchedule test; all timing flows from domain events (already deterministic from M0).

## 7. Sequencing & estimate

```
P0 pipeline/splash/audio ── P1 scene+lighting+post ──┬── P2 machine+cues ──┐
                                                     └── P3 batter rig ────┼── P4 LED board ── P5 camera/panel ── P6 perf+exit
                                                     (P2 ∥ P3 after P1)    ┘
```

Total ≈ **9–10 working days** single-developer. P4 (board) only needs P0–P1; it can start whenever P2/P3 stall on asset sourcing. The owner Mixamo step should be requested at P0 so it arrives by P3; the CC0 fallback decision point is the start of P3, not its end.
