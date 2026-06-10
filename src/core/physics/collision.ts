import {
  BACKSTOP_HALF_WIDTH_M,
  BACKSTOP_HEIGHT_M,
  BACKSTOP_Z_M,
  BALL_RADIUS_M,
  CAGE_BACK_Z_M,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  CAGE_HEIGHT_M,
  E_BACKSTOP,
  E_TURF,
  NET_CATCH_DAMP,
  SLEEP_SPEED_MPS,
  TURF_ROLL_DECAY,
} from '../constants';
import type { BallState } from '../types';
import { ballSpeed } from './ballistics';

export type CollisionEvent = 'NET_HIT' | 'BACKSTOP_HIT' | 'FLOOR_BOUNCE' | 'SETTLED';

/**
 * §7 in-cage resolution (visual, never scored) — M0 analytic version, M2
 * polishes. Greybox cage = AABB planes: side/far/ceiling nets catch with a
 * damped response (velocity → ~15%), the backstop pad is nearly dead
 * (e = 0.10), turf bounces at e = 0.38 with rolling decay, and balls sleep
 * below 0.3 m/s and remain for the round.
 *
 * Returns events raised this step (for audio cues in M2; tests now).
 */
export function resolveCageCollisions(b: BallState, dt: number, out: CollisionEvent[]): void {
  if (!b.active || b.asleep) return;
  const r = BALL_RADIUS_M;

  // Backstop pad (between plate and back net, 8 ft wide × 7 ft high).
  if (
    b.pz < BACKSTOP_Z_M + r &&
    b.vz < 0 &&
    b.py < BACKSTOP_HEIGHT_M &&
    Math.abs(b.px) < BACKSTOP_HALF_WIDTH_M
  ) {
    b.pz = BACKSTOP_Z_M + r;
    b.vz = -b.vz * E_BACKSTOP;
    b.vx *= 0.5;
    b.vy *= 0.5;
    out.push('BACKSTOP_HIT');
  }

  // Nets: damped catch — normal component reversed, whole velocity to ~15%.
  if (b.pz > CAGE_FAR_Z_M - r && b.vz > 0) {
    b.pz = CAGE_FAR_Z_M - r;
    b.vz = -b.vz;
    netDamp(b);
    out.push('NET_HIT');
  }
  if (b.pz < CAGE_BACK_Z_M + r && b.vz < 0) {
    b.pz = CAGE_BACK_Z_M + r;
    b.vz = -b.vz;
    netDamp(b);
    out.push('NET_HIT');
  }
  if (b.px > CAGE_HALF_WIDTH_M - r && b.vx > 0) {
    b.px = CAGE_HALF_WIDTH_M - r;
    b.vx = -b.vx;
    netDamp(b);
    out.push('NET_HIT');
  }
  if (b.px < -CAGE_HALF_WIDTH_M + r && b.vx < 0) {
    b.px = -CAGE_HALF_WIDTH_M + r;
    b.vx = -b.vx;
    netDamp(b);
    out.push('NET_HIT');
  }
  if (b.py > CAGE_HEIGHT_M - r && b.vy > 0) {
    b.py = CAGE_HEIGHT_M - r;
    b.vy = -b.vy;
    netDamp(b);
    out.push('NET_HIT');
  }

  // Turf.
  if (b.py < r) {
    b.py = r;
    if (b.vy < 0) {
      const vyAfter = -b.vy * E_TURF;
      // Kill micro-bounces; below that the ball rolls.
      b.vy = vyAfter > 0.2 ? vyAfter : 0;
      if (b.vy === 0) b.spinRadS = 0;
      out.push('FLOOR_BOUNCE');
    }
    if (b.vy === 0) {
      // Rolling decay.
      const decay = Math.exp(-TURF_ROLL_DECAY * dt);
      b.vx *= decay;
      b.vz *= decay;
      if (ballSpeed(b) < SLEEP_SPEED_MPS) {
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        b.asleep = true;
        out.push('SETTLED');
      }
    }
  }
}

function netDamp(b: BallState): void {
  b.vx *= NET_CATCH_DAMP;
  b.vy *= NET_CATCH_DAMP;
  b.vz *= NET_CATCH_DAMP;
  b.spinRadS = 0; // the net kills the spin
}
