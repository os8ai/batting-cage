import {
  CLOTH_CONSTRAINT_PASSES,
  CLOTH_DAMPING,
  CLOTH_DT,
  CLOTH_IMPULSE_MAX_MPS,
  CLOTH_SUBSTEPS,
  GRAVITY,
} from '../constants';

/**
 * Verlet cloth solver (SPEC §11) — pure TS over preallocated typed arrays,
 * zero allocations per step, fully deterministic. Visual-only physics: it is
 * stepped by the presentation layer (scene/actors/Net.ts) on the render
 * loop's 60 Hz sub-accumulator and is NEVER read by the sim (§Architecture:
 * "gameplay outcomes never read cloth state"; tests/boundaries.test.ts
 * asserts core/sim.ts cannot reach this file).
 *
 * Node layout is panel-local: x = col·spacing (rightward), y = −row·spacing
 * (row 0 at the top), z = 0 at rest; z bulges along the local normal. The
 * caller orients the mesh and passes gravity in this local frame.
 */
export interface ClothState {
  readonly cols: number;
  readonly rows: number;
  readonly spacing: number;
  /** xyz per node. */
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly pinned: Uint8Array;
  /** Constraint node-index pairs (a,b) per constraint. */
  readonly pairs: Int32Array;
  readonly rest: Float32Array;
}

export function clothNodeIndex(state: ClothState, col: number, row: number): number {
  return row * state.cols + col;
}

/**
 * Build a cols×rows panel at rest with structural + shear constraints.
 * `isPinned(col,row)` marks nodes welded to the frame (immovable).
 */
export function createCloth(
  cols: number,
  rows: number,
  spacing: number,
  isPinned: (col: number, row: number) => boolean
): ClothState {
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const prev = new Float32Array(n * 3);
  const pinned = new Uint8Array(n);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      pos[i * 3] = col * spacing;
      pos[i * 3 + 1] = -row * spacing;
      pos[i * 3 + 2] = 0;
      pinned[i] = isPinned(col, row) ? 1 : 0;
    }
  }
  prev.set(pos);

  const structural = rows * (cols - 1) + cols * (rows - 1);
  const shear = 2 * (cols - 1) * (rows - 1);
  const pairs = new Int32Array((structural + shear) * 2);
  const rest = new Float32Array(structural + shear);
  const diag = Math.SQRT2 * spacing;
  let c = 0;
  const add = (a: number, b: number, len: number): void => {
    pairs[c * 2] = a;
    pairs[c * 2 + 1] = b;
    rest[c] = len;
    c++;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (col + 1 < cols) add(i, i + 1, spacing);
      if (row + 1 < rows) add(i, i + cols, spacing);
      if (col + 1 < cols && row + 1 < rows) {
        add(i, i + cols + 1, diag);
        add(i + 1, i + cols, diag);
      }
    }
  }
  return { cols, rows, spacing, pos, prev, pinned, pairs, rest };
}

/**
 * Advance the cloth by dt using `substeps` Verlet substeps, each followed by
 * CLOTH_CONSTRAINT_PASSES relaxation passes. Gravity is given in the panel's
 * local frame (a wall panel hangs in-plane; the ceiling strip bellies along
 * its normal). Allocation-free.
 */
export function stepCloth(
  state: ClothState,
  dt: number,
  substeps: number = CLOTH_SUBSTEPS,
  gx = 0,
  gy = -GRAVITY,
  gz = 0
): void {
  const h = dt / substeps;
  const h2 = h * h;
  const keep = 1 - CLOTH_DAMPING;
  const { pos, prev, pinned, pairs, rest } = state;
  const n = pinned.length;
  for (let s = 0; s < substeps; s++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const j = i * 3;
      const px = pos[j]!;
      const py = pos[j + 1]!;
      const pz = pos[j + 2]!;
      pos[j] = px + (px - prev[j]!) * keep + gx * h2;
      pos[j + 1] = py + (py - prev[j + 1]!) * keep + gy * h2;
      pos[j + 2] = pz + (pz - prev[j + 2]!) * keep + gz * h2;
      prev[j] = px;
      prev[j + 1] = py;
      prev[j + 2] = pz;
    }
    for (let p = 0; p < CLOTH_CONSTRAINT_PASSES; p++) {
      for (let cI = 0; cI < rest.length; cI++) {
        const a = pairs[cI * 2]!;
        const b = pairs[cI * 2 + 1]!;
        const pa = pinned[a]!;
        const pb = pinned[b]!;
        if (pa && pb) continue;
        const ja = a * 3;
        const jb = b * 3;
        const dx = pos[jb]! - pos[ja]!;
        const dy = pos[jb + 1]! - pos[ja + 1]!;
        const dz = pos[jb + 2]! - pos[ja + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const diff = (d - rest[cI]!) / d;
        const wa = pa ? 0 : pb ? 1 : 0.5;
        const wb = pb ? 0 : pa ? 1 : 0.5;
        if (wa > 0) {
          pos[ja]! += dx * diff * wa;
          pos[ja + 1]! += dy * diff * wa;
          pos[ja + 2]! += dz * diff * wa;
        }
        if (wb > 0) {
          pos[jb]! -= dx * diff * wb;
          pos[jb + 1]! -= dy * diff * wb;
          pos[jb + 2]! -= dz * diff * wb;
        }
      }
    }
  }
}

/**
 * Inject a velocity impulse at (col,row), spread over the 3×3 neighborhood
 * (§11): full weight at the center, half on edges, quarter on corners.
 * The magnitude is clamped (CLOTH_IMPULSE_MAX_MPS) so a 102 EV rope deforms
 * without tunneling. Pinned nodes ignore it.
 */
export function applyImpulse(
  state: ClothState,
  col: number,
  row: number,
  vx: number,
  vy: number,
  vz: number
): void {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (speed < 1e-9) return;
  const k = speed > CLOTH_IMPULSE_MAX_MPS ? CLOTH_IMPULSE_MAX_MPS / speed : 1;
  const h = CLOTH_DT / CLOTH_SUBSTEPS;
  const { prev, pinned, cols, rows } = state;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const i = r * cols + c;
      if (pinned[i]) continue;
      const w = dr === 0 && dc === 0 ? 1 : dr === 0 || dc === 0 ? 0.5 : 0.25;
      const j = i * 3;
      // Verlet velocity injection: v = (pos − prev) / h.
      prev[j]! -= vx * k * w * h;
      prev[j + 1]! -= vy * k * w * h;
      prev[j + 2]! -= vz * k * w * h;
    }
  }
}

/** Kinetic-energy proxy: Σ|pos − prev|² — drives the "active panel" flag
 * (normals recompute only while above CLOTH_REST_ENERGY). */
export function settleEnergy(state: ClothState): number {
  const { pos, prev } = state;
  let e = 0;
  for (let j = 0; j < pos.length; j++) {
    const d = pos[j]! - prev[j]!;
    e += d * d;
  }
  return e;
}
