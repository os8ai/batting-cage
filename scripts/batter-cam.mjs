/**
 * Dev pose inspector: orbits the play camera around the batter and freezes
 * key swing frames, saving close-up screenshots for pose review.
 *
 * Usage: node scripts/batter-cam.mjs (vite preview must be running)
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

// Aim the play camera at the batter from a given angle (runtime access to
// the rig's private fields — dev-only).
const aim = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) => {
      const rig = window.__bc.rig;
      rig.playBase.set(x, y, z);
      rig.playLook.set(0.85, 1.3, 0.1); // batter chest/head area
      rig.look.set(0.85, 1.3, 0.1);
    },
    [x, y, z]
  );

const ANGLES = {
  'from-plate': [-0.8, 1.5, 0.1], // looking at his chest from the plate side
  'from-machine': [0.85, 1.5, 3.2], // pitcher's view
  'from-camera-side': [0.3, 1.6, -1.0], // the real play camera direction
  'from-behind': [2.6, 1.5, 0.1], // from outside the cage behind his back
};

// Token → wait for LOAD (waggle) pose, then orbit.
await page.keyboard.press('KeyR');
const waitPhase = async (want) => {
  for (let i = 0; i < 600; i++) {
    if ((await page.evaluate(() => window.__bc.sim.currentPhase)) === want) return;
    await page.waitForTimeout(40);
  }
  throw new Error('timeout: ' + want);
};
await waitPhase('LOAD');
for (const [name, pos] of Object.entries(ANGLES)) {
  await aim(...pos);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/load-${name}.png` });
}

// Swing freeze-frames: press on this pitch, pause at contact and follow-through.
await page.evaluate(() => {
  const { sim, loop } = window.__bc;
  const target = sim.scheduledPlateTime() - 0.15;
  window.__contactFrozen = false;
  sim.onEvent((e) => {
    if (e.type === 'CONTACT') {
      let n = 0;
      const tick = () => (++n >= 1 ? ((loop.setPaused(true), (window.__contactFrozen = true))) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }
  });
  const fire = () => {
    if (loop.simTimeOf(performance.now()) >= target) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    } else setTimeout(fire, 2);
  };
  fire();
});
for (let i = 0; i < 600; i++) {
  if (await page.evaluate(() => window.__contactFrozen === true)) break;
  await page.waitForTimeout(40);
}
// Orbit the frozen contact pose (camera still updates? loop paused → no
// render. Unpause with a huge timescale freeze instead: just screenshot the
// frozen frame from the angle the camera was last at, then resume + re-aim
// won't help. So: screenshot once frozen, then resume and catch follow-through.)
await page.screenshot({ path: `${OUT}/swing-contact-playcam.png` });

// Resume; catch follow-through ~0.25 s later from the machine side.
await page.evaluate(() => window.__bc.loop.setPaused(false));
await aim(...ANGLES['from-machine']);
await page.waitForTimeout(150);
await page.evaluate(() => window.__bc.loop.setPaused(true));
await page.screenshot({ path: `${OUT}/swing-follow-machine.png` });
await page.evaluate(() => window.__bc.loop.setPaused(false));

console.log('pose shots saved');
await browser.close();
