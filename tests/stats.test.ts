import { describe, expect, it } from 'vitest';
import { HARD_HIT_EV_MPH } from '../src/core/constants';
import {
  foldRound,
  foldSwings,
  last50Trend,
  median,
  TREND_BUCKETS,
  TREND_WINDOW,
} from '../src/core/rules/stats';
import type { SwingRecord } from '../src/core/types';

/** §What-8 aggregate folds vs hand-computed fixtures. */

function rec(over: Partial<SwingRecord>): SwingRecord {
  return {
    pitch: 1,
    tier: 60,
    epsMs: 10,
    grade: 'GOOD',
    spray: 'CENTER',
    evMph: 90,
    laDeg: 25,
    carryFt: 300,
    points: 300,
    ...over,
  };
}

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
  });
});

describe('foldSwings / foldRound', () => {
  it('hand-computed fixture', () => {
    const records = [
      rec({ epsMs: -20, evMph: 96 }), // contact, hard
      rec({ epsMs: 40, evMph: 80 }), // contact
      rec({ epsMs: 130, grade: 'FOUL', evMph: 70, carryFt: null }), // FOUL counts as contact
      rec({ epsMs: 250, grade: 'MISS', evMph: null, carryFt: null }), // swing, no contact
      rec({ epsMs: null, grade: 'TAKE', evMph: null, carryFt: null }), // no swing
    ];
    const agg = foldSwings(records);
    // |ε| over judged swings: 20, 40, 130, 250 → median (40+130)/2 = 85.
    expect(agg.medianAbsEpsMs).toBe(85);
    // Contact 3 of 5 pitches = 60 %.
    expect(agg.contactPct).toBe(60);
    // Hard-hit: 1 of 3 contacted ≥ 95 EV.
    expect(agg.hardHitPct).toBeCloseTo(100 / 3, 9);
  });

  it('hard-hit boundary: exactly 95 EV counts', () => {
    const agg = foldSwings([rec({ evMph: HARD_HIT_EV_MPH }), rec({ evMph: 94.9 })]);
    expect(agg.hardHitPct).toBe(50);
  });

  it('degenerate folds: no swings, no contact', () => {
    const takes = [rec({ epsMs: null, grade: 'TAKE', evMph: null })];
    const agg = foldSwings(takes);
    expect(agg.medianAbsEpsMs).toBeNull();
    expect(agg.contactPct).toBe(0);
    expect(agg.hardHitPct).toBe(0);
    expect(foldSwings([]).contactPct).toBe(0);
  });

  it('foldRound fixes the denominator at the 10 pitches', () => {
    // 5 contacts recorded mid-round must read 50 %, not 100 %.
    const records = Array.from({ length: 5 }, () => rec({}));
    expect(foldRound(records).contactPct).toBe(50);
  });
});

describe('last-50 trend (monitor sparkline)', () => {
  it('windows to the most recent 50 and buckets into medians', () => {
    const eps = Array.from({ length: 80 }, (_, i) => i); // 0..79, oldest first
    const trend = last50Trend(eps);
    expect(trend.length).toBeLessThanOrEqual(TREND_BUCKETS);
    // Window = last 50 values (30..79), bucket of 5 → first bucket median = 32.
    expect(trend[0]).toBe(32);
    expect(trend[trend.length - 1]).toBe(77);
    // Improving timing shows a falling trend.
    const improving = Array.from({ length: TREND_WINDOW }, (_, i) => 100 - i);
    const t2 = last50Trend(improving);
    for (let i = 1; i < t2.length; i++) expect(t2[i]!).toBeLessThan(t2[i - 1]!);
  });

  it('short histories still produce a sparkline', () => {
    expect(last50Trend([])).toEqual([]);
    expect(last50Trend([12])).toEqual([12]);
    expect(last50Trend([12, 8, 20]).length).toBeGreaterThan(0);
  });
});
