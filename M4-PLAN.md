# M4 Execution Plan — Tune & Ship ("it's good")

Source of truth: `SPEC.md` §13 (M4 definition), with §14 supplying the
acceptance contract this milestone closes out in full (every criterion .1–.24
checked and recorded), §12 the final performance/load budgets, §8/§6 the
TUNABLE tables, §How/§Deployment the packaging and publish pipeline, and
§Inputs-outputs (f) the clipboard summary. Builds on the M3 codebase (tag
`m3`, 251 headless tests + the 4-scenario acceptance lane); all suites stay
green throughout — with the one sanctioned exception: tuning passes that
change TUNABLE table values re-baseline the table-driven suites in the same
commit (the M2/M3 P0 pattern). The §14 criteria — never the launch values —
are the contract (SPEC §Detailed-design preamble).

## 1. M4 objective & exit contract

Turn the product into the shippable game: thresholds tuned so the §14.22–.24
mastery curve holds, every §12 budget formally gated, the last §What output
(clipboard summary) landed, licensing finalized, and a host-agnostic `dist/`
publishing from CI — one URL and one key away.

**Exit criteria (verbatim from §13, expanded into checkable items):**

| # | Exit check | Verified by |
|---|---|---|
| E1 | Every §14 criterion (.1–.24) checked, with evidence recorded | The §14 verification matrix in `M4-NOTES.md` — each row names its suite/harness/playtest and the measured number |
| E2 | Windows/multipliers/medal thresholds tuned against §14.22–.24 | Tuning-oracle proxies green (player-model sweeps) + owner playtest sessions recorded; tables re-baselined in suites |
| E3 | §12 perf budgets formally gated: 60 fps sustained at High, 1% low ≥ 50, main-thread JS ≤ 6 ms during the cycle, no GC pause > 2 ms, < 120 draw calls, < 500k tris | `scripts/perf.mjs` extended with hard gates (exits non-zero on breach) |
| E4 | §12 load budgets met: critical path ≤ 15 MB Brotli (JS ≤ 1.5 MB gz), cold load → interactive ≤ 10 s on a throttled 20 Mbps profile, URL → first pitch ≤ 60 s | New `scripts/load-budget.mjs` (size report) + throttled-load acceptance step (CDP network emulation) |
| E5 | Clipboard summary on demand at round end ("BATTING CAGE — 70 MPH — 8/10 — BEST 312 FT — SCORE 4,120") | Pure-formatter suite + ESC-sheet button + manual copy check |
| E6 | §14.20 network audit: zero requests after load, zero third-party origins ever, exactly two runtime deps | New acceptance step recording every request; lockfile audit |
| E7 | LICENSES.md finalized, covering every shipped asset (§14.21) | Inventory review — all assets remain procedural/first-party |
| E8 | CI publishes `dist/` on tagged release; identical artifact runs via `npm run preview` | Committed GitHub Actions workflow + local preview parity check; the actual public-URL verification is the owner publish step |
| E9 | All M0–M3 suites + acceptance lane green at exit | `npm test`, `npm run test:acceptance`, typecheck, lint, build |

## 2. Scope fences for M4

**In:** runtime-mutable TUNABLE tables + dev-only lil-gui tuning panel
(`?tune=1`, dev builds only — never in `dist/`), a headless player-model
"tuning oracle" harness, tuning passes over §6 windows / §8 multipliers /
medal+carry thresholds, perf-gate hardening (formal thresholds in
`perf.mjs` incl. JS main-thread sampling and the draw-call budget),
settled-pool instancing (the <120 draw-call headroom), save-size budget test,
`persist/clipboard.ts` + ESC-sheet copy button, LICENSES.md finalization,
load-budget report + throttled-load harness, network-zero audit,
`.github/workflows/publish.yml`, README run/deploy docs, ATTRACT-2 layout
polish (M3-NOTES handoff), `M4-NOTES.md` + tags `m4` and `v1.0`.

**Out (post-v1, per §15):** PWA/offline service worker, WebGPU promotion,
itch.io channel (zip target documented, not shipped), daily token / ghost
rival / endless / streak / replays, sampled-SFX or KTX2-texture cooks.

