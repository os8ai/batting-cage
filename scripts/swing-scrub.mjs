/**
 * Dev swing-plane inspector: scrubs the swing clip to fixed times with the
 * mixer frozen and screenshots each pose from two angles. True stills — no
 * freeze races.
 *
 * Usage: node scripts/swing-scrub.mjs (vite preview must be running)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'scripts/shots/pose';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell`,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:4173/?dev=1', { waitUntil: 'networkidle' });
await page.mouse.click(400, 400);
await page.waitForTimeout(1500);

// Put the swing action in control, frozen, and scrub it.
await page.evaluate(() => {
  const batter = window.__bc.cage.batter;
  const actions = batter['actions'];
  for (const k of Object.keys(actions)) actions[k].stop();
  const swing = actions.swing;
  swing.reset();
  swing.setEffectiveTimeScale(0);
  swing.play();
  window.__scrub = (t) => {
    swing.time = t;
    batter['mixer'].update(0);
  };
});

const aim = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) => {
      const rig = window.__bc.rig;
      rig.playBase.set(x, y, z);
      rig.playLook.set(0.85, 1.2, 0.1);
      rig.look.set(0.85, 1.2, 0.1);
    },
    [x, y, z]
  );

const TIMES = [0.0, 0.12, 0.18, 0.21, 0.3, 0.45];
const VIEWS = { machine: [0.85, 1.6, 3.4], plate: [-1.1, 1.5, 0.3] };

for (const [view, pos] of Object.entries(VIEWS)) {
  await aim(...pos);
  await page.waitForTimeout(400);
  for (const t of TIMES) {
    await page.evaluate((t) => window.__scrub(t), t);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/scrub-${view}-${String(t).replace('.', '_')}.png` });
  }
}
console.log('scrub shots saved');
await browser.close();
