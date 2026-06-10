/**
 * §14.11 — "First Contact": casual player, cold machine. Cold load → attract
 * offers exactly one action → first pitch ≤ 60 s from load → board coaching
 * on → signature beats ≤ 30 s of play → completes round one unaided →
 * starts round two. Fresh profile (the wiped-career FTUE path, §Flow 1).
 */
import {
  assert,
  assertNoErrors,
  boot,
  launch,
  save,
  swingPitch,
  waitFn,
  waitPhase,
  waitPitch,
} from './helpers.mjs';

const { context, page, errors } = await launch({ resetProfile: true });
const tLoad = Date.now();
await boot(page, { fresh: true });
const tPlayStart = Date.now();

// Attract: first run shows exactly ONE action (INSERT TOKEN), and the
// machine idles with no round.
await waitFn(page, '() => window.__bc.cage.board.machine.page.kind === "ATTRACT"', 10000, 'attract page');
const attract = await page.evaluate(() => window.__bc.cage.board.machine.page);
assert(attract.variant === 1, `first-run attract must be ATTRACT-1, got ${attract.variant}`);
const tier = await page.evaluate(() => window.__bc.sim.currentTier);
assert(tier === 40, `cold machine boots at 40 mph, got ${tier}`);
const loadout = await page.evaluate(() => window.__bc.save.loadout);
assert(loadout.handedness === 'R' && loadout.bat === 'WOOD', 'defaults righty/wood');

// The one action: SPACE inserts the token.
await page.keyboard.press('Space');
await waitFn(page, '() => window.__bc.sim.inRound', 5000, 'round started');

// Coaching: WATCH THE LIGHT on the first feed.
await waitPitch(page, 1);
const coach1 = await page.evaluate(() => window.__bc.cage.board.machine.coachLine);
assert(coach1 === 'WATCH THE LIGHT', `coach pre-release, got ${coach1}`);

// First pitch (FLIGHT) within 60 s of URL load (§14.11).
await waitPhase(page, 'FLIGHT', 20000);
const firstPitchS = (Date.now() - tLoad) / 1000;
assert(firstPitchS <= 60, `first pitch took ${firstPitchS.toFixed(1)} s (> 60)`);
const coach2 = await page.evaluate(() => window.__bc.cage.board.machine.coachLine);
assert(coach2 === 'SPACE TO SWING', `coach during flight, got ${coach2}`);

// Swing pitch 1 — the signature beats (crack + net + board number) land now.
await swingPitch(page);
await waitFn(
  page,
  '() => window.__bc.sim.roundRecords.length >= 1 && window.__bc.sim.roundRecords[0].carryFt !== null',
  10000,
  'pitch 1 contact'
);
const beatS = (Date.now() - tPlayStart) / 1000;
assert(beatS <= 30, `signature beats took ${beatS.toFixed(1)} s of play (> 30)`);
const rec1 = await page.evaluate(() => window.__bc.sim.roundRecords[0]);
console.log(`  pitch 1: ${rec1.grade} eps=${rec1.epsMs?.toFixed(1)}ms carry=${rec1.carryFt}ft`);

// Finish the round unaided (timed presses on every remaining pitch).
for (let p = 2; p <= 10; p++) {
  await waitPitch(page, p);
  await swingPitch(page);
}
await waitPhase(page, 'ROUND_END', 30000);
const s1 = await save(page);
assert(s1.recentRounds.length === 1, 'round one persisted');
assert(s1.tiers['40'].pbs.bestRoundScore > 0, 'a score landed');
console.log(`  round 1 score: ${s1.recentRounds[0].score} medal: ${s1.recentRounds[0].medal}`);

// The recap/ceremony sequence plays; a first decent round enters the empty
// top-5 → INITIALS. Skip = three SPACE presses on the defaults (§What 7).
await waitFn(page, '() => window.__bc.cage.board.machine.inInitials', 45000, 'initials page');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
await waitFn(page, '() => !window.__bc.cage.board.machine.inInitials', 5000, 'initials done');

// Success criterion: starts round two (the §14.13 one-key re-token).
await page.keyboard.press('Space');
await waitFn(page, '() => window.__bc.sim.inRound', 5000, 'round two started');
const round2 = await page.evaluate(() => ({ tier: window.__bc.sim.currentTier, inRound: window.__bc.sim.inRound }));
assert(round2.tier === 40 && round2.inRound, 're-token at the same tier');

// Coaching is done after the first completed round.
const coachOff = await page.evaluate(() => window.__bc.cage.board.machine.coachLine);
assert(coachOff === null, 'coach dark in round two');

// Flush the career for the next visit (Mastery chains on this profile).
await page.evaluate(() => window.__bc.recorder.flush());
assertNoErrors(errors, 'firstContact');
console.log('PASS firstContact (E1)');
await context.close();
