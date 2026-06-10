import { describe, expect, it } from 'vitest';
import {
  FT_TO_M,
  MPH_TO_MPS,
  PLATE_CROSS_HEIGHT_M,
  SIM_DT,
  TIERS,
} from '../src/core/constants';
import { makeBall, stepBall } from '../src/core/physics/ballistics';
import { pitchSolution, simulatePitchFlight } from '../src/core/physics/pitchSchedule';
import {
  RELEASE_DIST_M,
  RELEASE_HEIGHT_M,
} from '../src/core/constants';

/**
 * §5 informative flight-time table. These values are *derived from* the §7
 * model in the spec; the binding acceptance criteria are the 2.5 ft crossing
 * (§14.6) and the §7 carry calibration (§14.7). With Cd tuned to the carry
 * table, flight times track the spec table within 25 ms.
 */
const SPEC_FLIGHT_TIMES: Record<number, number> = {
  40: 0.82,
  50: 0.65,
  60: 0.54,
  70: 0.47,
  80: 0.41,
  90: 0.36,
};

describe('§5 pitch schedule solver', () => {
  for (const tier of TIERS) {
    it(`${tier} mph crosses the plate at 2.5 ft ± 0.5 in (§14.6)`, () => {
      const s = pitchSolution(tier);
      const tolM = 0.5 / 12 / (1 / FT_TO_M); // 0.5 in → m
      expect(Math.abs(s.plateHeightM - PLATE_CROSS_HEIGHT_M)).toBeLessThanOrEqual(tolM);
    });

    it(`${tier} mph flight time tracks the §5 table`, () => {
      const s = pitchSolution(tier);
      expect(Math.abs(s.flightTimeS - SPEC_FLIGHT_TIMES[tier]!)).toBeLessThanOrEqual(0.025);
    });

    it(`${tier} mph bleeds ~8–9% speed to the plate (§5)`, () => {
      const s = pitchSolution(tier);
      const bleed = 1 - s.plateSpeedMph / tier;
      expect(bleed).toBeGreaterThan(0.06);
      expect(bleed).toBeLessThan(0.11);
    });
  }

  it('elevation decreases monotonically with speed (§5 table shape)', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(pitchSolution(TIERS[i]!).elevationRad).toBeLessThan(
        pitchSolution(TIERS[i - 1]!).elevationRad
      );
    }
  });

  it('the live 120 Hz integrator reproduces the solved 2.5 ft crossing (± 0.5 in)', () => {
    for (const tier of TIERS) {
      const s = pitchSolution(tier);
      const b = makeBall();
      b.px = 0;
      b.py = RELEASE_HEIGHT_M;
      b.pz = RELEASE_DIST_M;
      b.vy = Math.sin(s.elevationRad) * s.releaseSpeedMps;
      b.vz = -Math.cos(s.elevationRad) * s.releaseSpeedMps;
      let prevZ = b.pz;
      let prevY = b.py;
      for (let i = 0; i < 1000 && b.pz > 0; i++) {
        prevZ = b.pz;
        prevY = b.py;
        stepBall(b, SIM_DT);
      }
      const f = prevZ / (prevZ - b.pz);
      const yAtPlate = prevY + f * (b.py - prevY);
      expect(Math.abs(yAtPlate - PLATE_CROSS_HEIGHT_M)).toBeLessThanOrEqual(0.0127);
    }
  });

  it('simulatePitchFlight is deterministic and monotone in elevation', () => {
    const v = 60 * MPH_TO_MPS;
    const lo = simulatePitchFlight(v, 0.0);
    const hi = simulatePitchFlight(v, 0.1);
    expect(hi.plateHeightM).toBeGreaterThan(lo.plateHeightM);
    expect(simulatePitchFlight(v, 0.05)).toEqual(simulatePitchFlight(v, 0.05));
  });
});
