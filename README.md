# Batting Cage

A one-button, visually premium 3D batting cage for the desktop browser.
You stand in an indoor training facility, a pitching machine throws
fastballs over the plate, and **SPACE** times your swing. Every ball you
square up physically flies into the cage netting — while the in-world
HitTrax-style LED board answers the only question that matters: *how far
would that one have gone?*

Free, local, telemetry-free. No accounts, no network, no ads — your career
lives entirely in your browser.

## Play

1. Open the public URL (or run locally, below).
2. Click once — **STEP INTO THE CAGE** (this also unlocks audio).
3. **SPACE** inserts a token: 10 pitches at the selected speed.
4. Watch the machine's light — it snaps **green** at release. Press SPACE
   as the ball gets big over the plate; the swing lands 150 ms later.
5. The board shows carry distance, exit velo, launch angle, and your
   timing error to the millisecond. Score = contact quality × distance.

Earn **Bronze** at a tier to unlock the next machine speed
(40 → 50 → 60 → 70 → 80 → 90 mph). Platinum demands both a score and a
total-carry bar. Distance clubs (250/300/350/400 ft), per-speed top-5
boards with initials, and a full stat locker live on the cage-side monitor.

### Keys

| Key | Action |
|---|---|
| SPACE | swing · insert token · confirm |
| ARROWS | machine panel · initials entry |
| ENTER | confirm · insert token (never swings) |
| TAB | stats monitor · next page |
| H / B | handedness · wood/metal bat |
| M | mute |
| ESC | pause + system sheet (quality, volumes, save export/import, copy last round) |
| F3 | diagnostics overlay |

The mouse can click panels and sheets; it never swings.

## Run locally

```sh
npm ci
npm run build      # typecheck + vite build → dist/
npm run preview    # serve the built artifact at http://localhost:4173
```

`npm run preview` (or `npx serve dist`) is the canonical local path.
Opening `dist/index.html` via `file://` is **unsupported** — ES modules
need an HTTP origin. `npm run dev` gives the dev server; add `?tune=1`
there for the live tuning panel (dev builds only).

## Deploy

The build is one host-agnostic static `dist/` (relative base, every asset
same-origin, zero runtime network I/O after load). CI publishes it to
GitHub Pages on any `v*` tag (`.github/workflows/publish.yml`):

```sh
git tag v1.0 && git push origin main --tags
```

Then enable **Settings → Pages → Source: GitHub Actions** once. Any static
host works the same — copy `dist/` anywhere.

## Saves

Your career is one versioned JSON document in `localStorage`, written at
round end and on tab close, double-buffered against torn writes.
**Saves are per-origin** — the hosted URL and `localhost` are separate
careers. Bridge them (and survive a cache clear) with **ESC → EXPORT
SAVE / IMPORT SAVE**; export after a big PB.

## Develop

```sh
npm test                 # 270+ headless suites (core is pure TS, no DOM)
npm run test:acceptance  # Playwright lane: the three SPEC scenarios + audits
node scripts/perf.mjs    # binary §12 perf gate (needs a real GPU + preview up)
node scripts/load-budget.mjs   # dist size budgets
node scripts/tune-sweep.mjs    # tuning-oracle medal-probability sweep
```

`SPEC.md` is the contract; `M0`–`M4` plan/notes document each milestone.
