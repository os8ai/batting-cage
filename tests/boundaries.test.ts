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
});
