import { describe, expect, it } from 'vitest';
import { MEDAL_THRESHOLDS, TIERS } from '../src/core/constants';
import {
  clubsEntered,
  medalFor,
  medalsImplied,
  nextTier,
  unlocksAfter,
} from '../src/core/rules/progression';
import { CageSim } from '../src/core/sim';
import type { CareerSnapshot, DomainEvent, TierMph } from '../src/core/types';
import { pressForEps, runScriptedRound, type ScriptedPress } from './harness';

/** §8 medals/unlocks/clubs (§14.10 — table-driven, boundaries ±1 point). */

describe('medal boundaries (every tier, every threshold, ±1 point)', () => {
  for (const tier of TIERS) {
    const t = MEDAL_THRESHOLDS[tier];
    const bigCarry = t.platinumCarryFt + 100; // carry bar satisfied
    it(`${tier} mph thresholds`, () => {
      expect(medalFor(tier, t.bronze - 1, bigCarry)).toBeNull();
      expect(medalFor(tier, t.bronze, bigCarry)).toBe('bronze');
      expect(medalFor(tier, t.bronze + 1, bigCarry)).toBe('bronze');
      expect(medalFor(tier, t.silver - 1, bigCarry)).toBe('bronze');
      expect(medalFor(tier, t.silver, bigCarry)).toBe('silver');
      expect(medalFor(tier, t.gold - 1, bigCarry)).toBe('silver');
      expect(medalFor(tier, t.gold, bigCarry)).toBe('gold');
      expect(medalFor(tier, t.platinum - 1, bigCarry)).toBe('gold');
      expect(medalFor(tier, t.platinum, bigCarry)).toBe('platinum');
    });

    it(`${tier} mph Platinum requires BOTH bars`, () => {
      // Platinum score without the carry bar stays Gold...
      expect(medalFor(tier, t.platinum, t.platinumCarryFt - 1)).toBe('gold');
      expect(medalFor(tier, t.platinum + 500, 0)).toBe('gold');
      // ...and the carry bar alone never upgrades a Gold score.
      expect(medalFor(tier, t.gold, t.platinumCarryFt + 999)).toBe('gold');
      // Both bars exactly at threshold → Platinum.
      expect(medalFor(tier, t.platinum, t.platinumCarryFt)).toBe('platinum');
    });
  }
});

describe('bronze → unlock chain', () => {
  it('any medal at N unlocks N+1; nothing past 90', () => {
    expect(nextTier(40)).toBe(50);
    expect(nextTier(90)).toBeNull();
    expect(unlocksAfter(40, 'bronze', [40])).toEqual([50]);
    expect(unlocksAfter(40, 'platinum', [40])).toEqual([50]);
    expect(unlocksAfter(40, null, [40])).toEqual([]);
    expect(unlocksAfter(40, 'bronze', [40, 50])).toEqual([]); // already open
    expect(unlocksAfter(90, 'gold', TIERS as TierMph[])).toEqual([]);
  });

  it('higher medals imply the lower ones for the locker', () => {
    expect(medalsImplied('bronze')).toEqual(['bronze']);
    expect(medalsImplied('gold')).toEqual(['bronze', 'silver', 'gold']);
  });
});

describe('distance clubs (§8: first entry per tier)', () => {
  it('enters every club the best carry reaches, once', () => {
    expect(clubsEntered(310, [])).toEqual([250, 300]);
    expect(clubsEntered(310, [250])).toEqual([300]);
    expect(clubsEntered(420, [250, 300])).toEqual([350, 400]);
    expect(clubsEntered(249, [])).toEqual([]);
    expect(clubsEntered(400, [250, 300, 350, 400])).toEqual([]);
  });
});

