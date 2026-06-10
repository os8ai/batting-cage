import {
  DEG_TO_RAD,
  M_TO_FT,
  MPH_TO_MPS,
  PLATE_CROSS_HEIGHT_M,
  PROJECTION_DT,
  RPM_TO_RADS,
  SPIN_BASE_RPM,
  SPIN_MIN_RPM,
  SPIN_PER_LA_DEG,
} from '../constants';
import type { BallState, Handedness } from '../types';
import { makeBall, stepBall } from './ballistics';

/** §7: batted backspin ω = 500 + 60×LA° rpm, min 300. No sidespin in v1. */
export function battedSpinRpm(laDeg: number): number {
  return Math.max(SPIN_MIN_RPM, SPIN_BASE_RPM + SPIN_PER_LA_DEG * laDeg);
}

/**
 * Build the batted-ball state at the contact point (plate centerline, 2.5 ft).
 * φ (sprayDeg) > 0 = opposite field. World realization: the engine is
 * right-handed (+Z toward the machine, +Y up), so the third-base / LEFT-field
 * side is +X and right field is −X — §4's "+X toward the right-field side"
 * assumed a left-handed frame and is mirrored here. A righty's oppo (right
 * field) is therefore −X; mirrored for lefties.
 */
export function contactState(
  evMph: number,
  laDeg: number,
  sprayDeg: number,
  handedness: Handedness,
  out?: BallState
): BallState {
  const b = out ?? makeBall();
  const v = evMph * MPH_TO_MPS;
  const la = laDeg * DEG_TO_RAD;
  const phiWorld = sprayDeg * DEG_TO_RAD * (handedness === 'R' ? -1 : 1);
  b.px = 0;
  b.py = PLATE_CROSS_HEIGHT_M;
  b.pz = 0;
  b.vx = v * Math.cos(la) * Math.sin(phiWorld);
  b.vy = v * Math.sin(la);
  b.vz = v * Math.cos(la) * Math.cos(phiWorld);
  // Pure backspin: axis horizontal, perpendicular to the horizontal heading,
  // oriented so ω̂ × v̂ points up (lift).
  const hx = Math.sin(phiWorld);
  const hz = Math.cos(phiWorld);
  b.sx = -hz;
  b.sy = 0;
  b.sz = hx;
  b.spinRadS = battedSpinRpm(laDeg) * RPM_TO_RADS;
  b.asleep = false;
  b.active = true;
  return b;
}

const scratch = makeBall();

/**
 * §7 open-field projection: the same model stepped at 240 Hz from the contact
 * state to touchdown (y = 0), run synchronously in the contact tick.
 * Carry = horizontal distance from home plate at touchdown, floored to whole
 * feet — carry only, no roll (the HitTrax convention).
 */
export function projectCarryFt(evMph: number, laDeg: number, sprayDeg: number): number {
  const b = contactState(evMph, laDeg, sprayDeg, 'R', scratch);
  let prevX = b.px;
  let prevY = b.py;
  let prevZ = b.pz;
  for (let i = 0; i < 8000; i++) {
    stepBall(b, PROJECTION_DT);
    if (b.py <= 0) {
      const f = prevY / (prevY - b.py);
      const x = prevX + f * (b.px - prevX);
      const z = prevZ + f * (b.pz - prevZ);
      return Math.floor(Math.sqrt(x * x + z * z) * M_TO_FT);
    }
    prevX = b.px;
    prevY = b.py;
    prevZ = b.pz;
  }
  // Unreachable for physical inputs (a batted ball lands in well under 10 s).
  return Math.floor(Math.sqrt(b.px * b.px + b.pz * b.pz) * M_TO_FT);
}
