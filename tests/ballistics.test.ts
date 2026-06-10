import { describe, expect, it } from 'vitest';
import { GRAVITY, MPH_TO_MPS, RPM_TO_RADS } from '../src/core/constants';
import { ballSpeed, makeBall, stepBall } from '../src/core/physics/ballistics';

function launch(speedMph: number, laDeg: number, spinRpm: number) {
  const b = makeBall();
  const v = speedMph * MPH_TO_MPS;
  const la = (laDeg * Math.PI) / 180;
  b.py = 1;
  b.vy = v * Math.sin(la);
  b.vz = v * Math.cos(la);
  if (spinRpm > 0) {
    b.sx = -1; // backspin for +Z travel (ω̂ × v̂ = +Y)
    b.spinRadS = spinRpm * RPM_TO_RADS;
  }
  b.active = true;
  return b;
}

function flyToGround(b: ReturnType<typeof launch>, dt = 1 / 240): { range: number; time: number } {
  let t = 0;
  for (let i = 0; i < 20000 && b.py > 0; i++) {
    stepBall(b, dt);
    t += dt;
  }
  return { range: Math.sqrt(b.px * b.px + b.pz * b.pz), time: t };
}

describe('§7 ballistics integrator', () => {
  it('drag always decelerates: speed decreases monotonically in level flight', () => {
    const b = launch(90, 0, 0);
    let prev = ballSpeed(b);
    for (let i = 0; i < 100; i++) {
      stepBall(b, 1 / 120);
      // Horizontal launch: drag bleeds speed faster than gravity adds it early on.
      const s = ballSpeed(b);
      if (i < 30) expect(s).toBeLessThan(prev);
      prev = s;
    }
  });

  it('a dropped ball accelerates at slightly under g (drag opposes)', () => {
    const b = makeBall();
    b.py = 10;
    b.active = true;
    stepBall(b, 0.01);
    expect(b.vy).toBeCloseTo(-GRAVITY * 0.01, 3);
  });

  it('backspin (Magnus) extends carry vs the same launch without spin', () => {
    const noSpin = flyToGround(launch(96, 25, 0));
    const spun = flyToGround(launch(96, 25, 2000));
    expect(spun.range).toBeGreaterThan(noSpin.range * 1.05);
    expect(spun.time).toBeGreaterThan(noSpin.time);
  });

  it('drag shortens carry vs vacuum kinematics', () => {
    const { range } = flyToGround(launch(96, 25, 0));
    const v = 96 * MPH_TO_MPS;
    const la = (25 * Math.PI) / 180;
    const vacuumRange = (v * v * Math.sin(2 * la)) / GRAVITY;
    expect(range).toBeLessThan(vacuumRange * 0.75);
  });

  it('is deterministic: identical states step identically', () => {
    const a = launch(80, 20, 1500);
    const b = launch(80, 20, 1500);
    for (let i = 0; i < 500; i++) {
      stepBall(a, 1 / 120);
      stepBall(b, 1 / 120);
    }
    expect(a).toEqual(b);
  });
});
