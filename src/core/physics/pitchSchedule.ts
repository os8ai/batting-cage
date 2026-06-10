import {
  MPH_TO_MPS,
  MPS_TO_MPH,
  PLATE_CROSS_HEIGHT_M,
  RELEASE_DIST_M,
  RELEASE_HEIGHT_M,
} from '../constants';
import type { PitchSolution, TierMph } from '../types';
import { makeBall, stepBall } from './ballistics';

/**
 * §5: machine elevation is *solved* per tier so every pitch crosses the plate
 * at exactly 2.5 ft on the centerline — "all fastballs over the plate" is
 * deterministic. Pitch flight is gravity + drag only (§7: machine ball, no
 * Magnus). Bisection on launch elevation, integrating the §7 model.
 *
 * The solver steps at the live SIM rate (120 Hz, §Architecture: the live ball
 * is semi-implicit Euler inside the core tick) so the rendered pitch crosses
 * at exactly the solved height — the schedule and the visible ball are the
 * same model. Sub-tick precision comes from crossing interpolation.
 */

const SOLVER_DT = 1 / 120;

interface PitchFlight {
  plateHeightM: number;
  flightTimeS: number;
  plateSpeedMps: number;
}

/** Integrate a pitch at elevation theta until it crosses the plate plane (z = 0). */
export function simulatePitchFlight(releaseSpeedMps: number, thetaRad: number): PitchFlight {
  const b = makeBall();
  b.px = 0;
  b.py = RELEASE_HEIGHT_M;
  b.pz = RELEASE_DIST_M;
  b.vx = 0;
  b.vy = Math.sin(thetaRad) * releaseSpeedMps;
  b.vz = -Math.cos(thetaRad) * releaseSpeedMps;
  b.spinRadS = 0;

  let t = 0;
  let prevZ = b.pz;
  let prevY = b.py;
  let prevSp = releaseSpeedMps;
  for (let i = 0; i < 100000; i++) {
    stepBall(b, SOLVER_DT);
    t += SOLVER_DT;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    if (b.pz <= 0) {
      // Interpolate the exact plate crossing between the last two steps.
      const f = prevZ / (prevZ - b.pz);
      return {
        plateHeightM: prevY + f * (b.py - prevY),
        flightTimeS: t - SOLVER_DT + f * SOLVER_DT,
        plateSpeedMps: prevSp + f * (sp - prevSp),
      };
    }
    prevZ = b.pz;
    prevY = b.py;
    prevSp = sp;
  }
  throw new Error('pitch never reached the plate');
}

function solveTier(tier: TierMph): PitchSolution {
  const releaseSpeedMps = tier * MPH_TO_MPS;
  // Crossing height is monotonic in elevation: bisect.
  let lo = -0.2; // rad
  let hi = 0.4;
  let flight = simulatePitchFlight(releaseSpeedMps, (lo + hi) / 2);
  let mid = (lo + hi) / 2;
  for (let i = 0; i < 48; i++) {
    mid = (lo + hi) / 2;
    flight = simulatePitchFlight(releaseSpeedMps, mid);
    if (flight.plateHeightM > PLATE_CROSS_HEIGHT_M) hi = mid;
    else lo = mid;
  }
  return {
    tier,
    releaseSpeedMps,
    elevationRad: mid,
    flightTimeS: flight.flightTimeS,
    plateHeightM: flight.plateHeightM,
    plateSpeedMph: flight.plateSpeedMps * MPS_TO_MPH,
  };
}

const cache = new Map<TierMph, PitchSolution>();

/** Per-tier analytic pitch solution; solved once and memoized. */
export function pitchSolution(tier: TierMph): PitchSolution {
  let s = cache.get(tier);
  if (!s) {
    s = solveTier(tier);
    cache.set(tier, s);
  }
  return s;
}
