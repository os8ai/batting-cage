import type { Bat, DomainEvent, Grade } from '../core/types';

/**
 * Event → cue mapping (§10 subset shipped in M1; the rest lands in M2).
 * Pure and dependency-free: cues derive ONLY from sim domain events (whose
 * timestamps come from the deterministic §5 clock) — never from rAF time.
 * That is the M1 E2 guarantee ("release cues frame-identical across pitches"),
 * and `tests/cueSchedule.test.ts` asserts it over this exact mapping.
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
  | 'perfectThump';

export type CueAnchor = 'machine' | 'plate' | 'panel';

export interface CueTrigger {
  cue: CueName;
  anchor: CueAnchor;
  /** Sim-time of the triggering domain event, seconds. */
  t: number;
}

export interface CueContext {
  bat: Bat;
  /** Grade of the last judged swing — CONTACT carries no grade itself. */
  lastGrade: Grade | null;
}

export function createCueContext(bat: Bat = 'WOOD'): CueContext {
  return { bat, lastGrade: null };
}

/**
 * Map one domain event to its cue triggers, updating the running context.
 * The M1 subset: machine cadence (whirr/clunk/thwip/token) + contact voice
 * (crack/ping + PERFECT thump). Whiff swish, net rustle, board ticks are M2+.
 */
export function cuesForEvent(e: DomainEvent, ctx: CueContext): CueTrigger[] {
  switch (e.type) {
    case 'TOKEN':
      return [
        { cue: 'tokenClink', anchor: 'machine', t: e.t },
        { cue: 'whirrStart', anchor: 'machine', t: e.t },
      ];
    case 'FEED':
      return [{ cue: 'feedClunk', anchor: 'machine', t: e.t }];
    case 'LOAD':
      return [{ cue: 'whirrDip', anchor: 'machine', t: e.t }];
    case 'RELEASE':
      return [{ cue: 'releaseThwip', anchor: 'machine', t: e.t }];
    case 'SWING_JUDGED':
      ctx.lastGrade = e.record.grade;
      return [];
    case 'CONTACT': {
      const triggers: CueTrigger[] = [
        { cue: ctx.bat === 'WOOD' ? 'contactWood' : 'contactMetal', anchor: 'plate', t: e.t },
      ];
      if (ctx.lastGrade === 'PERFECT') triggers.push({ cue: 'perfectThump', anchor: 'plate', t: e.t });
      return triggers;
    }
    case 'ROUND_END':
      return [{ cue: 'whirrStop', anchor: 'machine', t: e.t }];
    default:
      return [];
  }
}
