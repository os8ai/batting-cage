import { describe, expect, it } from 'vitest';
import {
  CLOTH_DT,
  CLOTH_NODE_PITCH_M,
  CLOTH_REST_ENERGY,
  CLOTH_SUBSTEPS,
  MPH_TO_MPS,
} from '../src/core/constants';
import {
  applyImpulse,
  clothNodeIndex,
  createCloth,
  settleEnergy,
  type ClothState,
} from '../src/core/physics/cloth';
import { stepCloth } from '../src/core/physics/cloth';

/** A §11 far-end-panel-sized cloth: 14 × 12 ft ≈ 4.27 × 3.66 m at 0.35 m pitch. */
function panel(pin: (col: number, row: number) => boolean = edgePins): ClothState {
  return createCloth(13, 11, CLOTH_NODE_PITCH_M, pin);
}

function edgePins(col: number, row: number): boolean {
  return col === 0 || col === 12 || row === 0 || row === 10;
}

function stepSeconds(c: ClothState, seconds: number): void {
  const steps = Math.round(seconds / CLOTH_DT);
  for (let i = 0; i < steps; i++) stepCloth(c, CLOTH_DT, CLOTH_SUBSTEPS);
}

describe('Verlet cloth solver (§11, M2 P1)', () => {
  it('pinned nodes never move', () => {
    const c = panel();
    const before = new Float32Array(c.pos);
    stepSeconds(c, 2);
    for (let row = 0; row < c.rows; row++) {
      for (let col = 0; col < c.cols; col++) {
        if (!edgePins(col, row)) continue;
        const j = clothNodeIndex(c, col, row) * 3;
        expect(c.pos[j]).toBe(before[j]);
        expect(c.pos[j + 1]).toBe(before[j + 1]);
        expect(c.pos[j + 2]).toBe(before[j + 2]);
      }
    }
  });

  it('hangs with a believable belly: settles with constraints within 2%', () => {
    const c = panel();
    stepSeconds(c, 5);
    // At rest: low energy, and every constraint within 2% of its rest length.
    expect(settleEnergy(c)).toBeLessThan(CLOTH_REST_ENERGY);
    for (let i = 0; i < c.rest.length; i++) {
      const a = c.pairs[i * 2]! * 3;
      const b = c.pairs[i * 2 + 1]! * 3;
      const dx = c.pos[b]! - c.pos[a]!;
      const dy = c.pos[b + 1]! - c.pos[a + 1]!;
      const dz = c.pos[b + 2]! - c.pos[a + 2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(Math.abs(len - c.rest[i]!) / c.rest[i]!).toBeLessThan(0.02);
    }
  });

  it('an impulse spreads over exactly the 3×3 neighborhood', () => {
    const c = panel(() => false); // no pins: all 9 nodes must receive it
    const before = new Float32Array(c.prev);
    applyImpulse(c, 6, 5, 0, 0, -8);
    let touched = 0;
    for (let i = 0; i < c.pinned.length; i++) {
      const j = i * 3;
      const moved =
        c.prev[j] !== before[j] || c.prev[j + 1] !== before[j + 1] || c.prev[j + 2] !== before[j + 2];
      if (moved) {
        touched++;
        const col = i % c.cols;
        const row = Math.floor(i / c.cols);
        expect(Math.abs(col - 6)).toBeLessThanOrEqual(1);
        expect(Math.abs(row - 5)).toBeLessThanOrEqual(1);
      }
    }
    expect(touched).toBe(9);
    // Center node carries full weight; corner carries a quarter.
    const center = clothNodeIndex(c, 6, 5) * 3 + 2;
    const corner = clothNodeIndex(c, 5, 4) * 3 + 2;
    const dCenter = before[center]! - c.prev[center]!;
    const dCorner = before[corner]! - c.prev[corner]!;
    expect(dCorner / dCenter).toBeCloseTo(0.25, 6);
  });

  it('survives a 102 EV impulse: bounded bulge, no NaN, decays back to rest', () => {
    const c = panel();
    stepSeconds(c, 3); // reach the rest pose first
    const restPose = new Float32Array(c.pos);
    const ev102 = 102 * MPH_TO_MPS; // ≈ 45.6 m/s — the clamp's job
    applyImpulse(c, 6, 5, 0, 0, -ev102);
    const e0 = settleEnergy(c);
    expect(e0).toBeGreaterThan(0);

    let maxBulge = 0;
    const windowMax: number[] = [];
    let windowPeak = 0;
    const steps = Math.round(4 / CLOTH_DT);
    for (let i = 0; i < steps; i++) {
      stepCloth(c, CLOTH_DT, CLOTH_SUBSTEPS);
      const e = settleEnergy(c);
      expect(Number.isNaN(e)).toBe(false);
      windowPeak = Math.max(windowPeak, e);
      if ((i + 1) % Math.round(1 / CLOTH_DT) === 0) {
        windowMax.push(windowPeak);
        windowPeak = 0;
      }
      for (let j = 0; j < c.pos.length; j += 3) {
        expect(Number.isNaN(c.pos[j])).toBe(false);
        const dz = Math.abs(c.pos[j + 2]! - restPose[j + 2]!);
        if (dz > maxBulge) maxBulge = dz;
      }
    }
    // M2-PLAN §3.4: a 102 EV impact deforms ~0.5–0.7 m without tunneling.
    expect(maxBulge).toBeGreaterThan(0.3);
    expect(maxBulge).toBeLessThan(1.2);
    // Energy envelope decays monotonically second-over-second, back to rest.
    for (let i = 1; i < windowMax.length; i++) {
      expect(windowMax[i]!).toBeLessThan(windowMax[i - 1]!);
    }
    expect(settleEnergy(c)).toBeLessThan(CLOTH_REST_ENERGY * 50);
  });

  it('stepCloth is allocation-free on its state (captured array identities)', () => {
    const c = panel();
    const refs = [c.pos, c.prev, c.pinned, c.pairs, c.rest];
    applyImpulse(c, 6, 5, 1, 2, -5);
    stepSeconds(c, 1);
    expect(c.pos).toBe(refs[0]);
    expect(c.prev).toBe(refs[1]);
    expect(c.pinned).toBe(refs[2]);
    expect(c.pairs).toBe(refs[3]);
    expect(c.rest).toBe(refs[4]);
  });

  it('is bit-deterministic: identical runs produce identical Float32 contents', () => {
    const run = (): ClothState => {
      const c = panel();
      stepSeconds(c, 1);
      applyImpulse(c, 4, 3, 2, -1, -9);
      stepSeconds(c, 2);
      return c;
    };
    const a = run();
    const b = run();
    expect(a.pos).toEqual(b.pos);
    expect(a.prev).toEqual(b.prev);
  });

  it('gravity along the local normal bellies the ceiling strip', () => {
    // Ceiling: panel lies flat; gravity is −z in its local frame.
    const c = createCloth(9, 9, 0.5, (col, row) => col === 0 || col === 8 || row === 0 || row === 8);
    for (let i = 0; i < 240; i++) stepCloth(c, CLOTH_DT, CLOTH_SUBSTEPS, 0, 0, -9.81);
    const center = clothNodeIndex(c, 4, 4) * 3 + 2;
    expect(c.pos[center]!).toBeLessThan(-0.05); // hangs below the frame plane
    expect(c.pos[center]!).toBeGreaterThan(-1.0); // but doesn't fall away
  });
});
