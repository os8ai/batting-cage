# M3 Notes — The Game ("it's a product")

Built against `M3-PLAN.md` on top of tag `m2` (+ aisle-lighting fix). Six
phases, one commit each (P0 ada4647…P6). All §13-M3 exit criteria below.

## Exit checklist (E1–E10, measured)

| # | Check | Result |
|---|---|---|
| E1 | First Contact: cold load → attract single action → coached round one → starts round two; first pitch ≤ 60 s; beats ≤ 30 s | **PASS** (acceptance lane, 129 s wall; pitch 1 PERFECT ε ≈ 2 ms; first pitch ~12 s from load; beats ~9 s into play) |
| E2 | Mastery Session: loadout auto-resumed (metal bat survives reload); 3 rounds at the unlocked 50; session aggregates persisted + rendered on monitor (TAB cycle to SESSIONS/TREND) | **PASS** (acceptance lane) |
| E3 | Duel: initials entry on a top-5 score (BAA), re-token in 1 key ≤ 10 s, attract carousel carries the update | **PASS** (acceptance lane) |
| E4 | Save survives reload; eviction → restore via the real ESC-sheet import (byte-lossless); hostile imports refused with board message, prior save intact | **PASS** (headless fuzz suite + browser durability scenario) |
| E5 | Kill mid-write: boot loads `bc.save` or `.bak`, never fresh | **PASS** (torn-write sim at every kv-op budget, `persist.test.ts`) |
| E6 | Medal/unlock logic exact (boundaries ±1, Platinum dual-bar, bronze chain, locker never gates) | **PASS** (table-driven `progression.test.ts`, all six tiers) |
| E7 | §8 multipliers exact; round = Σ quality × carry; FOUL 25 flat | **PASS** (`scoring.test.ts`) |
| E8 | §11 presets + first-run auto-detect (<55 → MEDIUM, <40 → LOW) + live ESC switching | **PASS** (`quality.test.ts`; SwiftShader probe lands LOW in smoke; GB10 lands HIGH) |
| E9 | Audio confirms on every interaction; ceremony cues (count-up loop, medal stamp, unlock klaxon) land | **PASS** (cue/synth suites; deferred-cue ledger emptied — see Decisions 4) |
| E10 | All M0–M2 suites green post-extension; core purity holds; exactly two runtime deps | **PASS** — `npm test` 251 tests / 20 files; `three` + `postprocessing` only |

**Perf gate** (`scripts/perf.mjs`, GB10/Vulkan, 3 rounds, 1080p, 13,961
frames): avg **60.0 fps** · p50 16.7 ms · 1% low **59.5 fps** · worst frame of
the whole run 16.8 ms · max impact frame **1.006× median** (gate ≤ 1.1×) —
identical to the M2 baseline. Caught and fixed en route: the key-hint footer
stayed `display:block` at opacity 0 after its fade, and a DOM layer composited
over the canvas slips vsync (~6% doubled frames, 2.0× impact spikes). Overlays
now leave the render path on `transitionend`. Bloom's resolutionScale is also
pinned to the library default (0.5) so a future preset tweak can't silently
double the bloom buffer.

## Decisions & deviations from the plan

1. **Ceremony cues ride board signals, not raw events.** The plan's design
   note 2 put `medalStamp`/`unlockKlaxon` on the cue map's event rows, but the
   stamp *appears* at count-up end (~2 s after `MEDAL_EARNED` fires). Audio
   syncs to the visual: `cuesForBoardSignal` maps the page machine's
   `BoardSignal`s (still derived deterministically from event times through
   fixed beats). Event-row purity tests unchanged.
2. **Lifetime averages derive from the retained 10k-swing window**, not true
   lifetime — recomputed per round from the log (single-derivation). True
   lifetime medians would need an incremental sketch; out of scope. Session
   rows (kept forever) carry the per-day truth.
3. **`medalsImplied`:** earning gold stamps bronze+silver too — keeps the
   MEDALS locker monotone and the unlock chain simple.
4. **Acceptance swing timing is in-page dispatched** (the smoke.mjs
   technique): under SwiftShader the main thread runs ~250 ms frames and the
   hitch clamp dilates sim time, so Node-side CDP key timing lands ±200 ms
   off (measured −202 ms). UI keys (token, panel, initials, ESC, TAB) remain
   real CDP keyboard input. Deviation noted against the plan's "real keyboard
   input throughout".
5. **First-round PBs celebrate.** A fresh career's first scoring round fires
   NEW_PB (prior = 0) — Wii-style; the TAKE-only round fires nothing.
6. **ESC no longer "back to play".** ESC = pause + system sheet everywhere
   (spec §Inputs); leaving a station happens via token/TAB. ESC during
   INITIALS = skip (accept current letters).
7. **ATTRACT-2 layout:** 72×40 cells fit a header + 5 entries only at a 6-row
   pitch (1-row glyph overlap on the list). Cosmetic; revisit in M4 if it
   reads poorly on the real board texture.
8. **Sim owns ceremony judgment.** The sim takes the career snapshot at
   construction/`setCareer` and folds round results back in, so multi-round
   sessions chain (unlock → selectable next token) without reading storage.
   Persist recomputes independently from the same events (recorder is
   idempotent per round id).

## M0-DEBUG ledger — closed

| Item | Status |
|---|---|
| `R`-token key | **Retired** — SPACE at the token slot (routeSpace gate); dev scripts updated |
| `Date.now()` session seed | **Retired** — `saveId` (crypto 32-bit) mints once per career and seeds the sim |
| HTML DebugHud | **Deleted** — F3 = Diagnostics overlay only |
| M1 all-tiers-unlocked panel | **Retired** — career-lit buttons, red + stencil when locked |
| Deferred-cue ledger (M2) | **Emptied** — count-up loop, medal stamp, unlock klaxon, volume buses all live |

## Test inventory

251 headless tests / 20 files (`npm test`, ~3 s) — new: `scoring`,
`progression`, `stats`, `persist`, `quality`, `modes`; extended: `boardPages`
(recap/ceremony/initials/attract/coach), `cueSchedule` (+ ceremony rows),
`synthInventory` (+ 3 voices). Acceptance lane (`npm run test:acceptance`,
~8 min, SwiftShader, persistent profile chaining one career):
`firstContact` → `mastery` → `duel` → `durability`.

## M4 handoff

- Tune windows/multipliers/medals vs §14.22–.24 via lil-gui (values frozen
  through M3); perf pass to final §12 budgets (1% low 59.5 at High already
  clears the 50-fps bar — formal gating lands with M4).
- Clipboard summary (`persist/clipboard.ts` — §13 lists under M4).
- LICENSES.md finalization + CI publish of `dist/`.
- ATTRACT-2 row-overlap polish; DSEG atlas swap for the code font.
- Owner step still open: Mixamo batter rig swap (M1 ledger).
