# M4 Notes — Tune & Ship ("it's good")

Built against `M4-PLAN.md` on top of tag `m3`. Phases P0+P1 (one commit —
the same-commit re-baseline pattern), P2, P3, P4, P5. This file carries the
full §14 verification matrix (E1), the tuning rationale + final tables (E2),
and the measured budget numbers (E3/E4).

## Exit checklist (E1–E9)

| # | Check | Result |
|---|---|---|
| E1 | §14 matrix .1–.24 with evidence | **DONE** — matrix below |
| E2 | Tables tuned vs §14.22–.24 | **DONE (model)** — oracle proxies green with margin; owner playtest sessions remain the human contract (owner step a) |
| E3 | §12 perf budgets formally gated | **PASS** — `scripts/perf.mjs` binary gate, numbers below |
| E4 | §12 load budgets | **PASS (local proxy)** — 217 kB Brotli total (budget 15 MB); throttled-load lane step interactive 0.8 s / first pitch 14.3 s; public-URL re-run = owner step c |
| E5 | Clipboard summary | **PASS** — `persist/clipboard.ts` + 5-case exact-string suite; ESC "COPY LAST ROUND" verified end-to-end in-browser (button enables at ROUND_END; click puts `BATTING CAGE — 40 MPH — 0/10 — SCORE 0` on the real clipboard, read back via clipboard-read permission) |
| E6 | §14.20 network audit | **PASS** — lane step: 2 requests total (html + bundle), 0 third-party, 0 after load; lockfile = exactly `three` + `postprocessing` |
| E7 | LICENSES.md finalized | **DONE** — all-procedural shipped set, ISC project line, dev-time table incl. lil-gui/playwright-core |
| E8 | CI publishes dist/ on tag | **COMMITTED** — `.github/workflows/publish.yml` (inert until the owner adds a remote; `npm run preview` serves the identical artifact) |
| E9 | All suites green at exit | **PASS** — 275 headless tests / 23 files, 6-step acceptance lane, perf gate, load budget, typecheck, lint, build |

**Perf gate** (`scripts/perf.mjs`, GB10/Vulkan, 3 rounds, 1080p, High,
idle machine — 13,952 frames): avg **60.0 fps** · 1% low **59.5** · JS
rAF-callback p50 0.20 ms / **p99 2.70 ms** (budget 6) · worst frame
**1.006× median** (GC proxy budget 2×) · max impact frame 1.006× (budget
1.1×) · draw calls **119 peak** with the full 10-ball pile (budget < 120;
margin = 1, the gate is the regression alarm) · 17,730 tris (budget 500k).
All 8 rows PASS, exit 0. The remaining §12 row — input→judgment < 2 ms —
reads **1.2 ms** on the smoke run's F3 (judge max, SwiftShader worst case).

*Precondition proven the hard way:* an unrelated ~100%-CPU / 22 GB
inference process (`storedmoe`) started on this DGX mid-exit-review; gate
reruns alongside it fail on JS p99 (6.1 ms) and one 33 ms frame — on a
unified-memory machine an external bandwidth-heavy workload contaminates
frame pacing exactly as the M3 SwiftShader lesson predicted. The gate
documents "idle machine" as its precondition; the numbers above are the
idle run on the shipping code (no hot-loop change landed after it).

**Load budget** (`scripts/load-budget.mjs`): one JS bundle 848 kB raw /
254.4 kB gz / 217.0 kB br + index.html — totals 254.8 kB gz, **217.2 kB
Brotli** against the 15 MB budget; `lil-gui` absent from the bundle
(grep-asserted). Headroom is ~70×; the gate exists to catch regressions
(asset cooks, accidental dep).

**Acceptance lane** (`npm run test:acceptance`, SwiftShader, ~11.5 min):
throttledLoad (22 s) → firstContact (125 s) → mastery (304 s) → duel (94 s)
→ durability (34 s) → networkAudit (103 s) — all PASS. (The scripted ε≈3 ms
robot platinums round 1 at 40 — an elite-player artifact, not a tuning
miss; the §14.22 novice story is the oracle's, not the robot's.)

