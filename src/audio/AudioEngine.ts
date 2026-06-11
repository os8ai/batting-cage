import * as THREE from 'three';
import { TIERS } from '../core/constants';
import type { TierMph } from '../core/types';
import { clampVolumes, DEFAULT_VOLUMES, type Volumes } from './buses';
import type { CueTrigger } from './cueMap';
import {
  backstopThud,
  boardTick,
  countUpLoop,
  feedClunk,
  frameClang,
  guardRattle,
  medalStamp,
  metalPing,
  netRustle,
  panelClick,
  perfectThump,
  releaseThwip,
  roomTone,
  tokenClink,
  turfBounce,
  turfRollLoop,
  unlockKlaxon,
  whiffSwish,
  whirrLoop,
  whooshLoop,
  woodCrack,
} from './synth';

/** Round-robin pool of PositionalAudio nodes at one spatial anchor (§10). */
class Emitter {
  readonly object = new THREE.Object3D();
  readonly pool: THREE.PositionalAudio[] = [];
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

/** Roving one-shot pool: each voice has its own Object3D so concurrent
 * impacts sound from their own positions (M2 §10 spatial one-shots). */
class RovingEmitter {
  readonly group = new THREE.Group();
  readonly voices: Array<{ holder: THREE.Object3D; audio: THREE.PositionalAudio }> = [];
  private next = 0;

  constructor(listener: THREE.AudioListener, size: number, refDistance: number) {
    for (let i = 0; i < size; i++) {
      const holder = new THREE.Object3D();
      const audio = new THREE.PositionalAudio(listener);
      audio.setRefDistance(refDistance);
      audio.setRolloffFactor(1.1);
      holder.add(audio);
      this.group.add(holder);
      this.voices.push({ holder, audio });
    }
  }

  playAt(buffer: AudioBuffer, x: number, y: number, z: number, volume = 1, rate = 1): void {
    const v = this.voices[this.next]!;
    this.next = (this.next + 1) % this.voices.length;
    v.holder.position.set(x, y, z);
    if (v.audio.isPlaying) v.audio.stop();
    v.audio.setBuffer(buffer);
    v.audio.setVolume(volume);
    v.audio.setPlaybackRate(rate);
    v.audio.play();
  }
}

/**
 * One splash-unlocked AudioContext; all cues are synthesized buffers played
 * through three.js PositionalAudio (§How: Web Audio directly, no Howler).
 * M2 completes the §10 set: a roving impact-emitter pool lands rustles/thuds/
 * clangs at their true event positions, the ball emitter tracks the rendered
 * ball carrying the whoosh loop with MANUAL doppler (browsers removed
 * PannerNode doppler) and the turf roll loop, and the room-tone ambience bed
 * starts at unlock on its own bus gain.
 */
export class AudioEngine {
  readonly listener = new THREE.AudioListener();
  /** Spatial anchors — main positions these in the scene. */
  readonly machineAnchor: Emitter;
  readonly plateAnchor: Emitter;
  readonly panelAnchor: Emitter;
  readonly boardAnchor: Emitter;
  /** Roving one-shots (impact payload positions). */
  readonly impacts: RovingEmitter;
  /** Follows the rendered ball (main updates per frame). */
  readonly ballAnchor = new THREE.Object3D();

  private whirr: THREE.PositionalAudio;
  private whoosh: THREE.PositionalAudio;
  private roll: THREE.PositionalAudio;
  private room: THREE.Audio;
  /** Looping count-up ticks on the board anchor (§10 RECAP). */
  private countUp: THREE.PositionalAudio;
  private whirrTierRate = 1;
  private unlocked = false;
  private muted = false;
  /** §10 buses: Master (listener) / SFX / Ambience (ESC sliders + M mute). */
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private rr = 0; // round-robin counter for contact/rustle variants
  private dopplerRate = 1;
  private prevBallDist = -1;
  private listenerPos = new THREE.Vector3();
  private ballPos = new THREE.Vector3();

  private bufs: {
    whirr?: AudioBuffer;
    clunk?: AudioBuffer;
    thwip?: AudioBuffer;
    crack?: AudioBuffer[];
    ping?: AudioBuffer[];
    thump?: AudioBuffer;
    click?: AudioBuffer;
    clink?: AudioBuffer;
    whoosh?: AudioBuffer;
    swish?: AudioBuffer;
    thud?: AudioBuffer;
    rustle?: AudioBuffer[];
    clang?: AudioBuffer;
    rattle?: AudioBuffer;
    bounce?: AudioBuffer;
    rollLoop?: AudioBuffer;
    tick?: AudioBuffer;
    room?: AudioBuffer;
    countUp?: AudioBuffer;
    stamp?: AudioBuffer;
    klaxon?: AudioBuffer;
  } = {};

