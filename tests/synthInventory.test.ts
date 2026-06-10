import { describe, expect, it } from 'vitest';
import * as synth from '../src/audio/synth';

/**
 * M2 E4 — full §10 audio set: every cue name resolves to a synthesized
 * buffer that is finite, non-silent, and (for loops) click-free at the wrap.
 * Runs headless against a minimal AudioContext stand-in (synthesis is pure
 * math over createBuffer).
 *
 * M3-deferred §10 rows (recorded, not stubbed): score count-up, medal stamp,
 * unlock klaxon — they land with the board pages/events that trigger them.
 */
class FakeBuffer {
  private data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(_ch: number): Float32Array {
    return this.data;
  }
}

const ctx = {
  sampleRate: 48000,
  createBuffer: (ch: number, len: number, sr: number) => new FakeBuffer(ch, len, sr),
} as unknown as AudioContext;

/** §10 rows shipped by M2 → their synth source (variants sampled at 0). */
const SYNTHS: Record<string, () => AudioBuffer> = {
  whirrLoop: () => synth.whirrLoop(ctx),
  feedClunk: () => synth.feedClunk(ctx),
  releaseThwip: () => synth.releaseThwip(ctx),
  woodCrack: () => synth.woodCrack(ctx, 0),
  metalPing: () => synth.metalPing(ctx, 0),
  perfectThump: () => synth.perfectThump(ctx),
  panelClick: () => synth.panelClick(ctx),
  tokenClink: () => synth.tokenClink(ctx),
  whooshLoop: () => synth.whooshLoop(ctx),
  whiffSwish: () => synth.whiffSwish(ctx),
  backstopThud: () => synth.backstopThud(ctx),
  netRustle: () => synth.netRustle(ctx, 0),
  frameClang: () => synth.frameClang(ctx),
  guardRattle: () => synth.guardRattle(ctx),
  turfBounce: () => synth.turfBounce(ctx),
  turfRollLoop: () => synth.turfRollLoop(ctx),
  boardTick: () => synth.boardTick(ctx),
  roomTone: () => synth.roomTone(ctx),
};

const LOOPS = ['whirrLoop', 'whooshLoop', 'turfRollLoop', 'roomTone'];

describe('§10 synth inventory (E4)', () => {
  for (const [name, make] of Object.entries(SYNTHS)) {
    it(`${name}: finite, audible, normalized`, () => {
      const buf = make();
      const data = buf.getChannelData(0);
      expect(data.length).toBeGreaterThan(100);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(data[i])).toBe(true);
        peak = Math.max(peak, Math.abs(data[i]!));
      }
      expect(peak).toBeGreaterThan(0.2); // audible
      expect(peak).toBeLessThanOrEqual(1.0); // never clips
    });
  }

  for (const name of LOOPS) {
    it(`${name}: loop wrap is click-free`, () => {
      const data = SYNTHS[name]!().getChannelData(0);
      // The wrap step must be on the order of an ordinary sample step.
      let maxStep = 0;
      for (let i = 1; i < data.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(data[i]! - data[i - 1]!));
      }
      const wrapStep = Math.abs(data[0]! - data[data.length - 1]!);
      expect(wrapStep).toBeLessThanOrEqual(maxStep * 1.5 + 1e-4);
    });
  }

  it('variants are distinct (round-robin reads as different hits)', () => {
    for (const make of [synth.woodCrack, synth.metalPing, synth.netRustle]) {
      const a = make(ctx, 0).getChannelData(0);
      const b = make(ctx, 1).getChannelData(0);
      let diff = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i]! - b[i]!);
      expect(diff).toBeGreaterThan(1);
    }
  });
});
