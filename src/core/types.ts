export type TierMph = 40 | 50 | 60 | 70 | 80 | 90;

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'FOUL' | 'MISS' | 'TAKE';

export type SprayTag = 'PULL' | 'CENTER' | 'OPPO';

export type Handedness = 'R' | 'L';

export type Bat = 'WOOD' | 'METAL';

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

/** Structured per-pitch swing record (§What outputs; points field arrives in M3). */
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
}

export type IgnoredPressReason = 'PRE_RELEASE' | 'LOCKOUT' | 'AFTER_WINDOW' | 'NO_PITCH';

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
  | { type: 'NET_HIT'; t: number; speedMps: number }
  | { type: 'BACKSTOP_HIT'; t: number; speedMps: number }
  | { type: 'BALL_SETTLED'; t: number }
  | { type: 'ROUND_END'; t: number; tier: TierMph; records: SwingRecord[] };

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
