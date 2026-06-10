import {
  GRACE_S,
  RELEASE_DIST_M,
  RELEASE_HEIGHT_M,
  RELEASE_T,
  SETTLED_POOL,
  SIM_DT,
  SPINUP_S,
  SWING_CONTACT_OFFSET_S,
  TIERS,
} from './constants';
import { resolveContact } from './contact/contactModel';
import { makeBall, stepBall } from './physics/ballistics';
import { resolveCageCollisions, separateSettled, type CollisionHit } from './physics/collision';
import { pitchSolution } from './physics/pitchSchedule';
import { contactState, projectCarryFt } from './physics/projection';
import { cycleTimes, phaseAt, type CycleTimes } from './pitchCycle';
import { pitchRng } from './rng';
import { clubsEntered, medalsImplied, medalFor, unlocksAfter } from './rules/progression';
import { createRound, isComplete, recordSwing, type Round } from './rules/round';
import { bestCarryFt, bestEvMph, pointsFor, roundScore, totalCarryFt } from './rules/scoring';
import type {
  BallState,
  CareerSnapshot,
  DomainEvent,
  Handedness,
  Medal,
  PitchPhase,
  SwingRecord,
  TierCareer,
  TierMph,
} from './types';

export interface SimOptions {
  seed: number;
  handedness?: Handedness;
  /**
   * Prior career snapshot (§8 gating + ceremony baselines). Default: every
   * tier unlocked with empty history — headless suites stay storage-free;
   * the browser passes the persisted career (M3).
   */
  career?: CareerSnapshot;
}

function emptyTierCareer(): TierCareer {
  return { pbs: { bestRoundScore: 0, longestCarryFt: 0, hardestEvMph: 0 }, medals: [], clubs: [] };
}

/** Deep-clone a snapshot into sim-owned mutable state. */
function cloneCareer(c: CareerSnapshot): CareerSnapshot {
  const tiers: Partial<Record<TierMph, TierCareer>> = {};
  for (const t of TIERS) {
    const src = c.tiers[t];
    if (src) tiers[t] = { pbs: { ...src.pbs }, medals: [...src.medals], clubs: [...src.clubs] };
  }
  return { unlockedTiers: [...c.unlockedTiers], tiers };
}

interface PendingContact {
  t: number; // absolute sim time the bat meets the ball (press + 150 ms)
  evMph: number;
  laDeg: number;
  sprayDeg: number;
  pitch: number;
  carryFt: number | null;
}

/**
 * The deterministic headless sim core (SPEC §Architecture). Advances only via
 * fixed ticks; swing judgment is analytic and sub-tick — ε is computed from
 * the input timestamp against the continuous pitch schedule the moment the
 * event arrives (queueSwing), never quantized by tick or frame rate.
 */
export class CageSim {
  readonly seed: number;
  handedness: Handedness;

  /** Sim time, seconds — advances in fixed SIM_DT ticks. */
  t = 0;

  private tier: TierMph = 40;
  private phase: PitchPhase = 'IDLE';
  private roundCounter = 0;
  private round: Round | null = null;
  private pitchIndex = 0; // 1-based; 0 = none
  private cycleStart = 0; // absolute time of current pitch's FEED
  private firstFeedAt = 0;
  private times: CycleTimes | null = null;
  private flightTime = 0;
  private judged = false;
  private pendingContact: PendingContact | null = null;

  /** Live pitched/batted ball + settled balls on the floor (pool, §7). */
  readonly ball: BallState = makeBall();
  readonly settled: BallState[] = [];

  private listeners: Array<(e: DomainEvent) => void> = [];
  private collisionScratch: CollisionHit[] = [];
  /** Guard collisions apply to batted balls only (the pitch exits the guard). */
  private batted = false;

  private career: CareerSnapshot;

  constructor(opts: SimOptions) {
    this.seed = opts.seed;
    this.handedness = opts.handedness ?? 'R';
    this.career = cloneCareer(opts.career ?? { unlockedTiers: [...TIERS], tiers: {} });
  }

