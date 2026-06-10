import { describe, expect, it } from 'vitest';
import { battedSpinRpm, contactState, projectCarryFt } from '../src/core/physics/projection';
import { PLATE_CROSS_HEIGHT_M } from '../src/core/constants';

/**
 * §7 calibration table (q = 1, ε = 0, jitter off): the model must land within
 * ±10 ft of every row — this is the contract; Cd/Cl/spin are tuned to fit.
 */
const CALIBRATION: Array<{ tier: number; ev: number; target: number }> = [
  { tier: 40, ev: 92, target: 352 },
  { tier: 50, ev: 94, target: 365 },
  { tier: 60, ev: 96, target: 378 },
  { tier: 70, ev: 98, target: 391 },
  { tier: 80, ev: 100, target: 404 },
  { tier: 90, ev: 102, target: 417 },
];

describe('§7 projected-distance calibration (acceptance #7)', () => {
  for (const row of CALIBRATION) {
    it(`${row.ev} mph EV @ 25° carries ~${row.target} ft (±10)`, () => {
      const carry = projectCarryFt(row.ev, 25, 0);
      expect(Math.abs(carry - row.target), `carry ${carry} vs target ${row.target}`).toBeLessThanOrEqual(10);
    });
  }

  it('25° launch gets ~2,000 rpm backspin (§7: 500 + 60×LA, min 300)', () => {
    expect(battedSpinRpm(25)).toBe(2000);
    expect(battedSpinRpm(-5)).toBe(300); // clamped at the minimum
    expect(battedSpinRpm(0)).toBe(500);
  });

  it('carry is floored to whole feet and deterministic', () => {
    const a = projectCarryFt(96, 25, 0);
    const b = projectCarryFt(96, 25, 0);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('carry is carry-only horizontal distance — spray does not change it materially', () => {
    const center = projectCarryFt(96, 25, 0);
    const sprayed = projectCarryFt(96, 25, 30);
    expect(Math.abs(center - sprayed)).toBeLessThanOrEqual(1); // same speed, rotated heading
  });

  it('contact state starts at the plate, 2.5 ft up, with lift-producing backspin', () => {
    const b = contactState(96, 25, 0, 'R');
    expect(b.px).toBe(0);
    expect(b.pz).toBe(0);
    expect(b.py).toBeCloseTo(PLATE_CROSS_HEIGHT_M, 6);
    // Backspin axis × velocity must point up (Magnus lift).
    const liftY = b.sz * b.vx - b.sx * b.vz;
    expect(liftY).toBeGreaterThan(0);
  });

  it('handedness mirrors the world spray direction', () => {
    const r = contactState(96, 25, 20, 'R');
    const l = contactState(96, 25, 20, 'L');
    // Right-handed world: righty oppo = right field = −X (+X is third-base side).
    expect(r.vx).toBeLessThan(0);
    expect(l.vx).toBeCloseTo(-r.vx, 9);
    expect(l.vz).toBeCloseTo(r.vz, 9);
  });
});
