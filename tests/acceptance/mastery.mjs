/**
 * §14.12 — "Mastery Session": enthusiast, returning. Loadout auto-resumed
 * (bat/handedness/tier preselected so one press proceeds), ≥ 3 rounds
 * sustained, session aggregates (median |ε|, contact %, hard-hit %)
 * persisted and rendered on the monitor. Chains on First Contact's profile.
 */
import { assert, assertNoErrors, boot, launch, playRound, save, waitFn } from './helpers.mjs';

const { context, page, errors } = await launch();
await boot(page);

// Returning visit: career resumed, coaching dark, attract carousel has data.
const s0 = await save(page);
assert(s0.recentRounds.length >= 1, 'career resumed from the prior visit');
const coach = await page.evaluate(() => window.__bc.cage.board.machine.coachLine);
assert(coach === null, 'no coaching for a returning player');

// Change the loadout (metal bat), flush, reload: it must auto-resume.
await page.keyboard.press('KeyB');
await page.evaluate(() => window.__bc.recorder.flush());
await boot(page); // new visit
const resumed = await page.evaluate(() => window.__bc.save.loadout);
assert(resumed.bat === 'METAL', `loadout auto-resumed, got bat=${resumed.bat}`);
const batterBat = await page.evaluate(() => window.__bc.cage.batter.bat);
assert(batterBat === 'METAL', 'the batter actually holds the resumed bat');

// First Contact's medal unlocked 50: select it at the panel (arrows + SPACE)
// — the §8 ladder in the browser.
const unlocked = await page.evaluate(() => window.__bc.sim.unlockedTiers.slice());
assert(unlocked.includes(50), `50 mph unlocked by round one's medal (got ${unlocked})`);
await page.keyboard.press('ArrowDown'); // camera → panel (focus on selected 40)
await page.waitForTimeout(1200);
await page.keyboard.press('ArrowDown'); // focus 50
await page.keyboard.press('Space'); // confirm 50
await waitFn(page, '() => window.__bc.sim.currentTier === 50', 4000, 'tier 50 selected');

// ≥ 3 rounds, one token each (SPACE at the slot), riding out the recap +
// initials between rounds.
for (let round = 1; round <= 3; round++) {
  await page.keyboard.press('Space'); // insert token
  await waitFn(page, '() => window.__bc.sim.inRound', 6000, `round ${round} started`);
  console.log(`  round ${round} under way (50 mph)…`);
  await playRound(page);
  // Ride the ceremonies; skip initials when the round made the top-5.
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => ({
      initials: window.__bc.cage.board.machine.inInitials,
      kind: window.__bc.cage.board.machine.page.kind,
    }));
    if (st.initials) {
      await page.keyboard.press('Space');
      continue;
    }
    if (st.kind === 'ROUND_OVER' || st.kind === 'ATTRACT') break;
    await page.waitForTimeout(500);
  }
}

// Session aggregates persisted (§What 8: median |ε|, contact %, hard-hit %).
const s1 = await save(page);
const today = s1.sessions[s1.sessions.length - 1];
assert(today.rounds >= 3, `session sustained ≥ 3 rounds (got ${today.rounds})`);
assert(today.medianAbsEpsMs !== null && today.medianAbsEpsMs >= 0, 'median |ε| recorded');
assert(today.contactPct > 0, 'contact % recorded');
assert(typeof today.hardHitPct === 'number', 'hard-hit % recorded');
console.log(
  `  session: rounds=${today.rounds} med|ε|=${today.medianAbsEpsMs?.toFixed(1)}ms contact=${today.contactPct.toFixed(0)}% hard=${today.hardHitPct.toFixed(0)}%`
);

// …and rendered on the monitor: TAB to the station, cycle to SESSIONS/TREND.
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
const pages = ['AVERAGES', 'MEDALS', 'SESSIONS', 'TREND'];
for (const want of pages) {
  await page.keyboard.press('Tab');
  const got = await page.evaluate(() => window.__bc.cage.monitor.page);
  assert(got === want, `monitor cycles to ${want} (got ${got})`);
}
await page.screenshot({ path: 'tests/acceptance/shots/mastery-monitor-trend.png' });

assertNoErrors(errors, 'mastery');
console.log('PASS mastery (E2)');
await context.close();
