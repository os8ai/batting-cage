import { PITCHES_PER_ROUND } from '../core/constants';
import { bestCarryFt, roundScore } from '../core/rules/scoring';
import type { SwingRecord, TierMph } from '../core/types';

/**
 * §What outputs (f): the on-demand end-of-round clipboard summary for
 * hot-seat bragging — "BATTING CAGE — 70 MPH — 8/10 — BEST 312 FT —
 * SCORE 4,120". Pure formatter (headless-tested); the browser copy lives on
 * the ESC sheet. Contact count and best carry derive from the round's own
 * records (single-derivation rule); thousands separator is locale-free.
 */

/** Locale-free thousands grouping (the §What example: "4,120"). */
export function groupThousands(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const sign = n < 0 ? '-' : '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return sign + out;
}

export function formatRoundSummary(tier: TierMph, records: readonly SwingRecord[]): string {
  // Contact = bat met ball (PERFECT/GREAT/GOOD/FOUL) — the stats.ts rule:
  // every contact grade carries an EV; MISS/TAKE never do.
  const contacts = records.filter((r) => r.evMph !== null).length;
  const best = bestCarryFt(records);
  const score = roundScore(records);
  const parts = [
    'BATTING CAGE',
    `${tier} MPH`,
    `${contacts}/${PITCHES_PER_ROUND}`,
  ];
  // An all-TAKE/MISS round has no carry to brag about — drop the segment.
  if (best > 0) parts.push(`BEST ${groupThousands(best)} FT`);
  parts.push(`SCORE ${groupThousands(score)}`);
  return parts.join(' — ');
}
