import type { TierMph } from './types';

/**
 * M4 tuning rig (SPEC §13): the four player-facing TUNABLE tables — grade
 * windows, point multipliers, foul consolation, medal thresholds — live here
 * behind stable-identity mutable exports. Consumers (timingWindows, scoring,
 * progression) read the tables at use-time via property access, so panel
 * edits apply mid-round without any call-site change; FOUL_POINTS is a `let`
 * export, and ESM live bindings keep the re-export through constants.ts hot.
 *
 * Headless suites never mutate these (launch values stay the proven
 * baseline); only the dev-only TunePanel and the tuning suites' own
 * try/finally blocks call applyTuning/resetTuning. Determinism is untouched:
 * the tables carry no RNG state, and a fixed table + fixed seed still replays
 * bit-identically.
 */

export interface WindowsRow {
  P: number;
  GR: number;
  GD: number;
  FL: number;
}

export interface MedalRow {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  platinumCarryFt: number;
}

export type Multipliers = { PERFECT: number; GREAT: number; GOOD: number };

export interface TuningTables {
  windowsMs: Record<TierMph, WindowsRow>;
  pointMultipliers: Multipliers;
  foulPoints: number;
  medalThresholds: Record<TierMph, MedalRow>;
}

/** §6 per-tier grade windows, |ε| ms — launch values (the game's identity). */
const LAUNCH_WINDOWS_MS: Record<TierMph, WindowsRow> = {
  40: { P: 40, GR: 80, GD: 120, FL: 160 },
  50: { P: 35, GR: 70, GD: 105, FL: 145 },
  60: { P: 30, GR: 60, GD: 90, FL: 130 },
  70: { P: 25, GR: 50, GD: 75, FL: 115 },
  80: { P: 20, GR: 40, GD: 60, FL: 100 },
  90: { P: 15, GR: 30, GD: 45, FL: 85 },
};

/** §8 locked formula: quality multiplier × projected carry. */
const LAUNCH_MULTIPLIERS: Multipliers = { PERFECT: 1.6, GREAT: 1.25, GOOD: 1.0 };
const LAUNCH_FOUL_POINTS = 25;

/**
 * §8 medal thresholds — M4-tuned against the §14.22–.24 oracle proxies
 * (tests/tuningOracle.test.ts; sweep evidence in M4-NOTES). Two findings
 * forced a retune of the spec's launch table:
 *
 * 1. Launch Platinum was unreachable: a round's hard ceiling is
 *    10 × 1.6 × max carry ≈ 5,630 pts at 40 mph and ≈ 6,670 at 90 — below
 *    the launch Platinum row at every tier (oracle: P(platinum)=0 even at
 *    elite σ=12 ms). Platinum now sits at ≈ the 97th percentile of a
 *    practiced (σ30) round and under the 90th of an elite (σ12) one —
 *    elite-only yet genuinely reachable; at 80–90 mph the carry bar joins
 *    in (σ20 rounds fail the 90 mph bar ~75% of the time on its own).
 * 2. Launch Bronze was flat: a σ=62 ms novice cleared bronze at EVERY tier
 *    (carry rises with tier, so points hold up while windows tighten).
 *    Bronze now tracks the σ ladder — max σ for 50% bronze falls smoothly
 *    ≈ 118 → 37 ms from 40 → 90 (§14.22's 2–4 h climb, no cliff) while a
 *    first-session novice still brons at 40 near-certainly.
 *
 * Silver = the practiced rung, Gold = the near-elite rung, at every tier.
 * Carry bars keep the spec's launch values — the Wii-pattern second check
 * (elite rounds clear them; lucky short rounds don't).
 */
