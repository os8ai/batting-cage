import { describe, expect, it } from 'vitest';
import { SWING_CONTACT_OFFSET_S } from '../src/core/constants';
import { SWING_META } from '../src/scene/actors/Batter';
import { contactDelayS, retimedDurationS, swingTimeScale } from '../src/scene/actors/swingRetiming';

/**
 * M1 E5 — the batter's swing animation reaches the contact pose exactly
 * K = 150 ms after keydown, for ANY clip metadata (the Mixamo swap contract).
 */
describe('swing retiming (E5)', () => {
  it('contact frame lands at exactly K for arbitrary clip metadata', () => {
    for (const durationS of [0.3, 0.5, 0.8, 1.2, 2.0]) {
      for (const frac of [0.1, 0.25, 0.42, 0.7, 0.9]) {
        const meta = { durationS, contactTimeS: durationS * frac };
        const rate = swingTimeScale(meta, SWING_CONTACT_OFFSET_S);
        expect(contactDelayS(meta, rate)).toBeCloseTo(SWING_CONTACT_OFFSET_S, 12);
        expect(rate).toBeGreaterThan(0);
        expect(retimedDurationS(meta, rate)).toBeCloseTo(durationS / rate, 12);
      }
    }
  });

  it('the shipped procedural clip metadata retimes to 150 ms', () => {
    const rate = swingTimeScale(SWING_META, SWING_CONTACT_OFFSET_S);
    expect(contactDelayS(SWING_META, rate) * 1000).toBeCloseTo(150, 9);
    // Sanity: the retimed full swing stays plausibly swing-length (< 1 s).
    expect(retimedDurationS(SWING_META, rate)).toBeLessThan(1);
  });

  it('rejects metadata that cannot anchor a contact frame', () => {
    expect(() => swingTimeScale({ durationS: 0.5, contactTimeS: 0 }, 0.15)).toThrow();
    expect(() => swingTimeScale({ durationS: 0.5, contactTimeS: 0.6 }, 0.15)).toThrow();
    expect(() => swingTimeScale({ durationS: 0.5, contactTimeS: 0.2 }, 0)).toThrow();
  });
});
