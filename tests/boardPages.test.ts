import { describe, expect, it } from 'vitest';
import type { DomainEvent, SwingRecord } from '../src/core/types';
import { BoardPageMachine } from '../src/ui/diegetic/boardPages/pageMachine';
import { pressForEps, runScriptedRound } from './harness';

/** §9 page logic: LIVE ↔ SWING CARD ↔ TAKE/MISS on BOARD_REVEAL/HOLD_END. */

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
  tier: SwingRecord['tier'];
  records: SwingRecord[];
}): DomainEvent {
  return {
    type: 'ROUND_END',
    round: 1,
    score: over.records.reduce((s, r) => s + r.points, 0),
    totalCarryFt: over.records.reduce((s, r) => s + (r.carryFt ?? 0), 0),
    medal: null,
    newUnlocks: [],
    clubs: [],
    isPB: false,
    ...over,
  };
}

describe('board page machine', () => {
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
      const m = new BoardPageMachine();
      m.handle({ type: 'TOKEN', t: 0, tier: 40 });
      m.handle({ type: 'FEED', t: 3, pitch: 1 });
      m.handle({
        type: 'SWING_JUDGED',
        t: 5,
        record: record({ grade, epsMs: eps, carryFt: null, evMph: null, laDeg: null, spray: null }),
      });
      m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 });
      expect(m.page.kind).toBe('NO_DIST_CARD');
      if (m.page.kind === 'NO_DIST_CARD') expect(m.page.record.grade).toBe(grade);
    }
  });

  it('a BOARD_REVEAL with no judged swing changes nothing', () => {
    const m = new BoardPageMachine();
    m.handle({ type: 'TOKEN', t: 0, tier: 40 });
    m.handle({ type: 'FEED', t: 3, pitch: 1 });
    expect(m.handle({ type: 'BOARD_REVEAL', t: 5.6, pitch: 1 })).toBe(false);
    expect(m.page.kind).toBe('LIVE');
  });

  it('ROUND_END summarizes contact count and best carry', () => {
    const m = new BoardPageMachine();
    m.handle({ type: 'TOKEN', t: 0, tier: 60 });
    const records = [
      record({ carryFt: 310 }),
      record({ grade: 'MISS', carryFt: null }),
      record({ carryFt: 372 }),
    ];
    m.handle(roundEnd({ t: 80, tier: 60, records }));
    expect(m.page).toMatchObject({ kind: 'ROUND_OVER', contactCount: 2, bestCarryFt: 372 });
  });

  it('tracks a full scripted round: 10 reveals, then ROUND_OVER', () => {
    const presses = [1, 4, 8].map((p) => ({ t: pressForEps(50, p, p === 4 ? 300 : -20) }));
    const { events } = runScriptedRound({ seed: 3, tier: 50, presses, frameDt: 1 / 60 });
    const m = new BoardPageMachine();
    const seen: string[] = [];
    for (const e of events as DomainEvent[]) {
      if (m.handle(e) && (m.page.kind === 'SWING_CARD' || m.page.kind === 'NO_DIST_CARD')) {
        seen.push(m.page.kind);
      }
    }
    expect(seen).toHaveLength(10); // every pitch reveals exactly one card
    expect(m.page.kind).toBe('ROUND_OVER');
  });
});
