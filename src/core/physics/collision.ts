import {
  BACKSTOP_HALF_WIDTH_M,
  BACKSTOP_HEIGHT_M,
  BACKSTOP_Z_M,
  BALL_RADIUS_M,
  BOUNCE_EVENT_MIN_VY_MPS,
  CAGE_BACK_Z_M,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  CAGE_HEIGHT_M,
  E_BACKSTOP,
  E_FRAME,
  E_GUARD,
  E_TURF,
  FRAME_FIRST_Z_M,
  FRAME_LAST_Z_M,
  FRAME_RADIUS_M,
  FRAME_SPACING_M,
  GUARD_HALF_XZ_M,
  GUARD_TOP_M,
  MACHINE_BODY_DIST_M,
  NET_CATCH_DAMP,
  SLEEP_SPEED_MPS,
  TURF_ROLL_DECAY,
} from '../constants';
import type { BallState, NetPanel } from '../types';
import { ballSpeed } from './ballistics';

export type CollisionKind =
  | 'NET_HIT'
  | 'BACKSTOP_HIT'
  | 'FRAME_HIT'
  | 'GUARD_HIT'
  | 'FLOOR_BOUNCE'
  | 'BALL_BOUNCE'
  | 'SETTLED';

/** One surface response this step. Position lives on the ball (post-clamp =
 * the contact point); speedMps is the ball speed AT impact, pre-response —
 * that is what cloth impulse and rustle gain scale by (M2-PLAN §3.4, §10). */
export interface CollisionHit {
  kind: CollisionKind;
  /** Net section for NET_HIT; null otherwise. */
  panel: NetPanel | null;
  speedMps: number;
}

/**
 * §7 in-cage resolution (visual, never scored) — M2 version: damped net catch
 * per panel, steel-frame uprights as narrow cylinder colliders (e = 0.45),
 * machine-guard AABB (e = 0.30, batted balls only — the pitch exits through
 * the guard aperture), nearly-dead backstop pad (e = 0.10), turf bounce
 * (e = 0.38) with rolling decay, sleep below 0.3 m/s.
 *
 * Pushes the surface responses raised this step into `out` (impact frames
 * only — the quiet-frame path allocates nothing).
 */
