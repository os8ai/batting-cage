# M3 Execution Plan — The Game ("it's a product")

Source of truth: `SPEC.md` §13 (M3 definition), with §8 (scoring/medals/
progression), §9 (board & monitor page inventory), §What 5–11 (rounds, recap,
stat locker, attract, FTUE), §UX (stations, ESC sheet, hot-seat), §Inputs &
outputs (save document, export/import), §Data model (the hardened save), §10
(deferred ceremony cues), §11 (quality presets) supplying the numbers. Builds
on the M2 codebase (tag `m2` + the aisle-lighting playtest fix); M2's 148
tests stay green throughout — with one deliberate, test-covered exception:
M3 *extends* `SwingRecord` with the §8 `points` field and `ROUND_END` with
the round summary (score/medal/unlocks), updating affected suites in the
same commit (the M2 P0 pattern).

## 1. M3 objective & exit contract

Turn the physics toy into the product: a token starts a scored 10-pitch
round, medals gate the speed ladder, the board celebrates and remembers, the
career persists across visits and survives disasters, and a first-time
player is coached to their first crack of the bat without a single tutorial
screen.

**Exit criteria (verbatim from §13, expanded into checkable items):**

| # | Exit check | Verified by |
|---|---|---|
| E1 | "First Contact" passes: cold load → completes round one unaided → starts round two; first pitch ≤ 60 s; coaching pages shown; signature beats within 30 s (§14.11) | Playwright scenario, headless shell |
| E2 | "Mastery Session" passes: loadout auto-resumed; ≥ 3 rounds; session aggregates (median \|ε\|, contact %, hard-hit %) persisted and rendered on the monitor (§14.12) | Playwright scenario |
| E3 | "Pass-the-Keyboard Duel" passes: round-end → re-tokened round in ≤ 2 keys / ≤ 10 s; initials entry on a top-5 score; attract carousel shows the update (§14.13) | Playwright scenario |
| E4 | Save survives reload, simulated eviction (restore via import), and a hostile-import fuzz set; corrupt/newer-schema imports refused with a board message, prior save intact (§14.18) | Headless persist suites + Playwright reload/import steps |
| E5 | Kill the tab mid-write: next boot loads `bc.save` or falls back to `.bak` — never a fresh career (§14.19) | Headless double-buffer suite (simulated torn writes) |
| E6 | Medal/unlock logic: Bronze at N unlocks N+1; Platinum requires both bars; the stat locker never gates (§14.10) | Table-driven core suites |
| E7 | Point multipliers match §8 exactly; round score = Σ quality × carry; FOUL 25 flat (§14.8) | Table-driven core suites |
| E8 | Quality presets per §11 (High/Medium/Low feature table) + first-run auto-detect; switching live from the ESC sheet | Manual + preset unit tests on the decision logic |
| E9 | Audio confirms on every panel/board interaction incl. new stations (§14.17); ceremony cues (count-up, medal stamp, unlock klaxon) land from the deferred-cue ledger | Cue inventory test extension + listening pass |
| E10 | All M0–M2 suites green after the event-payload extension; core purity boundary holds; lockfile still exactly two runtime deps (§14.20) | `npm test`, dep audit |

## 2. Scope fences for M3

**In:** `core/rules/{scoring,progression,stats}.ts` (+ `points` on
`SwingRecord`, round summary on `ROUND_END`, new ceremony domain events),
save-id-seeded RNG (retires the `Date.now()` M0-DEBUG seed), the entire
`persist/` layer (versioned schema, double-buffered verify-then-promote
store, vN→vN+1 migration chain, export/import with hand-rolled runtime
guards), board pages (RECAP with 10-cell strip + score count-up, CEREMONY
flashes, INITIALS entry, ATTRACT-1/2/3, COACH overlays), stats-monitor pages
(PBS / AVERAGES / MEDALS / SESSIONS / TREND sparkline), token-slot station
(SPACE inserts — retires `R`), machine-panel locked states (red/green +
stenciled "BRONZE AT 50 UNLOCKS 60"), attract mode (camera drift + board
carousel), FTUE coaching, ESC sheet (quality preset, Master/SFX/Ambience
volume buses, export/import/reset, key reference) + pause with audio
suspend, quality presets + ~120-frame auto-detect (Net/PostFX/Lighting
switches per §11), key-hint footer + toasts, ceremony audio (score count-up
loop, medal stamp, unlock klaxon — the M2 deferred-cue ledger), hidden-HUD
retirement, `tests/acceptance/` Playwright scenarios.

