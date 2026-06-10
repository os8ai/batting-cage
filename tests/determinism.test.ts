import { describe, expect, it } from 'vitest';
import { pressForEps, runScriptedRound, serializeEvents, type ScriptedPress } from './harness';
import type { TierMph } from '../src/core/types';

function scriptedPresses(tier: TierMph): ScriptedPress[] {
  // A varied round: perfects, earlies, lates, a foul, a hopeless whiff, takes.
  const eps = [0, -25, 70, -110, 140, 12, -60, 300, null, null] as const;
  const presses: ScriptedPress[] = [];
  eps.forEach((e, i) => {
    if (e !== null) presses.push({ t: pressForEps(tier, i + 1, e) });
  });
  return presses;
}

describe('§14 determinism & timing', () => {
  it('(1) identical seeds + scripted timestamps reproduce identical rounds bit-for-bit', () => {
    const a = runScriptedRound({ seed: 777, tier: 60, presses: scriptedPresses(60), frameDt: 1 / 60 });
    const b = runScriptedRound({ seed: 777, tier: 60, presses: scriptedPresses(60), frameDt: 1 / 60 });
    expect(serializeEvents(a.events)).toBe(serializeEvents(b.events));
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
  });

  it('(1b) a different seed changes jittered outcomes (no hidden constancy)', () => {
    const a = runScriptedRound({ seed: 1, tier: 60, presses: scriptedPresses(60), frameDt: 1 / 60 });
    const b = runScriptedRound({ seed: 2, tier: 60, presses: scriptedPresses(60), frameDt: 1 / 60 });
    const evA = a.records.filter((r) => r.evMph !== null).map((r) => r.evMph);
    const evB = b.records.filter((r) => r.evMph !== null).map((r) => r.evMph);
    expect(evA).not.toEqual(evB);
  });

  it('(2) frame-rate independence: 30 fps and 144 fps runs grade identical inputs identically', () => {
    for (const tier of [40, 90] as TierMph[]) {
      const presses = scriptedPresses(tier);
      const slow = runScriptedRound({ seed: 555, tier, presses, frameDt: 1 / 30 });
      const fast = runScriptedRound({ seed: 555, tier, presses, frameDt: 1 / 144 });
      // Judgments are timestamp-analytic: records must match exactly.
      expect(JSON.stringify(slow.records)).toBe(JSON.stringify(fast.records));
      // And the whole tick-driven event stream matches (ticks are the same grid).
      expect(serializeEvents(slow.events)).toBe(serializeEvents(fast.events));
    }
  });

  it('(3) reported ε equals the scripted oracle within 1 ms', () => {
    const tier = 70 as TierMph;
    const targets = [0, -25, 70, -110, 140, 12, -60, 33, -8, 99];
    const presses = targets.map((e, i) => ({ t: pressForEps(tier, i + 1, e) }));
    const { records } = runScriptedRound({ seed: 42, tier, presses, frameDt: 1 / 60 });
    records.forEach((r, i) => {
      expect(r.epsMs).not.toBeNull();
      expect(Math.abs(r.epsMs! - targets[i]!)).toBeLessThan(1);
    });
  });

  it('judgment is sub-tick analytic: ε resolution is finer than the 120 Hz tick', () => {
    // Two presses 2 ms apart must produce ε values 2 ms apart — a tick-
    // quantized judgment (8.3 ms grid) would collapse them.
    const tier = 60 as TierMph;
    const a = runScriptedRound({ seed: 9, tier, presses: [{ t: pressForEps(tier, 1, 10) }], frameDt: 1 / 60 });
    const b = runScriptedRound({ seed: 9, tier, presses: [{ t: pressForEps(tier, 1, 12) }], frameDt: 1 / 60 });
    expect(b.records[0]!.epsMs! - a.records[0]!.epsMs!).toBeCloseTo(2, 6);
  });

  it('input→judgment compute cost is far under the 2 ms budget (§13 exit, F3-observable)', () => {
    const tier = 60 as TierMph;
    const presses = Array.from({ length: 10 }, (_, i) => ({ t: pressForEps(tier, i + 1, 5) }));
    const { judgeLatenciesMs } = runScriptedRound({ seed: 3, tier, presses, frameDt: 1 / 60 });
    expect(judgeLatenciesMs.length).toBe(10);
    // Median under 2 ms (first call may pay one-time JIT/solver warmup).
    const sorted = [...judgeLatenciesMs].sort((x, y) => x - y);
    expect(sorted[Math.floor(sorted.length / 2)]!).toBeLessThan(2);
  });
});
