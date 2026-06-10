import * as THREE from 'three';
import { last50Trend } from '../../core/rules/stats';
import type { Medal } from '../../core/types';
import { decodeSwing, TIER_KEYS, type SaveV1 } from '../../persist/schema';

/**
 * §4 stats monitor: 32-inch LCD on the cage-side wall, TAB camera target,
 * ordinary LCD look (not dot-matrix). M3 renders the §9 dense pages from the
 * save snapshot — PBS / AVERAGES / MEDALS / SESSIONS / TREND (last-50 |ε|
 * sparkline) — and TAB cycles through them while focused. The stat locker
 * NEVER gates anything (§8, locked).
 */
export type MonitorPage = 'PBS' | 'AVERAGES' | 'MEDALS' | 'SESSIONS' | 'TREND';

export const MONITOR_PAGES: readonly MonitorPage[] = ['PBS', 'AVERAGES', 'MEDALS', 'SESSIONS', 'TREND'];

const W = 512;
const H = 288;

const MEDAL_COLOR: Record<Medal, string> = {
  bronze: '#c08550',
  silver: '#c9d2dc',
  gold: '#ecc94b',
  platinum: '#aef3e7',
};

export class StatsMonitor {
  readonly group = new THREE.Group();
  readonly screen: THREE.Mesh;

  page: MonitorPage = 'PBS';

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private save: SaveV1 | null = null;

