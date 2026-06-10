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

/**
 * Loop-safe noise bed builder: many random-phase sine partials, every
 * frequency an integer number of cycles over the loop — click-free wrap
 * (same construction as the whirr's wheel-rush bed).
 */
function partialBed(
  data: Float32Array,
  sr: number,
  durS: number,
  seed: number,
  count: number,
  fLo: number,
  fHi: number,
  ampOf: (f: number) => number
): void {
  const fit = (f: number) => Math.round(f * durS) / durS;
  const noise = lcg(seed);
  for (let p = 0; p < count; p++) {
    const f = fit(fLo + Math.abs(noise()) * (fHi - fLo));
    const a = ampOf(f) * (0.6 + Math.abs(noise()) * 0.4);
    const ph = noise() * Math.PI;
    for (let i = 0; i < data.length; i++) {
      data[i]! += a * Math.sin((2 * Math.PI * f * i) / sr + ph);
    }
  }
}

/** Ball whoosh loop — wind band, played on the roving ball emitter with
 * manual doppler (gain by tier, §10 "louder at higher tiers"). */
export function whooshLoop(ctx: AudioContext): AudioBuffer {
  const dur = 1.0;
  const { buf, data, sr } = buffer(ctx, dur);
  partialBed(data, sr, dur, 0x3005, 90, 180, 2400, (f) => 18 / (f + 120));
  // Slow loop-safe amplitude wobble so the wind breathes.
  const am = Math.round(2.0 * dur) / dur;
  for (let i = 0; i < data.length; i++) {
    data[i]! *= 1 + 0.25 * Math.sin((2 * Math.PI * am * i) / sr);
  }
  normalize(data, 0.5);
  return buf;
}

/** Whiff swish — the bat through empty air (§10 MISS swing). */
export function whiffSwish(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.32);
  const noise = lcg(0x5a15);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    // Raised-cosine hump: the swing passes the listener mid-sample.
    const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 0.32);
    data[i] = noise() * env * env;
  }
  // Sweep the band up through the swing plane and back down.
  onePoleLP(data, sr, (t) => 700 + 2600 * Math.sin((Math.PI * t) / 0.32));
  onePoleHP(data, sr, 350);
  normalize(data, 0.7);
  return buf;
}

/** Backstop thud — deep and dead (e = 0.10 pad). */
export function backstopThud(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.3);
  const noise = lcg(0xbac5);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const body = Math.sin(2 * Math.PI * (52 - 18 * t) * t) * Math.exp(-t / 0.08);
    const slap = noise() * Math.exp(-t / 0.015);
    data[i] = body * 1.1 + slap * 0.4;
  }
  onePoleLP(data, sr, 420);
  normalize(data, 0.9);
  return buf;
}

/** Net rustle — nylon hiss with a decaying flutter; 3 variants (§10,
 * gain scaled by impact energy at trigger time). */
export function netRustle(ctx: AudioContext, variant: number): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.45);
  const noise = lcg(0x4e7 + variant * 7919);
  const flutterF = 14 + variant * 3.5;
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const flutter = 0.55 + 0.45 * Math.sin(2 * Math.PI * flutterF * t + variant);
    data[i] = noise() * Math.exp(-t / 0.13) * flutter;
  }
  onePoleLP(data, sr, 5200);
  onePoleHP(data, sr, 750);
  normalize(data, 0.8);
  return buf;
}

/** Steel-frame clang — bright inharmonic ring (e = 0.45 upright). */
export function frameClang(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.4);
  const noise = lcg(0xf2a6);
  const partials: Array<[number, number, number]> = [
    [742, 1.0, 0.12],
    [1148, 0.62, 0.09],
    [1690, 0.4, 0.07],
    [2480, 0.22, 0.05],
  ];
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = noise() * Math.exp(-t / 0.005);
    for (const [f, a, tau] of partials) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
    data[i] = v;
  }
  onePoleHP(data, sr, 300);
  normalize(data, 0.85);
  return buf;
}

/** Machine-guard rattle — a flurry of mesh ticks (e = 0.30 guard). */
export function guardRattle(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.35);
  const noise = lcg(0x9a77);
  // Tick train with widening gaps, like loose mesh settling.
  let tickAt = 0;
  let gap = 0.012;
  const ticks: number[] = [];
  while (tickAt < 0.3) {
    ticks.push(tickAt);
    tickAt += gap;
    gap *= 1.35;
  }
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const tk of ticks) {
      if (t >= tk) v += noise() * Math.exp(-(t - tk) / 0.006) * Math.exp(-tk / 0.12);
    }
    v += 0.35 * Math.sin(2 * Math.PI * 320 * t) * Math.exp(-t / 0.04); // cage body knock
    data[i] = v;
  }
  onePoleLP(data, sr, 3200);
  normalize(data, 0.8);
  return buf;
}

