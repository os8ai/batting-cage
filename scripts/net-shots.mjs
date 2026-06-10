/**
 * M2 E1 harness (dev-only): boots the built app headlessly with ?dev=1 and
 * injects synthetic NET_HIT events straight into the Net actor at low / mid /
 * high impact speeds (a 60 EV flare vs a 102 EV rope). Verifies E1 two ways:
 *  - quantitatively: peak node displacement through the REAL actor pipeline
 *    must grow with impact speed and decay back toward rest;
 *  - visually: oblique screenshots of the far panel for the playtest record.
 *
 * Usage: node scripts/net-shots.mjs [url] (default http://localhost:4173/?dev=1)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:4173/?dev=1';
const OUT = 'scripts/shots/net';
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
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.mouse.click(640, 360); // splash → unlock
await page.waitForTimeout(1500);

// Oblique view across the far panel so the bulge silhouettes; borrow a scene
// light as a work lamp so the dim far end reads on camera (shoot-only).
await page.evaluate(() => {
  const { rig, cage } = window.__bc;
  rig.update = () => {}; // freeze the director for the shoot
  rig.camera.position.set(-1.7, 1.9, 15.2);
  rig.camera.lookAt(2.0, 1.7, 18.9);
  let lamp = null;
  cage.scene.traverse((o) => {
    if (!lamp && o.isLight && o.intensity !== undefined) lamp = o;
  });
  if (lamp) {
    const work = lamp.clone();
    work.castShadow = false;
    work.intensity = lamp.intensity * 3;
    work.position.set(0, 2.5, 15.5);
    if (work.target) {
      work.target.position.set(0.5, 1.8, 18.9);
      cage.scene.add(work.target);
    }
    cage.scene.add(work);
  }
});

// In-page helpers over the (runtime-visible) panel internals.
const snapshotRest = (panelName) =>
  page.evaluate((name) => {
    const p = window.__bc.cage.net.panels.find((q) => q.name === name);
    window.__rest = Float32Array.from(p.cloth.pos);
    return p.cloth.pos.length / 3;
  }, panelName);
const maxDeviation = (panelName) =>
  page.evaluate((name) => {
    const p = window.__bc.cage.net.panels.find((q) => q.name === name);
    let max = 0;
    for (let j = 0; j < p.cloth.pos.length; j++) {
      const d = Math.abs(p.cloth.pos[j] - window.__rest[j]);
      if (d > max) max = d;
    }
    return max;
  }, panelName);
const inject = (panelName, speed, px, py, pz) =>
  page.evaluate(
    ({ name, speed, px, py, pz }) => {
      window.__bc.cage.net.onEvent({ type: 'NET_HIT', t: 0, px, py, pz, speedMps: speed, panel: name });
    },
    { name: panelName, speed, px, py, pz }
  );

// speedMps ≈ at-net speeds: 60 EV flare ≈ 12 m/s, 96 EV drive ≈ 30, 102 EV rope ≈ 45.
const cases = [
  { name: 'low-60ev', speed: 12 },
  { name: 'mid-96ev', speed: 30 },
  { name: 'high-102ev', speed: 45 },
];

const results = [];
for (const c of cases) {
  await page.waitForTimeout(2500); // settle fully between cases
  await snapshotRest('far');
  await inject('far', c.speed, 0.3, 1.9, 18.85);
  let peak = 0;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(120);
    peak = Math.max(peak, await maxDeviation('far'));
    if (i === 2) await page.screenshot({ path: `${OUT}/${c.name}-peak.png` });
  }
  await page.waitForTimeout(2500);
  const residual = await maxDeviation('far');
  results.push({ ...c, peakM: peak, residualM: residual });
  await page.screenshot({ path: `${OUT}/${c.name}-recovered.png` });
}

// Ceiling-strip special case (P2.4): same quantitative check.
await snapshotRest('ceiling');
await inject('ceiling', 28, 0, 3.62, 7.5);
let ceilPeak = 0;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(120);
  ceilPeak = Math.max(ceilPeak, await maxDeviation('ceiling'));
}
results.push({ name: 'ceiling-90ev', speed: 28, peakM: ceilPeak, residualM: null });

console.log('--- net reaction (m) ---');
for (const r of results) {
  console.log(
    `${r.name.padEnd(14)} speed ${String(r.speed).padStart(2)} m/s → peak ${r.peakM.toFixed(3)}` +
      (r.residualM === null ? '' : `, residual ${r.residualM.toFixed(3)}`)
  );
}
const [lo, mid, hi] = results;
const ok =
  lo.peakM > 0.02 &&
  mid.peakM > lo.peakM * 1.3 &&
  hi.peakM > mid.peakM * 1.05 &&
  results.every((r) => r.residualM === null || r.residualM < 0.08) &&
  ceilPeak > 0.05;
console.log(ok ? 'E1 PASS: reaction grows with EV and recovers' : 'E1 FAIL');
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