## The tune (P0+P1) — what the oracle found and what changed

The oracle (`tests/oracle/playerModel.ts` + `scripts/tune-sweep.mjs`) drives
the real judgment chain (resolveContact → projectCarryFt → pointsFor →
medalFor) with press error ε ~ N(bias, σ); σ is the skill knob on the §6
window ladder's own scale (novice ≈ 55–70 ms, practiced ≈ 30–40, elite ≈
15–20). Two structural findings against the spec's launch tables:

1. **Launch Platinum was unreachable.** A round's hard ceiling is
   10 × 1.6 × max carry ≈ **5,630 pts at 40 mph** and ≈ **6,670 at 90** —
   below the launch Platinum row at every tier (oracle: P(platinum) = 0
   even at elite σ = 12 ms over hundreds of rounds). The spec's own §8
   "theoretical round max ≈ 6,900" only holds at 90 mph; the per-tier rows
   were authored above their own tiers' ceilings.
2. **Launch Bronze was flat.** A σ = 62 ms novice cleared bronze at EVERY
   tier (carry rises with machine speed, so points hold up while windows
   tighten) — the 40→90 ladder had no gate and §14.22's "2–4 h to 90"
   collapsed to one session.

**Final tables** (windows and multipliers untouched — the §6 ladder is the
game's identity; medal rows retuned, carry bars kept at launch values):

| Tier | Bronze | Silver | Gold | Platinum | + carry bar |
|---|---|---|---|---|---|
| 40 | 2,400 | 3,700 | 4,700 | 5,620 | 2,800 ft |
| 50 | 2,600 | 3,900 | 4,800 | 5,750 | 2,950 ft |
| 60 | 2,800 | 4,100 | 4,900 | 5,850 | 3,100 ft |
| 70 | 3,000 | 4,250 | 5,000 | 5,950 | 3,300 ft |
| 80 | 3,200 | 4,400 | 5,100 | 6,050 | 3,450 ft |
| 90 | 3,400 | 4,550 | 5,200 | 6,150 | 3,600 ft |

Design: Bronze tracks the σ ladder (max σ for 50% bronze falls smoothly
**133 → 111 → 90 → 72 → 55 → 38 ms** from 40→90 — every step in the
0.55–0.95 ratio band, no cliff, no free tier); Silver = the practiced rung;
Gold = near-elite; Platinum sits at ≈ the 97th percentile of a practiced
(σ30) round and under the 90th of an elite (σ12) one — elite-only yet
reachable (sweep at 300 rounds/cell: P(Pt | σ30) ≤ 1% everywhere;
P(Pt | σ12) = 66% at 40 mph falling to 12% at 90 — the crown). At 80–90 the
launch carry bars do real work on their own (a σ20 round fails the 90 mph
bar ~75% of the time). A novice first session (σ0 65 ms, +10 ms late bias,
5%/round practice) brons at 40 within 3 rounds at ~100% in the model.

`tests/tuningOracle.test.ts` pins all of this as the regression contract;
any future retune re-baselines it in the same commit.

**The rig:** the four TUNABLE tables live in `core/tuning.ts` as
stable-identity mutable exports (constants.ts re-exports; consumers read at
use-time, so edits land on the next judgment). Dev-only lil-gui panel on
`?tune=1` (env-gated dynamic import; `bc.tune` localStorage persistence;
console copy-out). Triple fence holds lil-gui out of dist/: statically-false
`import.meta.env.DEV` branch, devDependency, load-budget grep assert.

## §14 verification matrix

| § | Criterion | Evidence | Measured |
|---|---|---|---|
| .1 | Identical seeds + scripted timestamps → bit-identical rounds | `determinism.test.ts` (serialized event streams compared) | byte-equal across runs |
| .2 | 30 fps and 144 fps runs grade identical inputs identically | `determinism.test.ts` frame-rate independence cases (frameDt 1/30 vs 1/144) | identical records |
| .3 | Board ε equals the test oracle within 1 ms | `boardPages.test.ts` swing-card content vs `SWING_JUDGED` record | exact (same record object) |
| .4 | RELEASE at T+1.8 s ± 1 tick every pitch | `pitchCycle.test.ts` + `cueSchedule.test.ts` | release events at T+1.8 within one 120 Hz tick |
| .5 | Pre-release presses never consume the swing | `pitchCycle.test.ts` / sim `PRESS_IGNORED{PRE_RELEASE}` cases | pass |
| .6 | Plate crossing 2.5 ft ± 0.5 in per tier | `pitchSchedule.test.ts` (solver) | all six tiers within tolerance |
| .7 | Projection within ±10 ft of the §7 table | `projection.test.ts` calibration suite | all six rows in band |
| .8 | Windows/q/LA/spray/multiplier tables exact | `timingWindows` / `contactModel` / `scoring` table-driven suites | exact |
| .9 | FOUL always past 45°; fair never | `contactModel.test.ts` foul-band cases | 46–70° vs ≤ 42° (jitter-clamped) |
| .10 | Bronze at N unlocks N+1; Platinum dual-bar; locker never gates | `progression.test.ts` (boundaries ±1, all tiers) | pass |
| .11 | First Contact scenario | acceptance lane `firstContact.mjs` | pass; first pitch ≪ 60 s; beats ≤ 30 s |
| .12 | Mastery Session scenario | lane `mastery.mjs` | pass; aggregates persisted + on monitor |
| .13 | Duel scenario | lane `duel.mjs` | pass; 1-key re-token; initials on top-5; carousel updates |
| .14 | 60 fps sustained at High; 1% low ≥ 50 | `perf.mjs` binary gate on GB10/Vulkan (idle) | avg 60.0 · 1% low 59.5 over 13,952 frames |
| .15 | ≤ 10 s interactive / ≤ 60 s first pitch at 20 Mbps | lane `throttledLoad.mjs` (CDP emulation; local proxy) | 0.8 s / 14.3 s · public URL = owner step c |
| .16 | No GC pause > 2 ms mid-cycle | perf gate worst-frame proxy (≤ 2× median) + zero-alloc hot loops (M2 audit) | worst frame 1.006× median (a > 2 ms pause inside a 16.7 ms frame would read ≥ 1.12×) |
| .17 | Audio confirms on every interaction | `cueSchedule.test.ts` + `synthInventory.test.ts` (M3 E9 listening pass) | pass |
| .18 | Export→wipe→import lossless; corrupt/newer refused, prior intact | `persist.test.ts` fuzz set + lane `durability.mjs` | byte-lossless; refusals on board |
| .19 | Kill mid-write → `bc.save` or `.bak`, never fresh | `persist.test.ts` torn-write sim at every kv-op budget | pass |
| .20 | Zero requests after load; zero third-party; two runtime deps | lane `networkAudit.mjs` (full round + ESC) + lockfile audit | 2 boot requests; 0 / 0; `three`+`postprocessing` |
| .21 | LICENSES.md covers every shipped asset | `LICENSES.md` (all shipped content procedural/first-party, ISC) | complete |
| .22 | Median new player: bronze at 40 in session 1; 90 mph in 2–4 h | oracle proxies (`tuningOracle.test.ts`): novice bronze@40 ~100% in 3 rounds; σ-ladder 133→38 ms smooth | **model green; owner playtest = owner step a** |
| .23 | First session sustains ≥ 3 rounds; ≥ 50% re-token | oracle §14.23 proxy (first-medal lands round 1–3) + First Contact (re-token round 2 unaided) | **model green; owner playtest = owner step a** |
| .24 | Median \|ε\| improves ≥ 30% session 1→5 | oracle proxy: σ −30% (55→38.5) lifts median score > 10% and silver odds > +15 pts — the board shows the gain; save's session rows are the longitudinal instrument | **model green; post-ship tracking from exported saves** |

## Decisions & deviations

1. **P0+P1 landed as one commit.** The oracle-proxy suite asserts the
   *shipped* tables; against launch tables it is red by design (platinum
   unreachable). Splitting the commits would have left a red suite at P0 —
   the same-commit re-baseline pattern applied at phase scale.
2. **The oracle skips the pitch clock.** Medal outcomes depend only on the
   judged ε stream; the oracle calls the same analytic judgment chain the
   sim runs in `queueSwing`, so sweeps run ~10³× faster than real-cycle
   ticking. The full-sim path stays covered by determinism/acceptance.
3. **Medal retune is a spec deviation, recorded.** §8's launch medal table
   is superseded (rows were above the per-tier score ceilings); §14's
   criteria — not the launch values — are the contract (SPEC §Detailed-design
   preamble) and the §14.22–.24 proxies now hold with margin.
4. **ATTRACT-3 fixed alongside ATTRACT-2.** The M3-NOTES handoff named only
   ATTRACT-2, but BEST ROUNDS used the same 6-row pitch; both now share the
   header + top-4 × 8-row-pitch layout (entry five dropped, not squeezed —
   the "…AND N MORE" rotator was rejected as over-design per plan).
5. **Clipboard contact count** = any EV-bearing grade (P/GR/GD/FOUL), the
   `stats.ts` contact rule; BEST segment is dropped when no fair contact
   exists (all-TAKE rounds read "0/10 — SCORE 0"). The plan expected the
   browser copy to stay a manual check (headless clipboard flakiness); it
   turned out scriptable with granted clipboard permissions, so E5 closed
   fully automated.
6. **Dust motes stay cut** (M1 owner playtest) — standing §11 deviation;
   the timeboxed beam-masked retry was not spent, spent budget went to the
   ATTRACT-3 fix instead. Not an exit blocker (plan design note 10).
7. **`?tune=1` works in dev builds only** — by design (§13: "never in
   dist/"); a tuning session in the shipped artifact is impossible, which
   is the point.

## Owner steps (open, explicit — none are v1 build blockers)

- (a) **Playtest sessions for §14.22–.24 human sign-off**: session-1 flow at
  40–50 and a practiced ladder session; watch bronze pacing, re-token pull,
  GOOD-contact feel. The oracle's σ anchors vs observed ε distributions
  (the save's swing log records them for free) belong here when done.
- (b) **Create the GitHub repo / enable Pages (Source: Actions), push, tag
  `v1.0`** — CI is committed and inert until a remote exists.
- (c) **Post-publish re-runs against the public URL**:
  `BC_URL=<url> node tests/acceptance/throttledLoad.mjs` and
  `BC_URL=<url> node tests/acceptance/networkAudit.mjs` (§14.15/.20 close
  fully only there).
- (d) Content swaps (Mixamo rig, DSEG atlas) — optional post-v1 content
  changes; the procedural set is the shipped design (M1-NOTES).

## Post-ship watchlist

- §14.22/.24 longitudinal truth: session rows + swing log in exported saves
  are the instrument; compare observed median |ε| trajectories against the
  oracle's σ-improvement assumption (5%/round is the model's guess).
- Draw-call peak measured at 119 vs the <120 budget — one new glow object
  or shadow caster breaks the gate; that is intentional (the gate is the
  regression alarm), but know the margin is 1.
- Re-token rate (§14.23's ≥ 50%) is only observable in real sessions.

## Test inventory

275 headless tests / 23 files (`npm test`, ~9 s) — new: `tuningOracle`
(rig mechanics + §14.22–.24 proxies), `clipboard` (5 exact-string cases),
`saveSize` (§12 budgets); extended: `boundaries` (lil-gui fence),
`boardPages` (ATTRACT list layout). Acceptance lane (~11.5 min, 6 steps):
`throttledLoad` → `firstContact` → `mastery` → `duel` → `durability` →
`networkAudit` (lane wall ~11.5 min). Binary perf gate `scripts/perf.mjs` (8 rows) and
`scripts/load-budget.mjs` (3 rows). Tuning sweep: `scripts/tune-sweep.mjs`.