**Out (deferred to M4):** clipboard summary (§13 lists it under M4),
lil-gui tuning panel, threshold tuning against §14.22–.24, perf pass to
final §12 budgets, LICENSES.md finalization, CI publish. Out (post-v1):
PWA/offline, WebGPU.

**Kept as-is:** the M2 physics/audio surfaces; the smoke/perf/net-shots dev
harnesses (Playwright scenarios join them, not replace them).

## 3. Design notes (decisions the build hangs on)

1. **Rules stay in core; storage stays in persist.** `scoring.ts` (pure:
   record → points; round → score), `progression.ts` (pure: medal eval needs
   {score, totalCarryFt} + thresholds; unlock = bronze at N), `stats.ts`
   (pure fold: swing records → {medianAbsEps, contactPct, hardHitPct,
   last-50 trend}). The sim calls scoring/progression itself so points ride
   `SWING_JUDGED` and the summary rides `ROUND_END {score, medal, newUnlocks,
   clubs, isPB}` — but the sim takes the *prior* career snapshot (unlocks,
   PBs) as constructor/`insertToken` input; it never reads storage
   (§Architecture: one-way flow; headless tests stay storage-free).
2. **New domain events** (presentation + persist subscribe): `SCORE_TICK` is
   NOT an event — the count-up is a board animation over the final score.
   Events added: `MEDAL_EARNED {medal}`, `TIER_UNLOCKED {tier}`,
   `NEW_PB {kind}`, `CLUB_ENTERED {ft}`, all emitted between `ROUND_END` and
   the recap hold. Cue map rows: medal stamp, unlock klaxon; count-up loop is
   driven by the recap page's reveal envelope (still event-anchored: starts
   at `ROUND_END`+recap offset).
3. **The save transaction (single-derivation rule, §Data model).** One
   subscriber (`persist/recorder.ts`) buffers the round's `SwingRecord`s and,
   on `ROUND_END`, recomputes *all* derived stats from records + persisted
   aggregates in one transaction, then writes via the double-buffered store:
   serialize → `bc.save.next` → re-parse verify → promote to `bc.save`
   (retain `bc.save.bak`). `navigator.storage.persist()` requested at first
   save. Flush also on `visibilitychange`/`beforeunload`. Nothing writes
   mid-cycle (§Data model).
