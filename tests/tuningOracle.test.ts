import { describe, expect, it } from 'vitest';
import { MEDAL_THRESHOLDS, POINT_MULTIPLIERS, WINDOWS_MS } from '../src/core/constants';
import { applyTuning, resetTuning, tuningSnapshot } from '../src/core/tuning';
import { TIERS } from '../src/core/constants';
import { mulberry32 } from '../src/core/rng';
import {
  gauss,
  maxSigmaForBronze,
  medalProbabilities,
  noviceFirstSessionBronzeRate,
  simulateRound,
} from './oracle/playerModel';

/**
 * M4 tuning oracle (M4-PLAN §3.2 / P0.3): asserts the SHIPPED tables satisfy
 * the §14.22–.24 model proxies. The oracle focuses tuning and guards
 * regressions; the contract itself remains owner playtests (recorded in
 * M4-NOTES). Any future medal/window retune must keep these green or
 * re-baseline them in the same commit — the M2/M3 P0 pattern.
 */

describe('tuning rig (core/tuning.ts)', () => {
  it('applyTuning mutates the live tables in place; resetTuning restores launch values', () => {
    const before = tuningSnapshot();
    const windowsRef = WINDOWS_MS[40];
    try {
      applyTuning({
        windowsMs: { 40: { P: 99 } },
        medalThresholds: { 90: { bronze: 1234 } },
        pointMultipliers: { GREAT: 1.11 },
        foulPoints: 7,
      });
      expect(WINDOWS_MS[40].P).toBe(99);
      expect(WINDOWS_MS[40]).toBe(windowsRef); // stable identity — consumers stay live
      expect(WINDOWS_MS[40].GR).toBe(before.windowsMs[40].GR); // untouched keys survive
      expect(MEDAL_THRESHOLDS[90].bronze).toBe(1234);
      expect(POINT_MULTIPLIERS.GREAT).toBe(1.11);
      expect(tuningSnapshot().foulPoints).toBe(7);
    } finally {
      resetTuning();
    }
    expect(tuningSnapshot()).toEqual(before);
  });

  it('grading reads the table at use-time — a window edit applies to the next judgment', async () => {
    const { gradeFor } = await import('../src/core/contact/timingWindows');
    try {
      expect(gradeFor(40, 50)).toBe('GREAT');
      applyTuning({ windowsMs: { 40: { P: 60 } } });
      expect(gradeFor(40, 50)).toBe('PERFECT');
    } finally {
      resetTuning();
    }
  });
});

describe('player model mechanics', () => {
  it('gauss is deterministic for a fixed seed and roughly standard-normal', () => {
    const rng = mulberry32(42);
    const a = Array.from({ length: 4000 }, () => gauss(rng));
    const rng2 = mulberry32(42);
    expect(gauss(rng2)).toBe(a[0]);
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.93);
    expect(sd).toBeLessThan(1.07);
  });

  it('simulateRound replays bit-identically for fixed seeds', () => {
    const a = simulateRound(60, { sigmaMs: 30 }, 0xabc, 3, mulberry32(7));
    const b = simulateRound(60, { sigmaMs: 30 }, 0xabc, 3, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('skill pays: elite σ strictly outscores novice σ at every tier (median over 150 rounds)', () => {
    for (const tier of TIERS) {
      const elite = medalProbabilities(tier, { sigmaMs: 15 }, 150);
      const novice = medalProbabilities(tier, { sigmaMs: 65 }, 150);
      expect(elite.medianScore, `${tier} mph`).toBeGreaterThan(novice.medianScore);
    }
  });
});

describe('§14.22–.24 tuning proxies (the shipped-table contract)', () => {
  it('§14.22a — a median novice (σ0 65 ms, late bias) earns bronze at 40 within 3 rounds', () => {
    const rate = noviceFirstSessionBronzeRate({ sigma0Ms: 65, biasMs: 10 });
    expect(rate).toBeGreaterThanOrEqual(0.7); // target ~50% — hold with margin
  });

  it('§14.22b — the bronze ladder falls smoothly tier to tier (no free tier, no cliff)', () => {
    const ladder = TIERS.map((t) => maxSigmaForBronze(t, 0.5, 120));
    for (let i = 1; i < ladder.length; i++) {
      const ratio = ladder[i]! / ladder[i - 1]!;
      // Monotone: every step demands better timing than the last…
      expect(ratio, `σB ${TIERS[i - 1]}→${TIERS[i]} (${ladder.join(', ')})`).toBeLessThan(0.95);
      // …and smooth: no step is a cliff (the 2–4 h ladder has no wall).
      expect(ratio, `σB ${TIERS[i - 1]}→${TIERS[i]} (${ladder.join(', ')})`).toBeGreaterThan(0.55);
    }
    // The top of the ladder is a real summit: bronze at 90 needs practiced timing…
    expect(ladder[5]!).toBeLessThanOrEqual(45);
    // …and the bottom is a welcome mat: novice timing brons at 40.
    expect(ladder[0]!).toBeGreaterThanOrEqual(80);
  });

  it('§14.22c — platinum is elite-only (σ ≲ 20) yet reachable at every tier', () => {
    for (const tier of TIERS) {
      const practiced = medalProbabilities(tier, { sigmaMs: 30 }, 200);
      const elite = medalProbabilities(tier, { sigmaMs: 15 }, 200);
      const peak = medalProbabilities(tier, { sigmaMs: 12 }, 200);
      expect(practiced.platinum, `P(platinum | σ30) at ${tier}`).toBeLessThanOrEqual(0.03);
      expect(
        Math.max(elite.platinum, peak.platinum),
        `P(platinum | elite σ) at ${tier}`
      ).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('§14.23 proxy — bronze at 40 is near-certain for a completed first-session round', () => {
    // Session pull rides early wins (SPEC §Why): the first medal must land.
    expect(medalProbabilities(40, { sigmaMs: 65, biasMs: 10 }, 200).bronze).toBeGreaterThanOrEqual(0.9);
  });

  it('§14.24 proxy — a 30% |ε| improvement moves the medal needle at a fixed tier', () => {
    // First→fifth session: σ 55 → 38 (−30%). The board must SHOW the gain:
    // median score and silver odds both rise materially at the same tier.
    const first = medalProbabilities(60, { sigmaMs: 55 }, 200);
    const fifth = medalProbabilities(60, { sigmaMs: 38.5 }, 200);
    expect(fifth.medianScore).toBeGreaterThan(first.medianScore * 1.1);
    expect(fifth.silver).toBeGreaterThan(first.silver + 0.15);
  });

  it('medal ordering stays coherent at every tier (bronze < silver < gold < platinum)', () => {
    for (const tier of TIERS) {
      const m = MEDAL_THRESHOLDS[tier];
      expect(m.bronze).toBeLessThan(m.silver);
      expect(m.silver).toBeLessThan(m.gold);
      expect(m.gold).toBeLessThan(m.platinum);
    }
  });
});
