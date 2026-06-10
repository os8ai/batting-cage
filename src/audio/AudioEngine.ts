import * as THREE from 'three';
import { TIERS } from '../core/constants';
import type { TierMph } from '../core/types';
import type { CueTrigger } from './cueMap';
import {
  feedClunk,
  metalPing,
  panelClick,
  perfectThump,
  releaseThwip,
  tokenClink,
  whirrLoop,
  woodCrack,
} from './synth';

/** Round-robin pool of PositionalAudio nodes at one spatial anchor (§10). */
class Emitter {
  readonly object = new THREE.Object3D();
  private pool: THREE.PositionalAudio[] = [];
  private next = 0;

  constructor(listener: THREE.AudioListener, size: number, refDistance: number) {
    for (let i = 0; i < size; i++) {
      const a = new THREE.PositionalAudio(listener);
      a.setRefDistance(refDistance);
      a.setRolloffFactor(1.2);
      this.pool.push(a);
      this.object.add(a);
    }
  }

  play(buffer: AudioBuffer, volume = 1, rate = 1): void {
    const a = this.pool[this.next]!;
    this.next = (this.next + 1) % this.pool.length;
    if (a.isPlaying) a.stop();
    a.setBuffer(buffer);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
  }
}

/**
 * One splash-unlocked AudioContext; all cues are synthesized buffers played
 * through three.js PositionalAudio at the machine / plate / panel anchors
 * (§How: Web Audio directly, no Howler). The whirr loop is the §5 metronome:
 * pitch-shifted per tier, dipping under LOAD, ramping up over the 3 s token
 * spin-up.
 */
export class AudioEngine {
  readonly listener = new THREE.AudioListener();
  /** Spatial anchors — main positions these in the scene. */
  readonly machineAnchor: Emitter;
  readonly plateAnchor: Emitter;
  readonly panelAnchor: Emitter;

  private whirr: THREE.PositionalAudio;
  private whirrTierRate = 1;
  private unlocked = false;
  private muted = false;
  private rr = 0; // round-robin counter for contact variants

  private bufs: {
    whirr?: AudioBuffer;
    clunk?: AudioBuffer;
    thwip?: AudioBuffer;
    crack?: AudioBuffer[];
    ping?: AudioBuffer[];
    thump?: AudioBuffer;
    click?: AudioBuffer;
    clink?: AudioBuffer;
  } = {};

  constructor() {
    this.machineAnchor = new Emitter(this.listener, 3, 4);
    this.plateAnchor = new Emitter(this.listener, 3, 3);
    this.panelAnchor = new Emitter(this.listener, 2, 2);
    this.whirr = new THREE.PositionalAudio(this.listener);
    this.whirr.setRefDistance(5);
    this.whirr.setRolloffFactor(1.1);
    this.machineAnchor.object.add(this.whirr);
  }

  /** Splash click → resume context + synthesize the full cue set (~ms). */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') await ctx.resume();
    this.bufs.whirr = whirrLoop(ctx);
    this.bufs.clunk = feedClunk(ctx);
    this.bufs.thwip = releaseThwip(ctx);
    this.bufs.crack = [0, 1, 2].map((v) => woodCrack(ctx, v));
    this.bufs.ping = [0, 1, 2].map((v) => metalPing(ctx, v));
    this.bufs.thump = perfectThump(ctx);
    this.bufs.click = panelClick(ctx);
    this.bufs.clink = tokenClink(ctx);
    this.unlocked = true;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.listener.setMasterVolume(this.muted ? 0 : 1);
    return this.muted;
  }

  /** Tier → whirr playback rate: low & lazy at 40, high & angry at 90 (§5). */
  private tierRate(tier: TierMph): number {
    return 0.75 + TIERS.indexOf(tier) * 0.13;
  }

  setTier(tier: TierMph): void {
    this.whirrTierRate = this.tierRate(tier);
    if (this.whirr.isPlaying) this.whirr.setPlaybackRate(this.whirrTierRate);
  }

  /** Domain-event cue dispatch (cueMap output — bat voice already resolved). */
  trigger(trig: CueTrigger, tier: TierMph): void {
    if (!this.unlocked) return;
    const b = this.bufs;
    switch (trig.cue) {
      case 'tokenClink':
        this.machineAnchor.play(b.clink!, 0.8);
        break;
      case 'whirrStart':
        this.whirrStart(tier);
        break;
      case 'whirrDip':
        this.whirrDip();
        break;
      case 'whirrStop':
        this.whirrStop();
        break;
      case 'feedClunk':
        this.machineAnchor.play(b.clunk!, 0.9);
        break;
      case 'releaseThwip':
        this.machineAnchor.play(b.thwip!, 0.85);
        break;
      case 'contactWood':
        this.plateAnchor.play(b.crack![this.rr++ % 3]!, 1);
        break;
      case 'contactMetal':
        this.plateAnchor.play(b.ping![this.rr++ % 3]!, 0.9);
        break;
      case 'perfectThump':
        this.plateAnchor.play(b.thump!, 0.9);
        break;
    }
  }

  /** Panel/board confirm click — UI-called (§UX audio confirm). */
  confirmClick(): void {
    if (this.unlocked && this.bufs.click) this.panelAnchor.play(this.bufs.click, 0.7);
  }

  /** Token spin-up: wheels rise to tier pitch over 3 s (§10). */
  private whirrStart(tier: TierMph): void {
    if (!this.bufs.whirr) return;
    this.whirrTierRate = this.tierRate(tier);
    if (this.whirr.isPlaying) this.whirr.stop();
    this.whirr.setBuffer(this.bufs.whirr);
    this.whirr.setLoop(true);
    this.whirr.setVolume(0.55);
    this.whirr.setPlaybackRate(0.5);
    this.whirr.play();
    const now = this.listener.context.currentTime;
    const src = this.whirr.source as AudioBufferSourceNode;
    src.playbackRate.cancelScheduledValues(now);
    src.playbackRate.setValueAtTime(0.5, now);
    src.playbackRate.linearRampToValueAtTime(this.whirrTierRate, now + 3.0);
    const g = this.whirr.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0.0, now);
    g.linearRampToValueAtTime(1.0, now + 2.0);
  }

  /** LOAD: whirr dips under load (§5 metronome cue). */
  private whirrDip(): void {
    if (!this.whirr.isPlaying || !this.whirr.source) return;
    const now = this.listener.context.currentTime;
    const g = this.whirr.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.5, now + 0.07);
    g.linearRampToValueAtTime(1.0, now + 0.45);
    const r = (this.whirr.source as AudioBufferSourceNode).playbackRate;
    r.cancelScheduledValues(now);
    r.setValueAtTime(this.whirrTierRate, now);
    r.linearRampToValueAtTime(this.whirrTierRate * 0.93, now + 0.07);
    r.linearRampToValueAtTime(this.whirrTierRate, now + 0.5);
  }

  private whirrStop(): void {
    if (!this.whirr.isPlaying) return;
    const now = this.listener.context.currentTime;
    const g = this.whirr.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 1.4);
    const sound = this.whirr;
    setTimeout(() => {
      if (sound.isPlaying) sound.stop();
      sound.setVolume(0.55);
    }, 1500);
  }
}