const LAUNCH_MEDALS: Record<TierMph, MedalRow> = {
  40: { bronze: 2400, silver: 3700, gold: 4700, platinum: 5620, platinumCarryFt: 2800 },
  50: { bronze: 2600, silver: 3900, gold: 4800, platinum: 5750, platinumCarryFt: 2950 },
  60: { bronze: 2800, silver: 4100, gold: 4900, platinum: 5850, platinumCarryFt: 3100 },
  70: { bronze: 3000, silver: 4250, gold: 5000, platinum: 5950, platinumCarryFt: 3300 },
  80: { bronze: 3200, silver: 4400, gold: 5100, platinum: 6050, platinumCarryFt: 3450 },
  90: { bronze: 3400, silver: 4550, gold: 5200, platinum: 6150, platinumCarryFt: 3600 },
};

const TIER_KEYS: readonly TierMph[] = [40, 50, 60, 70, 80, 90];

function cloneWindows(src: Record<TierMph, WindowsRow>): Record<TierMph, WindowsRow> {
  const out = {} as Record<TierMph, WindowsRow>;
  for (const t of TIER_KEYS) out[t] = { ...src[t] };
  return out;
}

function cloneMedals(src: Record<TierMph, MedalRow>): Record<TierMph, MedalRow> {
  const out = {} as Record<TierMph, MedalRow>;
  for (const t of TIER_KEYS) out[t] = { ...src[t] };
  return out;
}

// ---------------------------------------------------------------------------
// The live tables. Object identity is stable for the life of the module —
// applyTuning/resetTuning mutate contents in place.
// ---------------------------------------------------------------------------
export const WINDOWS_MS: Record<TierMph, WindowsRow> = cloneWindows(LAUNCH_WINDOWS_MS);
export const POINT_MULTIPLIERS: Multipliers = { ...LAUNCH_MULTIPLIERS };
export let FOUL_POINTS: number = LAUNCH_FOUL_POINTS;
export const MEDAL_THRESHOLDS: Record<TierMph, MedalRow> = cloneMedals(LAUNCH_MEDALS);

export interface TuningPatch {
  windowsMs?: Partial<Record<TierMph, Partial<WindowsRow>>>;
  pointMultipliers?: Partial<Multipliers>;
  foulPoints?: number;
  medalThresholds?: Partial<Record<TierMph, Partial<MedalRow>>>;
}

/** Merge a partial patch into the live tables (pure data, no side channels). */
export function applyTuning(patch: TuningPatch): void {
  if (patch.windowsMs) {
    for (const t of TIER_KEYS) {
      const row = patch.windowsMs[t];
      if (row) Object.assign(WINDOWS_MS[t], row);
    }
  }
  if (patch.pointMultipliers) Object.assign(POINT_MULTIPLIERS, patch.pointMultipliers);
  if (patch.foulPoints !== undefined) FOUL_POINTS = patch.foulPoints;
  if (patch.medalThresholds) {
    for (const t of TIER_KEYS) {
      const row = patch.medalThresholds[t];
      if (row) Object.assign(MEDAL_THRESHOLDS[t], row);
    }
  }
}

/** Restore every table to its launch value. */
export function resetTuning(): void {
  for (const t of TIER_KEYS) {
    Object.assign(WINDOWS_MS[t], LAUNCH_WINDOWS_MS[t]);
    Object.assign(MEDAL_THRESHOLDS[t], LAUNCH_MEDALS[t]);
  }
  Object.assign(POINT_MULTIPLIERS, LAUNCH_MULTIPLIERS);
  FOUL_POINTS = LAUNCH_FOUL_POINTS;
}

/** Current tables as a plain snapshot (TunePanel persistence + copy-out). */
export function tuningSnapshot(): TuningTables {
  return {
    windowsMs: cloneWindows(WINDOWS_MS),
    pointMultipliers: { ...POINT_MULTIPLIERS },
    foulPoints: FOUL_POINTS,
    medalThresholds: cloneMedals(MEDAL_THRESHOLDS),
  };
}

/** JSON of the current tables — the paste-ready tuning-session export. */
export function serializeTuning(): string {
  return JSON.stringify(tuningSnapshot(), null, 2);
}
