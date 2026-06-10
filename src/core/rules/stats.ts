import { HARD_HIT_EV_MPH, PITCHES_PER_ROUND } from '../constants';
import type { SwingRecord } from '../types';

/**
 * §What-8 stat aggregation, pure folds. The persist layer's single-derivation
 * rule recomputes everything through these — the board can never show a
 * number the log doesn't support.
 */
export interface SwingAggregates {
  /** Median |ε| over swings that were judged (null when none swung). */
  medianAbsEpsMs: number | null;
  /** Contact (PERFECT/GREAT/GOOD/FOUL) per pitch, percent 0–100. */
  contactPct: number;
  /** EV ≥ 95 mph per contacted ball, percent 0–100 (0 when no contact). */
  hardHitPct: number;
}

/** A swing as the aggregates need it (records and save tuples both fit). */
export interface SwingStat {
  epsMs: number | null;
  evMph: number | null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function foldSwings(swings: readonly SwingStat[], pitchCount = swings.length): SwingAggregates {
  const eps = swings.filter((s) => s.epsMs !== null).map((s) => Math.abs(s.epsMs!));
  const contacts = swings.filter((s) => s.evMph !== null);
  const hard = contacts.filter((s) => s.evMph! >= HARD_HIT_EV_MPH);
  return {
    medianAbsEpsMs: median(eps),
    contactPct: pitchCount > 0 ? (contacts.length / pitchCount) * 100 : 0,
    hardHitPct: contacts.length > 0 ? (hard.length / contacts.length) * 100 : 0,
  };
}

/** One round's aggregates (denominator fixed at the 10 pitches). */
export function foldRound(records: readonly SwingRecord[]): SwingAggregates {
  return foldSwings(records, Math.max(records.length, PITCHES_PER_ROUND));
}

/**
 * Last-50-swings |ε| trend for the monitor sparkline: the most recent 50
 * judged |ε| values bucketed into up-to-10 medians, oldest → newest.
 */
export const TREND_WINDOW = 50;
export const TREND_BUCKETS = 10;

export function last50Trend(absEpsOldestFirst: readonly number[]): number[] {
  const tail = absEpsOldestFirst.slice(-TREND_WINDOW);
  if (tail.length === 0) return [];
  const perBucket = Math.max(1, Math.ceil(tail.length / TREND_BUCKETS));
  const out: number[] = [];
  for (let i = 0; i < tail.length; i += perBucket) {
    out.push(median(tail.slice(i, i + perBucket))!);
  }
  return out;
}
