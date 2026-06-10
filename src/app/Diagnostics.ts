/**
 * F3 diagnostics (§Inputs output g): fps, frame time, input→judgment latency,
 * plus renderer.info counters (M1 E4 — draw calls / triangles / GPU memory
 * proxies, continuously observable against the §12 scene budgets).
 */
export class Diagnostics {
  visible = false;

  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  lastJudgeLatencyMs = 0;
  maxJudgeLatencyMs = 0;

  private drawCalls = 0;
  private triangles = 0;
  private geometries = 0;
  private textures = 0;

  private el: HTMLDivElement;
  private lastDraw = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'f3';
    this.el.style.cssText =
      'position:fixed;top:8px;right:8px;padding:8px 10px;background:rgba(0,0,0,.75);' +
      'color:#7fff7f;font:12px/1.5 monospace;white-space:pre;display:none;z-index:30;' +
      'border:1px solid #2a2;border-radius:4px;pointer-events:none';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  setRenderInfo(info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } }): void {
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.geometries = info.memory.geometries;
    this.textures = info.memory.textures;
  }

  frame(now: number): void {
    if (this.lastFrameAt > 0) {
      this.frameTimes.push(now - this.lastFrameAt);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
    this.lastFrameAt = now;
    if (this.visible && now - this.lastDraw > 250) {
      this.lastDraw = now;
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
      const fps = avg > 0 ? 1000 / avg : 0;
      this.el.textContent =
        `fps            ${fps.toFixed(1)}\n` +
        `frame time     ${avg.toFixed(2)} ms (p99 ${p99.toFixed(2)})\n` +
        `judge latency  ${this.lastJudgeLatencyMs.toFixed(3)} ms\n` +
        `judge max      ${this.maxJudgeLatencyMs.toFixed(3)} ms\n` +
        `draw calls     ${this.drawCalls}\n` +
        `triangles      ${(this.triangles / 1000).toFixed(1)}k\n` +
        `geo/tex        ${this.geometries}/${this.textures}`;
    }
  }

  recordJudgeLatency(ms: number): void {
    this.lastJudgeLatencyMs = ms;
    if (ms > this.maxJudgeLatencyMs) this.maxJudgeLatencyMs = ms;
  }
}
