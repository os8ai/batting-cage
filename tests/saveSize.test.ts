import { describe, expect, it } from 'vitest';
import { SWING_LOG_CAP } from '../src/core/constants';
import {
  createFreshSave,
  encodeSwing,
  isSave,
  RECENT_ROUNDS_CAP,
  TIER_KEYS,
  type SaveV1,
  type SwingTuple,
} from '../src/persist/schema';
import type { SwingRecord } from '../src/core/types';

/**
 * §12 save budget (M4 P2.3): < 1 MB typical, < 2 MB worst case at the
 * 10k-swing cap. Synthesized through the real codec so the tuples carry
 * realistic magnitudes (epoch-ms timestamps, ×10 fixed-point fields).
 */

function worstSwing(pitch: number, t: number): SwingRecord {
  return {
    pitch,
    tier: 90,
    epsMs: -123.456, // encodes to a 5-digit ×10 fixed-point — widest realistic
    grade: 'PERFECT',
    spray: 'CENTER',
    evMph: 102.34,
    laDeg: -4.5 + (t % 60),
    carryFt: 417,
    points: 667,
  };
}

function buildSave(swings: number, sessions: number, fullTiers: boolean): SaveV1 {
  const save = createFreshSave(0xffffffff, '2026-06-10T12:34:56.789Z');
  const log: SwingTuple[] = [];
  const epoch0 = 1_780_000_000_000; // 2026-era epoch ms — realistic digit count
  for (let i = 0; i < swings; i++) {
    log.push(encodeSwing(worstSwing((i % 10) + 1, i), i % 2 ? 'METAL' : 'WOOD', epoch0 + i * 9000));
  }
  save.swingLog = log;
  save.swingLogBase = 123_456;

  for (let s = 0; s < sessions; s++) {
    save.sessions.push({
      dateISO: '2026-06-10T12:34:56.789Z',
      rounds: 12,
      bestScore: 6_543,
      medianAbsEpsMs: 123.4,
      contactPct: 0.876543,
      hardHitPct: 0.654321,
    });
  }

  if (fullTiers) {
    for (const k of TIER_KEYS) {
      const t = save.tiers[k];
      t.unlocked = true;
      t.medals = { bronze: true, silver: true, gold: true, platinum: true };
      t.pbs = { bestRoundScore: 6_543, longestCarryFt: 417, hardestEvMph: 102.3 };
      t.top5 = Array.from({ length: 5 }, (_, i) => ({
        initials: 'WWW',
        score: 6_543 - i,
        dateISO: '2026-06-10T12:34:56.789Z',
      }));
      t.lifetimeAverages = {
        rounds: 10_000,
        medianAbsEpsMs: 123.4,
        contactPct: 0.876543,
        hardHitPct: 0.654321,
        avgRoundScore: 4_321.987,
      };
      t.distanceClubs = [250, 300, 350, 400];
    }
    for (let i = 0; i < RECENT_ROUNDS_CAP; i++) {
      save.recentRounds.push({
        tier: '90',
        score: 6_543,
        medal: 'platinum',
        dateISO: '2026-06-10T12:34:56.789Z',
        logStart: 9_990 + i,
        count: 10,
      });
    }
  }
  return save;
}

describe('§12 save-size budget', () => {
  it('worst case — 10k-swing cap, max sessions/top5s/recents — serializes < 2 MB', () => {
    // 5,000 sessions is the import guard's own ceiling (schema SESSIONS_MAX):
    // at ~12 rounds/day that is a decade of daily play kept forever.
    const save = buildSave(SWING_LOG_CAP, 5_000, true);
    expect(isSave(save)).toBe(true); // the synthetic monster is a VALID save
    const bytes = new TextEncoder().encode(JSON.stringify(save)).length;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('typical 50-round career serializes < 1 MB', () => {
    const save = buildSave(500, 8, true);
    expect(isSave(save)).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(save)).length;
    expect(bytes).toBeLessThan(1 * 1024 * 1024);
  });

  it('the capped log alone stays near the §Data-model ~0.6 MB estimate', () => {
    const save = buildSave(SWING_LOG_CAP, 0, false);
    const bytes = new TextEncoder().encode(JSON.stringify(save.swingLog)).length;
    expect(bytes).toBeLessThan(900 * 1024); // tuple form, headroom over the estimate
  });
});
