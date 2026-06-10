/**
 * §14.20 network-zero audit (M4 P4.3): records EVERY request from a cold
 * load through one full round + ESC sheet open/close, then asserts
 *   - zero third-party origins ever (every request is same-origin)
 *   - zero requests after the initial static load (boundary: app booted
 *     + splash clicked + 1 s of decode buffer)
 * plus the lockfile audit: exactly two runtime dependencies.
 * Reruns against the public URL with BC_URL=<url> after the owner publishes.
 */
import { readFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { assert, assertNoErrors, BASE_URL, playRound } from './helpers.mjs';

// Lockfile audit first (§14.20: "exactly two runtime dependencies").
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const runtimeDeps = Object.keys(lock.packages[''].dependencies ?? {});
console.log(`runtime deps: ${runtimeDeps.join(', ')}`);
assert(
  runtimeDeps.length === 2 && runtimeDeps.includes('three') && runtimeDeps.includes('postprocessing'),
  `lockfile must carry exactly two runtime deps (three, postprocessing), got: ${runtimeDeps.join(', ')}`
);

const PROFILE = 'tests/acceptance/.profile-netaudit';
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

const origin = new URL(BASE_URL).origin;
const requests = []; // { url, tMs }
page.on('request', (r) => requests.push({ url: r.url(), tMs: Date.now() }));

await page.goto(`${BASE_URL}/?dev=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__bc, null, { timeout: 20000 });
await page.mouse.click(640, 360); // splash click (audio unlock + remaining init)
await page.waitForTimeout(1000);
const loadBoundaryMs = Date.now(); // everything after this must be silence

await page.keyboard.press('Space'); // token → full round with timed swings
await playRound(page);
await page.keyboard.press('Escape'); // ESC sheet open (§14.20 flow includes it)
await page.waitForTimeout(600);
await page.keyboard.press('Escape'); // close
await page.waitForTimeout(600);

const thirdParty = requests.filter((r) => new URL(r.url).origin !== origin);
const afterLoad = requests.filter((r) => r.tMs > loadBoundaryMs);
console.log(`requests total: ${requests.length}; third-party: ${thirdParty.length}; after load: ${afterLoad.length}`);
for (const r of thirdParty) console.log(`  THIRD-PARTY: ${r.url}`);
for (const r of afterLoad) console.log(`  AFTER-LOAD: ${r.url}`);
assert(thirdParty.length === 0, 'third-party origin contacted');
assert(afterLoad.length === 0, 'network request after load');
assert(requests.length > 0, 'sanity: the initial static fetches were recorded');

assertNoErrors(errors, 'networkAudit');
await context.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log('PASS networkAudit (§14.20)');
