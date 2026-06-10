import { describe, expect, it } from 'vitest';
import {
  createCueContext,
  cuesForEvent,
  rustleGain,
  type CueAnchor,
  type CueName,
  type CueTrigger,
} from '../src/audio/cueMap';
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

  it('whoosh runs exactly during flight: starts at RELEASE, stops at first contact', () => {
    // Mixed round: contacts (net catch), a miss (backstop), takes (backstop).
    const presses = [
      { t: pressForEps(60, 1, 0) },
      { t: pressForEps(60, 3, 300) }, // hopeless: MISS, ball to the backstop
      { t: pressForEps(60, 5, -40) },
    ];
    const { events } = runScriptedRound({ seed: 21, tier: 60, presses, frameDt: 1 / 60 });
    const ctx = createCueContext('WOOD');
    let open = false;
    let starts = 0;
    let releases = 0;
    for (const e of events) {
      if (e.type === 'RELEASE') releases++;
      for (const trig of cuesForEvent(e, ctx)) {
        if (trig.cue === 'whooshStart') {
          expect(e.type).toBe('RELEASE');
          expect(open, `whooshStart at t=${trig.t} while already open`).toBe(false);
          open = true;
          starts++;
        } else if (trig.cue === 'whooshRebase') {
          expect(open).toBe(true); // contact re-bases a live flight
        } else if (trig.cue === 'whooshStop' && open) {
          open = false;
        }
      }
    }
    expect(starts).toBe(releases); // every pitch flies with its whoosh
    expect(open).toBe(false); // and every flight was closed by a surface
  });

  it('§10 anchors: every cue sounds from its true position', () => {
    const ANCHOR_OF: Record<CueName, CueAnchor> = {
      tokenClink: 'machine',
      whirrStart: 'machine',
      whirrDip: 'machine',
      whirrStop: 'machine',
      feedClunk: 'machine',
      releaseThwip: 'machine',
      contactWood: 'plate',
      contactMetal: 'plate',
      perfectThump: 'plate',
      whiffSwish: 'plate',
      whooshStart: 'ball',
      whooshRebase: 'ball',
      whooshStop: 'ball',
      rollStart: 'ball',
      rollStop: 'ball',
      netRustle: 'impact',
      backstopThud: 'impact',
      frameClang: 'impact',
      guardRattle: 'impact',
      turfBounce: 'impact',
      boardTick: 'board',
    };
    const presses = [
      { t: pressForEps(60, 1, 0) },
      { t: pressForEps(60, 2, 300) },
      { t: pressForEps(60, 4, 70) },
    ];
    const { events } = runScriptedRound({ seed: 33, tier: 60, presses, frameDt: 1 / 60 });
    const ctx = createCueContext('WOOD');
    const seen = new Set<CueName>();
    for (const e of events) {
      for (const trig of cuesForEvent(e, ctx)) {
        seen.add(trig.cue);
        expect(trig.anchor, trig.cue).toBe(ANCHOR_OF[trig.cue]);
        if (trig.anchor === 'impact') {
          // Impact one-shots must carry the event's position payload through.
          expect(trig.px, trig.cue).toBeTypeOf('number');
          expect(trig.py, trig.cue).toBeTypeOf('number');
          expect(trig.pz, trig.cue).toBeTypeOf('number');
          if (e.type !== 'TOKEN' && 'px' in e) {
            expect(trig.px).toBe(e.px);
            expect(trig.py).toBe(e.py);
            expect(trig.pz).toBe(e.pz);
          }
        }
      }
    }
    // The round exercised the §10 core: machine cadence, contact, whoosh,
    // net/backstop impacts, board ticks. (frame/guard clangs are rare by
    // design — covered by the synthetic-event checks below.)
    for (const cue of [
      'feedClunk',
      'releaseThwip',
      'contactWood',
      'whooshStart',
      'whooshStop',
      'whiffSwish',
      'netRustle',
      'backstopThud',
      'boardTick',
    ] as CueName[]) {
      expect(seen.has(cue), cue).toBe(true);
    }
  });

  it('rare-surface events map to their voices with positions intact', () => {
    const ctx = createCueContext('WOOD');
    const frame: DomainEvent = { type: 'FRAME_HIT', t: 1, px: 2.1, py: 1.2, pz: 3.0, speedMps: 20 };
    const guard: DomainEvent = { type: 'GUARD_HIT', t: 2, px: 0.2, py: 1.0, pz: 13.7, speedMps: 30 };
    const bounce: DomainEvent = { type: 'BALL_BOUNCE', t: 3, px: 0, py: 0.04, pz: 6, speedMps: 9 };
    expect(cuesForEvent(frame, ctx).map((c) => c.cue)).toEqual(['frameClang']);
    expect(cuesForEvent(guard, ctx).map((c) => c.cue)).toEqual(['guardRattle']);
    expect(cuesForEvent(bounce, ctx).map((c) => c.cue)).toEqual([
      'whooshStop',
      'turfBounce',
      'rollStart',
    ]);
    const clang = cuesForEvent(frame, createCueContext())[0]!;
    expect([clang.px, clang.py, clang.pz]).toEqual([2.1, 1.2, 3.0]);
  });

  it('net rustle gain grows monotonically with impact speed (∝ energy)', () => {
    const speeds = [3, 8, 15, 25, 35, 45];
    const gains = speeds.map((s) => rustleGain(s));
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]!).toBeGreaterThanOrEqual(gains[i - 1]!);
    }
    expect(gains[gains.length - 1]).toBe(1); // saturates at a full rope
    expect(gains[0]).toBeGreaterThan(0); // a flare still whispers
    // And the mapping is what the cue carries.
    const ctx = createCueContext('WOOD');
    const hit: DomainEvent = { type: 'NET_HIT', t: 1, px: 0, py: 2, pz: 18.8, speedMps: 25, panel: 'far' };
    const rustle = cuesForEvent(hit, ctx).find((c) => c.cue === 'netRustle')!;
    expect(rustle.gain).toBeCloseTo(rustleGain(25), 9);
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
