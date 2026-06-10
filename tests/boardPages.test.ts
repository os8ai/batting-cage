import { describe, expect, it } from 'vitest';
import type { DomainEvent, SwingRecord, TierMph } from '../src/core/types';
import {
  ATTRACT_PAGE_S,
  BoardPageMachine,
  CEREMONY_S,
  COUNT_UP_S,
  RECAP_HOLD_S,
  ROUND_OVER_S,
  type BoardSignal,
} from '../src/ui/diegetic/boardPages/pageMachine';
import { pressForEps, runScriptedRound } from './harness';

/** §9 page logic: the M1 reveal beat + the M3 recap/ceremony/initials/attract/coach set. */

function record(over: Partial<SwingRecord>): SwingRecord {
  return {
    pitch: 1,
    tier: 60,
    epsMs: 10,
    grade: 'GREAT',
    spray: 'CENTER',
    evMph: 95,
    laDeg: 26,
    carryFt: 360,
    points: 450,
    ...over,
  };
}

export function roundEnd(over: {
  t: number;
  tier: TierMph;
  records: SwingRecord[];
  medal?: 'bronze' | 'silver' | 'gold' | 'platinum' | null;
}): Extract<DomainEvent, { type: 'ROUND_END' }> {
  return {
    type: 'ROUND_END',
    round: 1,
    score: over.records.reduce((s, r) => s + r.points, 0),
    totalCarryFt: over.records.reduce((s, r) => s + (r.carryFt ?? 0), 0),
    medal: over.medal ?? null,
    newUnlocks: [],
    clubs: [],
    isPB: false,
    t: over.t,
    tier: over.tier,
    records: over.records,
  };
}

function freshInRound(): BoardPageMachine {
  const m = new BoardPageMachine();
  m.handle({ type: 'TOKEN', t: 0, tier: 60 });
  m.handle({ type: 'FEED', t: 3, pitch: 1 });
  return m;
}

describe('board page machine — in-round (M1 beat)', () => {
  it('follows the locked reveal beat: judged → (hold) → reveal → live', () => {
    const m = new BoardPageMachine();
    expect(m.page.kind).toBe('IDLE');

    expect(m.handle({ type: 'TOKEN', t: 0, tier: 60 })).toBe(true);
    expect(m.page).toMatchObject({ kind: 'LIVE', pitch: 0, spinup: true });

    expect(m.handle({ type: 'FEED', t: 3, pitch: 1 })).toBe(true);
    expect(m.page).toMatchObject({ kind: 'LIVE', pitch: 1, spinup: false });

    // SWING_JUDGED must NOT flip the page — the card waits for the §5 beat.
    expect(m.handle({ type: 'SWING_JUDGED', t: 5, record: record({}) })).toBe(false);
    expect(m.page.kind).toBe('LIVE');

    expect(m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 })).toBe(true);
    expect(m.page).toMatchObject({ kind: 'SWING_CARD', record: { carryFt: 360 } });

    expect(m.handle({ type: 'BOARD_HOLD_END', t: 7.1, pitch: 1 })).toBe(true);
    expect(m.page).toMatchObject({ kind: 'LIVE', pitch: 1 });
  });

  it('routes no-distance outcomes (TAKE / MISS / FOUL) to the no-dist card', () => {
    for (const [grade, eps] of [
      ['TAKE', null],
      ['MISS', 200],
      ['FOUL', 140],
    ] as const) {
      const m = freshInRound();
      m.handle({
        type: 'SWING_JUDGED',
        t: 5,
        record: record({ grade, epsMs: eps, carryFt: null, evMph: null, laDeg: null, spray: null, points: 0 }),
      });
      m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 });
      expect(m.page.kind).toBe('NO_DIST_CARD');
      if (m.page.kind === 'NO_DIST_CARD') expect(m.page.record.grade).toBe(grade);
    }
  });

  it('a BOARD_REVEAL with no judged swing changes nothing', () => {
    const m = freshInRound();
    expect(m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 })).toBe(false);
    expect(m.page.kind).toBe('LIVE');
  });

  it('the LIVE page carries the running score (§9 LIVE header)', () => {
    const m = freshInRound();
    m.handle({ type: 'SWING_JUDGED', t: 5, record: record({ points: 450 }) });
    m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 });
    m.handle({ type: 'BOARD_HOLD_END', t: 7.1, pitch: 1 });
    expect(m.page).toMatchObject({ kind: 'LIVE', score: 450 });
  });
});

