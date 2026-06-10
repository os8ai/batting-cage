import * as THREE from 'three';
import { DEG_TO_RAD, FT_TO_M } from '../../core/constants';
import type { DomainEvent, SwingRecord } from '../../core/types';
import { GLYPH_H, GLYPH_W, glyph, textWidthCells } from './dotFont';
import { BoardPageMachine, type BoardPage } from './boardPages/pageMachine';

/**
 * The LED distance board (§4/§9): 8 × 4.5 ft dot-matrix face on the far
 * facility wall above the machine, bottom edge 8 ft up, tilted 8° toward the
 * plate. Rendered as a 1024×576 canvas texture; logical matrix 72×40 cells
 * (widened from the §4 note's 64×36 so the §9 page lines fit at 12 chars —
 * recorded in M1-NOTES). Amber-on-near-black, refresh shimmer, glass glare.
 * The canvas re-renders only on page changes (frame-budget rule).
 */
const COLS = 72;
const ROWS = 40;
const CANVAS_W = 1152; // 16 px per cell at 72 cols
const CANVAS_H = 640;
const CELL = CANVAS_W / COLS;

const AMBER = [255, 176, 0] as const;

export class LedBoard {
  /** Board face + glass + housing, positioned per §4. */
  readonly group = new THREE.Group();
  /** Bloom target. */
  readonly face: THREE.Mesh;

  private machine = new BoardPageMachine();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private faceMat: THREE.MeshBasicMaterial;
  private unlit: HTMLCanvasElement;

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
  }

  /** Refresh shimmer — cheap per-frame color wobble, no canvas redraw. The
   * >1 base drives the face into the bloom threshold (the warmest thing in
   * frame, §11) without re-painting the canvas. */
  update(timeS: number): void {
    const s = 1.55 + 0.07 * Math.sin(timeS * 47.0) * Math.sin(timeS * 9.3);
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

  private renderPage(): void {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.ctx.drawImage(this.unlit, 0, 0);
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
        } else {
          this.centered(3, 'PITCH', 1, 0.7);
          this.centered(12, `${p.pitch}/10`, 2);
          this.centered(30, `${p.tier} MPH`, 1, 0.7);
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
      case 'ROUND_OVER':
        this.centered(6, 'ROUND OVER', 1);
        this.centered(17, `CONTACT ${p.contactCount}/10`, 1, 0.85);
        this.centered(28, p.bestCarryFt > 0 ? `BEST ${p.bestCarryFt} FT` : 'INSERT TOKEN', 1, 0.85);
        break;
    }
    this.texture.needsUpdate = true;
  }
}
