/**
 * M1 E1 / M2 E2 perf gate: 3 scripted rounds at 1080p on the real GPU
 * (system chromium, ANGLE/Vulkan). Samples every rAF frame time during
 * rounds and reports avg fps, 1% low, and — new in M2 — the impact-frame
 * spike check: every swing is timed for contact, so balls test the cloth
 * net every pitch; frames within 250 ms after a NET_HIT count as impact
 * frames and their max must stay ≤ 1.1 × the median frame (§13 M2 exit).
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

// Frame-time sampler + impact log (independent of the F3 overlay).
await page.evaluate(() => {
  window.__samples = []; // [frameEndMs, dtMs]
  let last = performance.now();
  const tick = (now) => {
    window.__samples.push([now, now - last]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.__impacts = [];
  window.__bc.sim.onEvent((e) => {
    if (e.type === 'NET_HIT' || e.type === 'BACKSTOP_HIT') window.__impacts.push(performance.now());
  });

  // Timed swinger: press SPACE through the real input path at plate−150 ms
  // (ε ≈ 0 → contact every pitch → the net takes a hit every cycle).
  window.__pressed = {};
  window.__swinger = setInterval(() => {
    const { sim, loop } = window.__bc;
    if (sim.currentPhase !== 'FLIGHT') return;
    const plate = sim.scheduledPlateTime();
    if (plate === null || window.__pressed[`${sim.currentPitch}`]) return;
    const now = loop.simTimeOf(performance.now());
    if (now >= plate - 0.155) {
      window.__pressed[`${sim.currentPitch}`] = true;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    }
  }, 3);
});

for (let r = 1; r <= ROUNDS; r++) {
  await page.evaluate(() => {
    window.__pressed = {};
  });
  await page.keyboard.press('KeyR');
  const t0 = Date.now();
  for (;;) {
    const phase = await page.evaluate(() => window.__bc.sim.currentPhase);
    if (phase === 'ROUND_END') break;
    if (Date.now() - t0 > 150_000) throw new Error('round timeout');
    await page.waitForTimeout(500);
  }
  const grades = await page.evaluate(() =>
    window.__bc.sim.roundRecords.map((x) => x.grade)
  );
  console.log(`round ${r} complete: ${grades.join(' ')}`);
}

const stats = await page.evaluate(() => {
  const all = window.__samples.slice(120); // skip warmup
  const dts = all.map((s) => s[1]);
  const sorted = [...dts].sort((a, b) => a - b);
  const sum = dts.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  // Impact frames: every frame ending within 250 ms after a NET/BACKSTOP hit
  // (the cloth reaction + rustle dispatch window).
  const impacts = window.__impacts;
  const impactDts = all
    .filter(([end]) => impacts.some((t) => end >= t && end - t < 250))
    .map((s) => s[1]);
  const median = pct(0.5);
  const maxImpact = impactDts.length ? Math.max(...impactDts) : 0;
  return {
    frames: dts.length,
    avgMs: sum / dts.length,
    avgFps: 1000 / (sum / dts.length),
    p50: median,
    p99: pct(0.99),
    onePctLowFps: 1000 / pct(0.99),
    worstMs: sorted[sorted.length - 1],
    impacts: impacts.length,
    impactFrames: impactDts.length,
    maxImpactMs: maxImpact,
    impactSpikeRatio: maxImpact / median,
  };
});
console.log(JSON.stringify(stats, null, 2));
const ok = stats.impacts >= ROUNDS * 5 && stats.impactSpikeRatio <= 1.1;
console.log(
  ok
    ? `E2 PASS: ${stats.impacts} impacts, max impact frame ${stats.maxImpactMs.toFixed(2)} ms = ${stats.impactSpikeRatio.toFixed(3)}× median`
    : `E2 FAIL: impacts=${stats.impacts} spikeRatio=${stats.impactSpikeRatio.toFixed(3)}`
);
await browser.close();
process.exit(ok ? 0 : 1);
