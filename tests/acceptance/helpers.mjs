/**
 * Shared helpers for the §14.11–.13/.18 Playwright acceptance scenarios.
 * Cached headless shell + SwiftShader (the smoke.mjs binary): scenarios
 * assert flow/state/persistence, never frame rate. Real keyboard input
 * throughout; the ?dev=1 hook is read-only (phase polling, save inspection).
 * Swing timing polls the LIVE wall↔sim mapping (loop.simTimeOf) — never
 * precomputed wall times (the hitch clamp shifts the epoch; M1 smoke lesson).
 */
import { rmSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const BASE_URL = process.env.BC_URL ?? 'http://localhost:4317';

/** Shared persistent profile: scenarios chain on one career (Flow 2 visits). */
export const PROFILE_DIR = 'tests/acceptance/.profile';

const executablePath =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1223/chrome-linux/headless_shell`;

export async function launch({ resetProfile = false } = {}) {
  if (resetProfile) rmSync(PROFILE_DIR, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath,
    viewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  return { context, page, errors };
}

/** Cold boot: navigate (fresh or persisted per the context) + splash click. */
export async function boot(page, { fresh = false } = {}) {
  await page.goto(`${BASE_URL}/?dev=1`, { waitUntil: 'networkidle' });
  if (fresh) {
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForFunction(() => !!window.__bc, null, { timeout: 20000 });
  await page.mouse.click(640, 360); // STEP INTO THE CAGE (audio unlock)
  await page.waitForTimeout(400);
}

export const phase = (page) => page.evaluate(() => window.__bc.sim.currentPhase);

export async function waitPhase(page, want, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const p = await phase(page);
    if (Array.isArray(want) ? want.includes(p) : p === want) return p;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${want} (at ${p})`);
    await page.waitForTimeout(40);
  }
}

export async function waitFn(page, fn, timeoutMs = 60000, label = 'condition') {
  // String predicates are wrapped so the EXPRESSION's value comes back
  // (a bare stringified arrow would evaluate to the function object).
  const expr = typeof fn === 'string' ? `(${fn})()` : fn;
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(expr)) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await page.waitForTimeout(50);
  }
}

/**
 * Swing the current pitch with a SPACE keydown aimed at ε ≈ 0. The press is
 * scheduled IN-PAGE off the live wall↔sim mapping (the smoke.mjs technique):
 * under SwiftShader the main thread runs ~250 ms frames and the hitch clamp
 * dilates sim time, so a Node-side poll reads stale time and lands ±200 ms
 * off. An in-page timer makes the decision and the dispatch one atomic task —
 * the keydown timestamp is exactly what a real key would carry.
 */
export async function swingPitch(page) {
  await waitPhase(page, 'FLIGHT', 20000);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const { sim, loop } = window.__bc;
        const target = sim.scheduledPlateTime() - 0.15; // ideal press = plate − K
        const fire = () => {
          if (loop.simTimeOf(performance.now()) >= target) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
            resolve(undefined);
          } else {
            setTimeout(fire, 2);
          }
        };
        fire();
      })
  );
}

/** Wait until the pitch counter reaches n with the machine FED (in-cycle). */
export async function waitPitch(page, n, timeoutMs = 30000) {
  await waitFn(page, `() => window.__bc.sim.currentPitch >= ${n}`, timeoutMs, `pitch ${n}`);
}

/**
 * Play a full 10-pitch round with timed swings (every pitch attempted).
 * Assumes a round is starting (TOKEN already inserted). ~87 s real time.
 */
export async function playRound(page) {
  for (let p = 1; p <= 10; p++) {
    await waitPitch(page, p);
    await swingPitch(page);
    // Wait out the cycle so the next pitch's FLIGHT is really pitch p+1.
    if (p < 10) await waitPitch(page, p + 1, 30000);
  }
  await waitPhase(page, 'ROUND_END', 30000);
}

export const save = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__bc.save)));

export function fail(msg) {
  throw new Error(msg);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

export function assertNoErrors(errors, label) {
  // SwiftShader spews GL fallback warnings as plain logs; we collected only
  // hard errors. Any page error fails the scenario.
  if (errors.length > 0) throw new Error(`${label}: page errors\n${errors.join('\n')}`);
}
