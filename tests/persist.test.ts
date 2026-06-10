import { describe, expect, it } from 'vitest';
import { SWING_LOG_CAP } from '../src/core/constants';
import type { DomainEvent } from '../src/core/types';
import { exportSaveJson, importSaveJson } from '../src/persist/exportImport';
import { migrateToCurrent, refusalMessage } from '../src/persist/migrate';
import { Recorder, type PersistClock } from '../src/persist/recorder';
import {
  careerFromSave,
  createFreshSave,
  decodeSwing,
  encodeSwing,
  hasUnsafeKeys,
  isSave,
  type SaveV1,
} from '../src/persist/schema';
import { KEY_BAK, KEY_NEXT, KEY_SAVE, SaveStore, type KVStorage } from '../src/persist/store';
import { pressForEps, runScriptedRound } from './harness';

/** §14.18–.19 + §Data model, proven headlessly against injected storage. */

class MemoryKV implements KVStorage {
  map = new Map<string, string>();
  setCalls = 0;
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.setCalls += 1;
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** Torn-write simulator: every kv operation past `budget` throws (tab killed). */
class TornKV extends MemoryKV {
  constructor(private budget: number) {
    super();
  }
  private spend(): void {
    if (this.budget <= 0) throw new Error('TORN');
    this.budget -= 1;
  }
  override setItem(k: string, v: string): void {
    this.spend();
    super.setItem(k, v);
  }
  override removeItem(k: string): void {
    this.spend();
    super.removeItem(k);
  }
  /** The next boot reads storage as the dead tab left it. */
  asReadOnly(): KVStorage {
    return {
      getItem: (k) => (this.map.has(k) ? this.map.get(k)! : null),
      setItem: () => {},
      removeItem: () => {},
    };
  }
}

const clock: PersistClock = {
  nowISO: () => '2026-06-10T12:00:00.000Z',
  epochMs: () => 1_780_000_000_000,
};

function playRound(recorder: Recorder, opts: { seed?: number; eps?: Array<number | null> } = {}): DomainEvent[] {
  const eps = opts.eps ?? [0, -25, 70, -110, 140, 12, -60, 300, null, null];
  const presses = eps
    .map((e, i) => (e === null ? null : { t: pressForEps(60, i + 1, e) }))
    .filter((p): p is { t: number } => p !== null);
  const { events } = runScriptedRound({ seed: opts.seed ?? 99, tier: 60, presses, frameDt: 1 / 60 });
  for (const e of events) recorder.onEvent(e);
  return events;
}

describe('schema & codec', () => {
  it('a fresh save passes its own guard and starts with only 40 unlocked', () => {
    const save = createFreshSave(123, clock.nowISO());
    expect(isSave(save)).toBe(true);
    const career = careerFromSave(save);
    expect(career.unlockedTiers).toEqual([40]);
    expect(career.tiers[60]!.pbs.bestRoundScore).toBe(0);
  });

  it('first-run boot defaults: 40 mph · righty · wood (§FTUE)', () => {
    const save = createFreshSave(123, clock.nowISO());
    expect(save.loadout).toEqual({ handedness: 'R', bat: 'WOOD', lastInitials: 'AAA', lastTier: 40 });
    expect(save.settings.qualityPreset).toBeNull(); // auto-detect probe runs
    expect(save.sessions).toHaveLength(0); // coach + first-run attract key off zero rounds
  });

  it('swing tuples round-trip', () => {
    const rec = {
      pitch: 3,
      tier: 70 as const,
      epsMs: -23.4,
      grade: 'GREAT' as const,
      spray: 'PULL' as const,
      evMph: 97.25,
      laDeg: 24.1,
      carryFt: 381,
      points: 476,
    };
    const d = decodeSwing(encodeSwing(rec, 'METAL', 1234567));
    expect(d.tier).toBe(70);
    expect(d.epsMs).toBeCloseTo(-23.4, 1);
    expect(d.grade).toBe('GREAT');
    expect(d.spray).toBe('PULL');
    expect(d.evMph).toBeCloseTo(97.3, 1);
    expect(d.carryFt).toBe(381);
    expect(d.points).toBe(476);
    expect(d.bat).toBe('METAL');
    const take = decodeSwing(
      encodeSwing(
        { pitch: 1, tier: 40, epsMs: null, grade: 'TAKE', spray: null, evMph: null, laDeg: null, carryFt: null, points: 0 },
        'WOOD',
        1
      )
    );
    expect(take.epsMs).toBeNull();
    expect(take.grade).toBe('TAKE');
  });
});

describe('double-buffered store (E5)', () => {
  it('write promotes through bc.save.next and retains .bak', () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const a = createFreshSave(1, clock.nowISO());
    expect(store.write(a)).toBe(true);
    expect(kv.getItem(KEY_SAVE)).not.toBeNull();
    expect(kv.getItem(KEY_NEXT)).toBeNull();
    const b = createFreshSave(1, clock.nowISO());
    b.loadout.lastInitials = 'ZZZ';
    expect(store.write(b)).toBe(true);
    expect(JSON.parse(kv.getItem(KEY_BAK)!).loadout.lastInitials).toBe('AAA');
    expect(JSON.parse(kv.getItem(KEY_SAVE)!).loadout.lastInitials).toBe('ZZZ');
  });

  it('kill the tab at EVERY step mid-write: boot never yields a fresh career', () => {
    // Establish a good save, then attempt an update with the "tab" dying
    // after every possible number of storage mutations (0..4 covers the
    // write's full op sequence: next, bak, save, remove-next).
    const refSave = createFreshSave(7, clock.nowISO());
    refSave.loadout.lastInitials = 'OLD';
    const updated = createFreshSave(7, clock.nowISO());
    updated.loadout.lastInitials = 'NEW';
    const seeded = new MemoryKV();
    new SaveStore(seeded).write(refSave);

    for (let budget = 0; budget <= 4; budget++) {
      const torn = new TornKV(budget);
      torn.map = new Map(seeded.map);
      new SaveStore(torn).write(updated); // dies mid-sequence at the budget

      // Next boot reads whatever the torn run left behind.
      const recovered = new SaveStore(torn.asReadOnly()).load();
      expect(recovered, `budget=${budget}`).not.toBeNull();
      expect(['OLD', 'NEW'], `budget=${budget}`).toContain(recovered!.save.loadout.lastInitials);
    }
  });

  it('corrupt bc.save falls back to verified next, then bak', () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const good = createFreshSave(5, clock.nowISO());
    store.write(good);
    // Corrupt the primary; the ladder must fall through.
    kv.setItem(KEY_SAVE, '{"truncated": tru');
    const viaBakOrNext = store.load();
    expect(viaBakOrNext).toBeNull(); // no next/bak yet → only the corrupt doc existed
    // Now: good in bak, corrupt in save.
    store.clear();
    store.write(good);
    const better = createFreshSave(5, clock.nowISO());
    better.loadout.lastInitials = 'BBB';
    store.write(better);
    kv.setItem(KEY_SAVE, 'garbage');
    const rec = store.load();
    expect(rec!.source).toBe('bak');
    expect(rec!.save.loadout.lastInitials).toBe('AAA');
  });

