/**
 * §12 / §14.14/.16 perf gate (M4 E3 — binary: any breach exits non-zero).
 * 3 scripted rounds at 1080p on the real GPU (system chromium, ANGLE/Vulkan),
 * High preset hardware. Samples every rAF frame; swings are timed for contact
 * so the cloth net takes a hit every pitch and the settled pile fills.
 *
 * Gates:
 *   avg fps ≥ 58 · 1% low ≥ 50 fps          (§14.14: 60 sustained at High)
 *   rAF-callback JS p99 ≤ 6 ms              (§12 main-thread budget)
 *   worst frame ≤ 2× median                 (§14.16 GC proxy: a >2 ms GC pause
 *                                            inside a 16.7 ms frame breaches)
 *   max impact frame ≤ 1.1× median          (M2 E2, kept)
 *   draw calls < 120 · tris < 500k mid-round (§12 scene budget, full pile)
 *
 * PRECONDITION: idle machine — a concurrent GPU/SwiftShader run contaminates
 * pacing (M3 lesson). Perf runs are serialized in any combined script.
 *
 * Usage: node scripts/perf.mjs [url]   (default: vite preview at :4173)
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

// rAF-callback wrap (must land before the app's loop is constructed): every
// scheduled callback is timed — the game loop (sim ticks + render submit) is
// one callback, so its duration IS the per-frame main-thread JS cost.
await page.addInitScript(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__jsFrames = []; // [endMs, callbackMs]
  window.requestAnimationFrame = (cb) =>
    orig((t) => {
      const s = performance.now();
      cb(t);
      const e = performance.now();
      window.__jsFrames.push([e, e - s]);
    });
});

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
  // (ε ≈ 0 → contact every pitch → net hit + a settling ball every cycle).
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

// Scene-budget sampler: renderer.info holds the previous frame's counters
// between frames (main.ts resets at the top of each frame's render).
let maxCalls = 0;
let maxTris = 0;
let settledSeen = 0;

for (let r = 1; r <= ROUNDS; r++) {
  await page.evaluate(() => {
    window.__pressed = {};
  });
  await page.keyboard.press('Space'); // M3 token slot (R retired)
  const t0 = Date.now();
  for (;;) {
    const phase = await page.evaluate(() => window.__bc.sim.currentPhase);
    if (phase === 'ROUND_END') break;
    if (Date.now() - t0 > 150_000) throw new Error('round timeout');
    const s = await page.evaluate(() => ({
      calls: window.__bc.renderer.info.render.calls,
      tris: window.__bc.renderer.info.render.triangles,
      settled: window.__bc.sim.settled.length,
    }));
    maxCalls = Math.max(maxCalls, s.calls);
    maxTris = Math.max(maxTris, s.tris);
    settledSeen = Math.max(settledSeen, s.settled);
    await page.waitForTimeout(500);
  }
  const grades = await page.evaluate(() => window.__bc.sim.roundRecords.map((x) => x.grade));
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
  // Main-thread JS: p99 of rAF-callback durations after warmup.
  const js = window.__jsFrames.slice(120).map((s) => s[1]).sort((a, b) => a - b);
  const jsPct = (p) => js[Math.min(js.length - 1, Math.floor(js.length * p))];
  return {
    frames: dts.length,
    avgMs: sum / dts.length,
    avgFps: 1000 / (sum / dts.length),
    p50: median,
    p99: pct(0.99),
    onePctLowFps: 1000 / pct(0.99),
    worstMs: sorted[sorted.length - 1],
    worstOverMedian: sorted[sorted.length - 1] / median,
    jsP50Ms: jsPct(0.5),
    jsP99Ms: jsPct(0.99),
    jsWorstMs: js[js.length - 1],
    impacts: impacts.length,
    impactFrames: impactDts.length,
    maxImpactMs: maxImpact,
    impactSpikeRatio: maxImpact / median,
  };
});
stats.maxDrawCalls = maxCalls;
stats.maxTriangles = maxTris;
stats.maxSettledBalls = settledSeen;
console.log(JSON.stringify(stats, null, 2));

// ---- the binary gate (M4 E3): every row must hold ---------------------------
const gates = [
  ['avg fps ≥ 58', stats.avgFps >= 58, stats.avgFps.toFixed(1)],
  ['1% low ≥ 50 fps', stats.onePctLowFps >= 50, stats.onePctLowFps.toFixed(1)],
  ['JS p99 ≤ 6 ms', stats.jsP99Ms <= 6, stats.jsP99Ms.toFixed(2)],
  ['worst frame ≤ 2× median (GC proxy)', stats.worstOverMedian <= 2, stats.worstOverMedian.toFixed(3)],
  [`impacts ≥ ${ROUNDS * 5}`, stats.impacts >= ROUNDS * 5, String(stats.impacts)],
  ['max impact frame ≤ 1.1× median', stats.impactSpikeRatio <= 1.1, stats.impactSpikeRatio.toFixed(3)],
  ['draw calls < 120 mid-round', stats.maxDrawCalls < 120, String(stats.maxDrawCalls)],
  ['triangles < 500k mid-round', stats.maxTriangles < 500_000, String(stats.maxTriangles)],
];
let ok = true;
for (const [name, pass, value] of gates) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${value})`);
  if (!pass) ok = false;
}
console.log(ok ? '§12 PERF GATE: PASS' : '§12 PERF GATE: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
