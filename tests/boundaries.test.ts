import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SPEC §Architecture dependency rule, enforced headlessly: core/ imports
 * nothing outside core/ — zero Three.js, zero DOM, zero app/scene/ui/input.
 * (ESLint carries the same rule for editor feedback; this test is the gate.)
 */
const CORE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/core');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('core purity (import boundaries)', () => {
  const files = tsFilesUnder(CORE_DIR);

  it('finds the core modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of tsFilesUnder(CORE_DIR)) {
    it(`${file.slice(CORE_DIR.length + 1)} imports only within core/`, () => {
      const src = readFileSync(file, 'utf8');
      const specs = [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of specs) {
        expect(spec.startsWith('.'), `bare/external import "${spec}" in core/`).toBe(true);
        const target = resolve(dirname(file), spec);
        expect(
          target.startsWith(CORE_DIR),
          `"${spec}" resolves outside core/ (${target})`
        ).toBe(true);
      }
    });
  }

  it('sim.ts never reaches cloth.ts — one-way coupling is structural (M2 E6)', () => {
    // §Architecture: "gameplay outcomes never read cloth state". The cloth
    // solver lives in core for purity/testability, but only presentation
    // (scene/actors/Net.ts) may import it: walk sim.ts's import closure.
    const clothPath = join(CORE_DIR, 'physics', 'cloth.ts');
    const seen = new Set<string>();
    const queue = [join(CORE_DIR, 'sim.ts')];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file, 'core/sim.ts transitively imports cloth.ts').not.toBe(clothPath);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
        let target = resolve(dirname(file), m[1]!);
        if (!target.endsWith('.ts')) target += '.ts';
        queue.push(target);
      }
    }
    expect(seen.size).toBeGreaterThan(5); // the walk really traversed the core
  });
});
