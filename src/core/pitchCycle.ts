import {
  ARMED_T,
  BOARD_AFTER_PLATE_S,
  BOARD_HOLD_S,
  CYCLE_S,
  FEED_T,
  GRACE_S,
  LOAD_T,
  RELEASE_T,
} from './constants';
import type { PitchPhase } from './types';

/**
 * §5 — the pitch clock. One fixed 7.5 s cycle at every tier, every pitch, no
 * jitter; flight time varies inside the fixed cycle, FEED→RELEASE never does.
 * All times are cycle-local seconds; tf = the tier's release→plate flight time.
 */
export interface CycleTimes {
  feed: number;
  load: number;
  release: number;
  plate: number;
  windowClose: number; // plate + grace — swing input closes; TAKE decided here
  boardReveal: number; // plate + 0.6 (the climax beat)
  boardHoldEnd: number;
  armed: number;
  next: number; // next FEED (cycle length)
}

export function cycleTimes(tf: number): CycleTimes {
  return {
    feed: FEED_T,
    load: LOAD_T,
    release: RELEASE_T,
    plate: RELEASE_T + tf,
    windowClose: RELEASE_T + tf + GRACE_S,
    boardReveal: RELEASE_T + tf + BOARD_AFTER_PLATE_S,
    boardHoldEnd: RELEASE_T + tf + BOARD_AFTER_PLATE_S + BOARD_HOLD_S,
    armed: ARMED_T,
    next: CYCLE_S,
  };
}

/** Phase at cycle-local time t (the locked ARMED→FEED→…→BOARD_REVEAL sequence). */
export function phaseAt(t: number, tf: number): PitchPhase {
  const c = cycleTimes(tf);
  if (t < c.load) return 'FEED';
  if (t < c.release) return 'LOAD';
  if (t < c.plate) return 'FLIGHT';
  if (t < c.boardReveal) return 'RESOLUTION';
  if (t < c.boardHoldEnd) return 'BOARD_REVEAL';
  if (t < c.armed) return 'SETTLING';
  return 'ARMED';
}
