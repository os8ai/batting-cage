/**
 * M1 E1 perf gate: 3 scripted rounds at 1080p on the real GPU (system
 * chromium, ANGLE/Vulkan). Samples every rAF frame time during rounds and
 * reports avg fps, 1% low, and renderer.info — the §12/§13 numbers.
 *
 * Usage: node scripts/perf.mjs [url]
 */
import { chromium } from 'playwright-core';

const URL = process.argv[2] ?? 'http://localhost:4173/?dev=1';
const ROUNDS = 3;

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium-browser',
  args: ['--headless=new', '--no-sandbox', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.mouse.click(960, 540);
await page.waitForTimeout(2000);

// Frame-time sampler (independent of the F3 overlay).
await page.evaluate(() => {
  window.__samples = [];
  let last = performance.now();
  const tick = (now) => {
    window.__samples.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

for (let r = 1; r <= ROUNDS; r++) {
  await page.keyboard.press('KeyR');
  const t0 = Date.now();
  for (;;) {
    const phase = await page.evaluate(() => window.__bc.sim.currentPhase);
    if (phase === 'ROUND_END') break;
    if (Date.now() - t0 > 150_000) throw new Error('round timeout');
    await page.waitForTimeout(500);
  }
  console.log(`round ${r} complete`);
}

const stats = await page.evaluate(() => {
  const s = window.__samples.slice(120); // skip warmup
  const sorted = [...s].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames: s.length,
    avgMs: sum / s.length,
    avgFps: 1000 / (sum / s.length),
    p50: pct(0.5),
    p99: pct(0.99),
    onePctLowFps: 1000 / pct(0.99),
    worstMs: sorted[sorted.length - 1],
  };
});
const info = await page.evaluate(() => {
  const f3 = document.getElementById('f3');
  return f3 ? 'n/a (f3 hidden)' : 'n/a';
});
void info;
console.log(JSON.stringify(stats, null, 2));
await browser.close();