  it('a quota-throwing storage never corrupts the prior save', () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const good = createFreshSave(9, clock.nowISO());
    store.write(good);
    const throwing: KVStorage = {
      getItem: (k) => kv.getItem(k),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (k) => kv.removeItem(k),
    };
    const s2 = new SaveStore(throwing);
    const updated = createFreshSave(9, clock.nowISO());
    updated.loadout.lastInitials = 'XXX';
    expect(s2.write(updated)).toBe(false);
    expect(s2.load()!.save.loadout.lastInitials).toBe('AAA');
  });
});

describe('recorder transaction (single derivation)', () => {
  function freshRecorder(): { recorder: Recorder; kv: MemoryKV; save: SaveV1 } {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const save = createFreshSave(42, clock.nowISO());
    // Headless harness rounds run at 60 mph — open the tier for the fixture.
    save.tiers['50'].unlocked = true;
    save.tiers['60'].unlocked = true;
    const recorder = new Recorder(store, save, clock);
    return { recorder, kv, save };
  }

  it('zero writes during the pitch cycle; one transaction at ROUND_END', () => {
    const { recorder, kv } = freshRecorder();
    const events = playRound(recorder);
    const endIdx = events.findIndex((e) => e.type === 'ROUND_END');
    // Replay: count writes from events strictly before ROUND_END.
    const kv2 = new MemoryKV();
    const r2 = new Recorder(new SaveStore(kv2), createFreshSave(1, clock.nowISO()), clock);
    for (const e of events.slice(0, endIdx)) r2.onEvent(e);
    expect(kv2.setCalls).toBe(0); // nothing mid-cycle (§Data model)
    expect(kv.setCalls).toBeGreaterThan(0); // the round-end transaction wrote
  });

  it('applies the round: log, recentRounds, session, tier stats', () => {
    const { recorder, save } = freshRecorder();
    const events = playRound(recorder);
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    expect(save.swingLog).toHaveLength(10);
    expect(save.recentRounds).toHaveLength(1);
    expect(save.recentRounds[0]).toMatchObject({ tier: '60', score: end.score, logStart: 0, count: 10 });
    expect(save.sessions).toHaveLength(1);
    expect(save.sessions[0]!.rounds).toBe(1);
    expect(save.sessions[0]!.bestScore).toBe(end.score);
    expect(save.tiers['60'].pbs.bestRoundScore).toBe(end.score);
    expect(save.tiers['60'].lifetimeAverages.rounds).toBe(1);
    expect(save.loadout.lastTier).toBe(60);
    // Session aggregates derive from the log (single derivation).
    expect(save.sessions[0]!.contactPct).toBeGreaterThan(0);
  });

  it('is idempotent on the same round id (twice-applied = once)', () => {
    const { recorder, save } = freshRecorder();
    const events = playRound(recorder);
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    const snapshot = JSON.stringify(save);
    const outcome = recorder.applyRound(end);
    expect(outcome.written).toBe(false);
    expect(JSON.stringify(save)).toBe(snapshot);
  });

  it('caps the swing log FIFO at 10k with a moving base', () => {
    const { recorder, save } = freshRecorder();
    // Pre-fill near the cap with synthetic tuples.
    const filler = encodeSwing(
      { pitch: 1, tier: 40, epsMs: 5, grade: 'GOOD', spray: 'CENTER', evMph: 90, laDeg: 20, carryFt: 300, points: 300 },
      'WOOD',
      1
    );
    for (let i = 0; i < SWING_LOG_CAP - 4; i++) save.swingLog.push([...filler] as typeof filler);
    playRound(recorder);
    expect(save.swingLog.length).toBe(SWING_LOG_CAP);
    expect(save.swingLogBase).toBe(6); // 10 appended, 6 dropped
    // recentRounds range clipped by the base still resolves.
    expect(save.recentRounds[0]!.logStart).toBe(SWING_LOG_CAP - 4);
  });

  it('top-5 entry + initials stamp', () => {
    const { recorder, save } = freshRecorder();
    const events = playRound(recorder);
    const end = events.find((e) => e.type === 'ROUND_END')!;
    if (end.type !== 'ROUND_END') throw new Error('unreachable');
    expect(save.tiers['60'].top5).toHaveLength(1);
    expect(save.tiers['60'].top5[0]!.initials).toBe('AAA'); // defaults to last-used
    recorder.setInitials('LEO');
    expect(save.tiers['60'].top5[0]!.initials).toBe('LEO');
    expect(save.loadout.lastInitials).toBe('LEO');
  });

  it('a TAKE-only round never enters the top-5', () => {
    const { recorder, save } = freshRecorder();
    playRound(recorder, { eps: [null, null, null, null, null, null, null, null, null, null] });
    expect(save.tiers['60'].top5).toHaveLength(0);
  });
});

