import * as THREE from 'three';
import { FT_TO_M, RELEASE_DIST_M, RELEASE_HEIGHT_M } from '../core/constants';
import type { Handedness } from '../core/types';

/**
 * §4 locked OTS camera: 4.5 ft behind the batter, 2.0 ft outside his back
 * shoulder, 5.9 ft high, vFOV 50°, look-at pinned to the release aperture —
 * the pitch flies essentially at the lens. Mirrored for lefties. Idle
 * micro-sway ≤ 0.5° at 0.1 Hz. Station moves are M1.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private base = new THREE.Vector3();
  private lookAt = new THREE.Vector3(0, RELEASE_HEIGHT_M, RELEASE_DIST_M);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 120);
    this.setHandedness('R');
  }

  setHandedness(h: Handedness): void {
    // Righty: third-base-side box (+X); "outside his back (right) shoulder"
    // is further from the plate, i.e. further +X. Mirrored for lefties.
    const batterX = h === 'R' ? 0.85 : -0.85;
    const outside = h === 'R' ? 2.0 * FT_TO_M : -2.0 * FT_TO_M;
    this.base.set(batterX + outside, 5.9 * FT_TO_M, -4.5 * FT_TO_M);
  }

  update(timeS: number): void {
    // Idle micro-sway: ≤ 0.5° at 0.1 Hz, applied as a tiny positional drift.
    const sway = Math.sin(2 * Math.PI * 0.1 * timeS) * 0.012;
    const bob = Math.cos(2 * Math.PI * 0.1 * timeS * 0.8) * 0.008;
    this.camera.position.set(this.base.x + sway, this.base.y + bob, this.base.z);
    this.camera.lookAt(this.lookAt);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