  constructor() {
    this.machineAnchor = new Emitter(this.listener, 3, 4);
    this.plateAnchor = new Emitter(this.listener, 3, 3);
    this.panelAnchor = new Emitter(this.listener, 2, 2);
    this.boardAnchor = new Emitter(this.listener, 2, 8);
    this.impacts = new RovingEmitter(this.listener, 4, 4);
    this.whirr = new THREE.PositionalAudio(this.listener);
    this.whirr.setRefDistance(5);
    this.whirr.setRolloffFactor(1.1);
    this.machineAnchor.object.add(this.whirr);
    this.whoosh = new THREE.PositionalAudio(this.listener);
    this.whoosh.setRefDistance(2.5);
    this.whoosh.setRolloffFactor(1.4);
    this.roll = new THREE.PositionalAudio(this.listener);
    this.roll.setRefDistance(3);
    this.roll.setRolloffFactor(1.2);
    this.ballAnchor.add(this.whoosh, this.roll);
    this.countUp = new THREE.PositionalAudio(this.listener);
    this.countUp.setRefDistance(8);
    this.countUp.setRolloffFactor(1.1);
    this.boardAnchor.object.add(this.countUp);
    this.room = new THREE.Audio(this.listener); // the Ambience bed, non-spatial
  }

  /** Splash click → resume context + synthesize the full cue set (~ms). */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') await ctx.resume();
    // Bus graph: every voice's gain → SFX bus (or Ambience for the room
    // bed) → listener input; Master rides the listener's own gain.
    this.sfxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.sfxBus.connect(this.listener.getInput());
    this.ambienceBus.connect(this.listener.getInput());
    const toSfx: THREE.Audio<GainNode | PannerNode>[] = [
      ...this.machineAnchor.pool,
      ...this.plateAnchor.pool,
      ...this.panelAnchor.pool,
      ...this.boardAnchor.pool,
      ...this.impacts.voices.map((v) => v.audio),
      this.whirr,
      this.whoosh,
      this.roll,
      this.countUp,
    ];
    for (const a of toSfx) {
      a.gain.disconnect();
      a.gain.connect(this.sfxBus);
    }
    this.room.gain.disconnect();
    this.room.gain.connect(this.ambienceBus);
    this.applyVolumes();
    this.bufs.whirr = whirrLoop(ctx);
    this.bufs.clunk = feedClunk(ctx);
    this.bufs.thwip = releaseThwip(ctx);
    this.bufs.crack = [0, 1, 2].map((v) => woodCrack(ctx, v));
    this.bufs.ping = [0, 1, 2].map((v) => metalPing(ctx, v));
    this.bufs.thump = perfectThump(ctx);
    this.bufs.click = panelClick(ctx);
    this.bufs.clink = tokenClink(ctx);
    this.bufs.whoosh = whooshLoop(ctx);
    this.bufs.swish = whiffSwish(ctx);
    this.bufs.thud = backstopThud(ctx);
    this.bufs.rustle = [0, 1, 2].map((v) => netRustle(ctx, v));
    this.bufs.clang = frameClang(ctx);
    this.bufs.rattle = guardRattle(ctx);
    this.bufs.bounce = turfBounce(ctx);
    this.bufs.rollLoop = turfRollLoop(ctx);
    this.bufs.tick = boardTick(ctx);
    this.bufs.room = roomTone(ctx);
    this.bufs.countUp = countUpLoop(ctx);
    this.bufs.stamp = medalStamp(ctx);
    this.bufs.klaxon = unlockKlaxon(ctx);
    this.unlocked = true;
    // The Ambience bed runs for the whole visit (§10 room tone).
    this.room.setBuffer(this.bufs.room);
    this.room.setLoop(true);
    this.room.setVolume(0.12); // owner playtest: the bed should be felt, not heard
    this.room.play();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** ESC-sheet sliders → buses (clamped; persisted by the caller). */
  setVolumes(v: Partial<Volumes>): Volumes {
    this.volumes = clampVolumes({ ...this.volumes, ...v });
    this.applyVolumes();
    return this.volumes;
  }

  getVolumes(): Volumes {
    return { ...this.volumes };
  }

  private applyVolumes(): void {
    this.listener.setMasterVolume(this.muted ? 0 : this.volumes.master);
    if (this.sfxBus) this.sfxBus.gain.value = this.volumes.sfx;
    if (this.ambienceBus) this.ambienceBus.gain.value = this.volumes.ambience;
  }

  /** ESC pause: suspend the context (silence without tearing the graph). */
  suspend(): void {
    void this.listener.context.suspend();
  }

  resume(): void {
    void this.listener.context.resume();
  }

  /** Tier → whirr playback rate: low & lazy at 40, high & angry at 90 (§5). */
  private tierRate(tier: TierMph): number {
    return 0.75 + TIERS.indexOf(tier) * 0.13;
  }

