/**
 * Procedural SFX synthesis — the M1-PLAN §3 fallback path ("Procedural Web
 * Audio synthesis stubs"), promoted to the shipped source: every cue is
 * generated at unlock time from seeded math, so the audio set is zero-byte on
 * the wire, license-free, and deterministic. Sampled CC0 replacements can drop
 * in later via the same cue names (audio/cueMap.ts).
 */

/** Deterministic noise (LCG) — synthesis is reproducible across visits. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function buffer(ctx: AudioContext, durS: number): { buf: AudioBuffer; data: Float32Array; sr: number } {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.max(1, Math.round(durS * sr)), sr);
  return { buf, data: buf.getChannelData(0) as Float32Array, sr };
}

function normalize(data: Float32Array, peak = 0.9): void {
  let max = 1e-6;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]!));
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i]! *= k;
}

/** One-pole low-pass in place; cutoff in Hz (can be a sweep function of t). */
function onePoleLP(data: Float32Array, sr: number, cutoff: number | ((t: number) => number)): void {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff(i / sr);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    y += a * (data[i]! - y);
    data[i] = y;
  }
}

/** One-pole high-pass in place. */
function onePoleHP(data: Float32Array, sr: number, cutoff: number): void {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let yPrev = 0;
  let xPrev = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i]!;
    const y = a * (yPrev + x - xPrev);
    data[i] = y;
    yPrev = y;
    xPrev = x;
  }
}

/**
 * Machine wheel whirr — seamless loop. Every partial frequency is an integer
 * number of cycles over the loop length, so the wrap point is click-free.
 * Pitch-shifted per tier at playback (§5: an audible difficulty cue).
 */
export function whirrLoop(ctx: AudioContext): AudioBuffer {
  const dur = 1.5;
  const { buf, data, sr } = buffer(ctx, dur);
  const fit = (f: number) => Math.round(f * dur) / dur;
  const noise = lcg(0x57a11);
  // Motor hum fundamentals + electrical whine.
  const partials: Array<[number, number]> = [
    [fit(86), 0.55],
    [fit(172), 0.34],
    [fit(258), 0.18],
    [fit(345), 0.1],
    [fit(1725), 0.045],
    [fit(2590), 0.02],
  ];
  // Wheel-rush noise bed: many random-phase partials (loop-safe by construction).
  const rushN = 60;
  const rush: Array<[number, number, number]> = [];
  for (let p = 0; p < rushN; p++) {
    const f = fit(350 + Math.abs(noise()) * 1400);
    rush.push([f, 0.012 + Math.abs(noise()) * 0.012, noise() * Math.PI]);
  }
  const am1 = fit(7.2);
  const am2 = fit(13.1);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [f, a] of partials) v += a * Math.sin(2 * Math.PI * f * t);
    let r = 0;
    for (const [f, a, ph] of rush) r += a * Math.sin(2 * Math.PI * f * t + ph);
    const wobble = 1 + 0.1 * Math.sin(2 * Math.PI * am1 * t) + 0.05 * Math.sin(2 * Math.PI * am2 * t);
    data[i] = (v + r * wobble) * 0.5;
  }
  normalize(data, 0.6);
  return buf;
}

/** Feeder arm clunk (§5 FEED — identical every pitch). */
export function feedClunk(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.16);
  const noise = lcg(0xfeed);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const thump = Math.sin(2 * Math.PI * (82 - 30 * t) * t) * Math.exp(-t / 0.045);
    const rattle = noise() * Math.exp(-t / 0.02);
    data[i] = thump * 0.9 + rattle * 0.5;
  }
  onePoleLP(data, sr, 900);
  normalize(data, 0.85);
  return buf;
}

/** Release "thwip" — synced to the green light (§5 RELEASE anchor). */
export function releaseThwip(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.1);
  const noise = lcg(0x7717);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] = noise() * Math.exp(-t / 0.03);
  }
  // Downward bandpass sweep: HP floor + sweeping LP reads as "thwip".
  onePoleLP(data, sr, (t) => 3800 - 30000 * t);
  onePoleHP(data, sr, 500);
  normalize(data, 0.8);
  return buf;
}

/** Wood crack — transient + body resonance; 3 detuned round-robin variants. */
export function woodCrack(ctx: AudioContext, variant: number): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.22);
  const noise = lcg(0xc4ac + variant * 7919);
  const det = 1 + (variant - 1) * 0.07;
  const body: Array<[number, number, number]> = [
    [195 * det, 0.8, 0.07],
    [322 * det, 0.55, 0.05],
    [451 * det, 0.3, 0.035],
  ];
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = noise() * Math.exp(-t / 0.01) * 1.4; // the snap
    for (const [f, a, tau] of body) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
    data[i] = v;
  }
  onePoleHP(data, sr, 140);
  normalize(data, 0.95);
  return buf;
}

/** Metal ping — inharmonic partials, the anodized ring; 3 variants. */
export function metalPing(ctx: AudioContext, variant: number): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.55);
  const noise = lcg(0x9196 + variant * 104729);
  const det = 1 + (variant - 1) * 0.045;
  const partials: Array<[number, number, number]> = [
    [1560 * det, 1.0, 0.16],
    [2230 * det, 0.6, 0.12],
    [3170 * det, 0.42, 0.09],
    [4480 * det, 0.28, 0.06],
  ];
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = noise() * Math.exp(-t / 0.004) * 0.8; // contact click
    for (const [f, a, tau] of partials) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
    data[i] = v;
  }
  normalize(data, 0.9);
  return buf;
}

/** PERFECT low-end thump layer (§10). */
export function perfectThump(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.38);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] = Math.sin(2 * Math.PI * (64 - 28 * t) * t) * Math.exp(-t / 0.11);
  }
  normalize(data, 0.9);
  return buf;
}

/** Panel/board confirm click (§10 — the HRD-VR answer). */
export function panelClick(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.04);
  const noise = lcg(0xc11c);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] = noise() * Math.exp(-t / 0.003) + 0.5 * Math.sin(2 * Math.PI * 1250 * t) * Math.exp(-t / 0.01);
  }
  onePoleHP(data, sr, 600);
  normalize(data, 0.7);
  return buf;
}

/** Token clink — two coin partial bursts, staggered. */
export function tokenClink(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.28);
  const noise = lcg(0x70ce);
  const hit = (t: number, f: number) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.045);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = noise() * Math.exp(-t / 0.002) * 0.6;
    v += hit(t, 2840) * 0.8 + hit(t, 3690) * 0.5;
    if (t > 0.07) {
      const t2 = t - 0.07;
      v += hit(t2, 3120) * 0.55 + hit(t2, 4060) * 0.3;
    }
    data[i] = v;
  }
  normalize(data, 0.75);
  return buf;
}
