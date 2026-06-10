import {
  BALL_RADIUS_M,
  DRAG_K,
  GRAVITY,
  LIFT_CL_MAX,
  LIFT_CL_SLOPE,
  MAGNUS_K,
} from '../constants';
import type { BallState } from '../types';

/**
 * §7 equations of motion, semi-implicit Euler, allocation-free.
 *   a = g + a_drag + a_magnus
 *   a_drag   = −(ρCdA/2m)·|v|·v
 *   a_magnus = (ρClA/2m)·|v|²·(ω̂ × v̂),  Cl = min(0.35, 1.5·S),  S = r|ω|/|v|
 */
export function stepBall(b: BallState, dt: number): void {
  const vx = b.vx;
  const vy = b.vy;
  const vz = b.vz;
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
  let ax = 0;
  let ay = -GRAVITY;
  let az = 0;
  if (v > 1e-9) {
    const kd = DRAG_K * v;
    ax -= kd * vx;
    ay -= kd * vy;
    az -= kd * vz;
    if (b.spinRadS > 0) {
      const S = (BALL_RADIUS_M * b.spinRadS) / v;
      const cl = Math.min(LIFT_CL_MAX, LIFT_CL_SLOPE * S);
      const km = MAGNUS_K * cl * v; // (ρClA/2m)·|v|² × (ŝ × v)/|v| → factor |v|
      ax += km * (b.sy * vz - b.sz * vy);
      ay += km * (b.sz * vx - b.sx * vz);
      az += km * (b.sx * vy - b.sy * vx);
    }
  }
  b.vx += ax * dt;
  b.vy += ay * dt;
  b.vz += az * dt;
  b.px += b.vx * dt;
  b.py += b.vy * dt;
  b.pz += b.vz * dt;
}

export function makeBall(): BallState {
  return {
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    spinRadS: 0,
    asleep: false,
    active: false,
  };
}

export function ballSpeed(b: BallState): number {
  return Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
}
