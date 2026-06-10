/**
 * §14.15 throttled-load step (M4 P4.2): CDP network emulation at the spec's
 * 20 Mbps / 40 ms RTT profile over a FRESH browser profile against the
 * preview server. Gates:
 *   - navigation → splash interactive ≤ 10 s (app booted, splash clickable)
 *   - URL → first pitch in FLIGHT ≤ 60 s via the single-action flow
 * This is the local proxy until the owner publishes; rerun against the
 * public URL afterwards with BC_URL=<url> node tests/acceptance/throttledLoad.mjs
 */
import { rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { assert, assertNoErrors, BASE_URL, waitPhase } from './helpers.mjs';

const PROFILE = 'tests/acceptance/.profile-throttled';
rmSync(PROFILE, { recursive: true, force: true });

const executablePath =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell`;

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath,
  viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

// The spec's 20 Mbps line (§Deployment): 2.5 MB/s down, 40 ms RTT.
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 40,
  downloadThroughput: (20 * 1024 * 1024) / 8,
  uploadThroughput: (5 * 1024 * 1024) / 8,
});

const t0 = Date.now();
await page.goto(`${BASE_URL}/?dev=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__bc, null, { timeout: 20000 });
const interactiveS = (Date.now() - t0) / 1000;
console.log(`cold load → interactive: ${interactiveS.toFixed(1)} s (budget 10)`);
assert(interactiveS <= 10, `interactive ${interactiveS.toFixed(1)} s > 10 s`);

// The single-action flow: splash click, then SPACE inserts the token
// (defaults 40/righty/wood — attract offers exactly one action).
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
await page.keyboard.press('Space');
await waitPhase(page, 'FLIGHT', 60000);
const firstPitchS = (Date.now() - t0) / 1000;
console.log(`URL → first pitch in flight: ${firstPitchS.toFixed(1)} s (budget 60)`);
assert(firstPitchS <= 60, `first pitch ${firstPitchS.toFixed(1)} s > 60 s`);

assertNoErrors(errors, 'throttledLoad');
await context.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log('PASS throttledLoad (§14.15 local proxy)');