4. **Save-id seed.** New career mints `saveId` (32-bit from crypto). Sim
   seed = `saveId`; pitch RNG already folds (seed, roundCounter, pitch#)
   — replays differ between careers, repeat within one (§6 determinism).
   Headless suites keep fixed seeds; determinism tests unchanged.
5. **Input modes.** `uiKeys` gains a mode stack owned by main: PLAY →
   INITIALS (arrows cycle A–Z, SPACE confirms, defaults to last-used,
   skippable) → ESC sheet (DOM focus, arrows/enter on HTML controls). The
   swing path is untouched — SPACE only reaches `queueSwing` in PLAY mode
   with a round live (fence 1 stays clean).
6. **Attract mode** = no round + no save-pending input: CameraRig gains an
   `ATTRACT` state (slow dolly drift between two poses, 0.05 Hz), board
   cycles ATTRACT-1 (INSERT TOKEN) / ATTRACT-2 (per-speed TOP-5 carousel) /
   ATTRACT-3 (PBs) every ~6 s. Any key snaps to PLAY + the relevant station.
   First-run (no save): ATTRACT-1 only — the §What "exactly one action".
7. **Quality presets (§11 table).** A `Quality` module owns the setting:
   High = 2 shadow casters/2048+1024, full post, 5 cloth panels @60 Hz×2,
   100% scale; Medium = 1 caster/1024, half-res bloom, 2 panels (far +
   ceiling) @30 Hz, settled shadows on; Low = blob shadows, ACES only, sway
   shader only, 85% scale. Net/PostFX/Lighting expose `applyPreset` —
   rebuild-free where possible (visibility/uniform switches), full rebuild
   acceptable on ESC change (it's a menu moment). Auto-detect: hidden
   ~120-frame probe at High on first run; < 55 fps median → Medium; < 40 →
   Low; result toast + persisted in settings.
8. **FTUE coaching** is board-page logic keyed off career state (no save =
   coach on): "WATCH THE LIGHT" pre-RELEASE pitch 1, "SPACE TO SWING" during
   flight, "SWING AS IT GETS BIG" after a whiff, "WAIT FOR THE GREEN LIGHT"
   on a PRE_RELEASE ignored press. Pure page machine — headless-testable.
9. **Playwright scenarios run on the cached headless shell** (same binary as
   smoke.mjs; SwiftShader is fine — scenarios assert flow/state/persistence,
   not frame rate). Real keyboard input throughout; the `?dev=1` hook is
   read-only in scenarios (phase polling, save inspection). First Contact ≈
   3.5 min real-time (two full rounds), Mastery ≈ 5 min — acceptable as a
   separate `npm run test:acceptance` lane, not part of `npm test`.
10. **Board count-up + ceremonies budget:** count-up repaints the canvas at
    ~12 Hz for ~2 s (24 repaints — fine; the M1 budget concern was per-frame
    repaints). Ceremony flashes reuse the M2 brightness-pop envelope.

## 4. Work breakdown

### Phase 0 — Core rules: scoring, progression, stats (+ event shapes) (~1.5 days)

1. `SwingRecord.points` (§8: PERFECT 1.60×carry, GREAT 1.25×, GOOD 1.00×,
   FOUL 25, MISS/TAKE 0, rounded); `rules/scoring.ts` pure functions.
2. `rules/progression.ts`: medal eval (score thresholds + Platinum carry
   bar), `unlocksAfter(round)`, distance clubs (§8: 250/300/350/400 per
   tier). `rules/stats.ts`: aggregate fold (median |ε|, contact %, hard-hit
   % ≥ 95 EV, last-50 |ε| trend).
3. Sim: career snapshot in (`{unlockedTiers, pbs, clubs}` via `insertToken`
   context or setter), `selectTier` refuses locked tiers, ROUND_END payload
   + MEDAL_EARNED/TIER_UNLOCKED/NEW_PB/CLUB_ENTERED events; save-id seed
   plumbing (constructor unchanged; main passes saveId).
4. Update affected suites (round/determinism/cueSchedule re-baseline); new
   table-driven suites: every §8 multiplier row, medal boundary ±1 point,
   Platinum needs BOTH bars, bronze-unlock chain, stat folds vs hand-computed
   fixtures, locked-tier refusal.

**Done when:** a headless round returns the §8 score and medal bit-deterministically; E6/E7 suites green.

### Phase 1 — Persistence: schema, store, migrate, export/import (~1.5 days)

1. `persist/schema.ts`: the §Data-model document (meta/settings/loadout/
   tiers/sessions/swingLog tuples/recentRounds), `schemaVersion: 1`,
   hand-rolled runtime guards (`isSave(unknown)`).
2. `persist/store.ts`: double-buffered verify-then-promote writes
   (`bc.save.next` → verify → `bc.save`, retain `.bak`), boot-time recovery
   ladder (save → next-if-verified → bak → fresh), `navigator.storage.persist()`
   once, flush hooks. Storage injected (in-memory fake for tests).
3. `persist/recorder.ts`: the round-end transaction (design note 3) — swing
   log FIFO cap 10k, session upsert (dateISO), tier PBs/top-5/averages,
   single-derivation recompute.
4. `persist/migrate.ts`: v0(absent)→v1 init; chain scaffold + newer-version
   refusal. `persist/exportImport.ts`: pretty JSON download / file-picker
   import → guards → migrate → promote; refusal reasons surfaced for the
   board message.
5. Suites: round-trip export→wipe→import lossless; torn-write recovery (kill
   between next/promote at every step); hostile-import fuzz set (truncated
   JSON, wrong types, huge arrays, newer schemaVersion, prototype-pollution
   keys) — all refused, prior save intact; FIFO cap; single-derivation
   (recorder twice-applied = idempotent on the same round id).

**Done when:** E4/E5 pass headlessly against the fake storage; zero writes during a simulated pitch cycle.

### Phase 2 — Board pages: recap, ceremonies, initials, attract, coach (~2 days)

1. `boardPages/` page machine extensions (pure, headless-tested like M1's):
   RECAP (10-cell grade+distance strip, score count-up envelope, medal
   stamp), CEREMONY interleave (NEW PB / club / "BRONZE — 60 UNLOCKED"
   klaxon flash), INITIALS (3-slot A–Z, defaults last-used, skippable),
   ATTRACT-1/2/3 carousel, COACH overlays (design note 8).
2. Canvas renderers for the new pages in `LedBoard` (dot-matrix faces,
   count-up at ~12 Hz repaint, ceremony reuses the M2 pop envelope).
3. Cue map: `scoreCountUp` (loop start/stop with the envelope), `medalStamp`,
   `unlockKlaxon` + synth voices; cue inventory test updated (deferred
   ledger emptied except ESC-bus polish).
4. Page-machine suites: recap sequence ordering (RECAP → ceremonies →
   INITIALS when top-5 → ATTRACT), initials editing transitions, coach
   triggers (incl. "WAIT FOR THE GREEN LIGHT" on PRESS_IGNORED), attract
   cycling.

**Done when:** a finished round plays the full §9 board ceremony from domain events alone; E9 cues land.

### Phase 3 — Stations & flow: token slot, locked panel, monitor, attract (~1.5 days)

1. Token-slot station: SPACE at idle inserts (clink + spin-up already wired);
   `R` retired; hot-seat path = SPACE at round end re-tokens same tier (≤ 2
   keys, §14.13).
2. Machine panel: locked tiers red with stenciled requirement, green when
   unlocked, refusal click for locked picks; unlock event relights live.
3. Stats monitor pages (PBS/AVERAGES/MEDALS/SESSIONS/TREND) rendered from
   the save snapshot; TAB cycle through pages while focused.
4. Attract mode (design note 6): CameraRig drift state, any-key wake,
   first-run single-action gating.
5. DebugHud fully retired (F3 keeps Diagnostics only).

**Done when:** the §Flow-2 visit — attract → panel → token → rounds → recap → re-token — runs end-to-end diegetically with persistence.

### Phase 4 — ESC sheet, volumes, quality presets, pause polish (~1.5 days)

1. `ui/overlay/EscSheet.ts` (the flat concession): quality preset selector,
   Master/SFX/Ambience sliders (AudioEngine gains three GainNode buses —
   the M2 ledger's last row), export/import/reset-data (two-step confirm),
   key reference. ESC toggles + pauses (sim pause + AudioContext suspend —
   the M2-deferred blur polish; blur keeps voiding the pitch).
2. `app/Quality.ts`: preset definitions, apply paths into Lighting/PostFX/
   Net/renderer scale (design note 7), first-run auto-detect probe + toast,
   persisted in settings.
3. `ui/overlay/{KeyHints,Toasts}.ts`: auto-fading key footer, quality toast.
4. Unit tests on the auto-detect decision and preset tables; volume buses in
   the cue inventory test.

**Done when:** E8 holds; the ESC sheet round-trips every setting through the save.

### Phase 5 — FTUE + first-run flow (~0.5 day)

1. Coach-page triggers wired to career state (no completed rounds); boots at
   40 mph righty/wood; returning players resume loadout preselected.
2. First-run attract shows exactly one action (INSERT TOKEN).

**Done when:** a wiped profile plays First Contact by hand exactly as §Flow scenario 1 describes.

### Phase 6 — Acceptance scenarios, durability drills & exit review (~1.5 days)

1. `tests/acceptance/` (playwright-core, cached shell, `npm run
   test:acceptance`): First Contact (E1), Mastery Session (E2 — three rounds
   scripted via timed real keypresses, aggregates asserted on the monitor
   canvas via the dev hook), Duel (E3 — re-token ≤ 2 keys, initials entry,
   attract carousel update). Reload + eviction-import steps cover the
   browser half of E4.
2. Full gate run (`test`, `typecheck`, `lint`, `build`, smoke, perf) — perf
   confirms the board count-up and monitor repaints cost no frames.
3. `M3-NOTES.md` (exit checklist, measured numbers, M0-DEBUG ledger close-out,
   M4 handoff list), memory update, commit, tag `m3`.

## 5. Test inventory (additions/updates)

| Suite | Covers | Spec |
|---|---|---|
| `scoring.test.ts` (new) | §8 multipliers exact, FOUL flat, round Σ, points on records | §8, §14.8 |
| `progression.test.ts` (new) | Medal boundaries ±1, Platinum dual bar, bronze→unlock chain, clubs, locker-never-gates | §8, §14.10 |
| `stats.test.ts` (new) | Aggregate folds vs fixtures, last-50 trend, hard-hit ≥95 EV | §What 8 |
| `persist.test.ts` (new) | Schema guards, double-buffer torn-write ladder, FIFO cap, round-trip, fuzz refusals | §Data model, §14.18–.19 |
| `boardPages.test.ts` (extended) | Recap/ceremony/initials/attract/coach page machine | §9 |
| `quality.test.ts` (new) | Preset tables, auto-detect thresholds | §11 |
| `cueSchedule.test.ts` (extended) | Ceremony cues, bus inventory, count-up envelope anchoring | §10, E9 |
| `determinism.test.ts` (re-baselined) | Bit-identical rounds with points + summary payloads | §14.1–.3 |
| `tests/acceptance/*` (new lane) | First Contact, Mastery Session, Duel, reload/import durability | §14.11–.13, .18 |
| Remaining M0–M2 suites | Green throughout | — |

## 6. Key risks & mitigations

1. **Event-shape ripple** (points on SwingRecord touches many suites): Phase
   0 is one atomic commit with all suites updated — the proven M2 P0 pattern.
2. **Persistence corruption bugs are silent until they eat a career:** the
   store is built against an injected storage fake with a torn-write
   simulator BEFORE any browser wiring (prove the ladder headlessly, then
   bind localStorage). Export-after-PB toast nudges off-device backup.
3. **Playwright scenarios are slow/flaky under SwiftShader:** scenarios poll
   sim phase via the dev hook (the M1 smoke lesson: never precompute wall
   times — `loop.simTimeOf` only), get generous timeouts, and live in their
   own lane so `npm test` stays at ~3 s.
4. **Initials/ESC input modes leaking into the swing path:** mode stack
   gates uiKeys only; `attachSwingInput` stays untouched and is covered by
   an explicit test (SPACE during INITIALS never reaches `queueSwing`).
5. **Preset switching breaking the M2 cloth invariants:** Net's preset API
   only changes panel count/rate/visibility — solver code untouched; cloth
   suite runs per-preset configs headlessly.
6. **Scope creep toward M4:** tuning values stay frozen (§6/§8 launch
   tables); anything that is "make the numbers feel right" is M4's job
   behind §14.22–.24.

## 7. Sequencing & estimate

```
P0 core rules ── P1 persistence ──┬── P2 board pages ──┬── P5 FTUE ── P6 acceptance + exit
                                  └── P3 stations/flow ─┤
                                  └── P4 ESC/quality ───┘
(P2/P3/P4 parallelizable after P0+P1; P2 before P5; everything before P6)
```

Total ≈ **9–10 working days** single-developer, tests written alongside each
phase. P0+P1 are the foundation (pure rules + storage proven headlessly);
the presentation phases hang pages and stations off events that already
carry every number they need — the same "prove the math before the mesh"
discipline that carried M0→M2.
