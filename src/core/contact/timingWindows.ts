import { WINDOWS_MS } from '../constants';
import type { Grade, TierMph } from '../types';

export interface GradeWindows {
  P: number;
  GR: number;
  GD: number;
  FL: number;
}

/** §6 per-tier grade windows (|ε| in ms; beyond FOUL = MISS). Data-driven for M4 tuning. */
export function windowsFor(tier: TierMph): GradeWindows {
  return WINDOWS_MS[tier];
}

/** Grade from |ε| against a tier's windows. (TAKE is decided by the sim, not here.) */
export function gradeFor(tier: TierMph, epsMs: number): Exclude<Grade, 'TAKE'> {
  const w = windowsFor(tier);
  const a = Math.abs(epsMs);
  if (a <= w.P) return 'PERFECT';
  if (a <= w.GR) return 'GREAT';
  if (a <= w.GD) return 'GOOD';
  if (a <= w.FL) return 'FOUL';
  return 'MISS';
}