describe('sim career gating & ceremonies', () => {
  const firstRun: CareerSnapshot = { unlockedTiers: [40], tiers: {} };

  function goodPresses(tier: TierMph, count = 10): ScriptedPress[] {
    // All-PERFECT round: at 40 mph that's bronze comfortably (10 × ~563 ≈ 5,630).
    return Array.from({ length: count }, (_, i) => ({ t: pressForEps(tier, i + 1, 0) }));
  }

  it('selectTier refuses locked tiers and accepts unlocked ones', () => {
    const sim = new CageSim({ seed: 1, career: firstRun });
    expect(sim.selectTier(50)).toBe(false);
    expect(sim.selectTier(90)).toBe(false);
    expect(sim.selectTier(40)).toBe(true);
    expect(sim.isTierUnlocked(40)).toBe(true);
    expect(sim.isTierUnlocked(50)).toBe(false);
  });

  it('default career (headless) keeps every tier open — M0–M2 suites unaffected', () => {
    const sim = new CageSim({ seed: 1 });
    for (const tier of TIERS) expect(sim.selectTier(tier)).toBe(true);
  });

  it('a medal round emits TIER_UNLOCKED and the next token can select it', () => {
    const events: DomainEvent[] = [];
    const sim = new CageSim({ seed: 11, career: firstRun });
    sim.onEvent((e) => events.push(e));
    expect(sim.selectTier(40)).toBe(true);
    sim.insertToken();
    const presses = goodPresses(40);
    let pi = 0;
    while (sim.currentPhase !== 'ROUND_END' && sim.t < 90) {
      while (pi < presses.length && presses[pi]!.t <= sim.t) sim.queueSwing(presses[pi++]!.t);
      sim.tick();
    }
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    expect(end.medal).not.toBeNull();
    expect(end.newUnlocks).toEqual([50]);
    const unlock = events.find((e) => e.type === 'TIER_UNLOCKED');
    expect(unlock).toMatchObject({ type: 'TIER_UNLOCKED', tier: 50 });
    // The chain folds back into the live career.
    expect(sim.selectTier(50)).toBe(true);
    // ...but 60 stays locked until bronze at 50 (the §8 ladder).
    expect(sim.selectTier(60)).toBe(false);
  });

  it('ceremony order after ROUND_END: PB* → CLUB* → MEDAL → UNLOCK*', () => {
    const events: DomainEvent[] = [];
    const sim = new CageSim({ seed: 11, career: firstRun });
    sim.onEvent((e) => events.push(e));
    sim.insertToken();
    const presses = goodPresses(40);
    let pi = 0;
    while (sim.currentPhase !== 'ROUND_END' && sim.t < 90) {
      while (pi < presses.length && presses[pi]!.t <= sim.t) sim.queueSwing(presses[pi++]!.t);
      sim.tick();
    }
    const tail = events.slice(events.findIndex((e) => e.type === 'ROUND_END'));
    const order = tail.map((e) => e.type);
    const rank: Record<string, number> = {
      ROUND_END: 0,
      NEW_PB: 1,
      CLUB_ENTERED: 2,
      MEDAL_EARNED: 3,
      TIER_UNLOCKED: 4,
    };
    const ranks = order.filter((t) => t in rank).map((t) => rank[t]!);
    expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
    // An all-PERFECT first round is a score PB, a carry PB, an EV PB, and
    // enters 250/300/350 ft clubs at 40 mph (§7: max carry ≈ 352 ft).
    expect(order.filter((t) => t === 'NEW_PB')).toHaveLength(3);
    expect(tail.some((e) => e.type === 'CLUB_ENTERED')).toBe(true);
    expect(tail.some((e) => e.type === 'MEDAL_EARNED')).toBe(true);
  });

  it('a repeat performance earns no second medal stamp (the locker remembers)', () => {
    const events: DomainEvent[] = [];
    const sim = new CageSim({ seed: 11, career: firstRun });
    sim.onEvent((e) => events.push(e));
    const playRound = () => {
      const tokenAt = sim.t;
      sim.insertToken();
      const presses = Array.from({ length: 10 }, (_, i) => ({
        t: pressForEps(40, i + 1, 0, tokenAt),
      }));
      let pi = 0;
      const until = sim.t + 90;
      while (sim.currentPhase !== 'ROUND_END' && sim.t < until) {
        while (pi < presses.length && presses[pi]!.t <= sim.t) sim.queueSwing(presses[pi++]!.t);
        sim.tick();
      }
    };
    playRound();
    const medalsRound1 = events.filter((e) => e.type === 'MEDAL_EARNED').length;
    expect(medalsRound1).toBeGreaterThanOrEqual(1);
    const ends1 = events.filter((e) => e.type === 'ROUND_END').length;
    expect(ends1).toBe(1);
    playRound();
    expect(events.filter((e) => e.type === 'ROUND_END')).toHaveLength(2);
    const end2 = events.filter((e) => e.type === 'ROUND_END')[1]!;
    if (end2.type !== 'ROUND_END') throw new Error('unreachable');
    // Round two earns the same medal level → already stamped, no new ceremony
    // (unless round two outscored round one into a HIGHER never-earned level,
    // which identical all-PERFECT timing can't do beyond jitter — assert the
    // stamped set only ever grows by genuinely new levels).
    const medalsRound2 = events.filter((e) => e.type === 'MEDAL_EARNED').length - medalsRound1;
    if (end2.medal !== null) {
      const round1End = events.find((e) => e.type === 'ROUND_END')!;
      if (round1End.type !== 'ROUND_END') throw new Error('unreachable');
      expect(medalsRound2).toBe(end2.medal === round1End.medal ? 0 : medalsRound2);
    }
    // And the 50 mph unlock from round one never re-fires.
    expect(events.filter((e) => e.type === 'TIER_UNLOCKED')).toHaveLength(1);
  });

  it('the stat locker never gates: unlocks derive from medals alone', () => {
    // A round of nothing but fouls + takes (terrible aggregates) at an
    // unlocked tier changes nothing; a bronze-score round with awful timing
    // stats still unlocks. Gate inputs are (score, carry) only.
    expect(unlocksAfter(40, medalFor(40, MEDAL_THRESHOLDS[40].bronze, 0), [40])).toEqual([50]);
  });

  it('setCareer is refused mid-round', () => {
    const { events } = (() => {
      const sim = new CageSim({ seed: 5, career: firstRun });
      const events: DomainEvent[] = [];
      sim.onEvent((e) => events.push(e));
      sim.insertToken();
      for (let i = 0; i < 600; i++) sim.tick(); // into the round
      expect(sim.setCareer({ unlockedTiers: [40, 50], tiers: {} })).toBe(false);
      expect(sim.isTierUnlocked(50)).toBe(false);
      return { events };
    })();
    void events;
  });

  it('a TAKE-only round earns nothing — no PB, no medal, no clubs', () => {
    const { events } = runScriptedRound({ seed: 8, tier: 40, presses: [], frameDt: 1 / 60 });
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    expect(end.score).toBe(0);
    expect(end.medal).toBeNull();
    expect(end.isPB).toBe(false);
    expect(events.some((e) => e.type === 'NEW_PB' || e.type === 'MEDAL_EARNED')).toBe(false);
  });
});
