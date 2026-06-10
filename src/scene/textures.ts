import * as THREE from 'three';

/**
 * Procedural PBR-ish texture set (M1-PLAN §3 fallback path, promoted to the
 * shipped source). Canvas-generated at boot from seeded noise — zero wire
 * bytes, no licenses, deterministic. CC0 photo-scan cooks (KTX2) can replace
 * these per-name later; the materials only see THREE.Texture.
 */

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function asTexture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Per-pixel value noise over a base color. */
function noisyFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rnd: () => number,
  base: [number, number, number],
  vary: number
): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const n = (rnd() - 0.5) * 2 * vary;
    d[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    d[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    d[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Cage turf, mapped once across the 14×70 ft tunnel floor (UV x = width,
 * y = length): green nylon with mow bands, the worn machine lane down the
 * centerline, and a worn patch at the plate end (§4).
 */
export function turfTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 2048;
  const [c, ctx] = canvas(W, H);
  const rnd = mulberry(0x7e2f);
  noisyFill(ctx, W, H, rnd, [42, 86, 48], 14);

  // Mow bands across the width (subtle alternating lightness).
  for (let band = 0; band < 16; band++) {
    if (band % 2 === 0) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(0, (band * H) / 16, W, H / 16);
  }

  // Worn machine lane along the centerline: thinned, browned fibers.
  const laneGrad = ctx.createLinearGradient(W * 0.38, 0, W * 0.62, 0);
  laneGrad.addColorStop(0, 'rgba(118,96,60,0)');
  laneGrad.addColorStop(0.5, 'rgba(118,96,60,0.5)');
  laneGrad.addColorStop(1, 'rgba(118,96,60,0)');
  ctx.fillStyle = laneGrad;
  ctx.fillRect(W * 0.38, 0, W * 0.24, H);

  // Heavier wear blotch at the plate end (v=0 end of the tunnel).
  const plateWear = ctx.createRadialGradient(W / 2, H * 0.045, 10, W / 2, H * 0.045, W * 0.45);
  plateWear.addColorStop(0, 'rgba(124,102,64,0.65)');
  plateWear.addColorStop(1, 'rgba(124,102,64,0)');
  ctx.fillStyle = plateWear;
  ctx.fillRect(0, 0, W, H * 0.2);

  // Fiber speckle on top.
  ctx.fillStyle = 'rgba(20,40,22,0.35)';
  for (let i = 0; i < 14000; i++) {
    ctx.fillRect(rnd() * W, rnd() * H, 1, 2 + rnd() * 3);
  }
  return asTexture(c);
}

/** Painted/bare concrete for the facility shell. */
export function concreteTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rnd = mulberry(0xc0c7);
  noisyFill(ctx, S, S, rnd, [70, 72, 75], 9);
  // Large stains / tonal blotches.
  for (let i = 0; i < 26; i++) {
    const g = ctx.createRadialGradient(rnd() * S, rnd() * S, 4, rnd() * S, rnd() * S, 40 + rnd() * 120);
    const dark = rnd() > 0.5;
    g.addColorStop(0, dark ? 'rgba(35,36,40,0.16)' : 'rgba(120,122,124,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  return asTexture(c, [3, 3]);
}

/** Padded vinyl (lower facility walls + backstop pad): seamed panels. */
export function padTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rnd = mulberry(0x9ad5);
  // Base lifted from [38,50,84] (owner playtest, M2): that navy is ~2%
  // albedo once sRGB-decoded — it rendered black under ANY light level.
  noisyFill(ctx, S, S, rnd, [88, 100, 134], 6);
  // Panel seams + soft highlight per panel.
  const cols = 4;
  for (let p = 0; p < cols; p++) {
    const x0 = (p * S) / cols;
    const g = ctx.createLinearGradient(x0, 0, x0 + S / cols, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, S / cols, S);
    ctx.fillStyle = 'rgba(8,10,16,0.8)';
    ctx.fillRect(x0, 0, 3, S);
  }
  return asTexture(c, [2, 1]);
}

/**
 * Black nylon netting — alpha-tested square weave (§11). One weave cell per
 * tile; heavy repeat across the panels.
 */
export function netTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(16,16,18,1)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  // Two thread directions of the knotted weave.
  ctx.moveTo(0, S / 2);
  ctx.lineTo(S, S / 2);
  ctx.moveTo(S / 2, 0);
  ctx.lineTo(S / 2, S);
  ctx.stroke();
  // Knot at the crossing.
  ctx.fillStyle = 'rgba(22,22,25,1)';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Brushed galvanized steel (frame, machine guard, fixtures). */
export function steelTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rnd = mulberry(0x57ee1);
  noisyFill(ctx, S, S, rnd, [126, 130, 134], 7);
  // Brush streaks.
  for (let i = 0; i < 700; i++) {
    const y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(rnd() * S, y, 18 + rnd() * 60, 1);
  }
  return asTexture(c, [2, 2]);
}

/** Worn rubber plate mat with painted batter's boxes (§4). UV: 1 ≈ 12×12 ft. */
export function plateMatTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rnd = mulberry(0xa7a7);
  noisyFill(ctx, S, S, rnd, [30, 30, 33], 6);
  // Scuffs.
  ctx.fillStyle = 'rgba(180,180,180,0.05)';
  for (let i = 0; i < 240; i++) ctx.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 26, 1 + rnd() * 2);
  // Painted batter's boxes: 4×6 ft boxes either side of a 17 in plate at center.
  const ftPx = S / 12;
  ctx.strokeStyle = 'rgba(214,212,200,0.85)';
  ctx.lineWidth = 4;
  const boxW = 4 * ftPx;
  const boxH = 6 * ftPx;
  const gap = (17 / 12 / 2 + 0.5) * ftPx; // half plate + 6 in
  ctx.strokeRect(S / 2 - gap - boxW, S / 2 - boxH / 2, boxW, boxH);
  ctx.strokeRect(S / 2 + gap, S / 2 - boxH / 2, boxW, boxH);
  return asTexture(c);
}
