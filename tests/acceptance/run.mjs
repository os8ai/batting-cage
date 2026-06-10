/**
 * The acceptance lane (§14.11–.13, .15, .18, .20): builds nothing — run
 * `npm run build` first. Serves dist/ on :4317, then runs the steps
 * sequentially: throttled-load (M4, fresh profile, CDP 20 Mbps) → the four
 * M3 scenarios in one persistent profile (First Contact seeds the career
 * the others chain on) → the network-zero audit (M4, fresh profile).
 * Separate from `npm test` (the ~3 s headless lane) by design.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const scenarios = [
  'throttledLoad.mjs',
  'firstContact.mjs',
  'mastery.mjs',
  'duel.mjs',
  'durability.mjs',
  'networkAudit.mjs',
];
mkdirSync('tests/acceptance/shots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server never came up')), 15000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('4317')) {
      clearTimeout(t);
      resolve();
    }
  });
  server.on('exit', () => reject(new Error('preview server exited')));
});

let failed = false;
for (const file of scenarios) {
  console.log(`\n=== ${file} ===`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn('node', [`tests/acceptance/${file}`], { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (code !== 0) {
    failed = true;
    console.error(`FAIL ${file}`);
    break;
  }
}

server.kill();
process.exit(failed ? 1 : 0);
