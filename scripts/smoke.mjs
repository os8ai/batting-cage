/**
 * M1 browser smoke (dev-only): boots the built app headlessly with ?dev=1,
 * walks the visit — splash → panel station → token → a timed PERFECT-ish
 * swing on pitch 1 (scheduled from the sim's own pitch schedule, so software
 * rendering lag cannot skew ε) — and saves screenshots + console + F3.
 *
 * Usage: node scripts/smoke.mjs [url] (default http://localhost:4173/?dev=1)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:4173/?dev=1';
const OUT = 'scripts/shots';
mkdirSync(OUT, { recursive: true });

const executablePath =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell`;

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const phase = () => page.evaluate(() => window.__bc?.sim.currentPhase ?? 'NO_HOOK');
const waitPhase = async (want, timeoutMs = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const p = await phase();
    if (p === want) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${want} (at ${p})`);
    await page.waitForTimeout(60);
  }
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-splash.png` });

await page.mouse.click(640, 360);
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/02-idle-scene.png` });
await page.keyboard.press('F3');

// Panel: a fresh career has only 40 unlocked (M3 §8) — walk the focus over
// the locked 60 (red + stencil), watch the refusal, then settle on 40.
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(2500); // dolly (slow under software rendering)
await page.screenshot({ path: `${OUT}/03-panel-station.png` });
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Space'); // locked pick → refusal flash, no selection
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/04-panel-confirmed.png` });
const sel = await page.evaluate(() => window.__bc.sim.currentTier);
if (sel !== 40) throw new Error(`locked 60 was selected (tier=${sel})`);
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowUp');

// ESC sheet (M3): pause + quality/volumes/export — open, shoot, close.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/05-esc-sheet.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// Token: SPACE at idle inserts (M3 token slot; R is retired) — focus is back
// on the selected 40, so this single press proceeds (§Flow 2). Schedule a
// near-perfect SPACE press for pitch 1, timed off the sim's own schedule.
await page.keyboard.press('Space');
await waitPhase('FLIGHT');
// Install the reveal-freeze watcher BEFORE the press: it pauses the loop two
// frames into BOARD_REVEAL so screenshot latency can't outrun the hold.
await page.evaluate(() => {
  const { sim, loop } = window.__bc;
  window.__frozen = false;
  let frames = 0;
  const poll = () => {
    if (sim.currentPhase === 'BOARD_REVEAL' && ++frames >= 2) {
      loop.setPaused(true);
      window.__frozen = true;
    } else {
      requestAnimationFrame(poll);
    }
  };
  requestAnimationFrame(poll);
});
await page.evaluate(() => {
  const { sim, loop } = window.__bc;
  const target = sim.scheduledPlateTime() - 0.15; // ideal press → ε ≈ poll lag
  const fire = () => {
    // Poll the LIVE wall↔sim mapping: hitch clamps shift the epoch, so a
    // precomputed wall time would drift on a slow renderer.
    if (loop.simTimeOf(performance.now()) >= target) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    } else {
      setTimeout(fire, 2);
    }
  };
  fire();
});
const waitFrozen = async () => {
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => window.__frozen === true)) return;
    await page.waitForTimeout(50);
  }
  throw new Error('freeze watcher never fired');
};

await waitFrozen();
await page.screenshot({ path: `${OUT}/09-board-reveal.png` });
await page.evaluate(() => window.__bc.loop.setPaused(false));

// Pitch 2: take it; freeze on the TAKE card the same way.
await page.evaluate(() => {
  const { sim, loop } = window.__bc;
  window.__frozen = false;
  let seenLive = false;
  let frames = 0;
  const poll = () => {
    if (sim.currentPhase === 'FLIGHT') seenLive = true; // wait out pitch 1's hold
    if (seenLive && sim.currentPhase === 'BOARD_REVEAL' && ++frames >= 2) {
      loop.setPaused(true);
      window.__frozen = true;
    } else {
      requestAnimationFrame(poll);
    }
  };
  requestAnimationFrame(poll);
});
await waitFrozen();
await page.screenshot({ path: `${OUT}/10-take-card.png` });
await page.evaluate(() => window.__bc.loop.setPaused(false));

// Last judged record + F3.
const record = await page.evaluate(() => JSON.stringify(window.__bc.sim.roundRecords));
console.log('--- records ---\n' + record);
const f3 = await page.locator('#f3').textContent();
console.log('--- F3 ---\n' + f3);
console.log('--- console errors/warnings ---');
console.log(errors.length ? errors.join('\n') : '(none)');

await browser.close();
