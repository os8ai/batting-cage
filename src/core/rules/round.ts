import { PITCHES_PER_ROUND } from '../constants';
import type { SwingRecord, TierMph } from '../types';

/** A 10-pitch token round (§What). Scoring/medals consume this in M3. */
export interface Round {
  tier: TierMph;
  records: SwingRecord[];
}

export function createRound(tier: TierMph): Round {
  return { tier, records: [] };
}

export function recordSwing(round: Round, record: SwingRecord): void {
  round.records.push(record);
}

export function isComplete(round: Round): boolean {
  return round.records.length >= PITCHES_PER_ROUND;
}
