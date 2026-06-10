import { CYCLE_S, RELEASE_T, SIM_DT, SPINUP_S, SWING_CONTACT_OFFSET_S } from '../src/core/constants';
import { pitchSolution } from '../src/core/physics/pitchSchedule';
import { CageSim } from '../src/core/sim';
import type { DomainEvent, SwingRecord, TierMph } from '../src/core/types';

/**
 * Headless round runner. Mimics the browser loop exactly: wall time advances
 * in frames; presses are delivered when wall time passes their timestamp
 * (sim time never ahead of wall time — the accumulator invariant), then the
 * sim ticks up to wall time. Frame size varies to prove frame-rate
 * independence (§14.2).
 */
export interface ScriptedPress {
  /** Absolute sim-time of SPACE keydown, seconds. */
  t: number;
}

export interface RunResult {
  events: DomainEvent[];
  records: SwingRecord[];
  judgeLatenciesMs: number[];
}

export function plateTimeFor(tier: TierMph, pitch: number, tokenAt = 0): number {
  const tf = pitchSolution(tier).flightTimeS;
  return tokenAt + SPINUP_S + (pitch - 1) * CYCLE_S + RELEASE_T + tf;
}

export function releaseTimeFor(_tier: TierMph, pitch: number, tokenAt = 0): number {
  return tokenAt + SPINUP_S + (pitch - 1) * CYCLE_S + RELEASE_T;
}

/** Press time that produces a desired signed ε (ms) on a given pitch. */
export function pressForEps(tier: TierMph, pitch: number, epsMs: number, tokenAt = 0): number {
  return plateTimeFor(tier, pitch, tokenAt) - SWING_CONTACT_OFFSET_S + epsMs / 1000;
}

export function runScriptedRound(opts: {
  seed: number;
  tier: TierMph;
  presses: ScriptedPress[];
  /** Wall-clock frame duration, seconds (e.g. 1/30, 1/144). */
  frameDt: number;
  maxTimeS?: number;
}): RunResult {
  const sim = new CageSim({ seed: opts.seed });
  sim.selectTier(opts.tier);
  const events: DomainEvent[] = [];
  const latencies: number[] = [];
  sim.onEvent((e) => events.push(e));
  sim.insertToken();

  const presses = [...opts.presses].sort((a, b) => a.t - b.t);
  let pressIdx = 0;
  let wall = 0;
  let done = false;
  sim.onEvent((e) => {
    if (e.type === 'ROUND_END') done = true;
  });

  const maxTime = opts.maxTimeS ?? SPINUP_S + 11 * CYCLE_S;
  while (!done && wall < maxTime) {
    wall += opts.frameDt;
    // Deliver due presses before ticking — exactly the browser ordering
    // (the event fires before the next rAF callback runs the accumulator).
    while (pressIdx < presses.length && presses[pressIdx]!.t <= wall) {
      const ts = presses[pressIdx]!.t;
      const before = performance.now();
      sim.queueSwing(ts);
      latencies.push(performance.now() - before);
      pressIdx++;
    }
    while (sim.t + SIM_DT <= wall) sim.tick();
  }

  return { events, records: [...sim.roundRecords], judgeLatenciesMs: latencies };
}

/** Stable serialization for bit-for-bit comparison (§14.1). */
export function serializeEvents(events: DomainEvent[]): string {
  return JSON.stringify(events);
}
