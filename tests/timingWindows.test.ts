import { describe, expect, it } from 'vitest';
import { WINDOWS_MS, TIERS } from '../src/core/constants';
import { gradeFor, windowsFor } from '../src/core/contact/timingWindows';
import type { TierMph } from '../src/core/types';

/** §6 per-tier grade windows — table-driven, both sides of every boundary (§14.8). */
const TABLE: Record<TierMph, [number, number, number, number]> = {
  40: [40, 80, 120, 160],
  50: [35, 70, 105, 145],
  60: [30, 60, 90, 130],
  70: [25, 50, 75, 115],
  80: [20, 40, 60, 100],
  90: [15, 30, 45, 85],
};

describe('§6 timing windows', () => {
  it('windows table matches the spec exactly', () => {
    for (const tier of TIERS) {
      const [P, GR, GD, FL] = TABLE[tier];
      expect(windowsFor(tier)).toEqual({ P, GR, GD, FL });
      expect(WINDOWS_MS[tier]).toEqual({ P, GR, GD, FL });
    }
  });

  for (const tier of TIERS) {
    const [P, GR, GD, FL] = TABLE[tier];
    it(`${tier} mph: grades flip exactly at ±{${P}, ${GR}, ${GD}, ${FL}} ms`, () => {
      for (const sign of [1, -1]) {
        expect(gradeFor(tier, sign * 0)).toBe('PERFECT');
        expect(gradeFor(tier, sign * P)).toBe('PERFECT');
        expect(gradeFor(tier, sign * (P + 1))).toBe('GREAT');
        expect(gradeFor(tier, sign * GR)).toBe('GREAT');
        expect(gradeFor(tier, sign * (GR + 1))).toBe('GOOD');
        expect(gradeFor(tier, sign * GD)).toBe('GOOD');
        expect(gradeFor(tier, sign * (GD + 1))).toBe('FOUL');
        expect(gradeFor(tier, sign * FL)).toBe('FOUL');
        expect(gradeFor(tier, sign * (FL + 1))).toBe('MISS');
      }
    });
  }

  it('windows tighten monotonically with speed (fence 2: difficulty = speed + windows)', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const a = windowsFor(TIERS[i - 1]!);
      const b = windowsFor(TIERS[i]!);
      expect(b.P).toBeLessThan(a.P);
      expect(b.FL).toBeLessThan(a.FL);
    }
  });
});