export function resolveCageCollisions(
  b: BallState,
  dt: number,
  out: CollisionHit[],
  guardActive = false
): void {
  if (!b.active || b.asleep) return;
  const r = BALL_RADIUS_M;

  // Backstop pad (between plate and back net, 8 ft wide × 7 ft high).
  if (
    b.pz < BACKSTOP_Z_M + r &&
    b.vz < 0 &&
    b.py < BACKSTOP_HEIGHT_M &&
    Math.abs(b.px) < BACKSTOP_HALF_WIDTH_M
  ) {
    const impact = ballSpeed(b);
    b.pz = BACKSTOP_Z_M + r;
    b.vz = -b.vz * E_BACKSTOP;
    b.vx *= 0.5;
    b.vy *= 0.5;
    out.push({ kind: 'BACKSTOP_HIT', panel: null, speedMps: impact });
  }

  // Steel-frame uprights on both side planes (checked before the side nets so
  // the rare clang wins over the catch).
  if (!frameUprightHit(b, out)) {
    // Nets: damped catch — normal component reversed, whole velocity to ~15%.
    if (b.px > CAGE_HALF_WIDTH_M - r && b.vx > 0) {
      const impact = ballSpeed(b);
      b.px = CAGE_HALF_WIDTH_M - r;
      b.vx = -b.vx;
      netDamp(b);
      out.push({ kind: 'NET_HIT', panel: 'left', speedMps: impact });
    }
    if (b.px < -CAGE_HALF_WIDTH_M + r && b.vx < 0) {
      const impact = ballSpeed(b);
      b.px = -CAGE_HALF_WIDTH_M + r;
      b.vx = -b.vx;
      netDamp(b);
      out.push({ kind: 'NET_HIT', panel: 'right', speedMps: impact });
    }
  }
  if (b.pz > CAGE_FAR_Z_M - r && b.vz > 0) {
    const impact = ballSpeed(b);
    b.pz = CAGE_FAR_Z_M - r;
    b.vz = -b.vz;
    netDamp(b);
    out.push({ kind: 'NET_HIT', panel: 'far', speedMps: impact });
  }
  if (b.pz < CAGE_BACK_Z_M + r && b.vz < 0) {
    const impact = ballSpeed(b);
    b.pz = CAGE_BACK_Z_M + r;
    b.vz = -b.vz;
    netDamp(b);
    out.push({ kind: 'NET_HIT', panel: 'back', speedMps: impact });
  }
  if (b.py > CAGE_HEIGHT_M - r && b.vy > 0) {
    const impact = ballSpeed(b);
    b.py = CAGE_HEIGHT_M - r;
    b.vy = -b.vy;
    netDamp(b);
    out.push({ kind: 'NET_HIT', panel: 'ceiling', speedMps: impact });
  }

  // Machine guard (batted balls can't pass through the machine, §7).
  if (guardActive) guardHit(b, out);

  // Turf.
  if (b.py < r) {
    b.py = r;
    if (b.vy < 0) {
      const impactVy = -b.vy;
      const impact = ballSpeed(b);
      const vyAfter = impactVy * E_TURF;
      // Kill micro-bounces; below that the ball rolls.
      b.vy = vyAfter > 0.2 ? vyAfter : 0;
      if (b.vy === 0) b.spinRadS = 0;
      out.push({ kind: 'FLOOR_BOUNCE', panel: null, speedMps: impact });
      if (impactVy >= BOUNCE_EVENT_MIN_VY_MPS) {
        out.push({ kind: 'BALL_BOUNCE', panel: null, speedMps: impact });
      }
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
        out.push({ kind: 'SETTLED', panel: null, speedMps: 0 });
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

/** Narrow cylinder colliders at x = ±halfW, z every 10 ft (e = 0.45). */
function frameUprightHit(b: BallState, out: CollisionHit[]): boolean {
  const r = BALL_RADIUS_M;
  const reach = r + FRAME_RADIUS_M;
  const side = b.px > 0 ? CAGE_HALF_WIDTH_M : -CAGE_HALF_WIDTH_M;
  const dx = b.px - side;
  if (Math.abs(dx) >= reach || b.py > CAGE_HEIGHT_M) return false;
  // Nearest upright on the 10 ft grid.
  const k = Math.round((b.pz - FRAME_FIRST_Z_M) / FRAME_SPACING_M);
  const uz = FRAME_FIRST_Z_M + k * FRAME_SPACING_M;
  if (uz < FRAME_FIRST_Z_M - 1e-9 || uz > FRAME_LAST_Z_M + 1e-9) return false;
  const dz = b.pz - uz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach || d2 < 1e-12) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return false; // already separating
  const impact = ballSpeed(b);
  b.px = side + nx * reach;
  b.pz = uz + nz * reach;
  b.vx -= (1 + E_FRAME) * vn * nx;
  b.vz -= (1 + E_FRAME) * vn * nz;
  out.push({ kind: 'FRAME_HIT', panel: null, speedMps: impact });
  return true;
}

/** Sphere vs the machine-guard AABB (e = 0.30; mesh rattle damps tangentials). */
function guardHit(b: BallState, out: CollisionHit[]): boolean {
  const r = BALL_RADIUS_M;
  const gz0 = MACHINE_BODY_DIST_M - GUARD_HALF_XZ_M;
  const gz1 = MACHINE_BODY_DIST_M + GUARD_HALF_XZ_M;
  const cx = clamp(b.px, -GUARD_HALF_XZ_M, GUARD_HALF_XZ_M);
  const cy = clamp(b.py, 0, GUARD_TOP_M);
  const cz = clamp(b.pz, gz0, gz1);
  const dx = b.px - cx;
  const dy = b.py - cy;
  const dz = b.pz - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  const impact = ballSpeed(b);
  if (d2 > 1e-12) {
    // Center outside the box: reflect along the surface normal.
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn >= 0) return false;
    b.px = cx + nx * r;
    b.py = cy + ny * r;
    b.pz = cz + nz * r;
    reflectGuard(b, nx, ny, nz, vn);
  } else {
    // Center inside (fast ball stepped in): exit along the least-penetration
    // axis. The plate side (-z face) wins ties — batted balls come from there.
    const penX = GUARD_HALF_XZ_M - Math.abs(b.px);
    const penY = GUARD_TOP_M - b.py;
    const penZNear = b.pz - gz0;
    const penZFar = gz1 - b.pz;
    const minPen = Math.min(penZNear, penX, penY, penZFar);
    if (minPen === penZNear) {
      b.pz = gz0 - r;
      if (b.vz > 0) reflectGuard(b, 0, 0, -1, -b.vz);
    } else if (minPen === penX) {
      const s = b.px >= 0 ? 1 : -1;
      b.px = s * (GUARD_HALF_XZ_M + r);
      if (b.vx * s < 0) reflectGuard(b, s, 0, 0, b.vx * s);
    } else if (minPen === penY) {
      b.py = GUARD_TOP_M + r;
      if (b.vy < 0) reflectGuard(b, 0, 1, 0, b.vy);
    } else {
      b.pz = gz1 + r;
      if (b.vz < 0) reflectGuard(b, 0, 0, 1, b.vz);
    }
  }
  out.push({ kind: 'GUARD_HIT', panel: null, speedMps: impact });
  return true;
}

function reflectGuard(b: BallState, nx: number, ny: number, nz: number, vn: number): void {
  b.vx -= (1 + E_GUARD) * vn * nx;
  b.vy -= (1 + E_GUARD) * vn * ny;
  b.vz -= (1 + E_GUARD) * vn * nz;
  // The mesh rattles some energy out of the glancing components too.
  b.vx *= nx === 0 ? 0.8 : 1;
  b.vy *= ny === 0 ? 0.8 : 1;
  b.vz *= nz === 0 ? 0.8 : 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Sphere-sphere position nudges among settled balls (§Architecture: "simple
 * nudges", no velocity exchange): the live ball shoves settled balls out of
 * its path; overlapping settled pairs split the correction. Horizontal only —
 * everything sits on the turf.
 */
export function separateSettled(settled: BallState[], live: BallState | null): boolean {
  const r = BALL_RADIUS_M;
  const minDist = 2 * r;
  let moved = false;
  if (live && live.active && !live.asleep && live.py < 3 * r) {
    for (const s of settled) moved = nudgeAway(live, s, minDist) || moved;
  }
  for (let i = 0; i < settled.length; i++) {
    for (let j = i + 1; j < settled.length; j++) {
      moved = splitPair(settled[i]!, settled[j]!, minDist) || moved;
    }
  }
  return moved;
}

/** Push `s` horizontally fully out of `from` (the live ball never moves). */
function nudgeAway(from: BallState, s: BallState, minDist: number): boolean {
  let dx = s.px - from.px;
  let dz = s.pz - from.pz;
  let d = Math.sqrt(dx * dx + dz * dz);
  if (d >= minDist) return false;
  if (d < 1e-9) {
    // Coincident centers: deterministic split along +x.
    dx = 1;
    dz = 0;
    d = 1;
  }
  const push = minDist - d;
  s.px += (dx / d) * push;
  s.pz += (dz / d) * push;
  clampIntoCage(s, minDist);
  return true;
}

/** Resolve one settled pair exactly: each moves half the overlap, apart. */
function splitPair(a: BallState, b: BallState, minDist: number): boolean {
  let dx = b.px - a.px;
  let dz = b.pz - a.pz;
  let d = Math.sqrt(dx * dx + dz * dz);
  if (d >= minDist) return false;
  if (d < 1e-9) {
    dx = 1;
    dz = 0;
    d = 1;
  }
  const half = (minDist - d) / 2 + 1e-9; // epsilon: land at ≥ minDist, not under it
  const ux = dx / d;
  const uz = dz / d;
  a.px -= ux * half;
  a.pz -= uz * half;
  b.px += ux * half;
  b.pz += uz * half;
  clampIntoCage(a, minDist);
  clampIntoCage(b, minDist);
  return true;
}

function clampIntoCage(s: BallState, minDist: number): void {
  s.px = clamp(s.px, -CAGE_HALF_WIDTH_M + minDist / 2, CAGE_HALF_WIDTH_M - minDist / 2);
  s.pz = clamp(s.pz, CAGE_BACK_Z_M + minDist / 2, CAGE_FAR_Z_M - minDist / 2);
}
