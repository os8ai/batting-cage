/**
 * §12 / §14.15 load-budget report + gate (M4 P4.1). Walks dist/ and prints
 * raw / gzip / brotli sizes per file and in total, then asserts:
 *   - JS ≤ 1.5 MB gzip (critical-path budget, §How)
 *   - total ≤ 15 MB Brotli (critical path, §12)
 *   - no "lil-gui" string anywhere in the bundle (triple fence #3, M4 P0)
 * Exits non-zero on any breach. Run `npm run build` first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const DIST = 'dist';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

let files;
try {
  files = walk(DIST);
} catch {
  console.error('load-budget: no dist/ — run `npm run build` first');
  process.exit(1);
}

let totalRaw = 0;
let totalGz = 0;
let totalBr = 0;
let jsGz = 0;
let lilGuiHits = [];

console.log('file'.padEnd(44) + 'raw'.padStart(12) + 'gzip'.padStart(12) + 'brotli'.padStart(12));
for (const f of files.sort()) {
  const buf = readFileSync(f);
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf).length;
  totalRaw += buf.length;
  totalGz += gz;
  totalBr += br;
  if (f.endsWith('.js')) {
    jsGz += gz;
    if (buf.includes('lil-gui')) lilGuiHits.push(f);
  }
  console.log(f.slice(DIST.length + 1).padEnd(44) + kb(buf.length).padStart(12) + kb(gz).padStart(12) + kb(br).padStart(12));
}
console.log('TOTAL'.padEnd(44) + kb(totalRaw).padStart(12) + kb(totalGz).padStart(12) + kb(totalBr).padStart(12));

const gates = [
  ['JS ≤ 1.5 MB gzip', jsGz <= 1.5 * 1024 * 1024, kb(jsGz)],
  ['total ≤ 15 MB Brotli', totalBr <= 15 * 1024 * 1024, kb(totalBr)],
  ['no lil-gui in bundle', lilGuiHits.length === 0, lilGuiHits.join(', ') || 'clean'],
];
let ok = true;
for (const [name, pass, value] of gates) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${value})`);
  if (!pass) ok = false;
}
console.log(ok ? '§12 LOAD BUDGET: PASS' : '§12 LOAD BUDGET: FAIL');
process.exit(ok ? 0 : 1);
