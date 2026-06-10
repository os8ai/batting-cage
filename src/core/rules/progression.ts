import { DISTANCE_CLUBS_FT, MEDAL_THRESHOLDS, TIERS } from '../constants';
import type { Medal, TierMph } from '../types';

/**
 * §8 medals & progression, pure. Medals gate machine speeds and NOTHING else
 * — the stat locker never gates (locked). Bronze (or better) at tier N
 * unlocks tier N+1; Platinum additionally requires the round's total-carry
 * bar (the Wii Sports pattern).
 */
export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold', 'platinum'];

export function medalRank(medal: Medal): number {
  return MEDALS.indexOf(medal);
}

/**
 * The medal a round earns: the highest score threshold met, with Platinum
 * demanding BOTH bars — a Platinum score without the carry bar stays Gold.
 */
export function medalFor(tier: TierMph, score: number, roundTotalCarryFt: number): Medal | null {
  const t = MEDAL_THRESHOLDS[tier];
  if (score >= t.platinum && roundTotalCarryFt >= t.platinumCarryFt) return 'platinum';
  if (score >= t.gold) return 'gold';
  if (score >= t.silver) return 'silver';
  if (score >= t.bronze) return 'bronze';
  return null;
}

export function nextTier(tier: TierMph): TierMph | null {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i + 1 < TIERS.length ? TIERS[i + 1]! : null;
}

/**
 * Tiers newly unlocked by this round: any medal (≥ bronze) at N unlocks N+1
 * when it isn't already open. 90 mph tops the ladder.
 */
export function unlocksAfter(
  tier: TierMph,
  medal: Medal | null,
  unlockedTiers: readonly TierMph[]
): TierMph[] {
  if (medal === null) return [];
  const next = nextTier(tier);
  return next !== null && !unlockedTiers.includes(next) ? [next] : [];
}

/** All medal levels a round's medal implies (gold ⇒ silver ⇒ bronze). */
export function medalsImplied(medal: Medal): Medal[] {
  return MEDALS.slice(0, medalRank(medal) + 1) as Medal[];
}

/**
 * §8 distance clubs (250/300/350/400 ft), first entry per tier: clubs the
 * round's best carry reaches that the career hasn't entered yet.
 */
export function clubsEntered(bestCarryFt: number, priorClubs: readonly number[]): number[] {
  return DISTANCE_CLUBS_FT.filter((ft) => bestCarryFt >= ft && !priorClubs.includes(ft));
}
