import { HARD_HIT_EV_MPH, SWING_LOG_CAP } from '../core/constants';
import { medalsImplied } from '../core/rules/progression';
import { foldSwings, median } from '../core/rules/stats';
import type { Bat, DomainEvent, Handedness, TierMph } from '../core/types';
import {
  decodeSwing,
  encodeSwing,
  RECENT_ROUNDS_CAP,
  TIER_KEYS,
  tierKeyOf,
  type SaveV1,
  type TierKey,
} from './schema';
import type { SaveStore } from './store';

export interface PersistClock {
  /** Wall time, ISO 8601 (swing tuples + session keys derive from this). */
  nowISO(): string;
  epochMs(): number;
}

export interface RoundOutcome {
  /** The round entered the tier's top-5 (INITIALS page trigger, §9). */
  madeTop5: boolean;
  top5Index: number | null;
  written: boolean;
}

/**
 * The single persistence subscriber (§Data model single-derivation rule).
 * Buffers nothing mid-cycle and writes nothing mid-cycle: on ROUND_END it
 * recomputes every derived stat from the round's records + the persisted
 * log in ONE transaction, then writes via the double-buffered store. Settings
 * and loadout changes mark the doc dirty; flush() (visibilitychange /
 * beforeunload / ESC sheet) writes them outside the pitch cycle.
 */
export class Recorder {
  /** The live save document — the single source the UI renders from. */
  readonly save: SaveV1;

  private appliedRounds = new Set<number>();
  private pendingTop5: { tier: TierKey; index: number } | null = null;
  private dirty = false;

  constructor(
    private store: SaveStore,
    save: SaveV1,
    private clock: PersistClock
  ) {
    this.save = save;
  }

  /** Domain-event hook: ROUND_END runs the transaction; all else is ignored. */
  onEvent(e: DomainEvent): RoundOutcome | null {
    if (e.type === 'ROUND_END') return this.applyRound(e);
    return null;
  }

  /**
   * The round-end transaction. Idempotent per sim round id: re-applying the
   * same ROUND_END is a no-op (torn-write retries can't double-count).
   */
  applyRound(e: Extract<DomainEvent, { type: 'ROUND_END' }>): RoundOutcome {
    if (this.appliedRounds.has(e.round)) {
      return { madeTop5: false, top5Index: null, written: false };
    }
    this.appliedRounds.add(e.round);
    const save = this.save;
    const nowISO = this.clock.nowISO();
    const dateISO = nowISO.slice(0, 10);
    const key = tierKeyOf(e.tier);
    const tier = save.tiers[key];

    // 1. Swing log append (FIFO cap; base index advances with dropped tuples).
    const logStart = save.swingLogBase + save.swingLog.length;
    const tEpoch = this.clock.epochMs();
    for (const r of e.records) save.swingLog.push(encodeSwing(r, save.loadout.bat, tEpoch));
    const overflow = save.swingLog.length - SWING_LOG_CAP;
    if (overflow > 0) {
      save.swingLog.splice(0, overflow);
      save.swingLogBase += overflow;
    }

    // 2. Round reference.
    save.recentRounds.push({ tier: key, score: e.score, medal: e.medal, dateISO, logStart, count: e.records.length });
    if (save.recentRounds.length > RECENT_ROUNDS_CAP) {
      save.recentRounds.splice(0, save.recentRounds.length - RECENT_ROUNDS_CAP);
    }

    // 3. Tier facts: unlocks, medals (implied levels fill in), PBs, clubs.
    for (const u of e.newUnlocks) save.tiers[tierKeyOf(u)].unlocked = true;
    if (e.medal !== null) for (const m of medalsImplied(e.medal)) tier.medals[m] = true;
    let bestCarry = 0;
    let bestEv = 0;
    for (const r of e.records) {
      if (r.carryFt !== null && r.carryFt > bestCarry) bestCarry = r.carryFt;
      if (r.evMph !== null && r.evMph > bestEv) bestEv = r.evMph;
    }
    tier.pbs.bestRoundScore = Math.max(tier.pbs.bestRoundScore, e.score);
    tier.pbs.longestCarryFt = Math.max(tier.pbs.longestCarryFt, bestCarry);
    tier.pbs.hardestEvMph = Math.max(tier.pbs.hardestEvMph, Math.round(bestEv * 10) / 10);
    for (const ft of e.clubs) if (!tier.distanceClubs.includes(ft)) tier.distanceClubs.push(ft);

    // 4. Top-5 insert (initials default to last-used; INITIALS page may edit).
    this.pendingTop5 = null;
    const entry = { initials: save.loadout.lastInitials, score: e.score, dateISO };
    const top5 = [...tier.top5, entry].sort((a, b) => b.score - a.score).slice(0, 5);
    const index = top5.indexOf(entry);
    if (index >= 0 && e.score > 0) {
      tier.top5 = top5;
      this.pendingTop5 = { tier: key, index };
    }

    // 5. Lifetime averages — single derivation: recomputed from the retained
    // log for this tier (never incrementally mutated).
    const tierIdxStats = save.swingLog
      .filter((t) => t[1] === this.tierIndexOf(key))
      .map((t) => decodeSwing(t));
    const lifetime = foldSwings(tierIdxStats);
    tier.lifetimeAverages = {
      rounds: tier.lifetimeAverages.rounds + 1,
      medianAbsEpsMs: lifetime.medianAbsEpsMs,
      contactPct: lifetime.contactPct,
      hardHitPct: lifetime.hardHitPct,
      avgRoundScore: this.avgScoreFor(key),
    };

    // 6. Session upsert (keyed by date) — aggregates recomputed from today's
    // rounds' log ranges (clipped by the FIFO base).
    this.upsertSession(dateISO, e.score);

    save.loadout.lastTier = e.tier;
    save.meta.updatedAt = nowISO;
    const written = this.store.write(save);
    this.dirty = !written;
    return { madeTop5: this.pendingTop5 !== null, top5Index: this.pendingTop5?.index ?? null, written };
  }

