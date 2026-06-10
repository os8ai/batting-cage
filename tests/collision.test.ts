import { describe, expect, it } from 'vitest';
import {
  BACKSTOP_Z_M,
  CAGE_FAR_Z_M,
  E_BACKSTOP,
  NET_CATCH_DAMP,
  SETTLED_POOL,
} from '../src/core/constants';
import { ballSpeed, makeBall, stepBall } from '../src/core/physics/ballistics';
import { resolveCageCollisions, type CollisionEvent } from '../src/core/physics/collision';
import { CageSim } from '../src/core/sim';
import { pressForEps } from './harness';

describe('§7 in-cage resolution (visual, never scored)', () => {
  it('the net catches with a damped response: speed drops to ~15%', () => {
    const b = makeBall();
    b.active = true;
    b.py = 1.5;
    b.pz = CAGE_FAR_Z_M + 0.001; // just past the far net plane
    b.vz = 40;
    b.vx = 3;
    b.vy = 5;
    const before = ballSpeed(b);
    const events: CollisionEvent[] = [];
    resolveCageCollisions(b, 1 / 120, events);
    expect(events).toContain('NET_HIT');
    expect(ballSpeed(b)).toBeCloseTo(before * NET_CATCH_DAMP, 6);
    expect(b.vz).toBeLessThan(0); // normal component reversed (net sags back)
  });

  it('the backstop pad is nearly dead (e = 0.10)', () => {
    const b = makeBall();
    b.active = true;
    b.py = 1;
    b.pz = BACKSTOP_Z_M - 0.001;
    b.vz = -20;
    const events: CollisionEvent[] = [];
    resolveCageCollisions(b, 1 / 120, events);
    expect(events).toContain('BACKSTOP_HIT');
    expect(b.vz).toBeCloseTo(20 * E_BACKSTOP, 6);
  });

  it('a dropped ball bounces, rolls, sleeps below 0.3 m/s and stays', () => {
    const b = makeBall();
    b.active = true;
    b.py = 2;
    b.vx = 2;
    const events: CollisionEvent[] = [];
    for (let i = 0; i < 120 * 30 && !b.asleep; i++) {
      stepBall(b, 1 / 120);
      resolveCageCollisions(b, 1 / 120, events);
    }
    expect(b.asleep).toBe(true);
    expect(events).toContain('FLOOR_BOUNCE');
    expect(events).toContain('SETTLED');
    expect(ballSpeed(b)).toBe(0);
  });

  it('hit balls remain on the floor for the round and clear on the next token', () => {
    const tier = 60;
    const presses = Array.from({ length: 10 }, (_, i) => ({ t: pressForEps(tier, i + 1, 0) }));
    const sim = new CageSim({ seed: 12 });
    sim.selectTier(tier);
    sim.insertToken();
    let pressIdx = 0;
    while (sim.currentPhase !== 'ROUND_END') {
      while (pressIdx < presses.length && presses[pressIdx]!.t <= sim.t) {
        sim.queueSwing(presses[pressIdx]!.t);
        pressIdx++;
      }
      sim.tick();
    }
    expect(sim.settled.length).toBeGreaterThan(0);
    expect(sim.settled.length).toBeLessThanOrEqual(SETTLED_POOL);
    sim.insertToken(); // between-round sweep
    expect(sim.settled.length).toBe(0);
  });
});
