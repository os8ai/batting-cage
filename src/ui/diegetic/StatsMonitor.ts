import * as THREE from 'three';

/**
 * §4 stats monitor: 32-inch LCD on the cage-side wall, TAB camera target.
 * M1 ships the powered-on placeholder ("STATS — COMING SOON" idle glow);
 * the real PBS/AVERAGES/MEDALS/SESSIONS/TREND pages are M3. Ordinary LCD
 * look — not dot-matrix (§4).
 */
export class StatsMonitor {
  readonly group = new THREE.Group();
  readonly screen: THREE.Mesh;

  constructor() {
    // 32" 16:9 ≈ 0.71 × 0.40 m.
    const w = 0.71;
    const h = 0.4;
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.4 })
    );
    this.group.add(bezel);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 288;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#04070c';
    ctx.fillRect(0, 0, 512, 288);
    const grad = ctx.createRadialGradient(256, 144, 20, 256, 144, 280);
    grad.addColorStop(0, 'rgba(28,52,72,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#9fd2e8';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STATS', 256, 130);
    ctx.font = '20px monospace';
    ctx.fillStyle = '#557789';
    ctx.fillText('COMING SOON', 256, 170);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    this.screen.position.z = 0.028;
    this.group.add(this.screen);
  }
}
