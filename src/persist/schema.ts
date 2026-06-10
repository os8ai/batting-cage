import { SWING_LOG_CAP, TIERS } from '../core/constants';
import type { Bat, CareerSnapshot, Grade, Handedness, Medal, SprayTag, SwingRecord, TierMph } from '../core/types';

/**
 * The §Data-model hardened single-document save (`bc.save`), schemaVersion 1,
 * with hand-rolled runtime guards (no validation dependency). The swing log
 * is FIFO-capped compact tuples; recentRounds reference log index ranges
 * rather than copying cells. All derived stats obey the single-derivation
 * rule — they are recomputed by persist/recorder.ts in one round-end
 * transaction, never incrementally mutated elsewhere.
 */
export const SCHEMA_VERSION = 1;

export type QualityPreset = 'HIGH' | 'MEDIUM' | 'LOW';

export type TierKey = '40' | '50' | '60' | '70' | '80' | '90';

export const TIER_KEYS: readonly TierKey[] = ['40', '50', '60', '70', '80', '90'];

export const GRADES: readonly Grade[] = ['PERFECT', 'GREAT', 'GOOD', 'FOUL', 'MISS', 'TAKE'];
export const SPRAYS: readonly SprayTag[] = ['PULL', 'CENTER', 'OPPO'];
export const BATS: readonly Bat[] = ['WOOD', 'METAL'];

/**
 * Fixed-order compact swing tuple (§Data model):
 * [tEpochMs, tierIdx, epsMsX10|null, gradeIdx, sprayIdx|null,
 *  evMphX10|null, laDegX10|null, carryFt|null, points, batIdx]
 */
export type SwingTuple = [
  number,
  number,
  number | null,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number,
  number,
];

export interface Top5Entry {
  initials: string;
  score: number;
  dateISO: string;
}

export interface TierSave {
  unlocked: boolean;
  medals: Record<Medal, boolean>;
  pbs: { bestRoundScore: number; longestCarryFt: number; hardestEvMph: number };
  top5: Top5Entry[];
  lifetimeAverages: {
    rounds: number;
    medianAbsEpsMs: number | null;
    contactPct: number;
    hardHitPct: number;
    avgRoundScore: number;
  };
  distanceClubs: number[];
}

export interface SessionRow {
  dateISO: string;
  rounds: number;
  bestScore: number;
  medianAbsEpsMs: number | null;
  contactPct: number;
  hardHitPct: number;
}

export interface RecentRound {
  tier: TierKey;
  score: number;
  medal: Medal | null;
  dateISO: string;
  /** Absolute swing index of the round's first tuple (see swingLogBase). */
  logStart: number;
  count: number;
}

export interface SaveV1 {
  meta: { schemaVersion: number; saveId: number; createdAt: string; updatedAt: string };
  settings: {
    qualityPreset: QualityPreset | null;
    volumes: { master: number; sfx: number; ambience: number };
    muted: boolean;
  };
  loadout: { handedness: Handedness; bat: Bat; lastInitials: string; lastTier: TierMph };
  tiers: Record<TierKey, TierSave>;
  sessions: SessionRow[];
  swingLog: SwingTuple[];
  /** Absolute swing index of swingLog[0] — advances as the FIFO cap drops old tuples. */
  swingLogBase: number;
  recentRounds: RecentRound[];
}

export const RECENT_ROUNDS_CAP = 30;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function freshTier(unlocked: boolean): TierSave {
  return {
    unlocked,
    medals: { bronze: false, silver: false, gold: false, platinum: false },
    pbs: { bestRoundScore: 0, longestCarryFt: 0, hardestEvMph: 0 },
    top5: [],
    lifetimeAverages: { rounds: 0, medianAbsEpsMs: null, contactPct: 0, hardHitPct: 0, avgRoundScore: 0 },
    distanceClubs: [],
  };
}

/** A new career: only 40 mph unlocked (§8 progression). */
export function createFreshSave(saveId: number, nowISO: string): SaveV1 {
  const tiers = {} as Record<TierKey, TierSave>;
  for (const k of TIER_KEYS) tiers[k] = freshTier(k === '40');
  return {
    meta: { schemaVersion: SCHEMA_VERSION, saveId, createdAt: nowISO, updatedAt: nowISO },
    settings: { qualityPreset: null, volumes: { master: 1, sfx: 1, ambience: 1 }, muted: false },
    loadout: { handedness: 'R', bat: 'WOOD', lastInitials: 'AAA', lastTier: 40 },
    tiers,
    sessions: [],
    swingLog: [],
    swingLogBase: 0,
    recentRounds: [],
  };
}

