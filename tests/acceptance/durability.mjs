/**
 * §14.18 (browser half) — the save survives reload and simulated eviction
 * (restore via the real ESC-sheet import), and hostile imports are refused
 * with a board message, prior save intact. Chains on the Duel profile.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { assert, assertNoErrors, boot, launch, save, waitFn } from './helpers.mjs';

const { context, page, errors } = await launch();
await boot(page);

const TMP = 'tests/acceptance/.tmp';
mkdirSync(TMP, { recursive: true });

// -- reload survival ----------------------------------------------------------
const before = await save(page);
assert(before.recentRounds.length >= 1, 'career present before reload');
await boot(page); // reload + splash
const after = await save(page);
assert(after.meta.saveId === before.meta.saveId, 'same career after reload');
assert(after.recentRounds.length === before.recentRounds.length, 'rounds intact after reload');

// Export the career to disk (the .json the player would download).
const exported = JSON.stringify(after, null, 2);
writeFileSync(`${TMP}/career.json`, exported);

// -- simulated eviction + import restore (real ESC-sheet UI) ------------------
await page.evaluate(() => window.localStorage.clear());
await boot(page);
const wiped = await save(page);
assert(wiped.meta.saveId !== before.meta.saveId, 'eviction minted a fresh career');
assert(wiped.recentRounds.length === 0, 'fresh career is empty');

await page.keyboard.press('Escape'); // pause sheet
const chooser = page.waitForEvent('filechooser');
await page.getByText('IMPORT SAVE').click();
const reloaded = page.waitForEvent('load'); // a good import promotes, then reloads
await (await chooser).setFiles(`${TMP}/career.json`);
await reloaded;
await waitFn(page, '() => !!window.__bc', 20000, 'reboot after import');
await page.mouse.click(640, 360); // splash again
await page.waitForTimeout(400);
const restored = await save(page);
assert(restored.meta.saveId === before.meta.saveId, 'import restored the career');
assert(restored.recentRounds.length === before.recentRounds.length, 'rounds restored losslessly');
assert(JSON.stringify(restored) === JSON.stringify(after), 'byte-lossless round trip');
console.log('  eviction restore: lossless');

// -- hostile imports refused, prior save intact -------------------------------
const newer = JSON.parse(exported);
newer.meta.schemaVersion = 99;
writeFileSync(`${TMP}/newer.json`, JSON.stringify(newer));
writeFileSync(`${TMP}/corrupt.json`, exported.slice(0, 180));

for (const [file, message] of [
  ['newer.json', 'SAVE FROM A NEWER VERSION'],
  ['corrupt.json', 'NOT A SAVE FILE'],
]) {
  await page.keyboard.press('Escape');
  const fc = page.waitForEvent('filechooser');
  await page.getByText('IMPORT SAVE').click();
  await (await fc).setFiles(`${TMP}/${file}`);
  await page.waitForTimeout(800);
  // Refusal surfaces (toast carries the board message text).
  const toastShown = await page.evaluate(
    (msg) => [...document.querySelectorAll('div')].some((d) => d.textContent === msg),
    message
  );
  assert(toastShown, `refusal message "${message}" surfaced for ${file}`);
  await page.keyboard.press('Escape'); // close the sheet
  const stillThere = await save(page);
  assert(stillThere.meta.saveId === before.meta.saveId, `prior save intact after ${file}`);
  assert(stillThere.recentRounds.length === before.recentRounds.length, `rounds intact after ${file}`);
}
console.log('  hostile imports: refused, save intact');

assertNoErrors(errors, 'durability');
console.log('PASS durability (E4 browser half)');
await context.close();
