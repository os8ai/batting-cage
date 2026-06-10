import {
  BAT_SPEED_MPH,
  EV_BAT_FACTOR,
  EV_JITTER,
  EV_PITCH_FACTOR,
  LA_BASE_DEG,
  LA_JITTER_DEG,
  LA_MAX_DEG,
  LA_MIN_DEG,
  LA_SLOPE_DEG,
  Q_ANCHORS,
  Q_FOUL_MIN,
  SPRAY_CENTER_TAG_DEG,
  SPRAY_FAIR_MAX_DEG,
  SPRAY_FOUL_MAX_DEG,
  SPRAY_FOUL_MIN_DEG,
  SPRAY_JITTER_DEG,
} from '../constants';
import type { Rng } from '../rng';
import type { Grade, SprayTag, TierMph } from '../types';
import { gradeFor, windowsFor } from './timingWindows';

export interface ContactOutcome {
  grade: Exclude<Grade, 'TAKE'>;
  /** Contact quality (defined for contact grades; 0 for MISS). */
  q: number;
  evMph: number | null;
  laDeg: number | null;
  /** Signed spray angle φ, ° (> 0 = opposite field). Null for MISS. */
  sprayDeg: number | null;
  sprayTag: SprayTag | null;
}

/**
 * §6 contact quality q — piecewise-linear in |ε| through the anchors
 * q(0)=1.00 → q(W_P)=0.95 → q(W_GR)=0.82 → q(W_GD)=0.65. Continuous, no
 * cliffs in the fair range. The FOUL band extends the GR→GD slope, clamped
 * (TUNABLE — foul contact is never scored or projected).
 */
export function contactQuality(tier: TierMph, epsMs: number): number {
  const w = windowsFor(tier);
  const a = Math.abs(epsMs);
  const { q0, qP, qGR, qGD } = Q_ANCHORS;
  if (a <= w.P) return q0 + ((qP - q0) * a) / w.P;
  if (a <= w.GR) return qP + ((qGR - qP) * (a - w.P)) / (w.GR - w.P);
  if (a <= w.GD) return qGR + ((qGD - qGR) * (a - w.GR)) / (w.GD - w.GR);
  const foulSlope = (qGD - qGR) / (w.GD - w.GR);
  return Math.max(Q_FOUL_MIN, qGD + foulSlope * (a - w.GD));
}

/**
 * §6 outcome mapping from signed ε. All curves are normalized to the tier's
 * windows, so tiers differ only in window tightness (fence 2). Draw order on
 * the per-pitch rng is fixed: EV, LA, spray — determinism depends on it.
 */
export function resolveContact(tier: TierMph, epsMs: number, vReleaseMph: number, rng: Rng): ContactOutcome {
  const grade = gradeFor(tier, epsMs);
  if (grade === 'MISS') {
    return { grade, q: 0, evMph: null, laDeg: null, sprayDeg: null, sprayTag: null };
  }
  const w = windowsFor(tier);
  const q = contactQuality(tier, epsMs);
  const u = epsMs / w.GD; // normalized signed error

  // EV = q × (1.2×70 + 0.2×v_release) × jitter, jitter ∈ [0.98, 1.02] seeded.
  const evJitter = 1 - EV_JITTER + 2 * EV_JITTER * rng();
  const evMph = q * (EV_BAT_FACTOR * BAT_SPEED_MPH + EV_PITCH_FACTOR * vReleaseMph) * evJitter;

  // LA = 25° + 21°×u + jitter(±3°), clamped to [−5°, 55°].
  const laJitter = LA_JITTER_DEG * (2 * rng() - 1);
  const laDeg = Math.min(LA_MAX_DEG, Math.max(LA_MIN_DEG, LA_BASE_DEG + LA_SLOPE_DEG * u + laJitter));

  // Spray φ: fair |ε| ≤ W_GD → 0→40°; FOUL band (W_GD, W_FL] → 46°→70°.
  // Jitter ±2°, then clamp back into the band so it can never flip fair/foul
  // across the 6° guard gap (§6) — a FOUL is always visibly past the 45° line.
  const a = Math.abs(epsMs);
  const sprayJitter = SPRAY_JITTER_DEG * (2 * rng() - 1);
  let mag: number;
  if (grade === 'FOUL') {
    const t = (a - w.GD) / (w.FL - w.GD);
    mag = SPRAY_FOUL_MIN_DEG + (SPRAY_FOUL_MAX_DEG - SPRAY_FOUL_MIN_DEG) * t + sprayJitter;
    mag = Math.min(SPRAY_FOUL_MAX_DEG, Math.max(SPRAY_FOUL_MIN_DEG, mag));
  } else {
    mag = (SPRAY_FAIR_MAX_DEG * a) / w.GD + sprayJitter;
    mag = Math.min(SPRAY_FAIR_MAX_DEG + SPRAY_JITTER_DEG, Math.max(0, mag));
  }
  // Sign from ε: EARLY (ε<0) = pull (φ<0), LATE = oppo (φ>0).
  const sprayDeg = epsMs < 0 ? -mag : mag;
  const sprayTag: SprayTag =
    Math.abs(sprayDeg) <= SPRAY_CENTER_TAG_DEG ? 'CENTER' : epsMs < 0 ? 'PULL' : 'OPPO';

  return { grade, q, evMph, laDeg, sprayDeg, sprayTag };
}
