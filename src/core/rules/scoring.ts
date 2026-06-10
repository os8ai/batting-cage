import { FOUL_POINTS, POINT_MULTIPLIERS } from '../constants';
import type { Grade, SwingRecord } from '../types';

/**
 * §8 per-pitch points (locked formula): quality multiplier × projected carry,
 * rounded — PERFECT 1.60×, GREAT 1.25×, GOOD 1.00×; FOUL 25 flat (no distance
 * exists); MISS/TAKE 0. Round score = Σ over the 10 pitches.
 */
export function pointsFor(grade: Grade, carryFt: number | null): number {
  switch (grade) {
    case 'PERFECT':
    case 'GREAT':
    case 'GOOD':
      return Math.round(POINT_MULTIPLIERS[grade] * (carryFt ?? 0));
    case 'FOUL':
      return FOUL_POINTS;
    case 'MISS':
    case 'TAKE':
      return 0;
  }
}

export function roundScore(records: readonly SwingRecord[]): number {
  let sum = 0;
  for (const r of records) sum += r.points;
  return sum;
}

/** Total projected carry over the round, ft (the Platinum second bar, §8). */
export function totalCarryFt(records: readonly SwingRecord[]): number {
  let sum = 0;
  for (const r of records) sum += r.carryFt ?? 0;
  return sum;
}

/** Longest single carry of the round, ft (PB + distance-club input). */
export function bestCarryFt(records: readonly SwingRecord[]): number {
  let best = 0;
  for (const r of records) if (r.carryFt !== null && r.carryFt > best) best = r.carryFt;
  return best;
}

/** Hardest exit velocity of the round, mph (PB input). */
export function bestEvMph(records: readonly SwingRecord[]): number {
  let best = 0;
  for (const r of records) if (r.evMph !== null && r.evMph > best) best = r.evMph;
  return best;
}