describe('recap → ceremonies → initials → attract (M3 sequence)', () => {
  const records = [
    record({ carryFt: 310, points: 310 }),
    record({ grade: 'MISS', carryFt: null, evMph: null, points: 0 }),
    record({ carryFt: 372, points: 372 }),
  ];

  function play(m: BoardPageMachine, t: number): BoardSignal[] {
    return m.advance(t);
  }

  it('ROUND_END opens the RECAP with the count-up envelope and medal stamp', () => {
    const m = freshInRound();
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: 'bronze' }));
    expect(m.page).toMatchObject({ kind: 'RECAP', score: 682, medal: 'bronze', start: 80 });

    const first = play(m, 80.05);
    expect(first).toContainEqual({ kind: 'COUNT_UP_START' });
    // Count-up value climbs to the score across COUNT_UP_S.
    expect(m.countUpValue(80)).toBe(0);
    expect(m.countUpValue(80 + COUNT_UP_S / 2)).toBe(341);
    expect(m.countUpValue(80 + COUNT_UP_S)).toBe(682);

    const atEnd = play(m, 80 + COUNT_UP_S + 0.01);
    expect(atEnd).toContainEqual({ kind: 'COUNT_UP_END', medal: 'bronze' });
    expect(m.page.kind).toBe('RECAP'); // recap holds past the count-up
  });

  it('ceremony queue plays in event order after the recap hold', () => {
    const m = freshInRound();
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: 'bronze' }));
    m.handle({ type: 'NEW_PB', t: 80, tier: 60, kind: 'SCORE', value: 682 });
    m.handle({ type: 'CLUB_ENTERED', t: 80, tier: 60, ft: 300 });
    m.handle({ type: 'TIER_UNLOCKED', t: 80, tier: 70 });

    play(m, 80.05);
    play(m, 80 + COUNT_UP_S + 0.01);
    let t = 80 + RECAP_HOLD_S + 0.01;
    let signals = play(m, t);
    expect(signals[0]).toMatchObject({ kind: 'CEREMONY', item: { kind: 'PB', pb: 'SCORE' } });
    expect(m.page).toMatchObject({ kind: 'CEREMONY', item: { kind: 'PB' } });

    t += CEREMONY_S + 0.01;
    signals = play(m, t);
    expect(signals[0]).toMatchObject({ kind: 'CEREMONY', item: { kind: 'CLUB', ft: 300 } });

    t += CEREMONY_S + 0.01;
    signals = play(m, t);
    expect(signals[0]).toMatchObject({ kind: 'CEREMONY', item: { kind: 'UNLOCK', tier: 70 } });

    t += CEREMONY_S + 0.01;
    play(m, t);
    expect(m.page.kind).toBe('ROUND_OVER');
  });

  it('INITIALS appears after ceremonies when the round made the top-5', () => {
    const m = freshInRound();
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: null }));
    m.requestInitials('LEO');
    play(m, 80 + RECAP_HOLD_S + 0.01);
    expect(m.page).toMatchObject({ kind: 'INITIALS', cursor: 0 });
    expect(m.inInitials).toBe(true);
    if (m.page.kind !== 'INITIALS') throw new Error('unreachable');
    // Slots prefill with the last-used initials (L-E-O).
    expect(m.page.slots).toEqual([11, 4, 14]);
  });

  it('initials editing: arrows cycle/move, three confirms finish (skip = 3 presses)', () => {
    const m = freshInRound();
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: null }));
    m.requestInitials('AAA');
    play(m, 80 + RECAP_HOLD_S + 0.01);

    m.initialsInput('up', 90); // A → B
    m.initialsInput('confirm', 90); // lock slot 1
    m.initialsInput('down', 90); // A → Z on slot 2
    m.initialsInput('down', 90); // Z → Y
    m.initialsInput('confirm', 90);
    const done = m.initialsInput('confirm', 90); // slot 3 stays A
    expect(done).toContainEqual({ kind: 'INITIALS_DONE', initials: 'BYA' });
    expect(m.page.kind).toBe('ROUND_OVER');

    // Pure skip: three confirms accept the defaults — one-key solo flow.
    const m2 = freshInRound();
    m2.handle(roundEnd({ t: 80, tier: 60, records, medal: null }));
    m2.requestInitials('LEO');
    play(m2, 80 + RECAP_HOLD_S + 0.01);
    m2.initialsInput('confirm', 91);
    m2.initialsInput('confirm', 91);
    const skip = m2.initialsInput('confirm', 91);
    expect(skip).toContainEqual({ kind: 'INITIALS_DONE', initials: 'LEO' });
  });

  it('SPACE during INITIALS only feeds the entry — initialsInput is inert elsewhere', () => {
    const m = freshInRound();
    expect(m.initialsInput('confirm', 10)).toEqual([]);
    expect(m.initialsInput('up', 10)).toEqual([]);
  });

  it('without initials, ROUND_OVER holds then the attract carousel cycles', () => {
    const m = freshInRound();
    m.setAttractData({
      firstRun: false,
      top5ByTier: [{ tier: 60, entries: [{ initials: 'LEO', score: 4000 }] }],
      pbs: [{ tier: 60, bestRoundScore: 4000, longestCarryFt: 380 }],
    });
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: null }));
    let t = 80 + RECAP_HOLD_S + 0.01;
    play(m, t);
    expect(m.page.kind).toBe('ROUND_OVER');
    t += ROUND_OVER_S + 0.01;
    play(m, t);
    expect(m.page).toMatchObject({ kind: 'ATTRACT', variant: 1 });
    // ~6 s later the carousel flips to ATTRACT-2 (top-5), then ATTRACT-3 (PBs).
    t += ATTRACT_PAGE_S + 0.01;
    play(m, t);
    expect(m.page).toMatchObject({ kind: 'ATTRACT', variant: 2, carouselTier: 60 });
    t += ATTRACT_PAGE_S;
    play(m, t);
    expect(m.page).toMatchObject({ kind: 'ATTRACT', variant: 3 });
  });

  it('first-run attract shows exactly one action: INSERT TOKEN (ATTRACT-1 only)', () => {
    const m = new BoardPageMachine();
    m.setAttractData({ firstRun: true, top5ByTier: [], pbs: [] });
    m.advance(0);
    expect(m.page).toMatchObject({ kind: 'ATTRACT', variant: 1 });
    for (let t = 1; t < 30; t += 1) m.advance(t);
    expect(m.page).toMatchObject({ kind: 'ATTRACT', variant: 1 }); // never cycles
  });

  it('a new TOKEN cuts any post-round page straight to LIVE', () => {
    const m = freshInRound();
    m.handle(roundEnd({ t: 80, tier: 60, records, medal: 'bronze' }));
    m.handle({ type: 'NEW_PB', t: 80, tier: 60, kind: 'SCORE', value: 682 });
    m.handle({ type: 'TOKEN', t: 81, tier: 60 });
    expect(m.page).toMatchObject({ kind: 'LIVE', spinup: true });
    // The staged ceremonies were flushed — advancing far never resurfaces them.
    const signals = m.advance(120);
    expect(signals.find((s) => s.kind === 'CEREMONY')).toBeUndefined();
    expect(m.page.kind).toBe('LIVE');
  });
});

