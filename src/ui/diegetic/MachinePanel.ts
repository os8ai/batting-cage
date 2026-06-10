import * as THREE from 'three';
import { TIERS } from '../../core/constants';
import type { TierMph } from '../../core/types';

/**
 * §4 machine control panel: pedestal by the cage door with six lit tier
 * buttons; arrows move focus, SPACE/ENTER confirms with a physical click,
 * mouse clicks land on the same buttons (raycast → uv). In M1 all six tiers
 * read unlocked/green — red locked states + stenciled requirements wire to
 * progression in M3. The token slot sits below (interactive in M3; R-token
 * remains the M0-DEBUG path).
 */
const W = 256;
const H = 384;
const BTN_TOP = 64;
const BTN_H = 46;
const BTN_GAP = 6;

export class MachinePanel {
  readonly group = new THREE.Group();
  /** Raycast target for click parity. */
  readonly faceMesh: THREE.Mesh;

  focusIndex = 0;
  selectedTier: TierMph = 40;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private flashUntil = 0;
  private nowS = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const steel = new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.5, metalness: 0.7 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 10), steel);
    post.position.y = 0.5;
    post.castShadow = true;
    this.group.add(post);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.55 }));
    head.position.set(0, 1.25, 0);
    head.rotation.x = -0.32;
    this.group.add(head);

    this.faceMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.45),
      new THREE.MeshBasicMaterial({ map: this.texture })
    );
    this.faceMesh.position.set(0, 1.25, 0.033);
    this.faceMesh.rotation.x = -0.32;
    this.group.add(this.faceMesh);

    // Token slot housing below the head (M3 station).
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), steel);
    slot.position.set(0, 0.95, 0.02);
    this.group.add(slot);
    const slit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.012, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 })
    );
    slit.position.set(0, 0.95, 0.062);
    this.group.add(slit);

    this.redraw();
  }

  moveFocus(delta: number): void {
    this.focusIndex = (this.focusIndex + delta + TIERS.length) % TIERS.length;
    this.redraw();
  }

  setFocus(i: number): void {
    this.focusIndex = Math.max(0, Math.min(TIERS.length - 1, i));
    this.redraw();
  }

  /** Confirm the focused tier (panel click + button flash). */
  confirm(): TierMph {
    this.selectedTier = TIERS[this.focusIndex]!;
    this.flashUntil = this.nowS + 0.25;
    this.redraw();
    return this.selectedTier;
  }

  setSelected(tier: TierMph): void {
    this.selectedTier = tier;
    this.focusIndex = TIERS.indexOf(tier);
    this.redraw();
  }

  /** Raycast uv → button index, or null off the buttons. */
  buttonAtUv(u: number, v: number): number | null {
    const y = (1 - v) * H;
    const x = u * W;
    if (x < 24 || x > W - 24) return null;
    for (let i = 0; i < TIERS.length; i++) {
      const top = BTN_TOP + i * (BTN_H + BTN_GAP);
      if (y >= top && y <= top + BTN_H) return i;
    }
    return null;
  }

  update(timeS: number): void {
    this.nowS = timeS;
    if (this.flashUntil > 0 && timeS > this.flashUntil) {
      this.flashUntil = 0;
      this.redraw();
    }
  }

  private redraw(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#cfd2d6';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPEED', W / 2, 36);
    ctx.strokeStyle = '#33363c';
    ctx.strokeRect(8, 8, W - 16, H - 16);

    for (let i = 0; i < TIERS.length; i++) {
      const tier = TIERS[i]!;
      const top = BTN_TOP + i * (BTN_H + BTN_GAP);
      const isSel = tier === this.selectedTier;
      const isFocus = i === this.focusIndex;
      const flashing = isFocus && this.flashUntil > 0;
      // M1: every tier unlocked → green-lit buttons (§UX; red/locked is M3).
      ctx.fillStyle = flashing ? '#7dffa0' : isSel ? '#1d8a3c' : '#123a1e';
      ctx.fillRect(28, top, W - 56, BTN_H);
      ctx.strokeStyle = isFocus ? '#ffb000' : '#2c6b3d';
      ctx.lineWidth = isFocus ? 4 : 2;
      ctx.strokeRect(28, top, W - 56, BTN_H);
      ctx.fillStyle = flashing ? '#06280f' : '#b9ffc9';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(`${tier} MPH`, W / 2, top + 32);
    }
    ctx.lineWidth = 1;
    this.texture.needsUpdate = true;
  }
}