// ---------------------------------------------------------------------------
// Swing tuple codec
// ---------------------------------------------------------------------------

export function encodeSwing(r: SwingRecord, bat: Bat, tEpochMs: number): SwingTuple {
  return [
    Math.round(tEpochMs),
    TIERS.indexOf(r.tier),
    r.epsMs === null ? null : Math.round(r.epsMs * 10),
    GRADES.indexOf(r.grade),
    r.spray === null ? null : SPRAYS.indexOf(r.spray),
    r.evMph === null ? null : Math.round(r.evMph * 10),
    r.laDeg === null ? null : Math.round(r.laDeg * 10),
    r.carryFt,
    r.points,
    BATS.indexOf(bat),
  ];
}

export interface DecodedSwing {
  tEpochMs: number;
  tier: TierMph;
  epsMs: number | null;
  grade: Grade;
  spray: SprayTag | null;
  evMph: number | null;
  laDeg: number | null;
  carryFt: number | null;
  points: number;
  bat: Bat;
}

export function decodeSwing(t: SwingTuple): DecodedSwing {
  return {
    tEpochMs: t[0],
    tier: TIERS[t[1]]!,
    epsMs: t[2] === null ? null : t[2] / 10,
    grade: GRADES[t[3]]!,
    spray: t[4] === null ? null : SPRAYS[t[4]]!,
    evMph: t[5] === null ? null : t[5] / 10,
    laDeg: t[6] === null ? null : t[6] / 10,
    carryFt: t[7],
    points: t[8],
    bat: BATS[t[9]]!,
  };
}

// ---------------------------------------------------------------------------
// Career snapshot for the sim (one-way: storage → sim input at token time)
// ---------------------------------------------------------------------------

