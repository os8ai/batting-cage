# Spec: Batting Cage — One-Button 3D Batting Cage Game for the Desktop Browser

## User's original guidance
> {"guidance": "Create a detailed spec/requirements document (SPEC.md) in /home/leo/Claude/batting-cage/ for \"Batting Cage\" — a simple-to-play, visually premium 3D batting cage game for desktop.\n\nCORE CONCEPT (from user):\n- You are a batter in a batting cage, pitched to by a pitching machine. One-button gameplay: press SPACE to time your swing. All pitches are fastballs over the plate — pure timing skill.\n- Machine has selectable pitch-speed settings (suggest 40–90 mph tiers).\n- On contact the ball physically flies and hits the cage netting/walls (the net visibly reacts), but an in-world HitTrax-style LED board in the cage displays the projected carry distance the ball WOULD have traveled in an open field.\n- 3D graphics, great physics, plays on the user's computer (browser is fine).\n\nUSER DECISIONS (locked in via Q&A, do not reopen):\n- Camera: over-the-shoulder third person, behind/above a fully animated 3D batter (you watch your batter swing). Depth-timing aids: ball size growth, ground shadow, machine release cues.\n- Setting: realistic INDOOR training facility — turf floor, black netting, dramatic overhead lighting, glowing LED distance board.\n- Modes: (1) Scored rounds — a \"token\" starts a 10-pitch round at chosen speed; score from contact quality + projected distance; local high-score board per speed. (2) Progression unlocks — start with slow speeds, performance unlocks faster machine settings.\n- Extras: ball-flight stats on the in-cage board (exit velocity, launch angle, timing error like \"LATE 23 ms\"); persistent local stats (personal bests, averages, session history); handedness toggle (righty/lefty) + bat choice wood/metal with distinct contact sounds (crack vs ping).\n- Explicitly NOT selected for v1 (list as future ideas): free-practice endless mode, streak challenge, slow-mo replays.\n\nTECH DIRECTION (my recommendation, user delegated platform choice — \"whatever looks and plays best\"):\n- Browser-based desktop game: TypeScript + Three.js (WebGL2 baseline, WebGPU optional), Vite, runs locally; keyboard-first (SPACE swing).\n- Custom fixed-timestep ballistic physics: pitch flight with gravity + drag; post-contact flight with gravity + drag + Magnus (backspin); projected distance computed by simulating the full open-field flight to ground; actual rendered ball collides with net/walls.\n- Verlet cloth simulation for the netting reaction; hit balls remain on the floor for the rest of the round.\n- Contact model: signed timing error ε maps outcome — early=pull side, late=opposite field, |ε| sets contact quality/exit velo (smash-factor style: EV ≈ q·(1.2·bat_speed + 0.2·pitch_speed)), outside window = whiff. Input timestamped at event time, frame-rate independent. Per-speed timing-window table (more forgiving at 40 mph, tight at 90).\n- Audio: machine wheel whirr + feed clunk, ball whoosh, wood crack / metal ping, net rustle, room ambience.\n- 60 fps target, quality presets, PBR materials, ACES tonemapping, bloom, soft shadows. Batter character: rigged humanoid with idle/load/swing animations (Mixamo-style pipeline acceptable).\n\nSPEC MUST COVER: vision/why; full functional requirements; cage scene with realistic dimensions (~70 ft long cage, machine ~45–50 ft from plate); pitching machine behavior, feed cadence, and timing-readability cues; swing/timing model with concrete windows and outcome-mapping formulas; ball-flight + distance-projection math; scoring formulas and progression unlock thresholds; UI/UX (diegetic-first: LED board, machine control panel for speed select); audio design; visual direction; performance targets; module/architecture breakdown; build milestones; acceptance criteria; out-of-scope/future list.", "outDir": "/home/leo/Claude/batting-cage"}

## Why
- **Problem statement:** The batting cage has a specific, proven pleasure: the whirr of the machine, one perfectly timed swing, the crack of contact, and a glowing board answering the question every hitter asks — 'how far would that one have gone?' HitTrax facilities and Toptracer ranges built businesses on exactly this loop of instant per-swing feedback turned into a game. But for someone at a desktop, that experience is locked away. Real cages demand a drive, a booking, and per-token fees; MLB Home Run Derby VR demands a $30 purchase and a headset; browser home-run-derby clones are visually disposable 2D/low-poly toys with arcade physics; and full baseball sims bury pure hitting under rosters, pitching meters, and multi-input control schemes. No product delivers the cage ritual itself — believable ball flight, a net that reacts, an honest stat board — with premium presentation, one URL and one key away. Batting Cage closes that gap: press SPACE to time your swing against a pitching machine, and a 10-pitch token round delivers the whole ritual in about two minutes — short enough for a break, deep enough to chase for months.
- **Objective function:** Primary maximand: fun per session from the one-button timing loop, made visible as mastery. The game is free, local, and telemetry-free; profit is explicitly zero; success is measured by locally verifiable proxies (the mandated persistent-stats system plus hands-on playtests). Targets: (a) time-to-fun — cold load to interactive in <=10 s, page load to first pitch thrown in <=60 s; (b) session pull — a first session naturally sustains >=3 ten-pitch rounds (~8-12 min, in line with casual first-session benchmarks), and >=50% of completed playtest rounds are followed by starting another token; (c) visible mastery — median |timing error| at a fixed machine speed improves >=30% between a player's first and fifth session, the median player unlocks a second speed tier in session one and reaches the 90 mph tier within 2-4 hours of cumulative play. Hard presentation gates — non-negotiable constraints, never traded against the fun targets: sustained 60 fps at the High quality preset on target desktop hardware, and the signature audiovisual beats (dramatic cage lighting, cloth-sim net reaction, LED-board readout, wood crack / metal ping) all landing within the first 30 seconds of play. Rubric for the rest of this spec: every gameplay, scoring, and progression decision is scored against fun-through-visible-mastery; every visual, audio, and performance decision is scored against the presentation gates.
- **Target user(s):** Primary: the baseball-literate enthusiast — the armchair Statcast fan, current or former player, or rec-league hitter who knows what 92 EV at 25 degrees means, has stood in a real cage (or wishes one were nearby), and plays deliberate solo sessions chasing per-speed personal bests up the 40-to-90 mph ladder. The guaranteed first user is named explicitly: the project owner on their own machine — a build-for-yourself product, which is why local-only persistence is a feature, not a gap. Secondary: (a) the drop-in casual with zero baseball knowledge, whose presence imposes a hard requirement — the game must be fully self-explanatory within the first 10-pitch round at 40 mph, with the LED board's big distance number as the universal hook; (b) pass-the-keyboard shared-machine play — household or office hot-seat competition on the local per-speed high-score board ('beat my 312 ft'), enabled by one-key input and fast round restart. Tie-break rule: when personas conflict, design for the enthusiast's mastery loop; the secondary personas contribute legibility and hot-seat constraints, never feature additions.
- **Non-goals:** Five permanent design fences, each carrying its rationale so downstream sections can resolve unanticipated questions without reopening scope. (1) One button, forever — no second gameplay input: no aiming, power meters, swing types, or mouse/motion swings; depth comes from timing windows and machine speed, never from more controls. (2) Fastballs only — no breaking balls, location variance, or pitch selection; fastball-over-the-plate is the design, not a gap; difficulty scales solely through machine speed and tighter timing windows. (3) The cage is the entire world — no stadiums, open fields, or fly-out cameras; every batted ball ends in the netting or on the cage floor, and the LED board is the only window to the open field (the HitTrax conceit is preserved, never bypassed). (4) Local and private — no servers, accounts, cloud sync, online leaderboards, multiplayer, telemetry, ads, in-app purchases, or licensed MLB content; all data stays on the player's machine. (5) Premium depth over broad reach — desktop browser, keyboard-first: no mobile/touch, no VR, no native/Steam build in v1; 60 fps desktop fidelity is chosen over portability. Deferred, not rejected (future ideas per the user's locked decision): free-practice endless mode, streak challenge, slow-motion replays. Anti-stub rule: cut features are fully absent — never shipped as degraded automation or placeholders. The spec's later out-of-scope/future section expands these fences into an exhaustive list.

