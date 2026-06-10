import { describe, expect, it } from 'vitest';
import { CYCLE_S, SIM_DT, SPINUP_S, TIERS } from '../src/core/constants';
import { pitchSolution } from '../src/core/physics/pitchSchedule';
import { cycleTimes, phaseAt } from '../src/core/pitchCycle';
import { CageSim } from '../src/core/sim';
import type { DomainEvent } from '../src/core/types';
import { plateTimeFor, pressForEps, releaseTimeFor, runScriptedRound } from './harness';

describe('§5 cycle timing functions', () => {
  it('the clock marks match §5: FEED 0, LOAD 0.9, RELEASE 1.8, BOARD plate+0.6, next 7.5', () => {
    const tf = 0.54;
    const c = cycleTimes(tf);
    expect(c.feed).toBe(0);
    expect(c.load).toBe(0.9);
    expect(c.release).toBe(1.8);
    expect(c.plate).toBeCloseTo(1.8 + tf, 12);
    expect(c.windowClose).toBeCloseTo(1.8 + tf + 0.2, 12);
    expect(c.boardReveal).toBeCloseTo(2.4 + tf, 12);
    expect(c.boardHoldEnd).toBeCloseTo(3.9 + tf, 12);
    expect(c.armed).toBe(5.5);
    expect(c.next).toBe(7.5);
  });

  it('phaseAt walks the locked sequence in order', () => {
    const tf = 0.65;
    expect(phaseAt(0.1, tf)).toBe('FEED');
    expect(phaseAt(1.0, tf)).toBe('LOAD');
    expect(phaseAt(1.9, tf)).toBe('FLIGHT');
    expect(phaseAt(1.8 + tf + 0.1, tf)).toBe('RESOLUTION');
    expect(phaseAt(2.4 + tf + 0.1, tf)).toBe('BOARD_REVEAL');
    expect(phaseAt(4.8, tf)).toBe('SETTLING');
    expect(phaseAt(6.0, tf)).toBe('ARMED');
  });
});

