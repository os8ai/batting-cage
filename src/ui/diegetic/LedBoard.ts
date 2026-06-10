import * as THREE from 'three';
import { DEG_TO_RAD, FT_TO_M } from '../../core/constants';
import type { DomainEvent, Grade, Medal, SwingRecord } from '../../core/types';
import { GLYPH_H, GLYPH_W, glyph, textWidthCells } from './dotFont';
import {
  BoardPageMachine,
  COUNT_UP_S,
  type AttractData,
  type BoardPage,
  type BoardSignal,
} from './boardPages/pageMachine';

/**
 * The LED distance board (§4/§9): 8 × 4.5 ft dot-matrix face on the far
 * facility wall above the machine, bottom edge 8 ft up, tilted 8° toward the
 * plate. Rendered as a 1152×640 canvas texture; logical matrix 72×40 cells.
 * Amber-on-near-black, refresh shimmer, glass glare. The canvas re-renders
 * only on page changes — plus a ~12 Hz repaint during the RECAP count-up
 * (≈24 repaints over the 2 s envelope; the M1 budget concern was per-frame).
 */
const COLS = 72;
const ROWS = 40;
const CANVAS_W = 1152; // 16 px per cell at 72 cols
const CANVAS_H = 640;
const CELL = CANVAS_W / COLS;

const AMBER = [255, 176, 0] as const;

const COUNT_UP_REPAINT_HZ = 12;

const GRADE_LETTER: Record<Grade, string> = {
  PERFECT: 'P',
  GREAT: 'G',
  GOOD: 'O',
  FOUL: 'F',
  MISS: 'M',
  TAKE: 'T',
};

const MEDAL_WORD: Record<Medal, string> = {
  bronze: 'BRONZE',
  silver: 'SILVER',
  gold: 'GOLD',
  platinum: 'PLATINUM',
};

export class LedBoard {
  /** Board face + glass + housing, positioned per §4. */
  readonly group = new THREE.Group();
  /** Bloom target. */
  readonly face: THREE.Mesh;
  /** The §9 page machine — main feeds initials input / context through it. */
  readonly machine = new BoardPageMachine();

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private faceMat: THREE.MeshBasicMaterial;
  /** Remaining seconds of the reveal-beat brightness pop (M2). */
  private popLeftS = 0;
  private unlit: HTMLCanvasElement;
  private lastCountPaintT = -1;
  /** One-shot import/board message overriding the page (ESC sheet feedback). */
  private noticeLine: string | null = null;
  private noticeUntilSimT = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.unlit = this.makeUnlitLayer();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const wFt = 8;
    const hFt = 4.5;
    const w = wFt * FT_TO_M;
    const h = hFt * FT_TO_M;