describe('export / import (E4, §14.18)', () => {
  it('round-trips export → wipe → import losslessly', () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const save = createFreshSave(77, clock.nowISO());
    save.tiers['60'].unlocked = true;
    const recorder = new Recorder(store, save, clock);
    playRound(recorder);
    const exported = exportSaveJson(save);

    kv.map.clear(); // simulated eviction
    expect(store.load()).toBeNull();

    const imported = importSaveJson(exported);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('unreachable');
    expect(imported.save).toEqual(save);
    expect(store.write(imported.save)).toBe(true);
    expect(store.load()!.save).toEqual(save);
  });

  it('hostile-import fuzz set: every document refused, prior save intact', () => {
    const kv = new MemoryKV();
    const store = new SaveStore(kv);
    const prior = createFreshSave(1, clock.nowISO());
    store.write(prior);
    const priorJson = kv.getItem(KEY_SAVE);

    const good = createFreshSave(2, clock.nowISO());
    const newer = createFreshSave(3, clock.nowISO());
    newer.meta.schemaVersion = 2;
    const hugeLog = createFreshSave(4, clock.nowISO());
    (hugeLog.swingLog as unknown[]) = Array.from({ length: SWING_LOG_CAP + 1 }, () => [
      1, 0, null, 5, null, null, null, null, 0, 0,
    ]);
    const polluted = JSON.parse(exportSaveJson(createFreshSave(5, clock.nowISO())));
    Object.defineProperty(polluted.settings, '__proto__', {
      value: { hacked: true },
      enumerable: true,
      configurable: true,
    });

    const cases: Array<[string, string]> = [
      ['truncated JSON', exportSaveJson(good).slice(0, 200)],
      ['not JSON at all', 'hello there'],
      ['JSON scalar', '42'],
      ['JSON array', '[1,2,3]'],
      ['empty object', '{}'],
      ['wrong types', '{"meta":{"schemaVersion":1,"saveId":"nope","createdAt":1,"updatedAt":[]}}'],
      ['newer schemaVersion', exportSaveJson(newer)],
      ['huge swing log', exportSaveJson(hugeLog)],
      ['prototype pollution', '{"meta":{"schemaVersion":1,"saveId":1,"createdAt":"x","updatedAt":"x"},"__proto__":{"polluted":1}}'],
      ['nested pollution', JSON.stringify(polluted)],
      ['NaN smuggling', exportSaveJson(good).replace(/"saveId": 2/, '"saveId": 1e999')],
    ];
    for (const [name, text] of cases) {
      const result = importSaveJson(text);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(refusalMessage(result.reason).length, name).toBeGreaterThan(0);
    }
    // Refused imports never touched storage.
    expect(kv.getItem(KEY_SAVE)).toBe(priorJson);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).hacked).toBeUndefined();
  });

  it('newer-schema refusal carries the board message', () => {
    const newer = createFreshSave(3, clock.nowISO());
    newer.meta.schemaVersion = 99;
    const r = migrateToCurrent(JSON.parse(exportSaveJson(newer)));
    expect(r).toEqual({ ok: false, reason: 'NEWER_SCHEMA' });
    expect(refusalMessage('NEWER_SCHEMA')).toBe('SAVE FROM A NEWER VERSION');
  });

  it('unsafe-keys scanner sees through nesting', () => {
    expect(hasUnsafeKeys({ a: { b: { constructor: 1 } } })).toBe(true);
    expect(hasUnsafeKeys({ a: [{ prototype: 1 }] })).toBe(true);
    expect(hasUnsafeKeys({ a: { b: 1 } })).toBe(false);
  });
});
