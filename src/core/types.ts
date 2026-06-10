export type TierMph = 40 | 50 | 60 | 70 | 80 | 90;

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'FOUL' | 'MISS' | 'TAKE';

export type SprayTag = 'PULL' | 'CENTER' | 'OPPO';

export type Handedness = 'R' | 'L';

export type Bat = 'WOOD' | 'METAL';

export type Medal = 'bronze' | 'silver' | 'gold' | 'platinum';

export type PbKind = 'SCORE' | 'CARRY' | 'EV';

/** Per-tier career facts the sim needs to judge ceremonies (§8). */
export interface TierCareer {
  pbs: { bestRoundScore: number; longestCarryFt: number; hardestEvMph: number };
  /** Medal levels earned at least once at this tier. */
  medals: Medal[];
  /** Distance clubs already entered at this tier, ft (§8). */
  clubs: number[];
}

/**
 * Prior career snapshot, passed INTO the sim (§Architecture: one-way flow —
 * the sim never reads storage). Headless default: all tiers unlocked, empty
 * history; the browser passes the persisted career.
 */
export interface CareerSnapshot {
  unlockedTiers: TierMph[];
  tiers: Partial<Record<TierMph, TierCareer>>;
}

/** Live ball state, SI units. Flat scalars — pooled, zero-alloc in the hot loop. */
export interface BallState {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin axis (unit vector); zero spin when spinRadS === 0. */
  sx: number;
  sy: number;
  sz: number;
  spinRadS: number;
  asleep: boolean;
  active: boolean;
}

/** Per-tier analytic pitch solution (derived once from the §7 model). */
export interface PitchSolution {
  tier: TierMph;
  releaseSpeedMps: number;
  elevationRad: number;
  /** Release → plate-crossing time, seconds. */
  flightTimeS: number;
  /** Crossing height at the plate plane, meters (target 0.762 m). */
  plateHeightM: number;
  plateSpeedMph: number;
}

/** Structured per-pitch swing record (§What outputs). */
export interface SwingRecord {
  pitch: number; // 1-based
  tier: TierMph;
  /** Signed timing error, ms (+ LATE / − EARLY). Null for TAKE. */
  epsMs: number | null;
  grade: Grade;
  spray: SprayTag | null;
  evMph: number | null;
  laDeg: number | null;
  /** Projected open-field carry, whole feet. Null for FOUL/MISS/TAKE (§6: no distance). */
  carryFt: number | null;
  /** §8 points: quality multiplier × carry; FOUL 25 flat; MISS/TAKE 0. */
  points: number;
}

export type IgnoredPressReason = 'PRE_RELEASE' | 'LOCKOUT' | 'AFTER_WINDOW' | 'NO_PITCH';

/** Which net section caught the ball ('left' = +X, screen-left from the box). */
export type NetPanel = 'far' | 'left' | 'right' | 'ceiling' | 'back';

/** Impact payload (M2): contact position + ball speed at impact, pre-response. */
export interface ImpactInfo {
  px: number;
  py: number;
  pz: number;
  speedMps: number;
}

export type DomainEvent =
  | { type: 'TOKEN'; t: number; tier: TierMph }
  | { type: 'FEED'; t: number; pitch: number }
  | { type: 'LOAD'; t: number; pitch: number }
  | { type: 'RELEASE'; t: number; pitch: number }
  | { type: 'PLATE_CROSS'; t: number; pitch: number }
  | { type: 'WINDOW_CLOSE'; t: number; pitch: number }
  | { type: 'BOARD_REVEAL'; t: number; pitch: number }
  | { type: 'BOARD_HOLD_END'; t: number; pitch: number }
  | { type: 'ARMED'; t: number; pitch: number }
  | { type: 'SWING_JUDGED'; t: number; record: SwingRecord }
  | { type: 'PRESS_IGNORED'; t: number; reason: IgnoredPressReason }
  | { type: 'CONTACT'; t: number; pitch: number; evMph: number; laDeg: number; carryFt: number | null }
  | ({ type: 'NET_HIT'; t: number; panel: NetPanel } & ImpactInfo)
  | ({ type: 'BACKSTOP_HIT'; t: number } & ImpactInfo)
  | ({ type: 'FRAME_HIT'; t: number } & ImpactInfo)
  | ({ type: 'GUARD_HIT'; t: number } & ImpactInfo)
  | ({ type: 'BALL_BOUNCE'; t: number } & ImpactInfo)
  | { type: 'BALL_SETTLED'; t: number; px: number; py: number; pz: number }
  | {
      type: 'ROUND_END';
      t: number;
      tier: TierMph;
      /** Sim-lifetime round counter (recorder idempotency key). */
      round: number;
      records: SwingRecord[];
      /** §8 round summary, computed by the sim from the career snapshot. */
      score: number;
      totalCarryFt: number;
      medal: Medal | null;
      newUnlocks: TierMph[];
      /** Distance clubs first entered this round, ft. */
      clubs: number[];
      isPB: boolean;
    }
  // Ceremony events (§9/§10) — emitted immediately after ROUND_END, in order:
  // NEW_PB* → CLUB_ENTERED* → MEDAL_EARNED → TIER_UNLOCKED*.
  | { type: 'NEW_PB'; t: number; tier: TierMph; kind: PbKind; value: number }
  | { type: 'CLUB_ENTERED'; t: number; tier: TierMph; ft: number }
  | { type: 'MEDAL_EARNED'; t: number; tier: TierMph; medal: Medal }
  | { type: 'TIER_UNLOCKED'; t: number; tier: TierMph };

export type PitchPhase =
  | 'IDLE'
  | 'SPINUP'
  | 'FEED'
  | 'LOAD'
  | 'FLIGHT'
  | 'RESOLUTION'
  | 'BOARD_REVEAL'
  | 'SETTLING'
  | 'ARMED'
  | 'ROUND_END';