**Owner steps (explicit, like M1's):** (a) playtest sessions for §14.22–.24
sign-off; (b) creating the GitHub repo / Pages site and pushing the tag (CI
is committed and inert until a remote exists); (c) post-publish re-run of the
load/network checks against the real public URL; (d) the long-standing
content swaps — Mixamo rig, DSEG atlas — remain optional content changes, not
v1 blockers (the procedural set is the shipped design, M1-NOTES).

**Kept as-is:** the M3 rules/persist/board surfaces; the smoke/perf/net-shots/
acceptance harnesses (M4 extends, never replaces).

## 3. Design notes (decisions the build hangs on)

1. **TUNABLE mutability without breaking purity.** `core/constants.ts`'s
   `WINDOWS_MS`, `POINT_MULTIPLIERS`, `FOUL_POINTS`, `MEDAL_THRESHOLDS` (and
   only these — §13 names windows/multipliers/medals) move behind a
   `core/tuning.ts` module: the exported tables stay the single source the
   sim/rules read at use-time, plus pure `applyTuning(partial)` /
   `resetTuning()` mutators and a `serializeTuning()` for copy-out. Headless
   suites never mutate (launch values stay proven); determinism is untouched
   (tables are read per-judgment, not captured). The lil-gui panel is loaded
   via `if (import.meta.env.DEV && ?tune=1) await import('lil-gui')` — Vite
   dead-code-eliminates it from `dist/` (asserted by the budget script
   grepping the bundle); lil-gui lands in devDependencies, so the §14.20
   two-runtime-deps audit is unaffected. Panel edits persist to
   localStorage (`bc.tune`, dev-only) so a tuning session survives reloads,
   and print a paste-ready constants diff to the console.
2. **The tuning oracle (model before playtest).** A headless harness drives
   the real sim with a synthetic player: press error ε ~ N(bias, σ), σ as the
   skill knob (novice ≈ 55–70 ms, practiced ≈ 30–40, elite ≈ 15–20 — the
   §6 window ladder's own scale), small per-round σ improvement to model
   practice. Sweeps (tier × σ × 200 seeded rounds) produce medal-probability
   tables. Tuning targets as proxies: P(bronze at 40 | novice σ) reaches ~50%
   within ~3 rounds (§14.22's "first session"); the σ needed for bronze rises
   smoothly tier to tier (the 2–4 h ladder has no cliff); platinum stays
   elite-only (σ ≲ 20 + the carry bar). The oracle focuses tuning and guards
   regressions; the *contract* remains owner playtests — model thresholds are
   recorded in M4-NOTES alongside observed session data.
3. **What playtests can and cannot sign off pre-ship.** §14.22's "median new
   player" and §14.24's session-1→5 improvement are population/multi-session
   claims. M4 sign-off = oracle proxies green + at least two real first
   sessions observed (owner + one drop-in casual if available) hitting the
   session-1 behaviors (bronze at 40, ≥ 3 rounds, re-token rate). The save's
   session history is the built-in longitudinal instrument — .22/.24
   long-horizon tracking continues post-ship from exported saves.
4. **Draw-call headroom: instance the settled pool.** 12 settled-ball meshes
   = ~11 redundant draw calls (main + shadow passes), measured 122 in-round
   vs the §12 <120 budget. One `InstancedMesh(12)` with per-instance matrix
   updates on park/sweep; the sweep's fade keeps working via the shared
   material opacity (it already fades all settled balls together). Verify the
   M2 separateSettled visuals are unchanged (positions come from the sim pool
   exactly as before).
5. **Formal perf gates in `perf.mjs`.** The harness already samples rAF
   frames and impact spikes; M4 adds: 1% low ≥ 50 fps (E3/§14.14), avg ≥
   58 fps, per-frame JS time (rAF-callback wrap, p99 ≤ 6 ms — §12
   main-thread), renderer.info draw calls < 120 / tris < 500k sampled
   mid-round, and the M2-style GC argument hardened: worst frame of the run
   ≤ 2× median (a > 2 ms GC pause inside a 16.7 ms frame would breach it).
   Any breach exits non-zero — the gate becomes binary.
6. **Throttled-load harness.** CDP `Network.emulateNetworkConditions`
   (20 Mbps down, 40 ms RTT) over a fresh profile against `vite preview`:
   measure navigation → splash interactive (≤ 10 s) and then the scripted
   one-action flow → first FLIGHT (≤ 60 s wall from URL). This is the §14.15
   proxy until the owner publishes; the same script reruns against the public
   URL afterwards. `scripts/load-budget.mjs` reports dist sizes (raw/gz/
   brotli per file + total) and asserts JS ≤ 1.5 MB gz, total ≤ 15 MB Brotli,
   and no `lil-gui` string in the bundle.
7. **Network-zero audit (§14.20).** An acceptance step records every request
   from a cold load through one full round + ESC sheet open/close: after the
   initial same-origin static fetches, the request log must be empty, and no
   request may ever leave the origin. Runs in the lane (it's flow-shaped, not
   frame-rate-shaped).
8. **Clipboard summary.** `persist/clipboard.ts`: pure
   `formatRoundSummary(round: RecentRound, records)` →
   `BATTING CAGE — 70 MPH — 8/10 — BEST 312 FT — SCORE 4,120` (contact count
   from records, locale-free thousands separator). Surfaced as a "COPY LAST
   ROUND" button on the ESC sheet (the flat concession — §What lists the
   clipboard under browser-app outputs), enabled once a round exists;
   `navigator.clipboard.writeText` in a try/catch with a toast confirm.
   Headless tests cover the formatter; the browser copy is a manual check
   (clipboard permissions are flaky headless).
9. **CI publish.** `.github/workflows/publish.yml`: on tag `v*` → npm ci →
   test → typecheck/lint → build → upload `dist/` → deploy-pages. `base:
   './'` already makes the artifact host-agnostic (project-pages subpaths
   included). The workflow is committed and validated by `act`-style dry
   inspection only; it goes live when the owner adds the remote. README gains
   the §Deployment story: public URL, `npm run preview` as the canonical
   local path, file:// unsupported note, per-origin saves + export/import
   bridge.
10. **ATTRACT-2 polish (M3 handoff).** Drop the 6-row pitch overlap: header +
    top-4 entries at a clean 8-row pitch, with entry 5 shown only when the
    list has five (rotating "…AND N MORE" line is over-design; 4 + header
    reads clean on 40 rows). Dust motes stay cut (M1 owner playtest) —
    recorded in M4-NOTES as the standing §11 deviation unless a timeboxed
    (≤ 0.5 d) beam-masked retry lands; not an exit blocker.

## 4. Work breakdown

### Phase 0 — Tuning rig: mutable tables, lil-gui, oracle (~1 day)

1. `core/tuning.ts`: move the four tables behind mutable exports +
   `applyTuning`/`resetTuning`/`serializeTuning`; `constants.ts` re-exports so
   no call site changes; boundary suite still passes (tuning.ts is pure core).
2. `app/TunePanel.ts` (dev-only, dynamic import behind `?tune=1` +
   `import.meta.env.DEV`): lil-gui folders per table (six window rows, three
   multipliers + foul, six medal rows + carry bars), localStorage persistence,
   reset button, console copy-out. lil-gui → devDependencies.
3. `tests/tuningOracle.test.ts` + `scripts/tune-sweep.mjs`: the §3.2 player
   model over the headless sim (seeded, fast — ~200 rounds/sec); the test
   asserts the CURRENT tables satisfy the proxy invariants (novice bronze@40
   reachable, ladder monotone, platinum elite-only); the script prints the
   full medal-probability sweep for tuning sessions.
4. Suite guard: a test asserting `dist`-bound code never imports lil-gui
   statically (grep-based, like the boundary suite).

**Done when:** `npm run dev` + `?tune=1` edits windows live mid-round; prod build contains no lil-gui; oracle sweep prints; all suites green.

### Phase 1 — Tune the game (~1–1.5 days + owner sessions)

1. Run the oracle sweep; adjust medal thresholds / platinum carry bars (and
   only if the model demands it, window edges — the §6 ladder is the game's
   identity, touch last) until the §3.2 proxies hold with margin.
2. Owner playtest sessions (the tuning contract): session-1 flow at 40–50,
   a practiced session up the ladder; watch bronze pacing, re-token pull,
   whether GOOD-grade contact still *feels* rewarded (§Why: fun per session).
   Capture observations + exported saves into `M4-NOTES.md`.
3. Re-baseline affected suites in the same commit as any table change
   (scoring/progression boundaries, oracle expectations). Determinism suites
   are value-agnostic and must not change.

**Done when:** oracle proxies green; ≥ 2 recorded first-session playtests behave per §14.22–.23; tables frozen for v1.0.

### Phase 2 — Perf & §12 budget pass (~1 day)

1. Settled-pool instancing (design note 4); confirm sweep/pile visuals.
2. `perf.mjs` hard gates (design note 5): fps/1%-low/JS-time/draw-call/tris/
   worst-frame thresholds, non-zero exit on breach; JS-time sampling via
   rAF-callback wrap.
3. `tests/saveSize.test.ts`: synthesize a worst-case save (10k swing tuples,
   max sessions/top5s) → serialized size < 2 MB; typical 50-round career
   < 1 MB (§12 save budget).
4. Run the gate on the GB10 at High; record M4-NOTES numbers.

**Done when:** `node scripts/perf.mjs` is a binary gate and passes; draw calls < 120 mid-round with a full settled pile.

### Phase 3 — Ship features & polish (~1 day)

1. `persist/clipboard.ts` formatter + suite; ESC-sheet "COPY LAST ROUND"
   button + toast (design note 8).
2. LICENSES.md finalization: drop the "pending" section into a "considered,
   not shipped in v1" note (everything stayed procedural); add lil-gui +
   playwright-core to the dev-time table; state the project license line.
3. ATTRACT-2 layout fix (design note 10) + boardPages test update.
4. README.md: what/how to play, keys, `npm run preview`, deploy story,
   save export/import + per-origin note (§Deployment).

**Done when:** round-end copy produces the §What string; LICENSES has no pending rows; attract pages have no glyph overlap.

### Phase 4 — Packaging, audits & CI (~1 day)

1. `scripts/load-budget.mjs` (design note 6): size report + JS ≤ 1.5 MB gz /
   total ≤ 15 MB Brotli / no-lil-gui asserts. (Current: 261 kB gz total JS —
   wide margin; the gate prevents regression.)
2. Throttled-load step in the acceptance lane: 20 Mbps profile → interactive
   ≤ 10 s, URL → first pitch ≤ 60 s (single-action flow).
3. Network-zero audit step (design note 7) in the lane.
4. `.github/workflows/publish.yml` + tag-triggered deploy; document the owner
   publish step (repo → push → tag `v1.0` → Pages URL → re-run §14.15/.20
   scripts against it).

**Done when:** lane includes load + network audits and passes; budget script green; workflow committed.

### Phase 5 — §14 exit review, notes, ship tags (~0.5–1 day)

1. Execute the full §14 matrix (.1–.24): every criterion → suite/harness/
   playtest evidence with measured numbers; rerun `npm test`, acceptance
   lane, perf gate, smoke, load budget in one sweep.
2. `M4-NOTES.md`: matrix, tuning rationale + final tables, measured budgets,
   standing deviations (dust motes, procedural content set, owner steps),
   post-ship watchlist (.22/.24 longitudinal tracking).
3. Memory update; commit; tag `m4` and `v1.0`.

**Done when:** every §14 row has evidence; tags pushed (locally; remote = owner step); the goal of §Why — one URL, one key — is a `git push` away.

## 5. Test inventory (additions/updates)

| Suite / harness | Covers | Spec |
|---|---|---|
| `tuningOracle.test.ts` (new) | Player-model proxies: bronze reachability, ladder monotonicity, platinum elitism | §14.22–.24 |
| `clipboard.test.ts` (new) | Summary formatter exact strings, contact counts, thousands separators, edge rounds (all-TAKE) | §What outputs (f) |
| `saveSize.test.ts` (new) | Worst-case 10k-cap save < 2 MB, typical < 1 MB | §12 |
| `boardPages.test.ts` (updated) | ATTRACT-2 four-entry layout | §9 |
| Re-baselined table suites | Any tuned values, same commit | §6/§8 |
| `perf.mjs` (extended, binary) | fps avg + 1% low, JS ≤ 6 ms, draw calls/tris, worst-frame GC proxy, impact spikes | §12, §14.14/.16 |
| `load-budget.mjs` (new) | gz/Brotli budgets, lil-gui exclusion | §12, §14.15 |
| Lane: throttled-load step (new) | ≤ 10 s interactive / ≤ 60 s first pitch at 20 Mbps | §14.15 |
| Lane: network-zero step (new) | Zero post-load requests, zero third-party origins | §14.20 |
| All M0–M3 suites + lane | Green throughout | §14.20, E9 |

## 6. Key risks & mitigations

1. **Tuning churn destabilizes table-driven suites:** the same-commit
   re-baseline pattern is established; suites that can read the tables
   directly (rather than literal values) get converted first, so a value
   change touches one place.
2. **The oracle's player model is wrong:** it only *focuses* playtests, never
   replaces them — both must agree before tables freeze; the model's σ
   anchors and the observed playtest ε distributions are compared in
   M4-NOTES (the save's swing log gives the real distribution for free).
3. **lil-gui leaks into the prod bundle:** triple fence — env-gated dynamic
   import, devDependency, and the load-budget grep assert.
4. **Perf gates flake on a busy machine:** the M3 lesson is recorded (a
   concurrent SwiftShader run contaminates pacing); the gate documents
   "idle machine" as a precondition and perf runs are serialized in any
   combined script.
5. **§14.15/.20 can't fully close without a public URL:** local throttled
   proxy + committed CI carry the milestone; the owner publish step and
   post-publish re-run are explicit exit-note items, not silent gaps.
6. **Settled-pool instancing breaks the sweep fiction:** the sweep already
   drives positions/fade wholesale; a scripted smoke screenshot pair
   (pile → swept) guards the visual before/after.

## 7. Sequencing & estimate

```
P0 tuning rig ── P1 tune (owner loop) ──┐
       └── P2 perf/budgets ─────────────┼── P5 §14 exit review ── m4 + v1.0
       └── P3 ship features ────────────┤
       └── P4 packaging/CI/audits ──────┘
(P2/P3/P4 parallel after P0; P1 interleaves owner sessions throughout;
 P5 only after every lane/gate is binary-green)
```

Total ≈ **5–6 working days** single-developer plus owner playtest/publish
loops. P0 is the keystone (tuning without a rig is guesswork; the oracle
makes §14.22–.24 tractable before a single human session); everything else
is hardening what M0–M3 already proved — the same finish-the-contract
discipline that carried the first four milestones.
