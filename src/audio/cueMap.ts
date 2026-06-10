import type { Bat, DomainEvent, Grade } from '../core/types';

/**
 * Event → cue mapping (the full §10 set as of M2; recap/ceremony rows land
 * with M3's board pages). Pure and dependency-free: cues derive ONLY from sim
 * domain events (whose timestamps come from the deterministic §5 clock) —
 * never from rAF time. That is the E2 guarantee ("release cues frame-
 * identical across pitches"), and `tests/cueSchedule.test.ts` asserts it over
 * this exact mapping. Impact payload positions pass through untouched.
 *
 * Engine-owned (not event rows): the room-tone ambience bed starts at audio
 * unlock; panel/board confirm clicks are UI-called (§UX).
 * M3-deferred §10 rows (need pages/events that don't exist yet): score
 * count-up, medal stamp / unlock klaxon.
 */
export type CueName =
  | 'tokenClink'
  | 'whirrStart' // 3 s spin-up ramp to tier pitch
  | 'whirrDip' // LOAD: whirr dips under load
  | 'whirrStop'
  | 'feedClunk'
  | 'releaseThwip'
  | 'contactWood'
  | 'contactMetal'
  | 'perfectThump'
  | 'whooshStart' // pitch leaves the wheels — loop on the ball emitter
  | 'whooshRebase' // contact: the loop re-bases to the batted flight
  | 'whooshStop' // first surface contact ends the flight
  | 'whiffSwish'
  | 'backstopThud'
  | 'netRustle'
  | 'frameClang'
  | 'guardRattle'
  | 'turfBounce'
  | 'rollStart' // roll loop on the ball emitter
  | 'rollStop' // sleep silences (§10)
  | 'boardTick';

export type CueAnchor = 'machine' | 'plate' | 'panel' | 'board' | 'ball' | 'impact';

export interface CueTrigger {
  cue: CueName;
  anchor: CueAnchor;
  /** Sim-time of the triggering domain event, seconds. */
  t: number;
  /** World position for 'impact'-anchored one-shots (event payload, m). */
  px?: number;
  py?: number;
  pz?: number;
  /** Event-derived gain scale (e.g. rustle ∝ impact energy), 0–1. */
  gain?: number;
}

export interface CueContext {
  bat: Bat;
  /** Grade of the last judged swing — CONTACT carries no grade itself. */
  lastGrade: Grade | null;
}

export function createCueContext(bat: Bat = 'WOOD'): CueContext {
  return { bat, lastGrade: null };
}

/** Net rustle gain ∝ impact energy (speed², §10), saturating at a 40 m/s rope. */
export function rustleGain(speedMps: number): number {
  const g = (speedMps * speedMps) / (40 * 40);
  return Math.min(1, Math.max(0.06, g));
}

/**
 * Map one domain event to its cue triggers, updating the running context.
 */
export function cuesForEvent(e: DomainEvent, ctx: CueContext): CueTrigger[] {
  switch (e.type) {
    case 'TOKEN':
      return [
        { cue: 'tokenClink', anchor: 'machine', t: e.t },
        { cue: 'whirrStart', anchor: 'machine', t: e.t },
      ];
    case 'FEED':
      // rollStop/whooshStop are idempotent safety stops for the rare ball
      // still moving when the next cycle feeds.
      return [
        { cue: 'feedClunk', anchor: 'machine', t: e.t },
        { cue: 'whooshStop', anchor: 'ball', t: e.t },
        { cue: 'rollStop', anchor: 'ball', t: e.t },
      ];
    case 'LOAD':
      return [{ cue: 'whirrDip', anchor: 'machine', t: e.t }];
    case 'RELEASE':
      return [
        { cue: 'releaseThwip', anchor: 'machine', t: e.t },
        { cue: 'whooshStart', anchor: 'ball', t: e.t },
      ];
    case 'SWING_JUDGED':
      ctx.lastGrade = e.record.grade;
      return e.record.grade === 'MISS'
        ? [{ cue: 'whiffSwish', anchor: 'plate', t: e.t }]
        : [];
    case 'CONTACT': {
      const triggers: CueTrigger[] = [
        { cue: ctx.bat === 'WOOD' ? 'contactWood' : 'contactMetal', anchor: 'plate', t: e.t },
        { cue: 'whooshRebase', anchor: 'ball', t: e.t },
      ];
      if (ctx.lastGrade === 'PERFECT') triggers.push({ cue: 'perfectThump', anchor: 'plate', t: e.t });
      return triggers;
    }
    case 'NET_HIT':
      return [
        { cue: 'whooshStop', anchor: 'ball', t: e.t },
        { cue: 'netRustle', anchor: 'impact', t: e.t, px: e.px, py: e.py, pz: e.pz, gain: rustleGain(e.speedMps) },
      ];
    case 'BACKSTOP_HIT':
      return [
        { cue: 'whooshStop', anchor: 'ball', t: e.t },
        { cue: 'backstopThud', anchor: 'impact', t: e.t, px: e.px, py: e.py, pz: e.pz },
      ];
    case 'FRAME_HIT':
      // The clang keeps the whoosh: e = 0.45 sends the ball back across the cage.
      return [{ cue: 'frameClang', anchor: 'impact', t: e.t, px: e.px, py: e.py, pz: e.pz }];
    case 'GUARD_HIT':
      return [{ cue: 'guardRattle', anchor: 'impact', t: e.t, px: e.px, py: e.py, pz: e.pz }];
    case 'BALL_BOUNCE':
      return [
        { cue: 'whooshStop', anchor: 'ball', t: e.t },
        { cue: 'turfBounce', anchor: 'impact', t: e.t, px: e.px, py: e.py, pz: e.pz },
        { cue: 'rollStart', anchor: 'ball', t: e.t },
      ];
    case 'BALL_SETTLED':
      return [{ cue: 'rollStop', anchor: 'ball', t: e.t }];
    case 'BOARD_REVEAL':
      return [{ cue: 'boardTick', anchor: 'board', t: e.t }];
    case 'BOARD_HOLD_END':
      return [{ cue: 'boardTick', anchor: 'board', t: e.t }];
    case 'ROUND_END':
      return [
        { cue: 'whirrStop', anchor: 'machine', t: e.t },
        { cue: 'whooshStop', anchor: 'ball', t: e.t },
        { cue: 'rollStop', anchor: 'ball', t: e.t },
      ];
    default:
      return [];
  }
}