describe('FTUE coach overlays (§FTUE — pure page logic)', () => {
  it('walks the first-pitch script: WATCH THE LIGHT → SPACE TO SWING', () => {
    const m = new BoardPageMachine();
    m.setCoachEnabled(true);
    m.handle({ type: 'TOKEN', t: 0, tier: 40 });
    m.handle({ type: 'FEED', t: 3, pitch: 1 });
    expect(m.coachLine).toBe('WATCH THE LIGHT');
    m.handle({ type: 'RELEASE', t: 4.8, pitch: 1 });
    expect(m.coachLine).toBe('SPACE TO SWING');
    // A swing clears the prompt.
    m.handle({ type: 'SWING_JUDGED', t: 5.4, record: record({ grade: 'GOOD' }) });
    expect(m.coachLine).toBeNull();
  });

  it('a whiff coaches the size cue on the next flight', () => {
    const m = new BoardPageMachine();
    m.setCoachEnabled(true);
    m.handle({ type: 'TOKEN', t: 0, tier: 40 });
    m.handle({ type: 'FEED', t: 3, pitch: 1 });
    m.handle({ type: 'RELEASE', t: 4.8, pitch: 1 });
    m.handle({
      type: 'SWING_JUDGED',
      t: 5.4,
      record: record({ grade: 'MISS', carryFt: null, evMph: null, points: 0 }),
    });
    m.handle({ type: 'FEED', t: 10.5, pitch: 2 });
    m.handle({ type: 'RELEASE', t: 12.3, pitch: 2 });
    expect(m.coachLine).toBe('SWING AS IT GETS BIG');
  });

  it('an ignored pre-release press coaches the green light', () => {
    const m = new BoardPageMachine();
    m.setCoachEnabled(true);
    m.handle({ type: 'TOKEN', t: 0, tier: 40 });
    m.handle({ type: 'FEED', t: 3, pitch: 1 });
    m.handle({ type: 'PRESS_IGNORED', t: 3.5, reason: 'PRE_RELEASE' });
    expect(m.coachLine).toBe('WAIT FOR THE GREEN LIGHT');
  });

  it('coach stays dark for a returning career', () => {
    const m = new BoardPageMachine();
    m.setCoachEnabled(false);
    m.handle({ type: 'TOKEN', t: 0, tier: 40 });
    m.handle({ type: 'FEED', t: 3, pitch: 1 });
    m.handle({ type: 'RELEASE', t: 4.8, pitch: 1 });
    m.handle({ type: 'PRESS_IGNORED', t: 3.5, reason: 'PRE_RELEASE' });
    expect(m.coachLine).toBeNull();
  });
});

describe('full scripted round through the machine', () => {
  it('10 reveals then RECAP, score totals match', () => {
    const presses = [1, 4, 8].map((p) => ({ t: pressForEps(50, p, p === 4 ? 300 : -20) }));
    const { events, records } = runScriptedRound({ seed: 3, tier: 50, presses, frameDt: 1 / 60 });
    const m = new BoardPageMachine();
    const seen: string[] = [];
    for (const e of events as DomainEvent[]) {
      if (m.handle(e) && (m.page.kind === 'SWING_CARD' || m.page.kind === 'NO_DIST_CARD')) {
        seen.push(m.page.kind);
      }
    }
    expect(seen).toHaveLength(10); // every pitch reveals exactly one card
    expect(m.page.kind).toBe('RECAP');
    if (m.page.kind === 'RECAP') {
      expect(m.page.score).toBe(records.reduce((s, r) => s + r.points, 0));
      expect(m.page.records).toHaveLength(10);
    }
  });
});
