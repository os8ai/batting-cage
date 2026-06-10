import { describe, expect, it } from 'vitest';
import { FOUL_POINTS, PITCHES_PER_ROUND } from '../src/core/constants';
import { bestCarryFt, bestEvMph, pointsFor, roundScore, totalCarryFt } from '../src/core/rules/scoring';
import type { Grade, SwingRecord } from '../src/core/types';
import { pressForEps, runScriptedRound } from './harness';

/** §8 per-pitch points & round score (§14.8 — table-driven, exact). */

function rec(over: Partial<SwingRecord>): SwingRecord {
  return {
    pitch: 1,
    tier: 60,
    epsMs: 0,
    grade: 'GOOD',
    spray: 'CENTER',
    evMph: 90,
    laDeg: 25,
    carryFt: 300,
    points: 0,
    ...over,
  };
}

describe('§8 point multipliers', () => {
  // Every multiplier row, exact — including the round() at .5 boundaries.
  const TABLE: Array<[Grade, number | null, number]> = [
    ['PERFECT', 100, 160],
    ['PERFECT', 352, Math.round(1.6 * 352)], // 563
    ['PERFECT', 417, Math.round(1.6 * 417)], // 667
    ['GREAT', 100, 125],
    ['GREAT', 358, Math.round(1.25 * 358)], // 448 (447.5 rounds up)
    ['GREAT', 302, Math.round(1.25 * 302)], // 378 (377.5 rounds up)
    ['GOOD', 100, 100],
    ['GOOD', 287, 287],
    ['FOUL', null, FOUL_POINTS],
    ['MISS', null, 0],
    ['TAKE', null, 0],
  ];
  for (const [grade, carry, want] of TABLE) {
    it(`${grade} @ ${carry ?? '—'} ft → ${want}`, () => {
      expect(pointsFor(grade, carry)).toBe(want);
    });
  }

  it('FOUL is 25 flat — carry can never leak in', () => {
    // §6: no distance exists for a FOUL; even a (buggy) non-null carry must not score.
    expect(pointsFor('FOUL', 399)).toBe(25);
  });
});

describe('round folds', () => {
  const records = [
    rec({ grade: 'PERFECT', carryFt: 380, points: 608, evMph: 101 }),
    rec({ grade: 'GOOD', carryFt: 250, points: 250, evMph: 88 }),
    rec({ grade: 'FOUL', carryFt: null, points: 25, evMph: 70 }),
    rec({ grade: 'TAKE', carryFt: null, points: 0, evMph: null, epsMs: null }),
  ];

  it('round score = Σ points', () => {
    expect(roundScore(records)).toBe(608 + 250 + 25);
  });

  it('total/best carry and best EV ignore no-distance outcomes', () => {
    expect(totalCarryFt(records)).toBe(630);
    expect(bestCarryFt(records)).toBe(380);
    expect(bestEvMph(records)).toBe(101);
  });
});

describe('points ride SWING_JUDGED records (sim integration)', () => {
  it('every record in a scripted round carries pointsFor(grade, carry)', () => {
    const presses = [0, -25, 70, -110, 140, 12, -60, 300].map((eps, i) => ({
      t: pressForEps(60, i + 1, eps),
    }));
    const { records } = runScriptedRound({ seed: 4242, tier: 60, presses, frameDt: 1 / 60 });
    expect(records).toHaveLength(PITCHES_PER_ROUND);
    for (const r of records) {
      expect(r.points).toBe(pointsFor(r.grade, r.carryFt));
    }
    // And ROUND_END agrees with the fold.
    expect(roundScore(records)).toBe(records.reduce((s, r) => s + r.points, 0));
  });

  it('ROUND_END carries the §8 summary consistent with its records', () => {
    const presses = [1, 3, 5].map((p) => ({ t: pressForEps(60, p, 0) }));
    const { events, records } = runScriptedRound({ seed: 7, tier: 60, presses, frameDt: 1 / 60 });
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    expect(end.score).toBe(roundScore(records));
    expect(end.totalCarryFt).toBe(totalCarryFt(records));
    expect(end.round).toBe(1);
  });
});