## What
- **Core functionality:** (1) One-key play: SPACE is the sole gameplay input — swing timestamped at keydown event time, key-repeat ignored, exactly one accepted swing per pitch, no input = a recorded TAKE. (2) Pitching machine: six fastball tiers — 40/50/60/70/80/90 mph — selected on the diegetic machine control panel; fixed feed cadence with identical telegraphing every pitch (wheel whirr, feed clunk, release-light cue), per the locked timing-readability decision. (3) Per-swing outcome from signed timing error ε: a quality grade from |ε| — PERFECT / GREAT / GOOD / FOUL / MISS — plus direction from the sign (early = pull, late = opposite field), surfaced as a spray tag (PULL / CENTER / OPPO) and the locked millisecond readout ("LATE 23 ms"). Contact spawns the full physical flight: the ball strikes the netting (visible cloth reaction), settles, and remains on the cage floor for the rest of the round. (4) LED board per swing: projected open-field carry distance as the headline number, then EV (mph), LA (°), grade word, spray tag, signed timing readout, running round score and pitch count — words for the casual, milliseconds for the enthusiast, the big distance number for everyone. (5) Token round: one key inserts a token and starts 10 pitches at the selected speed; round score = Σ per pitch (quality multiplier × projected distance); exact multiplier and threshold tables live in the spec's scoring section. (6) Medal progression: Bronze/Silver/Gold/Platinum score thresholds per speed tier, Platinum additionally requiring an aggregate-distance bar (Wii Sports pattern); Bronze at tier N unlocks tier N+1; locked tiers stay visible on the panel with the requirement stenciled in one sentence ("BRONZE AT 50 UNLOCKS 60"); thresholds tuned so the median new player earns Bronze at 40 within session one and reaches 90 mph within 2–4 cumulative hours. (7) End-of-round recap on the board: 10-cell pitch-by-pitch strip (grade + distance), score count-up, medal stamp, New-PB / first-medal / tier-unlock callouts with light-and-sound beats; per-speed top-5 high-score table with three-initial entry (defaults to last-used initials, skippable — solo flow stays one-key). (8) Stat locker (local, persistent, never gating): per-speed PBs (best round, longest carry, hardest EV), medals earned, lifetime and per-session averages, full swing log (capped at the most recent 10,000 swings; per-session aggregates — median |ε|, contact %, hard-hit % — kept forever), last-50-swings timing-error trend sparkline, session history (date, rounds, best score, median |ε|), and named per-speed distance clubs (e.g. 300 FT CLUB at 60) as board celebrations — no cosmetic economy, no XP. (9) Pre-round setup, fully diegetic: bat rack swaps wood/metal (distinct crack vs ping on contact); handedness by the batter switching batter's boxes. (10) Attract mode: idle machine, slow camera drift, board cycling INSERT TOKEN / per-speed top-5s / PBs. (11) First-run: boots at 40 mph with diegetic board prompts only — no tutorial screens.
- **UI / UX:** One continuous 3D scene; during play the UI is 100% diegetic, and between rounds it stays in-world except for a single flat concession. Governing rule for downstream sections: if it exists in a real training facility, it lives in the scene; if it exists only because this is a browser app, it lives on the ESC sheet. In-world stations, each reached by an automatic camera move with a glowing focus highlight and an audio confirm on every selection (the documented MLB HRD VR pitfall, answered): (a) the LED distance board — primary surface, multiplexing dot-matrix pages: per-swing card (DIST headline → EV/LA/grade/spray/ms line), running score and pitch count, end-of-round recap and ceremonies (count-up, medal stamp, PB lights, unlock klaxon, top-5 initials entry via arrows + SPACE), and attract pages; (b) the machine control panel — six lit tier buttons (green = unlocked, red = locked with the unlock requirement stenciled beside it), arrows move focus, SPACE confirms with a physical click; (c) the token slot — SPACE inserts, clunk, wheels spin up; (d) the bat rack and batter's boxes for bat/handedness; (e) a second smaller cage-side stats monitor (TAB snaps the camera to it) purpose-built for dense pages the dot-matrix board can't legibly hold: per-speed PBs, averages, medals, session history table, timing-trend sparkline. Flat concessions, kept minimal: the ESC system sheet (quality preset, volumes, save export/import, reset data, key reference), a first-run quality auto-detect toast, an auto-fading key-hint footer, and the optional F3 diagnostics overlay. FTUE is board-driven dot-matrix coaching synced to the first pitches ("WATCH THE LIGHT", "SPACE TO SWING", after a whiff: "SWING AS IT GETS BIG"). Hot-seat ergonomics: from round end, SPACE alone re-tokens at the same speed; initials default to last-used. Mouse parity: panels, board prompts, and sheets are clickable; the mouse never swings. Art direction per the locked setting: realistic indoor facility, dot-matrix LED typography, no neon arcade camp.
- **Inputs & outputs:** INPUTS — gameplay: SPACE keydown is the sole gameplay event, timestamped at DOM event time via performance.now(), debounced, key-repeat ignored; the swing is accepted from machine release until plate-crossing + grace window, one accepted swing per pitch with lockout; no input = recorded TAKE. Non-gameplay bindings (UI affordances, permitted by fence 1, which bans only gameplay inputs): arrows = station/board navigation and focus movement; ENTER mirrors SPACE for confirms; TAB = stats monitor; ESC = pause + system sheet; M = mute; H / B = handedness/bat accelerators that trigger the same diegetic animations as walking to the rack; F3 = diagnostics overlay. No 1–6 direct tier select (it would bypass the diegetic panel), no remapping, no gamepad, no touch. Mouse: full click parity on panels and sheets; never a swing input. Window blur auto-pauses and voids any in-flight pitch (re-fed, no penalty); the browser audio-unlock requirement is satisfied by the splash click. OUTPUTS — (a) the rendered scene (60 fps target, locked depth cues: ball-size growth, ground shadow, release light) and the locked audio set (wheel whirr, feed clunk, whoosh, crack/ping, net rustle, ambience); (b) a structured per-pitch swing record {pitch #, speed tier, signed ε ms, grade, spray, EV, LA, projected carry ft, points} that drives the LED board and appends to the swing log; (c) an end-of-round record {score, medal, 10-cell strip, new PBs, unlock events}; (d) one versioned JSON save in localStorage {schema version, settings, loadout, unlocks, medals, per-speed PBs/averages/top-5 initials tables, session aggregates (median |ε|, contact %, hard-hit %), session history, capped swing log}, written at round end and on visibilitychange/beforeunload; (e) user-initiated Export Save (.json download) and Import Save (file picker) on the ESC sheet — browser storage is evictable, and the PB career must survive a cache clear; (f) on-demand end-of-round clipboard summary ("BATTING CAGE — 70 MPH — 8/10 — BEST 312 FT — SCORE 4,120") for hot-seat bragging; (g) F3 diagnostics (fps, frame time, input-to-judgment latency ms) making the performance gate observable. Nothing ever touches the network.
- **Primary user flow(s):** Two flows split by altitude, with three named parameterizations as acceptance scenarios. FLOW 1 — "The Pitch Cycle" (the ~7–9 s atom, ×10 per token), a strict state sequence downstream sections hang exact timings on: ARMED → FEED (feed clunk, ball drops to wheels) → RELEASE (release-light cue at a fixed, identical release point) → FLIGHT (0.36–0.82 s by tier, see §5; ball-growth and ground-shadow cues converge on the plate) → INPUT (timestamped SPACE inside the per-speed window; none = TAKE) → OUTCOME (signed-ε contact model: grade + spray, or whiff) → RESOLUTION (physical flight, cloth-sim net reaction, ball settles and stays on the floor for the round) → BOARD REVEAL (~1.5 s hold: distance headline, then EV/LA/grade/ms line, running score — the climax beat of every cycle) → next FEED. FLOW 2 — "The Visit" (session macro): URL → one-click splash ("STEP INTO THE CAGE"; audio unlock + asset-init buffer) → cage fades in ≤10 s → ATTRACT (camera drift, machine idling, board cycling INSERT TOKEN / top-5s / PBs) → SETUP at the panel (speed/handedness/bat; returning player's loadout preselected so one press proceeds) → TOKEN (SPACE: clink, wheel spin-up, "PITCH 1/10") → Pitch Cycle ×10 → ROUND END (recap strip, score count-up, medal stamp, PB/unlock/initials ceremonies) → BETWEEN ROUNDS (board pages session stats and unlock progress; SPACE re-tokens same speed, arrows revisit the panel) → repeat or DEPART implicitly (autosave at round end and on tab close; next visit resumes loadout, unlocks, PBs). PARAMETERIZATIONS (acceptance scenarios with success criteria drawn from the objective function): (1) "First Contact" — casual, cold machine: defaults 40 mph/righty/wood, attract offers exactly one action, first pitch ≤60 s from load, board coaching on, full crack/net/board payoff within 30 s of play; success = completes round one unaided and starts round two. (2) "Mastery Session" — enthusiast, returning: auto-resumed loadout, ≥3 rounds sustained, session aggregates (median |ε|, trend delta) recorded and shown, unlock progress visible on the panel; success = mastery metrics persisted and legible. (3) "Pass-the-Keyboard Duel" — hot-seat: handoff to a re-tokened round in ≤2 keys and ≤10 s, initials entry on a top-5 result, attract cycles the updated table; success = no menus touched.

## How
- **Language(s) / stack:** TypeScript 5.x (strict) + vanilla Three.js (pinned minor release) + Vite; no UI framework, no react-three-fiber. Rendering baseline: WebGLRenderer on WebGL2 — the shipped, QA'd path on all evergreen desktop browsers; Three's WebGPURenderer behind an experimental `?webgpu=1` flag (same scene graph; post via three's native TSL pipeline there), promoted only when it passes the same visual QA — the honest reading of 'WebGL2 baseline, WebGPU optional.' Post-processing on the baseline via pmndrs `postprocessing`: merged-pass chain with ACES filmic tonemapping, selective bloom (LED board, release light), SMAA at the High preset. Diegetic UI rendered in-scene: LED board and stats monitor are canvas-textured surfaces (custom dot-matrix shader styling, DSEG segment font atlas); machine panel uses emissive PBR materials; only the splash and ESC system sheet are plain HTML/CSS overlays. All gameplay math — fixed-timestep ballistics (gravity + drag; + Magnus post-contact), signed-ε contact model and per-tier window tables, open-field projection-to-ground, Verlet cloth solver, scoring/medals/progression — lives in dependency-free pure-TS modules, headless-testable under Vitest in Node. Audio: Web Audio API directly (no Howler) — one AudioContext unlocked by the splash click, samples decoded to buffers, three's AudioListener/PositionalAudio panners for spatialized sources (machine whirr, plate crack/ping, net rustle), sample-accurate cue scheduling. Asset pipeline: Mixamo → Blender → glTF/GLB; meshopt for the animated batter, Draco for static cage geometry, KTX2/Basis textures (UASTC normals, ETC1S albedo), all decoder WASM vendored same-origin. Toolchain gates: tsc strict, ESLint (with an import-boundary rule enforcing core purity) + Prettier, Vitest for core, Playwright (dev-only) for the three locked acceptance scenarios, lil-gui behind a dev flag for live threshold tuning (excluded from production builds). Output is pure static files; no backend of any kind.
- **Deployment & access:** Self-contained static artifact + free static hosting at a stable public URL — the Slow Roads model and the literal fulfillment of the locked 'one URL and one key away.' `vite build` with a relative base emits one host-agnostic dist/: every model, texture, audio file, font, and decoder WASM vendored; zero third-party origins; zero runtime network I/O beyond same-origin static asset fetches at load (the locked 'nothing ever touches the network' is honored as: nothing is ever sent, and after load nothing is fetched). A minimal CI step publishes dist/ to GitHub Pages or Cloudflare Pages on tagged release; the identical artifact runs locally via `npm run preview` / `npx serve dist` (the canonical owner path; file:// documented as unsupported due to ES-module CORS) and is zip-ready for itch.io as an optional later channel. Load budget pinned to the locked gate: critical-path transfer (JS ~1.5 MB gz + cage/batter/core-audio assets) <= 15 MB Brotli, giving <=10 s cold load on a 20 Mbps line; content-hashed immutable caching makes warm loads near-instant; the splash click (which also unlocks audio) overlaps remaining decode/init Slow-Roads-style; first pitch reachable <=60 s from URL. Per-origin saves documented in-spec: hosted and localhost are separate careers, bridged by the ESC-sheet Export/Import already locked in the What. PWA install + service-worker offline is recorded as a post-v1 fast-follow — pure browser tech compatible with fence 5 — deferred to keep cache-invalidation risk out of the unattended v1 build.
- **Architecture:** Deterministic headless sim core + presentation adapters (hexagonal, single-threaded), one-way data flow: platform input adapter → core event queue → fixed-tick sim → snapshots + domain events → presentation and persistence; nothing flows back upstream. core/ (zero Three.js/DOM imports) owns the entire rules-of-the-game: the Visit and Pitch Cycle statecharts (the locked ARMED→FEED→RELEASE→FLIGHT→INPUT→OUTCOME→RESOLUTION→BOARD_REVEAL sequence), machine feed cadence, the analytic pitch schedule (per-tier release → plate-crossing times), per-speed ε-window tables and the signed-ε contact model, ballistic integrators (pitch: gravity + drag; post-contact: + Magnus; open-field projection integrated to ground for the board's number), an analytic ball-vs-net/cage/floor gameplay response (damped catch on the net, sphere-on-plane settle with sleep, simple sphere-sphere nudges among settled balls), scoring/medals/progression, and stats aggregation — advancing on a 120 Hz fixed-dt accumulator (Gaffer pattern) fed from a timestamped input queue, emitting immutable per-tick snapshots plus discrete domain events (FEED, RELEASE, SWING_JUDGED{ε, grade, spray}, CONTACT{EV, LA, carry}, NET_HIT, ROUND_END, UNLOCK). Swing judgment is analytic and sub-tick: ε = input timestamp (performance.now() at DOM event time) minus the scheduled plate-crossing time, computed against the continuous schedule — neither frame rate nor tick rate quantizes timing, making the locked frame-rate-independence provable and input-to-judgment latency F3-observable. presentation/ (Three.js scene graph, camera director with station moves, batter animation controller, LED-board/stats-monitor canvas renderers, audio mixer) subscribes to events and renders snapshot N-1→N interpolated by the accumulator alpha; the Verlet cloth net lives here as visual-only physics (fixed 60 Hz, 2 substeps, one-way coupled — the ball drives the cloth; gameplay outcomes never read cloth state), preserving core determinism. platform/ adapters: keyboard/mouse, versioned-JSON save service, clock, seedable RNG, F3 diagnostics. Because core is deterministic and seedable, ε tables, EV/LA formulas, projection math, scoring/medal thresholds, and all three locked acceptance parameterizations run as headless Vitest suites with scripted keypress timestamps. No Web Worker in v1 — one live ball plus visual cloth fits the frame budget and keeps the judgment path boundary-free; re-evaluate only if High-preset profiling shows cloth pressure.
- **Code organization:** Layered tree mirroring the architecture one-to-one (Option 4A), with 4B's actor cohesion preserved inside the presentation layer. src/main.ts (splash, audio unlock, boots App) · app/ (App.ts composition root; GameLoop.ts — rAF + 120 Hz fixed-step accumulator + interpolation alpha; Quality.ts presets + first-run auto-detect; Diagnostics.ts F3 data; events.ts typed bus) · core/ — PURE TS: pitchCycle.ts (the locked state machine), physics/{ballistics.ts, projection.ts, cloth.ts, collision.ts}, contact/{timingWindows.ts, contactModel.ts}, rules/{round.ts, scoring.ts, progression.ts, stats.ts}, constants.ts (cage dimensions, tiers, physics constants), types.ts, rng.ts · input/ (swing.ts — SPACE keydown at event time, debounce, lockout, TAKE; uiKeys.ts — arrows/ENTER/TAB/ESC/M/H/B/F3; pointer.ts — raycast click parity) · scene/ — three.js only: CageScene.ts, CameraRig.ts (OTS + station moves), Lighting.ts, PostFX.ts (ACES, bloom, SMAA), actors/ with one class per station owning meshes/clips/cues but zero rules logic (Batter.ts, Machine.ts, Ball.ts + settled pool, Net.ts cloth-mesh binding, BatRack.ts, TokenSlot.ts) · ui/ (diegetic/{LedBoard.ts + boardPages/, MachinePanel.ts, StatsMonitor.ts}, overlay/{EscSheet.ts, Splash.ts, KeyHints.ts, Toasts.ts}) · audio/ (AudioEngine.ts, cueMap.ts event→sample) · persist/ (schema.ts versioned, store.ts + visibilitychange flush, migrate.ts, exportImport.ts, clipboard.ts) · assets/ (manifest.ts, loaders.ts) · tests/ — Vitest suites over core/ (ε tables, EV/LA mapping, projection vs analytic checks, scoring/medal thresholds, state-machine transitions) plus tests/acceptance/ Playwright specs for First Contact, Mastery Session, and Pass-the-Keyboard Duel · public/assets/, index.html, vite.config.ts, tsconfig.json. Dependency rule enforced by ESLint import boundaries: core/ imports nothing outside core/; scene/, ui/, audio/ import core types, never the reverse; only persist/ touches storage APIs.
- **Data model:** Hardened single-document save (Option 5B) with a single-derivation rule absorbed from 5C. One versioned localStorage document `bc.save`: meta{schemaVersion, createdAt, updatedAt}; settings{qualityPreset, volumes, mute}; loadout{handedness, bat, lastInitials}; tiers — map keyed "40"…"90", each {unlocked, medals{bronze…platinum}, pbs{bestRoundScore, longestCarryFt, hardestEvMph}, top5:[{initials, score, dateISO}], lifetimeAverages, distanceClubs}; sessions:[{dateISO, rounds, bestScore, medianAbsEpsMs, contactPct, hardHitPct}] kept forever; swingLog FIFO-capped at 10,000 as fixed-order compact tuples [t, tierIdx, epsMs, gradeEnum, sprayEnum, evMphX10, laDeg, carryFt, points, batEnum] (under ~0.6 MB at cap); recentRounds referencing swing-log index ranges rather than copying cells. Single-derivation rule: all derived stats (averages, hard-hit %, last-50 sparkline, distance clubs) are recomputed from the round's swing records plus persisted session aggregates in one round-end transaction — never incrementally mutated in a second place — so the board can never show a number the log doesn't support. Durability: every save is double-buffered verify-then-promote (serialize → bc.save.next → re-parse to verify → promote, retaining bc.save.bak); navigator.storage.persist() requested at first save; writes only at round end and on visibilitychange/beforeunload (synchronous localStorage — never during the Pitch Cycle). Import: hand-rolled runtime schema guards (no validation dependency) → linear vN→vN+1 migration chain; saves from a newer schemaVersion refused with a board message. Export: pretty-printed .json download of the same document; a gentle ESC-sheet toast suggests exporting after a new all-time PB. Worst-case footprint stays well under the 5 MB origin quota with headroom for future fields.
- **External dependencies / integrations:** Exactly two runtime npm dependencies, lockfile-pinned: `three` (pinned minor; bundled examples/jsm modules cover GLTFLoader + DRACOLoader/KTX2Loader/meshopt decoder, AnimationMixer for the Mixamo batter, AudioListener/PositionalAudio) and `postprocessing` (pmndrs; merged-pass ACES/bloom/SMAA chain on the WebGL2 baseline — the experimental WebGPU flag path uses three's native TSL pipeline instead). Everything else first-party per the architecture: ballistics, Verlet cloth, contact model, projection, the dot-matrix LED shader with DSEG (OFL-1.1) font atlas, the save layer, mulberry32 seeded RNG. Dev-time only: typescript, vite, vitest, playwright, eslint + prettier, @gltf-transform/cli (meshopt/Draco/KTX2 cooking), vite-plugin-glsl, lil-gui behind a dev flag (stripped from production). Content-time services, never runtime: Mixamo (batter rig/animations — royalty-free embedded use, raw files not redistributed), Poly Haven/ambientCG CC0 PBR textures + HDRI, Sonniss GDC / freesound-CC0 SFX, DSEG fonts. Governance: all decoder WASM and fonts vendored same-origin; zero runtime third-party origins or services (no CDN, fonts API, analytics, or error reporting — fence 4 verifiable by auditing two lockfile entries); LICENSES.md inventories everything (MIT/Apache/OFL/CC0); JS budget <= 1.5 MB gzip. Considered-and-rejected, recorded in-spec: Rapier/Havok (the engine must never touch a scored number, and v1's contact needs — damped sphere-on-plane settle, one-way ball-to-cloth coupling — don't justify 1.5–2 MB WASM plus a determinism boundary), Babylon.js (contradicts the Three.js direction; bundles GUI/audio the diegetic design never uses), Unity/Godot web export (payloads and renderer fidelity threaten the load and 60 fps gates), Howler (raw Web Audio is lower-latency), three-mesh-bvh / troika-three-text / idb-keyval (solve problems this single-scene game doesn't have at its scale).

---

# Detailed design & engineering specification

The sections below carry the concrete numbers the Why/What/How defer to ("exact multiplier and threshold tables live in the spec's scoring section"). Values marked **TUNABLE** are config in `core/constants.ts` / `core/rules/*`, exposed in the dev-only lil-gui panel; the acceptance criteria in §14 — not these initial values — are the contract. Internally the sim uses SI units and seconds; every player-facing number is imperial (ft, mph, °) per the cage fantasy.

## 4. World & scene specification

**Coordinate system.** Origin = rear point of home plate at floor level; +Z toward the machine, +Y up, +X toward the right-field side (a right-handed batter's opposite field). Engine units are meters; this section gives feet first (design language), meters in `constants.ts`.

**Layout (top view, not to scale):**

```text
╔══════════════════════ facility wall (LED board above) ══════════════════════╗
║   ┌─────────────────────── cage netting 70 × 14 × 12 ft ──────────────────┐ ║
║   │                                                                       │ ║
║   │ backstop  ⌂plate   panel▣                 ▗█▖ machine + guard         │ ║
║   │   pad █   ││boxes  rack▯                  ▐●▌ (release 46 ft)         │ ║
║   │       █   ││                              ▝█▘ ● → → → plate           │ ║
║   │                                                                       │ ║
║   └───────────────────────────────────────────────────────────────────────┘ ║
║      bench · ball cart · stats monitor (side wall, 12 ft from plate)         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

| Element | Specification |
|---|---|
| Facility shell | ~90 × 40 × 18 ft warehouse interior visible through the netting: padded lower walls, one dark sibling cage silhouette, EXIT door, bench, rolling ball cart, safety signage ("HELMETS BEYOND THIS POINT"). Lit dim relative to the cage — the cage is the stage. |
| Cage tunnel | 70 ft long × 14 ft wide × 12 ft high, black nylon netting on a galvanized steel frame (uprights every 10 ft), door flap near the plate end. |
| Home plate | Rear point 8 ft from the back net; standard 17 in plate on a worn rubber mat; batter's boxes both sides (handedness = which box the batter occupies). |
| Backstop pad | 8 ft wide × 7 ft high padded mat 4 ft behind the plate; catches takes and whiffs. |
| Pitching machine | Two-wheel machine on a tripod with a 12-ball hopper feeder, inside a steel mesh guard. Body center 47.5 ft from the plate; **release aperture 46.0 ft from the plate, 3.5 ft high, dead on the plate centerline**. Amber/green status light on top of the guard at the batter's eye line. |
| LED distance board | 8 ft × 4.5 ft dot-matrix board on the far facility wall above the machine, bottom edge 8 ft above the floor, tilted 8° toward the plate. Logical matrix 64 × 36 cells rendered to a 1024 × 576 canvas texture with the dot-matrix shader. |
| Stats monitor | 32-inch LCD on the cage-side wall 12 ft from the plate at eye height; TAB camera target; ordinary LCD look (not dot-matrix). |
| Machine control panel | Pedestal panel 6 ft from the plate by the cage door: six tier buttons (green lit = unlocked, red = locked, unlock requirement stenciled beside each), token slot below. |
| Bat rack | Wall rack by the door holding the wood bat and the metal bat. |
| Lighting rig | Six high-bay fixtures in a line above the cage; two cast real-time shadows (key over the plate, fill over the machine), four are emissive-only with bloom. Pools of light on the turf; the facility beyond falls off to near-dark. Dust motes drift in the two key beams (GPU particles, High preset only). |
| Turf | Green nylon turf with visibly worn lanes at the plate and along the machine line; subtle roll/bounce decals where balls settle. |

**Camera (over-the-shoulder, locked).** Default play camera for a right-handed batter: 4.5 ft behind the batter, 2.0 ft outside his back (right) shoulder, 5.9 ft high, vertical FOV 50°, look-at pinned to the release aperture — the pitch flies essentially at the lens, maximizing the ball-growth depth cue. Mirrored for lefties. Idle micro-sway ≤0.5° at 0.1 Hz. On contact: 80–140 ms shake scaled by EV plus a 4° FOV kick on PERFECT. Station moves (panel, rack, board push-in, stats monitor) are 0.8 s eased dollies with a glowing focus highlight and an audio confirm.

**Depth-timing aids (locked, all diegetic):** ball size growth toward the lens, a soft contact ground shadow under the ball for its whole flight, the release light snapping green at the exact release instant, and the fixed audio cadence in §5.

## 5. Pitching machine & the pitch clock

**Tiers.** Six machine settings; release speed is the setting; drag bleeds ~8% by the plate. Flight times from the §7 model over the 46 ft release-to-plate distance (these supersede the rough "≈0.55–1.3 s" estimate in the working docs):

| Setting | Release | At plate | Flight time | Machine elevation* | Wheel whirr |
|---|---|---|---|---|---|
| 40 mph | 40.0 | 36.9 mph | **0.82 s** | +11.8° | low, lazy |
| 50 mph | 50.0 | 46.1 mph | **0.65 s** | +7.0° | ↓ |
| 60 mph | 60.0 | 55.3 mph | **0.54 s** | +4.5° | ↓ |
| 70 mph | 70.0 | 64.6 mph | **0.47 s** | +3.0° | ↓ |
| 80 mph | 80.0 | 73.8 mph | **0.41 s** | +2.0° | ↓ |
| 90 mph | 90.0 | 83.0 mph | **0.36 s** | +1.3° | high, angry |

\* Elevation is solved per tier so **every pitch crosses the plate at exactly 2.5 ft on the centerline** — "all fastballs over the plate" is deterministic (fence 2: zero location variance). The wheel-whirr loop is pitch-shifted per tier, an audible difficulty cue.

**The pitch clock.** One fixed **7.5 s cycle** at every tier, every pitch, no jitter — the learnable rhythm is the game's metronome (locked: identical telegraphing). Flight time varies inside the fixed cycle; the FEED→RELEASE interval never changes:

| Clock | State | Cues (identical every pitch) |
|---|---|---|
| T+0.0 s | FEED | Feeder arm clunk; ball drops toward the wheels; status light blinks amber |
| T+0.9 s | LOAD | Ball visibly enters the wheel throat; whirr dips under load |
| **T+1.8 s** | **RELEASE** | **Status light snaps green + "thwip"** — the timing anchor; light stays green through the flight |
| T+1.8+tf | PLATE | Ball crosses the plate at 2.5 ft (tf from the tier table); swing window per §6 |
| T+2.4+tf | BOARD | Swing card reveals 0.6 s after the plate moment; 1.5 s hold (the climax beat) |
| T+5.5–7.5 | ARMED | Net settles, idle whirr; next FEED at T+7.5 |

Token insert → 3.0 s wheel spin-up → first FEED. A 10-pitch round is ~75 s of pitches plus a ~12 s recap (plus PB/medal/unlock/initials ceremonies when earned). Window blur voids an in-flight pitch; it is re-fed on resume at no penalty (locked).

## 6. Swing, timing windows & the contact model

**Swing timing.** The batter's swing animation reaches the contact point exactly **K = 150 ms** after SPACE keydown (anchored to the animation's contact frame; matches a real swing's launch-to-contact time). Ideal press = plate-crossing − 150 ms. Signed timing error:

> **ε = t_press + 150 ms − t_plate**  (ε > 0 = LATE, ε < 0 = EARLY; judged analytically, sub-tick, from the DOM-event timestamp — never frame- or tick-quantized)

Input is accepted from RELEASE until plate + 200 ms grace; first press in the window is the swing (even a hopeless one — it animates and grades); presses before RELEASE are ignored (first-run board coaching: "WAIT FOR THE GREEN LIGHT"); one swing per pitch with lockout until the next ARMED; no press = TAKE.

**Per-tier grade windows** (|ε| in ms; beyond FOUL = MISS). **TUNABLE** — these are the launch values; §14's tuning targets are the contract:

| Setting | PERFECT | GREAT | GOOD | FOUL | Total contact window |
|---|---|---|---|---|---|
| 40 mph | ≤40 | ≤80 | ≤120 | ≤160 | ±160 ms |
| 50 mph | ≤35 | ≤70 | ≤105 | ≤145 | ±145 ms |
| 60 mph | ≤30 | ≤60 | ≤90 | ≤130 | ±130 ms |
| 70 mph | ≤25 | ≤50 | ≤75 | ≤115 | ±115 ms |
| 80 mph | ≤20 | ≤40 | ≤60 | ≤100 | ±100 ms |
| 90 mph | ≤15 | ≤30 | ≤45 | ≤85 | ±85 ms |

**Outcome mapping.** All curves are normalized to the tier's windows, so tiers differ *only* in window tightness (fence 2: difficulty scales solely through speed and windows). Let W_P/W_GR/W_GD/W_FL be the tier's thresholds and u = ε/W_GD the normalized error.

- **Contact quality q** — piecewise-linear in |ε| through the anchors: q(0) = 1.00 → q(W_P) = 0.95 → q(W_GR) = 0.82 → q(W_GD) = 0.65. Continuous; no cliffs inside the fair-contact range.
- **Exit velocity** — smash-factor model with constant bat speed v_bat = 70 mph (identical for wood and metal — bat choice is voice, not power; no hidden stats):
  > **EV = q × (1.2 × 70 + 0.2 × v_release) × jitter**, jitter ∈ [0.98, 1.02] seeded.
  > Max EV by tier (q = 1): 40→**92**, 50→**94**, 60→**96**, 70→**98**, 80→**100**, 90→**102 mph** — faster machines pay more, the risk/reward ladder.
- **Launch angle** — early swings top the ball, late swings get under it:
  > **LA = 25° + 21° × u + jitter(±3° seeded)**, clamped to [−5°, 55°]. PERFECT ≈ 22–28° (optimal carry); edge-of-GOOD early ≈ 4° topped liner/grounder; edge-of-GOOD late ≈ 46° flare/popup — at every tier.
- **Spray angle** (φ > 0 = opposite field; mirrored by handedness; EARLY = pull, LATE = oppo): fair contact maps |ε| ≤ W_GD linearly to **0→40°**; the FOUL band maps (W_GD, W_FL] to **46°→70°** (always past the 45° lines — a FOUL is visibly foul). Jitter ±2° seeded (cannot flip fair/foul across the 6° guard gap). Board spray tag: |φ| ≤ 8° CENTER, else PULL / OPPO.
- **FOUL** — contact with foul-band spray: sharp into the side netting or tipped back; board shows FOUL + the ms readout, no distance.
- **MISS / TAKE** — bat crosses empty air (whiff swish) or no swing; ball thuds into the backstop pad and stays; board shows MISS + ms (e.g. "EARLY 142 ms") or TAKE.

**Determinism.** Per-pitch jitter comes from mulberry32 seeded by (save id, round counter, pitch #): identical inputs replay identically; headless tests use fixed seeds; players get pitch-to-pitch variety with no hidden hand.

## 7. Ball flight & the projected-distance model

One flight model serves three jobs: the rendered pitch, the rendered batted ball in the cage, and the open-field projection behind the LED board's headline number.

**Equations of motion.**

> a = g + a_drag + a_magnus
> a_drag = −(ρ·Cd·A / 2m) · |v|·v
> a_magnus = (ρ·Cl·A / 2m) · |v|² · (ω̂ × v̂), Cl = min(0.35, 1.5·S), S = r·|ω| / |v|

**Constants** (single source: `core/constants.ts`; **TUNABLE** within §14 calibration tolerances):

| Constant | Value | Notes |
|---|---|---|
| Ball mass m | 0.145 kg | regulation |
| Ball radius r | 0.0366 m | regulation |
| Cross-section A | 4.20 × 10⁻³ m² | πr² |
| Air density ρ | 1.205 kg/m³ | 20 °C sea level, both cage and projected field |
| Drag coefficient Cd | 0.33 | constant by design (determinism); calibrated vs §7 table |
| Lift cap / slope | Cl ≤ 0.35, slope 1.5 | within published baseball envelopes |
| Gravity g | 9.81 m/s² | |
| Batted backspin ω | 500 + 60 × LA° rpm, min 300 | 25° fly ≈ 2,000 rpm; no sidespin in v1 |
| Pitch flight | gravity + drag only | machine elevation solves the 2.5 ft plate crossing (§5) |
| Contact point | plate centerline, 2.5 ft high | projection origin |

**Integration.** Live ball: semi-implicit Euler inside the 120 Hz core tick. Projection: same model stepped at 240 Hz from the contact state to touchdown (y = 0), run synchronously in the contact tick (≈1,000 trivial steps, sub-millisecond); **carry = horizontal distance from home plate at touchdown, floored to whole feet** — carry only, no roll, the HitTrax convention. The board number exists the instant contact resolves; the reveal is held for the §5 beat.

**In-cage resolution (visual, never scored).** Netting: one-way ball→cloth coupling — ball velocity damps to ~15% on catch, cloth absorbs the impulse (Verlet panels per §11); steel frame e = 0.45; turf e = 0.38 with rolling decay; backstop pad e = 0.10; machine guard e = 0.30; balls sleep below 0.3 m/s and remain for the round (pool of 12; cleared with a feeder-cart sweep animation between rounds).

**Calibration table** (q = 1, ε = 0, jitter off — Statcast-plausible carries; **acceptance: model lands within ±10 ft of each**, tuning Cd/Cl/spin to fit):

| Setting | EV | LA | Backspin | Target carry |
|---|---|---|---|---|
| 40 mph | 92 mph | 25° | ~2,000 rpm | **~352 ft** |
| 50 mph | 94 | 25° | ~2,000 | **~365 ft** |
| 60 mph | 96 | 25° | ~2,000 | **~378 ft** |
| 70 mph | 98 | 25° | ~2,000 | **~391 ft** |
| 80 mph | 100 | 25° | ~2,000 | **~404 ft** |
| 90 mph | 102 | 25° | ~2,000 | **~417 ft** |

## 8. Scoring, medals & progression

**Per-pitch points** (locked formula: quality multiplier × projected distance):

| Grade | Points |
|---|---|
| PERFECT | round(**1.60** × carry ft) |
| GREAT | round(**1.25** × carry ft) |
| GOOD | round(**1.00** × carry ft) |
| FOUL | **25** flat (contact consolation; no distance exists) |
| MISS / TAKE | **0** |

Round score = Σ over 10 pitches. Practical per-pitch ceiling ≈ 690 points (90 mph PERFECT); theoretical round max ≈ 6,900.

**Medal thresholds per tier** (**TUNABLE** — §14 tuning targets are the contract; Platinum additionally requires the round's **total carry** bar, the Wii Sports pattern):

| Setting | Bronze | Silver | Gold | Platinum | + Platinum carry bar |
|---|---|---|---|---|---|
| 40 mph | 1,800 | 3,200 | 4,600 | 5,800 | 2,800 ft |
| 50 mph | 1,900 | 3,400 | 4,900 | 6,100 | 2,950 ft |
| 60 mph | 2,000 | 3,600 | 5,200 | 6,400 | 3,100 ft |
| 70 mph | 2,100 | 3,800 | 5,500 | 6,800 | 3,300 ft |
| 80 mph | 2,200 | 4,000 | 5,800 | 7,100 | 3,450 ft |
| 90 mph | 2,300 | 4,200 | 6,100 | 7,500 | 3,600 ft |

**Progression.** Only 40 mph is unlocked on first run. **Bronze at tier N unlocks tier N+1**; locked panel buttons stay visible, red-lit, with the requirement stenciled ("BRONZE AT 50 UNLOCKS 60"). Medals only ever gate machine speeds — the stat locker never gates anything (locked).

**Distance clubs** (board celebrations, first entry per tier): **250 / 300 / 350 / 400 ft** clubs at every tier ("300 FT CLUB — 60 MPH"). The 400 FT CLUB is realistically reachable only at 70 mph and above — a built-in reason to climb.

## 9. LED board & diegetic surface inventory

Content and behavior are locked in the What; this is the page inventory implementation builds to. **Board** (dot-matrix, amber-on-near-black, DSEG + 5×7 matrix faces, refresh shimmer, glass glare): ATTRACT-1 "BATTING CAGE / INSERT TOKEN — PRESS SPACE", ATTRACT-2 per-speed TOP 5 carousel, ATTRACT-3 personal bests; COACH overlays (first-run: "WATCH THE LIGHT", "SPACE TO SWING", "SWING AS IT GETS BIG", "WAIT FOR THE GREEN LIGHT"); LIVE header (PITCH n/10 · SCORE); SWING CARD (carry headline → EV / LA / grade / spray / signed ms → points pop); TAKE/MISS card; RECAP (10-cell strip, score count-up, medal stamp); CEREMONY flashes (NEW PB, 300 FT CLUB, BRONZE — 60 UNLOCKED with klaxon); INITIALS entry (arrows + SPACE, defaults to last-used, skippable). **Stats monitor** (TAB): PBS, AVERAGES, MEDALS, SESSIONS table, TREND (last-50 |ε| sparkline). **Machine panel** and **token slot** per §4; **ESC sheet** (flat, locked concession): quality preset, volumes, export/import save, reset data, key reference.

## 10. Audio design

All cues are samples decoded into one splash-unlocked AudioContext; spatialized sources use three's PositionalAudio. Buses: Master / SFX / Ambience (ESC sliders + M mute). Budget ≤ 3 MB encoded; 2–3 round-robin variants on anything heard ten times a round.

| Cue | Trigger | Spatial | Notes |
|---|---|---|---|
| Wheel whirr loop | machine powered | machine | pitch-shifted per tier; dips at LOAD — the §5 metronome |
| Feed clunk | FEED | machine | identical every pitch |
| Release thwip | RELEASE | machine | synced to the green light |
| Ball whoosh | FLIGHT | ball (doppler) | subtle; louder at higher tiers |
| Wood crack ×3 | contact, wood bat | plate | PERFECT adds a low-end thump layer |
| Metal ping ×3 | contact, metal bat | plate | the authentic anodized ring |
| Whiff swish | MISS swing | plate | |
| Backstop thud | TAKE/MISS ball arrival | backstop | |
| Net rustle | NET_HIT | impact point | gain scaled by impact energy |
| Turf bounce/roll | ball settle | ball | sleep silences |
| Board tick | board page/reveal | board | dot-matrix shimmer tick |
| Score count-up | RECAP | board | rising tick loop |
| Medal stamp / klaxon | ceremony | board | unlock klaxon + light flash |
| Token clink + spin-up | token insert | machine | wheels rise to tier pitch over 3 s |
| Panel click | any panel/board confirm | panel | the locked audio-confirm answer to the HRD-VR pitfall |
| Room tone | always | ambient bed | HVAC hum, distant facility; no music anywhere (premium realism) |

## 11. Visual direction & quality presets

**Palette & materials.** Deep neutral facility (concrete, galvanized steel, black nylon) punctuated by turf green, machine navy, and the amber LED glow — the board is the warmest thing in frame by design. PBR sets (KTX2: UASTC normals, ETC1S albedo) for turf, netting (alpha-tested weave + cloth normal detail), steel, pads, painted concrete. ACES filmic tonemapping; selective bloom on the board, status light, and fixtures; SMAA at High.

**Batter.** Generic athlete (no licensed likeness), helmet, ~15–25k triangles, Mixamo-pipeline rig with four states: relaxed idle (bat resting), load/waggle anticipation loop, the swing (contact frame anchored at K = 150 ms), and reaction/recoil. Handedness mirrors the rig; the wood/metal bat swaps the prop mesh and the contact voice only.

**Netting & cloth.** Verlet panels (60 Hz, 2 substeps, one-way coupling, visual-only — locked): far-end panel behind the machine wall, the first 20 ft of both side panels, a ceiling strip over the plate-to-machine lane, and the section nearest likely impacts; remaining netting is static mesh with a subtle vertex-sway shader. Cloth nodes pinned to the frame; ball impulse spreads over the 3×3 node neighborhood.

**Quality presets** (first run auto-detects via a ~120-frame hidden probe, then ESC-adjustable):

| Feature | High | Medium | Low |
|---|---|---|---|
| Render scale | 100% | 100% | 85% |
| Shadows | 2 casters, 2048 key + 1024 fill, soft | 1 caster, 1024 | contact blob only |
| Post | ACES + selective bloom + SMAA | ACES + bloom (half-res) | ACES only |
| Cloth | 4 panels @ 60 Hz ×2 | 2 panels @ 30 Hz | sway shader only |
| Dust motes | on | off | off |
| Settled-ball shadows | on | on | off |

## 12. Performance budgets

| Budget | Target |
|---|---|
| Frame rate | 60 fps sustained at High, 1080p, mid desktop GPU (GTX 1660 / RX 580 / Apple M1 class); 60 fps at Medium on recent iGPUs (Iris Xe class) |
| Main-thread JS | ≤ 6 ms/frame at High during the pitch cycle; zero allocations in the hot loop (pooled balls, vectors, events) — no GC pause > 2 ms mid-cycle |
| Sim | 120 Hz fixed tick; input→judgment latency < 2 ms (analytic; F3-observable) |
| Scene | < 120 draw calls, < 500k visible triangles, < 500 MB GPU memory |
| Load | critical path ≤ 15 MB Brotli (JS ≤ 1.5 MB gz); cold load → interactive ≤ 10 s on 20 Mbps; URL → first pitch ≤ 60 s |
| Save | < 1 MB typical, < 2 MB worst case (10k-swing cap) |

## 13. Build milestones

- **M0 — Greybox loop (the game is fun ugly).** Box cage, sphere ball, capsule batter; analytic pitch schedule for all six tiers; SPACE judgment with ε/grades on a debug HUD; full contact model + projection printing carry. *Exit:* a 10-pitch round is playable at every tier; Vitest suites for windows, EV/LA mapping, projection vs the §7 calibration table, and the pitch-cycle state machine pass headless; F3 shows input→judgment < 2 ms.
- **M1 — The cage (it looks like the fantasy).** Full scene per §4, lighting, PBR materials, OTS camera + station moves, machine model with §5 cadence cues, batter rig + animation states, LED board with live/swing-card pages. *Exit:* 60 fps at High on target hardware; release cues frame-identical across pitches; the 30-second signature-beats gate passes (lighting, board, crack/ping all land).
- **M2 — Physics showpieces (it feels real).** Verlet netting + ball coupling, backstop/turf/frame responses, settled-ball accumulation and between-round sweep, full §10 audio set, board reveal beat. *Exit:* net reaction reads believably across the EV range; no frame spike > 10% on impact frames; whoosh/crack/rustle land in correct spatial positions.
- **M3 — The game (it's a product).** Token rounds, scoring, medals, unlocks, recap + ceremonies + initials, attract mode, stat locker + monitor, full persistence (versioned save, double-buffered writes, export/import), ESC sheet, quality presets + auto-detect, FTUE coaching. *Exit:* the three Playwright acceptance scenarios (First Contact, Mastery Session, Pass-the-Keyboard Duel) pass; save survives reload, simulated eviction (restore via import), and a hostile-import fuzz set.
- **M4 — Tune & ship (it's good).** Playtest-driven tuning of windows/multipliers/medals via lil-gui; perf pass to §12 budgets; clipboard summary; LICENSES.md; CI publish of `dist/` to static hosting. *Exit:* every §14 criterion checked; load budgets met from the public URL.

## 14. Acceptance criteria

**Determinism & timing.** (1) Identical seeds + scripted keypress timestamps reproduce identical rounds bit-for-bit, headless. (2) Judgment uses DOM-event timestamps: simulated 30 fps and 144 fps runs grade identical inputs identically. (3) ε reported on the board equals the test oracle within 1 ms. (4) The pitch clock is frame-identical: RELEASE at T+1.8 s ± 1 tick every pitch. (5) Pre-release presses never consume the swing.

**Model & scoring.** (6) Per-tier plate crossing at 2.5 ft ± 0.5 in. (7) Projection matches the §7 calibration table within ±10 ft. (8) Grade windows, q anchors, LA/spray maps, and point multipliers match §6/§8 tables exactly (table-driven tests). (9) FOUL spray is always past the 45° lines; fair contact never is. (10) Medal/unlock logic: Bronze at N unlocks N+1, Platinum requires both bars; stat locker never gates.

**Scenarios (Playwright).** (11) First Contact: cold load → completes round one unaided → starts round two; first pitch ≤ 60 s; coaching pages shown; signature beats within 30 s. (12) Mastery Session: loadout auto-resumed; ≥ 3 rounds; session aggregates (median |ε|, contact %, hard-hit %) persisted and rendered on the monitor. (13) Duel: round-end → re-tokened round in ≤ 2 keys / ≤ 10 s; initials entry on a top-5 score; attract carousel shows the update.

**Presentation gates.** (14) 60 fps sustained at High on target hardware (automated F3 sampling over 3 rounds; 1% low ≥ 50 fps). (15) Cold load ≤ 10 s / first pitch ≤ 60 s from the public URL on a throttled 20 Mbps profile. (16) No GC pause > 2 ms during the pitch cycle. (17) Audio confirms on every panel/board interaction.

**Durability & privacy.** (18) Save round-trips export→wipe→import losslessly; corrupt and newer-schema imports are refused with a board message, prior save intact. (19) Kill the tab mid-write: next boot loads `bc.save` or falls back to `.bak` — never a fresh career. (20) DevTools network panel shows zero requests after load (and zero third-party origins ever); the lockfile carries exactly two runtime dependencies. (21) LICENSES.md covers every shipped asset (MIT/Apache/OFL/CC0; Mixamo embedded-use).

**Tuning targets (playtest, the contract behind every TUNABLE).** (22) A median new player earns Bronze at 40 in their first session and reaches 90 mph within 2–4 cumulative hours. (23) A first session naturally sustains ≥ 3 rounds; ≥ 50% of completed playtest rounds are followed by another token. (24) Median |ε| at a fixed tier improves ≥ 30% between a player's first and fifth session.

## 15. Out of scope & future ideas

**Permanently fenced (expanding the Why's five fences).** No second gameplay input ever (no aiming, meters, swing types, mouse/motion swings, no key remapping, no gamepad, no touch). No pitch variety: no breaking balls, no location variance, no left-handed machine, no wind/altitude modifiers. Nothing leaves the cage: no stadiums, no fly-out or drone cameras, no ball-POV. No network: no accounts, cloud sync, online leaderboards, multiplayer, telemetry, analytics, error reporting, ads, IAP, or licensed MLB content. No mobile, no VR, no native/Steam build in v1. No XP, currencies, cosmetics economy, or achievements beyond medals and distance clubs. English only; imperial units only (the cage fantasy speaks ft and mph). Single camera presentation (OTS + station moves) — no camera options menu. Cut features are fully absent, never stubbed.

**Deferred, not rejected (the user's trio first).** Free-practice endless mode; streak challenge; slow-motion replays on barreled hits. Then: PWA install + offline service worker (post-v1 fast-follow); WebGPU promotion to default once it passes visual QA; itch.io channel; a seeded "daily token" round; ghost-rival pacing against your PB round; left-handed *pitching* machine variants; sidespin/hook visuals; photo mode. Each future idea must re-clear the five fences when proposed.
