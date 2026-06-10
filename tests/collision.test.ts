import { describe, expect, it } from 'vitest';
import {
  BACKSTOP_Z_M,
  BALL_RADIUS_M,
  BOUNCE_EVENT_MIN_VY_MPS,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  E_BACKSTOP,
  E_FRAME,
  E_GUARD,
  FRAME_FIRST_Z_M,
  FRAME_SPACING_M,
  GUARD_HALF_XZ_M,
  MACHINE_BODY_DIST_M,
  NET_CATCH_DAMP,
  SETTLED_POOL,
} from '../src/core/constants';
import { ballSpeed, makeBall, stepBall } from '../src/core/physics/ballistics';
import {
  resolveCageCollisions,
  separateSettled,
  type CollisionHit,
} from '../src/core/physics/collision';
import { CageSim } from '../src/core/sim';
import type { DomainEvent } from '../src/core/types';
import { pressForEps } from './harness';

const kinds = (hits: CollisionHit[]): string[] => hits.map((h) => h.kind);

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
    const hits: CollisionHit[] = [];
    resolveCageCollisions(b, 1 / 120, hits);
    expect(kinds(hits)).toContain('NET_HIT');
    expect(ballSpeed(b)).toBeCloseTo(before * NET_CATCH_DAMP, 6);
    expect(b.vz).toBeLessThan(0); // normal component reversed (net sags back)
  });

  it('NET_HIT carries the panel hint and the pre-damp impact speed', () => {
    const cases: Array<{ set: (b: ReturnType<typeof makeBall>) => void; panel: string }> = [
      { set: (b) => ((b.pz = CAGE_FAR_Z_M + 0.001), (b.vz = 35)), panel: 'far' },
      { set: (b) => ((b.px = CAGE_HALF_WIDTH_M + 0.001), (b.vx = 20)), panel: 'left' },
      { set: (b) => ((b.px = -CAGE_HALF_WIDTH_M - 0.001), (b.vx = -20)), panel: 'right' },
      { set: (b) => ((b.py = 3.7), (b.vy = 18)), panel: 'ceiling' },
    ];
    for (const c of cases) {
      const b = makeBall();
      b.active = true;
      b.py = 1.5;
      b.pz = 5; // off the upright grid so the side hits read as net, not frame
      c.set(b);
      const before = ballSpeed(b);
      const hits: CollisionHit[] = [];
      resolveCageCollisions(b, 1 / 120, hits);
      const net = hits.find((h) => h.kind === 'NET_HIT');
      expect(net, c.panel).toBeDefined();
      expect(net!.panel).toBe(c.panel);
      expect(net!.speedMps).toBeCloseTo(before, 6);
    }
  });

  it('the backstop pad is nearly dead (e = 0.10)', () => {
    const b = makeBall();
    b.active = true;
    b.py = 1;
    b.pz = BACKSTOP_Z_M - 0.001;
    b.vz = -20;
    const hits: CollisionHit[] = [];
    resolveCageCollisions(b, 1 / 120, hits);
    expect(kinds(hits)).toContain('BACKSTOP_HIT');
    expect(b.vz).toBeCloseTo(20 * E_BACKSTOP, 6);
  });

  it('a steel upright clangs at e = 0.45 (narrow: only on the 10 ft grid)', () => {
    const uprightZ = FRAME_FIRST_Z_M + 3 * FRAME_SPACING_M;
    const b = makeBall();
    b.active = true;
    b.py = 1.5;
    b.pz = uprightZ;
    b.px = CAGE_HALF_WIDTH_M - BALL_RADIUS_M + 0.001; // dead-on into the upright
    b.vx = 25;
    const hits: CollisionHit[] = [];
    resolveCageCollisions(b, 1 / 120, hits);
    expect(kinds(hits)).toContain('FRAME_HIT');
    expect(kinds(hits)).not.toContain('NET_HIT'); // the clang wins over the catch
    expect(b.vx).toBeLessThan(0);
    expect(Math.abs(b.vx)).toBeCloseTo(25 * E_FRAME, 4);

    // Same approach mid-bay (between uprights): a normal net catch.
    const b2 = makeBall();
    b2.active = true;
    b2.py = 1.5;
    b2.pz = uprightZ + FRAME_SPACING_M / 2;
    b2.px = CAGE_HALF_WIDTH_M + 0.001;
    b2.vx = 25;
    const hits2: CollisionHit[] = [];
    resolveCageCollisions(b2, 1 / 120, hits2);
    expect(kinds(hits2)).toContain('NET_HIT');
    expect(kinds(hits2)).not.toContain('FRAME_HIT');
  });

  it('a batted ball cannot pass through the machine guard (e = 0.30)', () => {
    const b = makeBall();
    b.active = true;
    b.px = 0;
    b.py = 1.0;
    b.pz = MACHINE_BODY_DIST_M - GUARD_HALF_XZ_M - BALL_RADIUS_M - 0.01;
    b.vz = 40; // line drive straight back at the machine
    const hits: CollisionHit[] = [];
    for (let i = 0; i < 8; i++) {
      stepBall(b, 1 / 120);
      resolveCageCollisions(b, 1 / 120, hits, true);
    }
    expect(kinds(hits)).toContain('GUARD_HIT');
    expect(b.vz).toBeLessThan(0); // bounced back toward the plate
    expect(b.pz).toBeLessThan(MACHINE_BODY_DIST_M - GUARD_HALF_XZ_M);
    const g = hits.find((h) => h.kind === 'GUARD_HIT')!;
    expect(Math.abs(b.vz) / g.speedMps).toBeLessThanOrEqual(E_GUARD + 0.01);
  });

  it('the guard is inert for the pitched ball (it exits through the aperture)', () => {
    const b = makeBall();
    b.active = true;
    b.px = 0;
    b.py = 1.07;
    b.pz = MACHINE_BODY_DIST_M; // center of the guard box, like a fresh release
    b.vz = -25;
    const hits: CollisionHit[] = [];
    for (let i = 0; i < 12; i++) {
      stepBall(b, 1 / 120);
      resolveCageCollisions(b, 1 / 120, hits, false);
    }
    expect(kinds(hits)).not.toContain('GUARD_HIT');
    expect(b.vz).toBeLessThan(0); // still flying to the plate
  });

  it('BALL_BOUNCE fires only above the vertical-impact threshold', () => {
    const hard = makeBall();
    hard.active = true;
    hard.py = BALL_RADIUS_M - 0.001;
    hard.vy = -(BOUNCE_EVENT_MIN_VY_MPS + 1);
    const hardHits: CollisionHit[] = [];
    resolveCageCollisions(hard, 1 / 120, hardHits);
    expect(kinds(hardHits)).toContain('BALL_BOUNCE');

    const soft = makeBall();
    soft.active = true;
    soft.py = BALL_RADIUS_M - 0.001;
    soft.vy = -(BOUNCE_EVENT_MIN_VY_MPS - 0.5);
    const softHits: CollisionHit[] = [];
    resolveCageCollisions(soft, 1 / 120, softHits);
    expect(kinds(softHits)).toContain('FLOOR_BOUNCE');
    expect(kinds(softHits)).not.toContain('BALL_BOUNCE');
  });

  it('a dropped ball bounces, rolls, sleeps below 0.3 m/s and stays', () => {
    const b = makeBall();
    b.active = true;
    b.py = 2;
    b.vx = 2;
    const hits: CollisionHit[] = [];
    for (let i = 0; i < 120 * 30 && !b.asleep; i++) {
      stepBall(b, 1 / 120);
      resolveCageCollisions(b, 1 / 120, hits);
    }
    expect(b.asleep).toBe(true);
    expect(kinds(hits)).toContain('FLOOR_BOUNCE');
    expect(kinds(hits)).toContain('SETTLED');
    expect(ballSpeed(b)).toBe(0);
  });

  it('overlapping settled balls nudge apart positionally (no velocity exchange)', () => {
    const a = makeBall();
    const b = makeBall();
    for (const s of [a, b]) {
      s.active = true;
      s.asleep = true;
      s.py = BALL_RADIUS_M;
    }
    a.px = 0.01;
    b.px = -0.01; // deep overlap
    for (let i = 0; i < 10; i++) separateSettled([a, b], null);
    const dist = Math.hypot(a.px - b.px, a.pz - b.pz);
    expect(dist).toBeGreaterThanOrEqual(2 * BALL_RADIUS_M - 1e-6);
    expect(ballSpeed(a)).toBe(0); // positions moved, velocities untouched
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
    // No two settled balls interpenetrate (the §7 nudges hold the pile apart).
    for (let i = 0; i < sim.settled.length; i++) {
      for (let j = i + 1; j < sim.settled.length; j++) {
        const a = sim.settled[i]!;
        const c = sim.settled[j]!;
        expect(Math.hypot(a.px - c.px, a.pz - c.pz)).toBeGreaterThanOrEqual(2 * BALL_RADIUS_M - 1e-6);
      }
    }
    sim.insertToken(); // between-round sweep
    expect(sim.settled.length).toBe(0);
  });

  it('impact payloads match the ball state at emission (M2-PLAN P0)', () => {
    const tier = 90;
    const presses = Array.from({ length: 10 }, (_, i) => ({ t: pressForEps(tier, i + 1, 0) }));
    const sim = new CageSim({ seed: 41 });
    sim.selectTier(tier);
    sim.insertToken();
    let impactCount = 0;
    sim.onEvent((e: DomainEvent) => {
      if (
        e.type === 'NET_HIT' ||
        e.type === 'BACKSTOP_HIT' ||
        e.type === 'FRAME_HIT' ||
        e.type === 'GUARD_HIT' ||
        e.type === 'BALL_BOUNCE'
      ) {
        impactCount++;
        // Emission is synchronous: the payload must equal the live ball now.
        expect(e.px).toBe(sim.ball.px);
        expect(e.py).toBe(sim.ball.py);
        expect(e.pz).toBe(sim.ball.pz);
        expect(e.speedMps).toBeGreaterThan(0);
        // And lie inside the cage volume (sane positions).
        expect(Math.abs(e.px)).toBeLessThanOrEqual(CAGE_HALF_WIDTH_M + 0.1);
        expect(e.py).toBeGreaterThanOrEqual(0);
      }
    });
    let pressIdx = 0;
    while (sim.currentPhase !== 'ROUND_END') {
      while (pressIdx < presses.length && presses[pressIdx]!.t <= sim.t) {
        sim.queueSwing(presses[pressIdx]!.t);
        pressIdx++;
      }
      sim.tick();
    }
    expect(impactCount).toBeGreaterThan(0);
  });
});
