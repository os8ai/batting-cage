import { describe, expect, it } from 'vitest';
import { Q_ANCHORS, TIERS } from '../src/core/constants';
import { contactQuality, resolveContact } from '../src/core/contact/contactModel';
import { windowsFor } from '../src/core/contact/timingWindows';
import { mulberry32 } from '../src/core/rng';
import type { TierMph } from '../src/core/types';

/** rng() === 0.5 ⇒ every jitter term is exactly zero. */
const noJitter = () => 0.5;

describe('§6 contact quality q', () => {
  it('hits the anchors exactly at every tier (§14.8)', () => {
    for (const tier of TIERS) {
      const w = windowsFor(tier);
      expect(contactQuality(tier, 0)).toBeCloseTo(Q_ANCHORS.q0, 9);
      expect(contactQuality(tier, w.P)).toBeCloseTo(Q_ANCHORS.qP, 9);
      expect(contactQuality(tier, -w.P)).toBeCloseTo(Q_ANCHORS.qP, 9);
      expect(contactQuality(tier, w.GR)).toBeCloseTo(Q_ANCHORS.qGR, 9);
      expect(contactQuality(tier, w.GD)).toBeCloseTo(Q_ANCHORS.qGD, 9);
    }
  });

  it('is continuous and monotonically non-increasing in |ε| (no cliffs)', () => {
    for (const tier of TIERS) {
      const w = windowsFor(tier);
      let prev = contactQuality(tier, 0);
      for (let a = 0.5; a <= w.FL; a += 0.5) {
        const q = contactQuality(tier, a);
        expect(q).toBeLessThanOrEqual(prev + 1e-12);
        expect(prev - q).toBeLessThan(0.01); // small steps ⇒ small drops
        prev = q;
      }
    }
  });
});

describe('§6 EV mapping', () => {
  it('max EV by tier (q=1, jitter off): 92/94/96/98/100/102 mph (§14.8)', () => {
    const expected: Record<TierMph, number> = { 40: 92, 50: 94, 60: 96, 70: 98, 80: 100, 90: 102 };
    for (const tier of TIERS) {
      const out = resolveContact(tier, 0, tier, noJitter);
      expect(out.evMph).toBeCloseTo(expected[tier], 9);
    }
  });

  it('EV jitter stays within [0.98, 1.02] of the deterministic value', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 200; i++) {
      const out = resolveContact(60, 0, 60, rng);
      expect(out.evMph!).toBeGreaterThanOrEqual(96 * 0.98 - 1e-9);
      expect(out.evMph!).toBeLessThanOrEqual(96 * 1.02 + 1e-9);
    }
  });
});

describe('§6 LA mapping', () => {
  it('PERFECT ≈ 25°, edge-of-GOOD early ≈ 4°, late ≈ 46° — at every tier', () => {
    for (const tier of TIERS) {
      const w = windowsFor(tier);
      expect(resolveContact(tier, 0, tier, noJitter).laDeg).toBeCloseTo(25, 9);
      expect(resolveContact(tier, -w.GD, tier, noJitter).laDeg).toBeCloseTo(4, 9);
      expect(resolveContact(tier, w.GD, tier, noJitter).laDeg).toBeCloseTo(46, 9);
    }
  });

  it('LA clamps to [−5°, 55°]', () => {
    const rng = mulberry32(99);
    for (let eps = -160; eps <= 160; eps += 7) {
      const out = resolveContact(40, eps, 40, rng);
      if (out.laDeg !== null) {
        expect(out.laDeg).toBeGreaterThanOrEqual(-5);
        expect(out.laDeg).toBeLessThanOrEqual(55);
      }
    }
  });
});

describe('§6 spray mapping', () => {
  it('FOUL spray is always past the 45° lines; fair contact never is (§14.9)', () => {
    const rng = mulberry32(7);
    for (const tier of TIERS) {
      const w = windowsFor(tier);
      for (let i = 0; i < 50; i++) {
        // Sweep the fair band and the foul band, both signs.
        const fairEps = (i / 49) * w.GD * (i % 2 ? 1 : -1);
        const fair = resolveContact(tier, fairEps, tier, rng);
        expect(Math.abs(fair.sprayDeg!)).toBeLessThan(45);
        const foulEps = (w.GD + 0.01 + (i / 49) * (w.FL - w.GD - 0.01)) * (i % 2 ? 1 : -1);
        const foul = resolveContact(tier, foulEps, tier, rng);
        expect(foul.grade).toBe('FOUL');
        expect(Math.abs(foul.sprayDeg!)).toBeGreaterThan(45);
        expect(Math.abs(foul.sprayDeg!)).toBeLessThanOrEqual(70);
      }
    }
  });

  it('sign follows ε: EARLY = PULL (φ<0), LATE = OPPO (φ>0); |φ|≤8° tags CENTER', () => {
    const early = resolveContact(60, -60, 60, noJitter);
    expect(early.sprayDeg).toBeLessThan(0);
    expect(early.sprayTag).toBe('PULL');
    const late = resolveContact(60, 60, 60, noJitter);
    expect(late.sprayDeg).toBeGreaterThan(0);
    expect(late.sprayTag).toBe('OPPO');
    const center = resolveContact(60, 5, 60, noJitter); // 40×(5/90) ≈ 2.2°
    expect(center.sprayTag).toBe('CENTER');
  });

  it('normalized curves are identical across tiers (fence 2): same u ⇒ same LA/spray', () => {
    for (const tier of TIERS) {
      const w = windowsFor(tier);
      const out = resolveContact(tier, 0.5 * w.GD, tier, noJitter);
      expect(out.laDeg).toBeCloseTo(25 + 21 * 0.5, 9);
      expect(out.sprayDeg).toBeCloseTo(20, 9);
    }
  });
});

describe('§6 determinism', () => {
  it('identical seeds reproduce identical outcomes', () => {
    const a = resolveContact(70, 33, 70, mulberry32(42));
    const b = resolveContact(70, 33, 70, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('MISS beyond the FOUL window carries no contact numbers', () => {
    const out = resolveContact(90, 120, 90, mulberry32(1));
    expect(out.grade).toBe('MISS');
    expect(out.evMph).toBeNull();
    expect(out.laDeg).toBeNull();
    expect(out.sprayDeg).toBeNull();
  });
});