  /** Tier → whoosh loudness: "louder at higher tiers" (§10). */
  private tierWhooshGain(tier: TierMph): number {
    return 0.14 + TIERS.indexOf(tier) * 0.05;
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
      case 'whooshStart':
        this.whooshStart(this.tierWhooshGain(tier));
        break;
      case 'whooshRebase':
        // Batted flight: the same loop, hotter and a touch higher.
        this.whooshStart(Math.min(0.5, this.tierWhooshGain(tier) * 1.5), 1.12);
        break;
      case 'whooshStop':
        this.fadeStop(this.whoosh, 0.08);
        break;
      case 'whiffSwish':
        this.plateAnchor.play(b.swish!, 0.85);
        break;
      case 'backstopThud':
        this.impacts.playAt(b.thud!, trig.px!, trig.py!, trig.pz!, 0.95);
        break;
      case 'netRustle':
        this.impacts.playAt(b.rustle![this.rr++ % 3]!, trig.px!, trig.py!, trig.pz!, trig.gain ?? 0.7);
        break;
      case 'frameClang':
        this.impacts.playAt(b.clang!, trig.px!, trig.py!, trig.pz!, 0.85);
        break;
      case 'guardRattle':
        this.impacts.playAt(b.rattle!, trig.px!, trig.py!, trig.pz!, 0.85);
        break;
      case 'turfBounce':
        this.impacts.playAt(b.bounce!, trig.px!, trig.py!, trig.pz!, 0.7);
        break;
      case 'rollStart':
        this.rollStart();
        break;
      case 'rollStop':
        this.fadeStop(this.roll, 0.12);
        break;
      case 'boardTick':
        this.boardAnchor.play(b.tick!, 0.6);
        break;
      case 'countUpStart':
        if (b.countUp && !this.countUp.isPlaying) {
          this.countUp.setBuffer(b.countUp);
          this.countUp.setLoop(true);
          this.countUp.setVolume(0.55);
          this.countUp.play();
        }
        break;
      case 'countUpStop':
        this.fadeStop(this.countUp, 0.1);
        break;
      case 'medalStamp':
        this.boardAnchor.play(b.stamp!, 0.95);
        break;
      case 'unlockKlaxon':
        this.boardAnchor.play(b.klaxon!, 0.9);
        break;
    }
  }

  /** Panel/board confirm click — UI-called (§UX audio confirm). */
  confirmClick(): void {
    if (this.unlocked && this.bufs.click) this.panelAnchor.play(this.bufs.click, 0.7);
  }

  /** Locked-pick refusal: the same click, dropped a fourth and damped (§UX). */
  refuseClick(): void {
    if (this.unlocked && this.bufs.click) this.panelAnchor.play(this.bufs.click, 0.5, 0.62);
  }

  /**
   * Per-render-frame: follow the rendered ball and bend the whoosh's
   * playbackRate with the radial velocity toward the listener — manual
   * doppler (clamped ±15%, one-pole smoothed against zipper noise).
   */
  updateBall(ballPos: THREE.Vector3 | null, dt: number): void {
    if (!this.unlocked) return;
    if (ballPos) this.ballAnchor.position.copy(ballPos);
    if (!this.whoosh.isPlaying || dt <= 0) {
      this.prevBallDist = -1;
      return;
    }
    this.listener.getWorldPosition(this.listenerPos);
    this.ballAnchor.getWorldPosition(this.ballPos);
    const dist = this.listenerPos.distanceTo(this.ballPos);
    if (this.prevBallDist >= 0) {
      const radialV = (dist - this.prevBallDist) / dt; // + receding, − approaching
      const target = Math.min(1.15, Math.max(0.85, 1 - radialV / 343));
      this.dopplerRate += (target - this.dopplerRate) * Math.min(1, dt * 10);
      this.whoosh.setPlaybackRate(this.dopplerRate);
    }
    this.prevBallDist = dist;
  }

  private whooshStart(gain: number, rate = 1): void {
    if (!this.bufs.whoosh) return;
    if (this.whoosh.isPlaying) this.whoosh.stop();
    this.whoosh.setBuffer(this.bufs.whoosh);
    this.whoosh.setLoop(true);
    this.dopplerRate = rate;
    this.prevBallDist = -1;
    this.whoosh.setPlaybackRate(rate);
    this.whoosh.play();
    // Quick fade-in so the loop never pops on.
    const g = this.whoosh.gain.gain;
    const now = this.listener.context.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(gain, now + 0.06);
  }

  private rollStart(): void {
    if (!this.bufs.rollLoop || this.roll.isPlaying) return;
    this.roll.setBuffer(this.bufs.rollLoop);
    this.roll.setLoop(true);
    this.roll.setVolume(0.55);
    this.roll.play();
  }

  /** Ramp a looping source out and stop it (click-free). */
  private fadeStop(sound: THREE.PositionalAudio, fadeS: number): void {
    if (!sound.isPlaying) return;
    const now = this.listener.context.currentTime;
    const g = sound.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fadeS);
    setTimeout(() => {
      if (sound.isPlaying) sound.stop();
    }, fadeS * 1000 + 60);
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
