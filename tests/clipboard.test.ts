import { describe, expect, it } from 'vitest';
import { formatRoundSummary, groupThousands } from '../src/persist/clipboard';
import type { Grade, SwingRecord } from '../src/core/types';

/** §What outputs (f) — the clipboard summary formatter (M4 P3.1). */

function rec(grade: Grade, carryFt: number | null, points: number, evMph: number | null): SwingRecord {
  return { pitch: 1, tier: 70, epsMs: grade === 'TAKE' ? null : 10, grade, spray: null, evMph, laDeg: null, carryFt, points };
}

describe('groupThousands (locale-free)', () => {
  it('groups exactly like the §What example', () => {
    expect(groupThousands(4120)).toBe('4,120');
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(999)).toBe('999');
    expect(groupThousands(1000)).toBe('1,000');
    expect(groupThousands(312)).toBe('312');
    expect(groupThousands(1234567)).toBe('1,234,567');
  });
});

describe('formatRoundSummary', () => {
  it('produces the exact §What string shape', () => {
    const records: SwingRecord[] = [
      ...Array.from({ length: 7 }, () => rec('GOOD', 250, 250, 80)),
      rec('GREAT', 312, 390, 95),
      rec('MISS', null, 0, null),
      rec('TAKE', null, 0, null),
    ];
    // 8 contacts, best 312, score 7×250 + 390 = 2,140.
    expect(formatRoundSummary(70, records)).toBe(
      'BATTING CAGE — 70 MPH — 8/10 — BEST 312 FT — SCORE 2,140'
    );
  });

  it('counts FOUL as contact (it carries an EV) but never as BEST (no distance exists)', () => {
    const records: SwingRecord[] = [
      rec('FOUL', null, 25, 70),
      rec('GOOD', 198, 198, 75),
      ...Array.from({ length: 8 }, () => rec('TAKE', null, 0, null)),
    ];
    expect(formatRoundSummary(40, records)).toBe(
      'BATTING CAGE — 40 MPH — 2/10 — BEST 198 FT — SCORE 223'
    );
  });

  it('drops the BEST segment on an all-TAKE round', () => {
    const records: SwingRecord[] = Array.from({ length: 10 }, () => rec('TAKE', null, 0, null));
    expect(formatRoundSummary(90, records)).toBe('BATTING CAGE — 90 MPH — 0/10 — SCORE 0');
  });

  it('foul-only round: contact without distance keeps the flat consolation visible', () => {
    const records: SwingRecord[] = Array.from({ length: 10 }, () => rec('FOUL', null, 25, 68));
    expect(formatRoundSummary(50, records)).toBe('BATTING CAGE — 50 MPH — 10/10 — SCORE 250');
  });

  it('big rounds group the score', () => {
    const records: SwingRecord[] = Array.from({ length: 10 }, () => rec('PERFECT', 417, 667, 102));
    expect(formatRoundSummary(90, records)).toBe(
      'BATTING CAGE — 90 MPH — 10/10 — BEST 417 FT — SCORE 6,670'
    );
  });
});
