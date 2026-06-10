/**
 * §14.13 — "Pass-the-Keyboard Duel": hot-seat. Round-end → re-tokened round
 * in ≤ 2 keys and ≤ 10 s; initials entry on a top-5 score; the attract
 * carousel shows the updated table. Chains on the Mastery profile.
 */
import { assert, assertNoErrors, boot, launch, playRound, save, waitFn } from './helpers.mjs';

const { context, page, errors } = await launch();
await boot(page);

// Player A: one round at the resumed tier (50 from Mastery).
await page.keyboard.press('Space');
await waitFn(page, '() => window.__bc.sim.inRound', 6000, 'player A round');
console.log('  player A swings…');
await playRound(page);

// Top-5 score → INITIALS entry (the table still has open slots at 50).
await waitFn(page, '() => window.__bc.cage.board.machine.inInitials', 45000, 'initials page');
// Enter "BAA": ArrowUp on slot 1, confirm ×3.
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
await waitFn(page, '() => !window.__bc.cage.board.machine.inInitials', 5000, 'initials confirmed');

const s1 = await save(page);
const top5 = s1.tiers['50'].top5;
assert(
  top5.some((e) => e.initials === 'BAA'),
  `top-5 carries the new initials (got ${JSON.stringify(top5.map((e) => e.initials))})`
);
assert(s1.loadout.lastInitials === 'BAA', 'initials default to last-used next time');

// Hand the keyboard: ONE key, re-tokened at the same tier, within 10 s.
const t0 = Date.now();
await page.keyboard.press('Space');
await waitFn(page, '() => window.__bc.sim.inRound', 6000, 'player B round');
const handoffS = (Date.now() - t0) / 1000;
assert(handoffS <= 10, `handoff took ${handoffS.toFixed(1)} s (> 10)`);
const tier = await page.evaluate(() => window.__bc.sim.currentTier);
assert(tier === 50, 'same tier re-token');
console.log(`  handoff: 1 key, ${handoffS.toFixed(2)} s`);

// The attract carousel data shows the update (ATTRACT-2 renders from it).
const carousel = await page.evaluate(() => window.__bc.cage.board.machine.attractData);
const row50 = carousel.top5ByTier.find((t) => t.tier === 50);
assert(
  row50.entries.some((e) => e.initials === 'BAA'),
  'attract carousel table carries the new initials'
);

assertNoErrors(errors, 'duel');
console.log('PASS duel (E3)');
await context.close();