export function careerFromSave(save: SaveV1): CareerSnapshot {
  const snapshot: CareerSnapshot = { unlockedTiers: [], tiers: {} };
  for (let i = 0; i < TIER_KEYS.length; i++) {
    const tier = TIERS[i]!;
    const t = save.tiers[TIER_KEYS[i]!];
    if (t.unlocked) snapshot.unlockedTiers.push(tier);
    snapshot.tiers[tier] = {
      pbs: { ...t.pbs },
      medals: (Object.keys(t.medals) as Medal[]).filter((m) => t.medals[m]),
      clubs: [...t.distanceClubs],
    };
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Runtime guards (hand-rolled, §Data model). The guard is the import gate:
// hostile documents (wrong types, huge arrays, prototype-pollution keys)
// must be refused with the prior save left intact.
// ---------------------------------------------------------------------------

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Depth-first scan for prototype-pollution key names anywhere in the doc. */
export function hasUnsafeKeys(u: unknown, depth = 0): boolean {
  if (depth > 12 || u === null || typeof u !== 'object') return false;
  if (Array.isArray(u)) return u.some((v) => hasUnsafeKeys(v, depth + 1));
  for (const k of Object.getOwnPropertyNames(u)) {
    if (UNSAFE_KEYS.has(k)) return true;
    if (hasUnsafeKeys((u as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

function isObj(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null && !Array.isArray(u);
}

function isNum(u: unknown): u is number {
  return typeof u === 'number' && Number.isFinite(u);
}

function isNumOrNull(u: unknown): boolean {
  return u === null || isNum(u);
}

function isStr(u: unknown, maxLen = 64): u is string {
  return typeof u === 'string' && u.length <= maxLen;
}

function isTierSave(u: unknown): u is TierSave {
  if (!isObj(u)) return false;
  if (typeof u.unlocked !== 'boolean') return false;
  const medals = u.medals;
  if (!isObj(medals)) return false;
  for (const m of ['bronze', 'silver', 'gold', 'platinum']) {
    if (typeof medals[m] !== 'boolean') return false;
  }
  const pbs = u.pbs;
  if (!isObj(pbs) || !isNum(pbs.bestRoundScore) || !isNum(pbs.longestCarryFt) || !isNum(pbs.hardestEvMph)) return false;
  if (!Array.isArray(u.top5) || u.top5.length > 5) return false;
  for (const e of u.top5) {
    if (!isObj(e) || !isStr(e.initials, 3) || !isNum(e.score) || !isStr(e.dateISO, 32)) return false;
  }
  const avg = u.lifetimeAverages;
  if (
    !isObj(avg) ||
    !isNum(avg.rounds) ||
    !isNumOrNull(avg.medianAbsEpsMs) ||
    !isNum(avg.contactPct) ||
    !isNum(avg.hardHitPct) ||
    !isNum(avg.avgRoundScore)
  ) {
    return false;
  }
  if (!Array.isArray(u.distanceClubs) || u.distanceClubs.length > 8 || !u.distanceClubs.every(isNum)) return false;
  return true;
}

function isSwingTuple(u: unknown): u is SwingTuple {
  if (!Array.isArray(u) || u.length !== 10) return false;
  const [t, tierIdx, eps, gradeIdx, sprayIdx, ev, la, carry, points, batIdx] = u as unknown[];
  return (
    isNum(t) &&
    isNum(tierIdx) && tierIdx >= 0 && tierIdx < TIERS.length &&
    isNumOrNull(eps) &&
    isNum(gradeIdx) && gradeIdx >= 0 && gradeIdx < GRADES.length &&
    (sprayIdx === null || (isNum(sprayIdx) && sprayIdx >= 0 && sprayIdx < SPRAYS.length)) &&
    isNumOrNull(ev) &&
    isNumOrNull(la) &&
    isNumOrNull(carry) &&
    isNum(points) &&
    isNum(batIdx) && batIdx >= 0 && batIdx < BATS.length
  );
}

const SESSIONS_MAX = 5_000;

export function isSave(u: unknown): u is SaveV1 {
  if (!isObj(u) || hasUnsafeKeys(u)) return false;
  const meta = u.meta;
  if (!isObj(meta) || meta.schemaVersion !== SCHEMA_VERSION || !isNum(meta.saveId)) return false;
  if (!isStr(meta.createdAt, 40) || !isStr(meta.updatedAt, 40)) return false;

  const settings = u.settings;
  if (!isObj(settings)) return false;
  if (settings.qualityPreset !== null && !['HIGH', 'MEDIUM', 'LOW'].includes(settings.qualityPreset as string)) return false;
  const vol = settings.volumes;
  if (!isObj(vol) || !isNum(vol.master) || !isNum(vol.sfx) || !isNum(vol.ambience)) return false;
  if (typeof settings.muted !== 'boolean') return false;

  const loadout = u.loadout;
  if (!isObj(loadout)) return false;
  if (loadout.handedness !== 'R' && loadout.handedness !== 'L') return false;
  if (loadout.bat !== 'WOOD' && loadout.bat !== 'METAL') return false;
  if (!isStr(loadout.lastInitials, 3)) return false;
  if (!TIERS.includes(loadout.lastTier as TierMph)) return false;

  const tiers = u.tiers;
  if (!isObj(tiers)) return false;
  for (const k of TIER_KEYS) {
    if (!isTierSave(tiers[k])) return false;
  }

  if (!Array.isArray(u.sessions) || u.sessions.length > SESSIONS_MAX) return false;
  for (const s of u.sessions) {
    if (
      !isObj(s) ||
      !isStr(s.dateISO, 32) ||
      !isNum(s.rounds) ||
      !isNum(s.bestScore) ||
      !isNumOrNull(s.medianAbsEpsMs) ||
      !isNum(s.contactPct) ||
      !isNum(s.hardHitPct)
    ) {
      return false;
    }
  }

  if (!Array.isArray(u.swingLog) || u.swingLog.length > SWING_LOG_CAP) return false;
  for (const t of u.swingLog) if (!isSwingTuple(t)) return false;
  if (!isNum(u.swingLogBase) || (u.swingLogBase as number) < 0) return false;

  if (!Array.isArray(u.recentRounds) || u.recentRounds.length > RECENT_ROUNDS_CAP) return false;
  for (const r of u.recentRounds) {
    if (
      !isObj(r) ||
      !TIER_KEYS.includes(r.tier as TierKey) ||
      !isNum(r.score) ||
      !(r.medal === null || ['bronze', 'silver', 'gold', 'platinum'].includes(r.medal as string)) ||
      !isStr(r.dateISO, 32) ||
      !isNum(r.logStart) ||
      !isNum(r.count)
    ) {
      return false;
    }
  }
  return true;
}

export function tierKeyOf(tier: TierMph): TierKey {
  return String(tier) as TierKey;
}