  /** Replace the career snapshot (e.g. after a save import). Idle only. */
  setCareer(career: CareerSnapshot): boolean {
    if (this.inRound) return false;
    this.career = cloneCareer(career);
    return true;
  }

  get unlockedTiers(): readonly TierMph[] {
    return this.career.unlockedTiers;
  }

  isTierUnlocked(tier: TierMph): boolean {
    return this.career.unlockedTiers.includes(tier);
  }

  onEvent(fn: (e: DomainEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: DomainEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  // -------------------------------------------------------------------------
  // Round control
  // -------------------------------------------------------------------------

  get currentTier(): TierMph {
    return this.tier;
  }

  get currentPhase(): PitchPhase {
    return this.phase;
  }

  get currentPitch(): number {
    return this.pitchIndex;
  }

  get roundRecords(): readonly SwingRecord[] {
    return this.round ? this.round.records : [];
  }

  get inRound(): boolean {
    return this.round !== null && this.phase !== 'ROUND_END';
  }

  /** §8 progression gate: locked tiers refuse selection. */
  selectTier(tier: TierMph): boolean {
    if (this.inRound || !this.isTierUnlocked(tier)) return false;
    this.tier = tier;
    return true;
  }

  /** Token insert (§5): 3.0 s wheel spin-up → first FEED. */
  insertToken(): boolean {
    if (this.inRound) return false;
    this.roundCounter += 1;
    this.round = createRound(this.tier);
    this.pitchIndex = 0;
    this.phase = 'SPINUP';
    this.firstFeedAt = this.t + SPINUP_S;
    this.flightTime = pitchSolution(this.tier).flightTimeS;
    this.times = cycleTimes(this.flightTime);
    // Between-round sweep (animation lands in M2): floor is cleared on token.
    this.settled.length = 0;
    this.ball.active = false;
    this.emit({ type: 'TOKEN', t: this.t, tier: this.tier });
    return true;
  }

  /**
   * Window-blur void (§Inputs): an unjudged in-flight pitch is voided and
   * re-fed on resume at no penalty. Browser-only path — not used by tests
   * that prove determinism.
   */
  voidCurrentPitch(): void {
    if (!this.inRound || this.pitchIndex === 0 || this.judged) return;
    this.ball.active = false;
    this.pendingContact = null;
    this.cycleStart = this.t; // re-feed the same pitch number from now
    this.emit({ type: 'FEED', t: this.t, pitch: this.pitchIndex });
  }

  // -------------------------------------------------------------------------
  // Swing input — analytic, sub-tick (§Architecture)
  // -------------------------------------------------------------------------

  /** Absolute scheduled times for the current pitch (valid once FED). */
  private scheduled(): { release: number; plate: number; close: number } | null {
    if (!this.times || this.pitchIndex === 0) return null;
    return {
      release: this.cycleStart + this.times.release,
      plate: this.cycleStart + this.times.plate,
      close: this.cycleStart + this.times.windowClose,
    };
  }

  /**
   * SPACE at DOM-event time tPress (sim-time seconds). ε = t_press + 150 ms −
   * t_plate, judged against the continuous schedule. Returns the record when
   * the press is accepted, null when ignored.
   */
  queueSwing(tPress: number): SwingRecord | null {
    const s = this.scheduled();
    if (!s || !this.inRound) {
      this.emit({ type: 'PRESS_IGNORED', t: tPress, reason: 'NO_PITCH' });
      return null;
    }
    if (this.judged) {
      this.emit({ type: 'PRESS_IGNORED', t: tPress, reason: 'LOCKOUT' });
      return null;
    }
    // §6: presses before RELEASE are ignored and never consume the swing.
    if (tPress < s.release) {
      this.emit({ type: 'PRESS_IGNORED', t: tPress, reason: 'PRE_RELEASE' });
      return null;
    }
    if (tPress > s.close) {
      this.emit({ type: 'PRESS_IGNORED', t: tPress, reason: 'AFTER_WINDOW' });
      return null;
    }

    const epsMs = (tPress + SWING_CONTACT_OFFSET_S - s.plate) * 1000;
    const rng = pitchRng(this.seed, this.roundCounter, this.pitchIndex);
    const outcome = resolveContact(this.tier, epsMs, this.tier, rng);

    let carryFt: number | null = null;
    if (outcome.grade !== 'MISS' && outcome.grade !== 'FOUL') {
      // The board number exists the instant contact resolves (§7).
      carryFt = projectCarryFt(outcome.evMph!, outcome.laDeg!, outcome.sprayDeg!);
    }

    const record: SwingRecord = {
      pitch: this.pitchIndex,
      tier: this.tier,
      epsMs,
      grade: outcome.grade,
      spray: outcome.sprayTag,
      evMph: outcome.evMph,
      laDeg: outcome.laDeg,
      carryFt,
      points: pointsFor(outcome.grade, carryFt),
    };
    this.judged = true;
    if (outcome.grade !== 'MISS') {
      // Physical contact lands when the swing animation reaches the ball.
      this.pendingContact = {
        t: tPress + SWING_CONTACT_OFFSET_S,
        evMph: outcome.evMph!,
        laDeg: outcome.laDeg!,
        sprayDeg: outcome.sprayDeg!,
        pitch: this.pitchIndex,
        carryFt,
      };
    }
    if (this.round) recordSwing(this.round, record);
    this.emit({ type: 'SWING_JUDGED', t: tPress, record });
    return record;
  }

  // -------------------------------------------------------------------------
  // Fixed tick
  // -------------------------------------------------------------------------

  tick(): void {
    const t0 = this.t;
    const t1 = t0 + SIM_DT;
    this.t = t1;

    if (this.round && this.phase === 'SPINUP') {
      if (t1 >= this.firstFeedAt) this.startPitch(this.firstFeedAt);
    }

    if (this.round && this.pitchIndex > 0 && this.times && this.phase !== 'ROUND_END') {
      const c = this.times;
      const lt0 = t0 - this.cycleStart;
      const lt1 = t1 - this.cycleStart;

      // Contact lands first: the bat meets the ball at (press + 150 ms),
      // which is never later than the plate-cross mark it's judged against.
      if (this.pendingContact && t1 >= this.pendingContact.t) {
        const pc = this.pendingContact;
        this.pendingContact = null;
        contactState(pc.evMph, pc.laDeg, pc.sprayDeg, this.handedness, this.ball);
        this.batted = true;
        this.emit({ type: 'CONTACT', t: pc.t, pitch: pc.pitch, evMph: pc.evMph, laDeg: pc.laDeg, carryFt: pc.carryFt });
      }

      // Boundary events, fired exactly once as the tick crosses each mark.
      if (lt0 < c.load && lt1 >= c.load) this.emit({ type: 'LOAD', t: this.cycleStart + c.load, pitch: this.pitchIndex });
      if (lt0 < c.release && lt1 >= c.release) {
        this.launchPitch();
        this.emit({ type: 'RELEASE', t: this.cycleStart + c.release, pitch: this.pitchIndex });
      }
      if (lt0 < c.plate && lt1 >= c.plate) this.emit({ type: 'PLATE_CROSS', t: this.cycleStart + c.plate, pitch: this.pitchIndex });
      if (lt0 < c.windowClose && lt1 >= c.windowClose) {
        this.emit({ type: 'WINDOW_CLOSE', t: this.cycleStart + c.windowClose, pitch: this.pitchIndex });
        if (!this.judged) {
          // §What: no input = a recorded TAKE.
          this.judged = true;
          const record: SwingRecord = {
            pitch: this.pitchIndex,
            tier: this.tier,
            epsMs: null,
            grade: 'TAKE',
            spray: null,
            evMph: null,
            laDeg: null,
            carryFt: null,
            points: 0,
          };
          if (this.round) recordSwing(this.round, record);
          this.emit({ type: 'SWING_JUDGED', t: this.cycleStart + c.windowClose, record });
        }
      }
      if (lt0 < c.boardReveal && lt1 >= c.boardReveal) this.emit({ type: 'BOARD_REVEAL', t: this.cycleStart + c.boardReveal, pitch: this.pitchIndex });
      if (lt0 < c.boardHoldEnd && lt1 >= c.boardHoldEnd) this.emit({ type: 'BOARD_HOLD_END', t: this.cycleStart + c.boardHoldEnd, pitch: this.pitchIndex });
      if (lt0 < c.armed && lt1 >= c.armed) this.emit({ type: 'ARMED', t: this.cycleStart + c.armed, pitch: this.pitchIndex });

      // End of cycle → next pitch or round end.
      if (lt1 >= c.next) {
        if (this.round && isComplete(this.round)) {
          this.phase = 'ROUND_END';
          this.parkBall();
          this.finishRound(this.cycleStart + c.next);
        } else {
          this.startPitch(this.cycleStart + c.next);
        }
      } else {
        this.phase = phaseAt(lt1, this.flightTime);
      }
    }

    this.stepBallPhysics();
  }

  /**
   * §8 round summary + ceremonies, judged against the prior career snapshot
   * and folded back in so a continuing session chains (unlock at 40 → 50 is
   * selectable for the next token). Emission order is the §9 ceremony order:
   * ROUND_END → NEW_PB* → CLUB_ENTERED* → MEDAL_EARNED → TIER_UNLOCKED*.
   */
  private finishRound(t: number): void {
    const records = this.round!.records;
    const tier = this.tier;
    const prior = this.career.tiers[tier] ?? emptyTierCareer();

    const score = roundScore(records);
    const carryTotal = totalCarryFt(records);
    const carryBest = bestCarryFt(records);
    const evBest = bestEvMph(records);
    const medal = medalFor(tier, score, carryTotal);
    const newUnlocks = unlocksAfter(tier, medal, this.career.unlockedTiers);
    const clubs = clubsEntered(carryBest, prior.clubs);

    const pbs: Array<{ kind: 'SCORE' | 'CARRY' | 'EV'; value: number }> = [];
    if (score > prior.pbs.bestRoundScore && score > 0) pbs.push({ kind: 'SCORE', value: score });
    if (carryBest > prior.pbs.longestCarryFt && carryBest > 0) pbs.push({ kind: 'CARRY', value: carryBest });
    if (evBest > prior.pbs.hardestEvMph && evBest > 0) pbs.push({ kind: 'EV', value: evBest });

    const newMedals: Medal[] =
      medal !== null ? medalsImplied(medal).filter((m) => !prior.medals.includes(m)) : [];

    this.emit({
      type: 'ROUND_END',
      t,
      tier,
      round: this.roundCounter,
      records,
      score,
      totalCarryFt: carryTotal,
      medal,
      newUnlocks,
      clubs,
      isPB: pbs.length > 0,
    });
    for (const pb of pbs) this.emit({ type: 'NEW_PB', t, tier, kind: pb.kind, value: pb.value });
    for (const ft of clubs) this.emit({ type: 'CLUB_ENTERED', t, tier, ft });
    // The stamp ceremony celebrates the round's headline medal when it's new.
    if (medal !== null && !prior.medals.includes(medal)) this.emit({ type: 'MEDAL_EARNED', t, tier, medal });
    for (const u of newUnlocks) this.emit({ type: 'TIER_UNLOCKED', t, tier: u });

    // Fold the round back into the career snapshot.
    const next: TierCareer = {
      pbs: {
        bestRoundScore: Math.max(prior.pbs.bestRoundScore, score),
        longestCarryFt: Math.max(prior.pbs.longestCarryFt, carryBest),
        hardestEvMph: Math.max(prior.pbs.hardestEvMph, evBest),
      },
      medals: [...prior.medals, ...newMedals],
      clubs: [...prior.clubs, ...clubs],
    };
    this.career.tiers[tier] = next;
    this.career.unlockedTiers.push(...newUnlocks);
  }

  private startPitch(feedAt: number): void {
    this.cycleStart = feedAt;
    this.pitchIndex += 1;
    this.judged = false;
    this.pendingContact = null;
    this.phase = 'FEED';
    this.parkBall();
    this.emit({ type: 'FEED', t: feedAt, pitch: this.pitchIndex });
  }

  /** Previous pitch's ball joins the floor pool when the next one feeds. */
  private parkBall(): void {
    if (this.ball.active) {
      const b = makeBall();
      Object.assign(b, this.ball, { asleep: true, active: true, vx: 0, vy: 0, vz: 0 });
      b.py = Math.min(b.py, 0.037);
      this.settled.push(b);
      if (this.settled.length > SETTLED_POOL) this.settled.shift();
      this.ball.active = false;
      // Relax the pile to convergence so the newcomer never interpenetrates
      // (§7 nudges; tight clusters need a handful of passes, capped).
      for (let i = 0; i < 40 && separateSettled(this.settled, null); i++);
    }
  }

  private launchPitch(): void {
    const sol = pitchSolution(this.tier);
    const b = this.ball;
    b.px = 0;
    b.py = RELEASE_HEIGHT_M;
    b.pz = RELEASE_DIST_M;
    b.vx = 0;
    b.vy = Math.sin(sol.elevationRad) * sol.releaseSpeedMps;
    b.vz = -Math.cos(sol.elevationRad) * sol.releaseSpeedMps;
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    b.spinRadS = 0; // machine pitch: gravity + drag only (§7)
    b.asleep = false;
    b.active = true;
    this.batted = false;
  }

  private stepBallPhysics(): void {
    const b = this.ball;
    if (!b.active || b.asleep) return;
    stepBall(b, SIM_DT);
    const hits = this.collisionScratch;
    hits.length = 0;
    resolveCageCollisions(b, SIM_DT, hits, this.batted);
    for (const h of hits) {
      // Payloads read the ball at emission: post-clamp position = the contact
      // point; speedMps captured by the resolver at impact, pre-response.
      if (h.kind === 'NET_HIT') {
        this.emit({ type: 'NET_HIT', t: this.t, px: b.px, py: b.py, pz: b.pz, speedMps: h.speedMps, panel: h.panel! });
      } else if (h.kind === 'BACKSTOP_HIT') {
        this.emit({ type: 'BACKSTOP_HIT', t: this.t, px: b.px, py: b.py, pz: b.pz, speedMps: h.speedMps });
      } else if (h.kind === 'FRAME_HIT') {
        this.emit({ type: 'FRAME_HIT', t: this.t, px: b.px, py: b.py, pz: b.pz, speedMps: h.speedMps });
      } else if (h.kind === 'GUARD_HIT') {
        this.emit({ type: 'GUARD_HIT', t: this.t, px: b.px, py: b.py, pz: b.pz, speedMps: h.speedMps });
      } else if (h.kind === 'BALL_BOUNCE') {
        this.emit({ type: 'BALL_BOUNCE', t: this.t, px: b.px, py: b.py, pz: b.pz, speedMps: h.speedMps });
      } else if (h.kind === 'SETTLED') {
        this.emit({ type: 'BALL_SETTLED', t: this.t, px: b.px, py: b.py, pz: b.pz });
        this.parkBall();
      }
    }
    // §7 settled-pile response: the rolling ball shoves the pile, pairs relax.
    if (this.settled.length > 0) separateSettled(this.settled, b.active && !b.asleep ? b : null);
  }

  // -------------------------------------------------------------------------
  // Render accessors (presentation reads; nothing flows back upstream)
  // -------------------------------------------------------------------------

  /** Machine status light (§5 cues): amber blink FEED→LOAD, green RELEASE→plate. */
  lightState(): 'off' | 'amber' | 'green' {
    if (!this.inRound || this.pitchIndex === 0 || !this.times) return 'off';
    const lt = this.t - this.cycleStart;
    if (lt >= this.times.release && lt < this.times.plate + GRACE_S) return 'green';
    if (lt >= 0 && lt < this.times.release) return 'amber';
    return 'off';
  }

  /** Scheduled plate-crossing time of the in-flight pitch (F3 diagnostics). */
  scheduledPlateTime(): number | null {
    const s = this.scheduled();
    return s ? s.plate : null;
  }

  releaseTimeAnchor(): number {
    return RELEASE_T;
  }

  flightTimeS(): number {
    return this.flightTime;
  }
}
