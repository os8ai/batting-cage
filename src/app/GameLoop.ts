import { SIM_DT } from '../core/constants';
import type { CageSim } from '../core/sim';

/**
 * rAF + 120 Hz fixed-dt accumulator (Gaffer pattern, §Architecture). The sim
 * advances only in fixed ticks; render interpolates by the accumulator alpha.
 * Sim time is anchored to performance.now() through `epochMs`, so DOM event
 * timestamps and the pitch schedule share one clock.
 */
export class GameLoop {
  private epochMs = 0;
  private accumulator = 0;
  private lastNowMs = 0;
  private running = false;
  private rafId = 0;
  paused = false;

  constructor(
    private sim: CageSim,
    private render: (alpha: number, nowMs: number) => void,
    private onPostTick?: () => void
  ) {}

  /** Convert a DOM event timestamp (performance.now() domain) to sim time. */
  simTimeOf(domTimeMs: number): number {
    return (domTimeMs - this.epochMs) / 1000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.epochMs = performance.now();
    this.lastNowMs = this.epochMs;
    const frame = (nowMs: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      let dt = (nowMs - this.lastNowMs) / 1000;
      this.lastNowMs = nowMs;
      if (this.paused) return;
      if (dt > 0.25) dt = 0.25; // hitch clamp; epoch re-anchors on resume
      this.accumulator += dt;
      while (this.accumulator >= SIM_DT) {
        this.sim.tick();
        this.accumulator -= SIM_DT;
        this.onPostTick?.();
      }
      this.render(this.accumulator / SIM_DT, nowMs);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Pause on window blur (§Inputs); resume re-anchors the clock so the sim never fast-forwards. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      // sim.t stays where it was; future DOM timestamps must map onto it.
      this.epochMs = performance.now() - this.sim.t * 1000;
      this.lastNowMs = performance.now();
      this.accumulator = 0;
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