  constructor() {
    // 32" 16:9 ≈ 0.71 × 0.40 m.
    const w = 0.71;
    const h = 0.4;
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.4 })
    );
    this.group.add(bezel);

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.screen.position.z = 0.028;
    this.group.add(this.screen);
    this.render();
  }

  /** The save snapshot the pages render from (boot + after each write). */
  setSave(save: SaveV1): void {
    this.save = save;
    this.render();
  }

  /** TAB while focused: cycle PBS → AVERAGES → MEDALS → SESSIONS → TREND. */
  cycle(): MonitorPage {
    const i = MONITOR_PAGES.indexOf(this.page);
    this.page = MONITOR_PAGES[(i + 1) % MONITOR_PAGES.length]!;
    this.render();
    return this.page;
  }

  showPage(page: MonitorPage): void {
    this.page = page;
    this.render();
  }

  // -- rendering --------------------------------------------------------------

  private frame(title: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#04070c';
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(256, 144, 20, 256, 144, 300);
    grad.addColorStop(0, 'rgba(28,52,72,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9fd2e8';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(title, 18, 32);
    ctx.strokeStyle = '#1d3a4d';
    ctx.beginPath();
    ctx.moveTo(18, 42);
    ctx.lineTo(W - 18, 42);
    ctx.stroke();
    // Page dots.
    MONITOR_PAGES.forEach((p, i) => {
      ctx.fillStyle = p === this.page ? '#9fd2e8' : '#27445a';
      ctx.beginPath();
      ctx.arc(W - 90 + i * 16, 28, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private render(): void {
    if (!this.save) {
      this.frame('STATS');
      this.ctx.fillStyle = '#557789';
      this.ctx.font = '20px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('NO CAREER YET', W / 2, H / 2 + 10);
      this.texture.needsUpdate = true;
      return;
    }
    switch (this.page) {
      case 'PBS':
        this.renderPbs();
        break;
      case 'AVERAGES':
        this.renderAverages();
        break;
      case 'MEDALS':
        this.renderMedals();
        break;
      case 'SESSIONS':
        this.renderSessions();
        break;
      case 'TREND':
        this.renderTrend();
        break;
    }
    this.texture.needsUpdate = true;
  }

  private rowY(i: number): number {
    return 78 + i * 32;
  }

  private renderPbs(): void {
    const ctx = this.ctx;
    this.frame('PERSONAL BESTS');
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#557789';
    ctx.fillText('MPH   SCORE   CARRY    EV', 24, 60);
    ctx.font = '18px monospace';
    TIER_KEYS.forEach((k, i) => {
      const t = this.save!.tiers[k];
      const y = this.rowY(i);
      ctx.fillStyle = t.unlocked ? '#cfe8f5' : '#3a5161';
      const pbs = t.pbs;
      const line =
        pbs.bestRoundScore > 0
          ? `${k.padEnd(5)} ${String(pbs.bestRoundScore).padStart(5)}  ${String(pbs.longestCarryFt).padStart(4)} FT  ${pbs.hardestEvMph.toFixed(0).padStart(3)}`
          : `${k.padEnd(5)}     -       -     -`;
      ctx.fillText(line, 24, y);
    });
  }

  private renderAverages(): void {
    const ctx = this.ctx;
    this.frame('AVERAGES');
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#557789';
    ctx.fillText('MPH   RNDS  MED|E|  CONTACT  HARD', 24, 60);
    ctx.font = '18px monospace';
    TIER_KEYS.forEach((k, i) => {
      const a = this.save!.tiers[k].lifetimeAverages;
      const y = this.rowY(i);
      ctx.fillStyle = a.rounds > 0 ? '#cfe8f5' : '#3a5161';
      const line =
        a.rounds > 0
          ? `${k.padEnd(5)} ${String(a.rounds).padStart(4)}  ${a.medianAbsEpsMs === null ? '   -' : (a.medianAbsEpsMs.toFixed(0) + 'MS').padStart(5)}  ${(a.contactPct.toFixed(0) + '%').padStart(6)}  ${(a.hardHitPct.toFixed(0) + '%').padStart(4)}`
          : `${k.padEnd(5)}    -      -       -     -`;
      ctx.fillText(line, 24, y);
    });
  }

  private renderMedals(): void {
    const ctx = this.ctx;
    this.frame('MEDALS');
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#557789';
    ctx.fillText('MPH   BRZ  SLV  GLD  PLT   CLUBS', 24, 60);
    TIER_KEYS.forEach((k, i) => {
      const t = this.save!.tiers[k];
      const y = this.rowY(i);
      ctx.font = '18px monospace';
      ctx.fillStyle = t.unlocked ? '#cfe8f5' : '#3a5161';
      ctx.fillText(k, 24, y);
      (['bronze', 'silver', 'gold', 'platinum'] as Medal[]).forEach((m, j) => {
        const x = 90 + j * 55;
        if (t.medals[m]) {
          ctx.fillStyle = MEDAL_COLOR[m];
          ctx.beginPath();
          ctx.arc(x, y - 6, 9, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#27445a';
          ctx.beginPath();
          ctx.arc(x, y - 6, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      ctx.font = '15px monospace';
      ctx.fillStyle = '#7fb3c8';
      ctx.fillText(t.distanceClubs.map((c) => `${c}`).join(' '), 320, y);
    });
  }

  private renderSessions(): void {
    const ctx = this.ctx;
    this.frame('SESSIONS');
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#557789';
    ctx.fillText('DATE        RNDS  BEST   MED|E|', 24, 60);
    ctx.font = '17px monospace';
    const rows = this.save!.sessions.slice(-6).reverse();
    if (rows.length === 0) {
      ctx.fillStyle = '#3a5161';
      ctx.fillText('NO SESSIONS YET', 24, this.rowY(1));
      return;
    }
    rows.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#cfe8f5' : '#7fb3c8';
      const eps = s.medianAbsEpsMs === null ? '  -' : `${s.medianAbsEpsMs.toFixed(0)}MS`;
      ctx.fillText(
        `${s.dateISO}  ${String(s.rounds).padStart(3)}  ${String(s.bestScore).padStart(5)}  ${eps.padStart(5)}`,
        24,
        this.rowY(i)
      );
    });
  }

  private renderTrend(): void {
    const ctx = this.ctx;
    this.frame('TIMING TREND · LAST 50');
    const eps = this.save!.swingLog
      .map((t) => decodeSwing(t))
      .filter((s) => s.epsMs !== null)
      .map((s) => Math.abs(s.epsMs!));
    const trend = last50Trend(eps);
    if (trend.length < 2) {
      ctx.fillStyle = '#3a5161';
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SWING MORE TO SEE A TREND', W / 2, H / 2 + 14);
      return;
    }
    const x0 = 40;
    const x1 = W - 30;
    const y0 = 240;
    const y1 = 70;
    const max = Math.max(...trend, 60);
    // Axis + reference line at the tier-40 PERFECT window (40 ms).
    ctx.strokeStyle = '#1d3a4d';
    ctx.beginPath();
    ctx.moveTo(x0, y1 - 8);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.stroke();
    ctx.strokeStyle = '#244e3d';
    ctx.setLineDash([4, 4]);
    const yRef = y0 - (40 / max) * (y0 - y1);
    ctx.beginPath();
    ctx.moveTo(x0, yRef);
    ctx.lineTo(x1, yRef);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#244e3d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('40MS', x1 - 36, yRef - 5);
    // The sparkline itself.
    ctx.strokeStyle = '#9fd2e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    trend.forEach((v, i) => {
      const x = x0 + (i / (trend.length - 1)) * (x1 - x0);
      const y = y0 - (Math.min(v, max) / max) * (y0 - y1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#7fb3c8';
    ctx.font = '14px monospace';
    ctx.fillText(`NOW ${trend[trend.length - 1]!.toFixed(0)} MS`, x0 + 4, y1);
  }
}