/** Turf bounce — short tick + low knock (§10). */
export function turfBounce(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.12);
  const noise = lcg(0x70b0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const knock = Math.sin(2 * Math.PI * (110 - 40 * t) * t) * Math.exp(-t / 0.035);
    const tick = noise() * Math.exp(-t / 0.004);
    data[i] = knock * 0.9 + tick * 0.5;
  }
  onePoleLP(data, sr, 1400);
  normalize(data, 0.75);
  return buf;
}

/** Turf roll loop — low rumble while the ball rolls out (kills on SETTLED). */
export function turfRollLoop(ctx: AudioContext): AudioBuffer {
  const dur = 0.8;
  const { buf, data, sr } = buffer(ctx, dur);
  partialBed(data, sr, dur, 0x2011, 40, 55, 420, (f) => 30 / (f + 60));
  const am = Math.round(9 * dur) / dur;
  for (let i = 0; i < data.length; i++) {
    data[i]! *= 1 + 0.35 * Math.sin((2 * Math.PI * am * i) / sr);
  }
  normalize(data, 0.45);
  return buf;
}

/** Board tick — the dot-matrix page-flip shimmer tick (§10). */
export function boardTick(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.05);
  const noise = lcg(0xb0a2);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    data[i] =
      noise() * Math.exp(-t / 0.004) * 0.5 +
      Math.sin(2 * Math.PI * 1980 * t) * Math.exp(-t / 0.012) * 0.8;
  }
  onePoleHP(data, sr, 900);
  normalize(data, 0.55);
  return buf;
}

/** Room tone — HVAC hum + distant facility air; the Ambience bed (§10,
 * "no music anywhere"). Loop-safe. */
export function roomTone(ctx: AudioContext): AudioBuffer {
  const dur = 2.0;
  const { buf, data, sr } = buffer(ctx, dur);
  const fit = (f: number) => Math.round(f * dur) / dur;
  // 60 Hz electrical hum family, very quiet.
  const hums: Array<[number, number]> = [
    [fit(60), 0.5],
    [fit(120), 0.22],
    [fit(180), 0.1],
  ];
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [f, a] of hums) v += a * Math.sin(2 * Math.PI * f * t);
    data[i] = v;
  }
  // Air-handler noise floor above the hum.
  partialBed(data, sr, dur, 0x4a1c, 70, 90, 900, (f) => 9 / (f + 90));
  normalize(data, 0.35);
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

/** Score count-up tick loop (§10 RECAP) — a rising arpeggio of dot-matrix
 * ticks, loop-safe: tick spacing divides the loop and every partial fits. */
export function countUpLoop(ctx: AudioContext): AudioBuffer {
  const dur = 0.5;
  const { buf, data, sr } = buffer(ctx, dur);
  const ticksPerLoop = 8;
  const tickLen = dur / ticksPerLoop;
  const fit = (f: number) => Math.round(f * tickLen) / tickLen;
  for (let k = 0; k < ticksPerLoop; k++) {
    const f = fit(1500 + 120 * k); // rises across the loop
    const start = Math.round(k * tickLen * sr);
    const n = Math.round(0.03 * sr);
    for (let i = 0; i < n && start + i < data.length; i++) {
      const t = i / sr;
      data[start + i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.01);
    }
  }
  normalize(data, 0.5);
  return buf;
}

/** Medal stamp (§10 ceremony) — a deep press with a bright shimmer tail. */
export function medalStamp(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 0.7);
  const noise = lcg(0x4eda1);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const press = Math.sin(2 * Math.PI * (95 - 40 * t) * t) * Math.exp(-t / 0.09);
    const clank = noise() * Math.exp(-t / 0.015);
    const shimmer =
      (Math.sin(2 * Math.PI * 1318 * t) + 0.7 * Math.sin(2 * Math.PI * 1760 * t) + 0.5 * Math.sin(2 * Math.PI * 2637 * t)) *
      Math.exp(-Math.max(0, t - 0.05) / 0.18) *
      (t > 0.05 ? 0.3 : 0);
    data[i] = press * 1.0 + clank * 0.4 + shimmer;
  }
  onePoleLP(data, sr, 5200);
  normalize(data, 0.88);
  return buf;
}

/** Unlock klaxon (§10 ceremony) — two-tone facility horn with light flash. */
export function unlockKlaxon(ctx: AudioContext): AudioBuffer {
  const { buf, data, sr } = buffer(ctx, 1.1);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const seg = t < 0.42 ? 0 : t < 0.5 ? 1 : 2; // tone, gap, tone
    const f = seg === 0 ? 392 : 523; // G4 → C5
    const on = seg === 1 ? 0 : 1;
    const env = seg === 0 ? Math.min(1, t / 0.02) : Math.min(1, Math.max(0, (t - 0.5) / 0.02));
    const tail = Math.exp(-Math.max(0, t - 0.95) / 0.06);
    const square =
      Math.sin(2 * Math.PI * f * t) +
      0.33 * Math.sin(2 * Math.PI * 3 * f * t) +
      0.2 * Math.sin(2 * Math.PI * 5 * f * t);
    data[i] = square * on * env * tail * 0.8;
  }
  onePoleLP(data, sr, 3600);
  normalize(data, 0.8);
  return buf;
}
