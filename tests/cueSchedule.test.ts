import { describe, expect, it } from 'vitest';
import { createCueContext, cuesForEvent, type CueTrigger } from '../src/audio/cueMap';
import { SIM_DT } from '../src/core/constants';
import type { DomainEvent } from '../src/core/types';
import { pressForEps, runScriptedRound } from './harness';

/**
 * M1 E2 — "release cues frame-identical across pitches": every audio/visual
 * cue fires from sim domain events on the deterministic §5 clock, so the
 * cue-trigger timestamps must repeat with zero jitter pitch-to-pitch (± 1
 * tick for tick-boundary events), and be bit-identical across seeds and
 * simulated frame rates.
 */
const TICK = SIM_DT + 1e-9;

function cueOffsetsByPitch(events: DomainEvent[]): Map<string, number[]> {
  const ctx = createCueContext('WOOD');
  let feedT = NaN;
  const offsets = new Map<string, number[]>();
  for (const e of events) {
    if (e.type === 'FEED') feedT = e.t;
    const trigs: CueTrigger[] = cuesForEvent(e, ctx);
    for (const trig of trigs) {
      if (trig.cue === 'tokenClink' || trig.cue === 'whirrStart' || trig.cue === 'whirrStop') continue;
      if (!Number.isFinite(feedT)) continue;
      const arr = offsets.get(trig.cue) ?? [];
      arr.push(trig.t - feedT);
      offsets.set(trig.cue, arr);
    }
  }
  return offsets;
}

describe('cue schedule (E2)', () => {
  it('machine cadence cues land at identical cycle offsets on all 10 pitches', () => {
    const { events } = runScriptedRound({ seed: 7, tier: 60, presses: [], frameDt: 1 / 60 });
    const offsets = cueOffsetsByPitch(events);
    for (const cue of ['feedClunk', 'whirrDip', 'releaseThwip'] as const) {
      const arr = offsets.get(cue)!;
      expect(arr).toHaveLength(10);
      for (const o of arr) expect(Math.abs(o - arr[0]!)).toBeLessThanOrEqual(TICK);
    }
    // The §5 anchors themselves: clunk at FEED+0, dip at LOAD (0.9), thwip at RELEASE (1.8).
    expect(offsets.get('feedClunk')![0]).toBeCloseTo(0, 3);
    expect(Math.abs(offsets.get('whirrDip')![0]! - 0.9)).toBeLessThanOrEqual(TICK);
    expect(Math.abs(offsets.get('releaseThwip')![0]! - 1.8)).toBeLessThanOrEqual(TICK);
  });

  it('cue offsets are identical across seeds and tiers stay fixed-cycle', () => {
    for (const tier of [40, 90] as const) {
      const a = cueOffsetsByPitch(runScriptedRound({ seed: 1, tier, presses: [], frameDt: 1 / 60 }).events);
      const b = cueOffsetsByPitch(runScriptedRound({ seed: 999, tier, presses: [], frameDt: 1 / 60 }).events);
      for (const cue of ['feedClunk', 'whirrDip', 'releaseThwip'] as const) {
        expect(a.get(cue)).toEqual(b.get(cue));
      }
    }
  });

  it('cue triggers are bit-identical across 30 fps and 144 fps frame batching', () => {
    const presses = [{ t: pressForEps(70, 3, 0) }, { t: pressForEps(70, 7, -50) }];
    const slow = runScriptedRound({ seed: 42, tier: 70, presses, frameDt: 1 / 30 });
    const fast = runScriptedRound({ seed: 42, tier: 70, presses, frameDt: 1 / 144 });
    const collect = (events: DomainEvent[]): CueTrigger[] => {
      const ctx = createCueContext('WOOD');
      return events.flatMap((e) => cuesForEvent(e, ctx));
    };
    expect(collect(slow.events)).toEqual(collect(fast.events));
  });

  it('contact voice follows the bat and PERFECT adds the thump layer', () => {
    const presses = [{ t: pressForEps(60, 1, 0) }, { t: pressForEps(60, 2, 75) }];
    const { events } = runScriptedRound({ seed: 11, tier: 60, presses, frameDt: 1 / 60 });
    const wood = createCueContext('WOOD');
    const woodCues = events.flatMap((e) => cuesForEvent(e, wood)).filter((c) => c.anchor === 'plate');
    // Pitch 1 (ε=0, PERFECT): crack + thump. Pitch 2 (ε=75 ms, GOOD): crack only.
    expect(woodCues.map((c) => c.cue)).toEqual(['contactWood', 'perfectThump', 'contactWood']);
    const metal = createCueContext('METAL');
    const metalCues = events.flatMap((e) => cuesForEvent(e, metal)).filter((c) => c.anchor === 'plate');
    expect(metalCues.map((c) => c.cue)).toEqual(['contactMetal', 'perfectThump', 'contactMetal']);
  });
});