  /** INITIALS page confirm: stamp the just-inserted top-5 entry + last-used. */
  setInitials(initials: string): void {
    const clean = initials.toUpperCase().slice(0, 3);
    this.save.loadout.lastInitials = clean;
    if (this.pendingTop5) {
      const { tier, index } = this.pendingTop5;
      const entry = this.save.tiers[tier].top5[index];
      if (entry) entry.initials = clean;
    }
    this.save.meta.updatedAt = this.clock.nowISO();
    this.dirty = !this.store.write(this.save);
  }

  /** Settings/loadout mutations between rounds mark the doc for flush. */
  markDirty(): void {
    this.dirty = true;
  }

  /** visibilitychange / beforeunload / ESC-sheet flush hook. */
  flush(): boolean {
    if (!this.dirty) return true;
    this.save.meta.updatedAt = this.clock.nowISO();
    const ok = this.store.write(this.save);
    this.dirty = !ok;
    return ok;
  }

  setLoadout(part: Partial<{ handedness: Handedness; bat: Bat; lastTier: TierMph }>): void {
    Object.assign(this.save.loadout, part);
    this.dirty = true;
  }

  private tierIndexOf(key: TierKey): number {
    return TIER_KEYS.indexOf(key);
  }

  private avgScoreFor(key: TierKey): number {
    const tier = this.save.tiers[key];
    const rounds = this.save.recentRounds.filter((r) => r.tier === key);
    if (rounds.length === 0) return tier.pbs.bestRoundScore;
    return Math.round(rounds.reduce((s, r) => s + r.score, 0) / rounds.length);
  }

  private upsertSession(dateISO: string, score: number): void {
    const save = this.save;
    let row = save.sessions.find((s) => s.dateISO === dateISO);
    if (!row) {
      row = { dateISO, rounds: 0, bestScore: 0, medianAbsEpsMs: null, contactPct: 0, hardHitPct: 0 };
      save.sessions.push(row);
    }
    row.rounds += 1;
    row.bestScore = Math.max(row.bestScore, score);
    // Recompute the day's aggregates from its rounds' retained log ranges.
    const eps: number[] = [];
    let pitches = 0;
    let contacts = 0;
    let hard = 0;
    for (const r of save.recentRounds) {
      if (r.dateISO !== dateISO) continue;
      const start = Math.max(r.logStart, save.swingLogBase) - save.swingLogBase;
      const end = r.logStart + r.count - save.swingLogBase;
      for (let i = start; i < end && i < save.swingLog.length; i++) {
        const s = decodeSwing(save.swingLog[i]!);
        pitches += 1;
        if (s.epsMs !== null) eps.push(Math.abs(s.epsMs));
        if (s.evMph !== null) {
          contacts += 1;
          if (s.evMph >= HARD_HIT_EV_MPH) hard += 1;
        }
      }
    }
    row.medianAbsEpsMs = median(eps);
    row.contactPct = pitches > 0 ? (contacts / pitches) * 100 : 0;
    row.hardHitPct = contacts > 0 ? (hard / contacts) * 100 : 0;
  }
}