describe('§5 statechart through a live round', () => {
  it('RELEASE fires at T+1.8 s ± 1 tick on every pitch, at every tier (§14.4)', () => {
    for (const tier of TIERS) {
      const { events } = runScriptedRound({ seed: 1, tier, presses: [], frameDt: 1 / 60 });
      const releases = events.filter((e) => e.type === 'RELEASE');
      expect(releases).toHaveLength(10);
      releases.forEach((e, i) => {
        const expected = releaseTimeFor(tier, i + 1);
        expect(Math.abs(e.t - expected)).toBeLessThanOrEqual(SIM_DT + 1e-9);
      });
    }
  });

  it('a silent round records 10 TAKEs and ends (§What: no input = TAKE)', () => {
    const { records, events } = runScriptedRound({ seed: 2, tier: 40, presses: [], frameDt: 1 / 60 });
    expect(records).toHaveLength(10);
    expect(records.every((r) => r.grade === 'TAKE' && r.epsMs === null)).toBe(true);
    expect(events.filter((e) => e.type === 'ROUND_END')).toHaveLength(1);
  });

  it('the cycle cadence is fixed: FEED every 7.5 s, first FEED 3.0 s after token (§5)', () => {
    const { events } = runScriptedRound({ seed: 3, tier: 70, presses: [], frameDt: 1 / 60 });
    const feeds = events.filter((e) => e.type === 'FEED');
    expect(feeds).toHaveLength(10);
    feeds.forEach((e, i) => {
      expect(Math.abs(e.t - (SPINUP_S + i * CYCLE_S))).toBeLessThanOrEqual(SIM_DT + 1e-9);
    });
  });

  it('pre-release presses are ignored and never consume the swing (§14.5)', () => {
    const tier = 60;
    const press = pressForEps(tier, 1, 0);
    const { records, events } = runScriptedRound({
      seed: 4,
      tier,
      presses: [{ t: releaseTimeFor(tier, 1) - 0.3 }, { t: press }],
      frameDt: 1 / 60,
    });
    const ignored = events.filter((e) => e.type === 'PRESS_IGNORED');
    expect(ignored.some((e) => e.type === 'PRESS_IGNORED' && e.reason === 'PRE_RELEASE')).toBe(true);
    expect(records[0]!.grade).toBe('PERFECT'); // the real swing still landed
  });

  it('one accepted swing per pitch — the second press hits lockout', () => {
    const tier = 60;
    const { records, events } = runScriptedRound({
      seed: 5,
      tier,
      presses: [{ t: pressForEps(tier, 1, 10) }, { t: pressForEps(tier, 1, 60) }],
      frameDt: 1 / 60,
    });
    expect(events.filter((e) => e.type === 'PRESS_IGNORED' && e.reason === 'LOCKOUT')).toHaveLength(1);
    expect(records[0]!.epsMs).toBeCloseTo(10, 6);
  });

  it('a press inside the window is accepted even when hopeless — it grades MISS', () => {
    const tier = 90;
    const { records } = runScriptedRound({
      seed: 6,
      tier,
      presses: [{ t: releaseTimeFor(tier, 1) + 0.001 }], // way early
      frameDt: 1 / 60,
    });
    expect(records[0]!.grade).toBe('MISS');
    expect(records[0]!.epsMs).toBeLessThan(-100);
  });

  it('the grace window accepts a press up to plate + 200 ms, not after', () => {
    const tier = 40;
    const onEdge = runScriptedRound({
      seed: 7,
      tier,
      presses: [{ t: plateTimeFor(tier, 1) + 0.199 }],
      frameDt: 1 / 60,
    });
    expect(onEdge.records[0]!.grade).toBe('MISS'); // ε ≈ +349 ms — but accepted
    const past = runScriptedRound({
      seed: 7,
      tier,
      presses: [{ t: plateTimeFor(tier, 1) + 0.25 }],
      frameDt: 1 / 60,
    });
    expect(past.records[0]!.grade).toBe('TAKE'); // ignored → recorded TAKE
  });

  it('contact spawns a physical flight that ends settled on the cage floor', () => {
    const tier = 60;
    const { events } = runScriptedRound({
      seed: 8,
      tier,
      presses: [{ t: pressForEps(tier, 1, 0) }],
      frameDt: 1 / 60,
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('CONTACT');
    expect(types.filter((t) => t === 'NET_HIT').length).toBeGreaterThan(0);
    expect(types).toContain('BALL_SETTLED');
  });

  it('a TAKE ball thuds into the backstop pad (§6)', () => {
    const { events } = runScriptedRound({ seed: 9, tier: 40, presses: [], frameDt: 1 / 60 });
    expect(events.some((e) => e.type === 'BACKSTOP_HIT')).toBe(true);
  });

  it('token is refused mid-round; tier select is refused mid-round', () => {
    const sim = new CageSim({ seed: 1 });
    sim.selectTier(50);
    expect(sim.insertToken()).toBe(true);
    for (let i = 0; i < 600; i++) sim.tick(); // 5 s — inside the round
    expect(sim.insertToken()).toBe(false);
    expect(sim.selectTier(90)).toBe(false);
    expect(sim.currentTier).toBe(50);
  });

  it('boundary events arrive in the locked order on every pitch', () => {
    const tier = 80;
    const { events } = runScriptedRound({
      seed: 10,
      tier,
      presses: Array.from({ length: 10 }, (_, i) => ({ t: pressForEps(tier, i + 1, 0) })),
      frameDt: 1 / 60,
    });
    const order = ['FEED', 'LOAD', 'RELEASE', 'SWING_JUDGED', 'CONTACT', 'PLATE_CROSS', 'WINDOW_CLOSE', 'BOARD_REVEAL', 'BOARD_HOLD_END', 'ARMED'];
    const perPitch = new Map<number, string[]>();
    for (const e of events) {
      const pitch =
        'pitch' in e ? e.pitch : e.type === 'SWING_JUDGED' ? e.record.pitch : null;
      if (pitch === null || !order.includes(e.type)) continue;
      if (!perPitch.has(pitch)) perPitch.set(pitch, []);
      perPitch.get(pitch)!.push(e.type);
    }
    expect(perPitch.size).toBe(10);
    for (const seq of perPitch.values()) {
      const idx = seq.map((t) => order.indexOf(t));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
});

describe('flight time feeds the schedule', () => {
  it('PLATE_CROSS lands flightTime after RELEASE per tier', () => {
    for (const tier of [40, 90] as const) {
      const tf = pitchSolution(tier).flightTimeS;
      const { events } = runScriptedRound({ seed: 11, tier, presses: [], frameDt: 1 / 60 });
      const rel = events.find((e): e is DomainEvent & { type: 'RELEASE' } => e.type === 'RELEASE')!;
      const plate = events.find((e): e is DomainEvent & { type: 'PLATE_CROSS' } => e.type === 'PLATE_CROSS')!;
      expect(plate.t - rel.t).toBeCloseTo(tf, 6);
    }
  });
});