    // Housing: dark cabinet behind the face.
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.4 })
    );
    cabinet.position.z = -0.1;
    this.group.add(cabinet);

    this.faceMat = new THREE.MeshBasicMaterial({ map: this.texture });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.faceMat);
    this.group.add(this.face);

    // Glass glare: faint static gradient sheet just in front of the face.
    const glare = document.createElement('canvas');
    glare.width = 128;
    glare.height = 128;
    const gctx = glare.getContext('2d')!;
    const grad = gctx.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.16)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glareTex = new THREE.CanvasTexture(glare);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: glareTex, transparent: true, opacity: 0.5, depthWrite: false })
    );
    glass.position.z = 0.012;
    this.group.add(glass);

    this.renderPage();
  }

  /** Place per §4: above the machine on the far wall, tilted 8° to the plate. */
  placeAt(z: number): void {
    const bottomFt = 8;
    this.group.position.set(0, bottomFt * FT_TO_M + (4.5 / 2) * FT_TO_M, z);
    this.group.rotation.y = Math.PI; // face the plate (-z side)
    this.group.rotation.x = -8 * DEG_TO_RAD;
  }

  onEvent(e: DomainEvent): void {
    if (this.machine.handle(e)) this.renderPage();
    // The reveal beat (M2): card flips and the recap land with a brightness
    // pop — a 120 ms color-scalar envelope, zero canvas cost.
    if (e.type === 'BOARD_REVEAL' || e.type === 'ROUND_END') this.popLeftS = 0.12;
  }

  /**
   * Sim-clock drive (main calls once per frame with sim.t): walks the page
   * machine's post-round/attract sequences and repaints the count-up at
   * ~12 Hz. Returns the signals so main can map them to §10 ceremony cues.
   */
  drive(simT: number): BoardSignal[] {
    if (this.noticeLine !== null && simT >= this.noticeUntilSimT) {
      this.noticeLine = null;
      this.renderPage();
    }
    const signals = this.machine.advance(simT);
    let repaint = signals.length > 0;
    const page = this.machine.page;
    if (page.kind === 'RECAP' && simT < page.start + COUNT_UP_S + 0.2) {
      if (simT - this.lastCountPaintT >= 1 / COUNT_UP_REPAINT_HZ) {
        this.lastCountPaintT = simT;
        repaint = true;
      }
    }
    if (repaint) this.renderPage(simT);
    for (const s of signals) {
      if (s.kind === 'CEREMONY' || s.kind === 'COUNT_UP_END') this.popLeftS = 0.12;
    }
    return signals;
  }

  /** INITIALS entry passthrough (arrows + SPACE, §9). */
  initialsInput(input: 'up' | 'down' | 'left' | 'right' | 'confirm', simT: number): BoardSignal[] {
    const signals = this.machine.initialsInput(input, simT);
    if (signals.length > 0) this.renderPage(simT);
    return signals;
  }

  setAttractData(data: AttractData): void {
    this.machine.setAttractData(data);
    if (this.machine.page.kind === 'ATTRACT' || this.machine.page.kind === 'IDLE') this.renderPage();
  }

  /** Board message line (save import refusals etc., §14.18) — brief override. */
  showNotice(line: string, simT: number, holdS = 4): void {
    this.noticeLine = line.toUpperCase().slice(0, 12);
    this.noticeUntilSimT = simT + holdS;
    this.renderPage(simT);
    this.popLeftS = 0.12;
  }

  /** Refresh shimmer — cheap per-frame color wobble, no canvas redraw. */
  update(timeS: number, dt = 0): void {
    let s = 1.55 + 0.07 * Math.sin(timeS * 47.0) * Math.sin(timeS * 9.3);
    if (this.popLeftS > 0) {
      this.popLeftS = Math.max(0, this.popLeftS - dt);
      s *= 1 + 0.5 * (this.popLeftS / 0.12);
    }
    this.faceMat.color.setScalar(s);
  }

  // -- dot rendering ----------------------------------------------------------

  private makeUnlitLayer(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(60,46,18,0.5)';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.beginPath();
        ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c;
  }

  private dot(col: number, row: number, intensity: number): void {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    const cx = col * CELL + CELL / 2;
    const cy = row * CELL + CELL / 2;
    const [r, g, b] = AMBER;
    const grad = this.ctx.createRadialGradient(cx, cy, CELL * 0.05, cx, cy, CELL * 0.62);
    grad.addColorStop(0, `rgba(${r},${g},${b},${intensity})`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},${0.75 * intensity})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(cx - CELL * 0.62, cy - CELL * 0.62, CELL * 1.24, CELL * 1.24);
  }

  private text(colLeft: number, rowTop: number, str: string, scale = 1, intensity = 1): void {
    let cx = colLeft;
    for (const ch of str) {
      const rowsArr = glyph(ch);
      for (let gy = 0; gy < GLYPH_H; gy++) {
        const line = rowsArr[gy]!;
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (line[gx] !== '1') continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              this.dot(cx + gx * scale + sx, rowTop + gy * scale + sy, intensity);
            }
          }
        }
      }
      cx += (GLYPH_W + 1) * scale;
    }
  }

  private centered(rowTop: number, str: string, scale = 1, intensity = 1): void {
    const w = textWidthCells(str, scale);
    this.text(Math.floor((COLS - w) / 2), rowTop, str, scale, intensity);
  }

  // -- pages ------------------------------------------------------------------

  private msReadout(r: SwingRecord): string {
    if (r.epsMs === null) return '';
    return `${r.epsMs >= 0 ? 'LATE' : 'EARLY'} ${Math.abs(Math.round(r.epsMs))} MS`;
  }

  private renderPage(simT = 0): void {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.ctx.drawImage(this.unlit, 0, 0);
    if (this.noticeLine !== null) {
      this.centered(8, 'SAVE', 2, 0.9);
      this.centered(24, this.noticeLine, 1, 0.95);
      this.texture.needsUpdate = true;
      return;
    }
    const p: BoardPage = this.machine.page;
    switch (p.kind) {
      case 'IDLE':
        this.centered(8, 'BATTING CAGE', 1, 0.85);
        this.centered(22, 'INSERT TOKEN', 1, 0.55);
        break;
      case 'LIVE':
        if (p.spinup) {
          this.centered(8, `${p.tier} MPH`, 2);
          this.centered(26, 'SPINNING UP', 1, 0.7);
        } else if (this.machine.coachLine !== null) {
          this.centered(1, `PITCH ${p.pitch}/10`, 1, 0.7);
          const [l1, l2] = splitCoach(this.machine.coachLine);
          this.centered(14, l1, 1, 1);
          this.centered(24, l2, 1, 1);
        } else {
          this.centered(2, 'PITCH', 1, 0.7);
          this.centered(11, `${p.pitch}/10`, 2);
          this.centered(30, `SCORE ${p.score}`, 1, 0.85);
        }
        break;
      case 'SWING_CARD': {
        const r = p.record;
        this.centered(1, `${r.carryFt} FT`, 2);
        this.centered(16, `${Math.round(r.evMph!)}EV ${Math.round(r.laDeg!)}LA`, 1, 0.9);
        const sprayWord = r.spray === 'CENTER' && r.grade === 'PERFECT' ? 'CTR' : r.spray!;
        this.centered(24, `${r.grade} ${sprayWord}`, 1, 0.9);
        this.centered(32, this.msReadout(r), 1, 0.75);
        break;
      }
      case 'NO_DIST_CARD': {
        const r = p.record;
        this.centered(6, r.grade, 2);
        if (r.epsMs !== null) this.centered(24, this.msReadout(r), 1, 0.8);
        break;
      }
      case 'RECAP': {
        // 10-cell strip: grade letters + carry bars (§9).
        for (let i = 0; i < 10; i++) {
          const x = 1 + i * 7;
          const r = p.records[i];
          if (!r) continue;
          this.text(x, 0, GRADE_LETTER[r.grade], 1, r.grade === 'PERFECT' ? 1 : 0.75);
          const carry = r.carryFt ?? 0;
          const h = Math.min(6, Math.round((carry / 450) * 6));
          for (let b = 0; b < h; b++) {
            for (let c = 0; c < 3; c++) this.dot(x + 1 + c, 13 - b, 0.8);
          }
        }
        // Score count-up (12 Hz repaints driven by drive()).
        this.centered(17, `${this.machine.countUpValue(simT)}`, 2);
        if (simT >= p.start + COUNT_UP_S && p.medal !== null) {
          this.centered(33, `${MEDAL_WORD[p.medal]} MEDAL`, 1, 1);
        }
        break;
      }
      case 'CEREMONY':
        switch (p.item.kind) {
          case 'PB': {
            this.centered(6, 'NEW PB', 2);
            const v = p.item.value;
            const line = p.item.pb === 'SCORE' ? `${v}` : p.item.pb === 'CARRY' ? `${v} FT` : `${Math.round(v)} EV`;
            this.centered(26, line, 1, 0.95);
            break;
          }
          case 'CLUB':
            this.centered(6, `${p.item.ft} FT`, 2);
            this.centered(26, `CLUB · ${p.item.tier} MPH`, 1, 0.95);
            break;
          case 'UNLOCK':
            this.centered(6, `${p.item.tier} MPH`, 2);
            this.centered(26, 'UNLOCKED', 1, 1);
            break;
        }
        break;
      case 'INITIALS': {
        this.centered(1, 'TOP 5 ENTRY', 1, 0.8);
        const letters = p.slots.map((i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]!).join(' ');
        const w = textWidthCells(letters, 2);
        const left = Math.floor((COLS - w) / 2);
        this.text(left, 12, letters, 2);
        // Cursor underline beneath the active slot.
        const slotLeft = left + p.cursor * ((GLYPH_W + 1) * 2 * 2);
        for (let c = 0; c < GLYPH_W * 2; c++) this.dot(slotLeft + c, 28, 1);
        this.centered(33, 'SPACE = OK', 1, 0.6);
        break;
      }
      case 'ROUND_OVER':
        this.centered(2, 'ROUND OVER', 1, 0.9);
        this.centered(12, `${p.score}`, 2);
        if (p.medal !== null) this.centered(28, `${MEDAL_WORD[p.medal]} MEDAL`, 1, 0.9);
        this.centered(35, 'INSERT TOKEN', 1, 0.6);
        break;
      case 'ATTRACT':
        this.renderAttract(p);
        break;
    }
    this.texture.needsUpdate = true;
  }

  private renderAttract(p: Extract<BoardPage, { kind: 'ATTRACT' }>): void {
    const data = this.machine.attractData;
    if (p.variant === 1) {
      this.centered(6, 'BATTING CAGE', 1, 0.9);
      this.centered(18, 'INSERT TOKEN', 1, 0.75);
      this.centered(28, 'PRESS SPACE', 1, 0.55);
      return;
    }
    if (p.variant === 2) {
      const tierRow = data.top5ByTier.find((t) => t.tier === p.carouselTier);
      this.centered(0, `${p.carouselTier} MPH TOP 5`, 1, 0.9);
      const entries = tierRow?.entries ?? [];
      if (entries.length === 0) {
        this.centered(18, 'NO SCORES', 1, 0.6);
        return;
      }
      entries.slice(0, 5).forEach((e, i) => {
        this.centered(8 + i * 6, `${e.initials} ${e.score}`, 1, i === 0 ? 0.95 : 0.7);
      });
      return;
    }
    this.centered(0, 'BEST ROUNDS', 1, 0.9);
    const pbs = data.pbs.filter((b) => b.bestRoundScore > 0).slice(0, 5);
    if (pbs.length === 0) {
      this.centered(18, 'NO ROUNDS YET', 1, 0.6);
      return;
    }
    pbs.forEach((b, i) => {
      this.centered(8 + i * 6, `${b.tier} ${b.bestRoundScore}`, 1, 0.75);
    });
  }
}

function splitCoach(line: string): [string, string] {
  switch (line) {
    case 'WATCH THE LIGHT':
      return ['WATCH', 'THE LIGHT'];
    case 'SPACE TO SWING':
      return ['SPACE', 'TO SWING'];
    case 'SWING AS IT GETS BIG':
      return ['SWING AS IT', 'GETS BIG'];
    case 'WAIT FOR THE GREEN LIGHT':
      return ['WAIT FOR', 'GREEN LIGHT'];
    default:
      return [line.slice(0, 12), line.slice(12, 24)];
  }
}
