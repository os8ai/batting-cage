import * as THREE from 'three';
import { FT_TO_M, RELEASE_DIST_M, RELEASE_HEIGHT_M } from '../core/constants';
import type { Grade, Handedness } from '../core/types';
import type { Station, StationName } from './CageScene';

/**
 * §4 camera director. Play camera is the locked OTS framing: 4.5 ft behind
 * the batter, 2.0 ft outside his back shoulder, 5.9 ft high, vFOV 50°,
 * look-at pinned to the release aperture; idle micro-sway ≤ 0.5° at 0.1 Hz.
 * Station moves are 0.8 s eased dollies (§UX). Contact feel: 80–140 ms shake
 * scaled by EV plus a 4° FOV kick on PERFECT (§4).
 */
const MOVE_S = 0.8;
const BASE_FOV = 54; // widened from the spec's 50 so the loaded bat stays in frame
// Play-view zoom (post-M4 owner playtest): on the pitch line the batter sits
// farther off-axis, so the default opens to 58° to keep the bat in frame;
// ↑/↓ adjust between the stops.
const PLAY_FOV_DEFAULT = 58;
const PLAY_FOV_MIN = 46;
const PLAY_FOV_MAX = 70;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  station: StationName = 'PLAY';
  /** Attract mode (M3 design note 6): slow dolly drift between two poses. */
  attract = false;

  private playBase = new THREE.Vector3();
  private playLook = new THREE.Vector3(0, RELEASE_HEIGHT_M, RELEASE_DIST_M);
  // Attract poses: a low wide view from the door side and a higher plate-side
  // view, both looking down the lane at the idling machine.
  private attractA = new THREE.Vector3(-1.9, 1.7, -0.6);
  private attractB = new THREE.Vector3(1.8, 2.3, 1.6);
  private attractLook = new THREE.Vector3(0, 1.1, RELEASE_DIST_M * 0.8);
  private attractPos = new THREE.Vector3();

  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private toPos = new THREE.Vector3();
  private toLook = new THREE.Vector3();
  private moveT = 1; // 1 = arrived
  private look = new THREE.Vector3().copy(this.playLook);

  // Contact feel.
  private shakeLeft = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  private kickLeft = 0;
  private playFov = PLAY_FOV_DEFAULT;

  private scratch = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.05, 120);
    this.setHandedness('R');
    this.camera.position.copy(this.playBase);
  }

  setHandedness(h: Handedness): void {
    // Owner-playtest fix (M1, refined post-M4): the camera sits EXACTLY on
    // the pitch line (x = 0) — the M1 read left it 0.40 m off-line, and the
    // lateral parallax made the dead-center pitch visibly drift right of
    // the lane stripe on its way down (owner playtest). On-line, ball,
    // stripe, and release light are collinear on screen and the ball flies
    // straight at the lens (§4); the batter frames to the side (mirrored
    // for lefties).
    const batterX = h === 'R' ? 0.85 : -0.85;
    const towardPlate = -batterX; // back to the centerline
    // z = −1.05 m (≈3.8 ft behind the batter, not the spec's 4.5): on the
    // pitch line the §4 distance lands the camera inside the backstop pad
    // (8 ft wide, 4 ft behind the plate) — pulled forward to clear it.
    this.playBase.set(batterX + towardPlate, 5.9 * FT_TO_M, -1.05);
  }

  /** Enter the attract drift (idle visit, §Flow 2); any station move exits. */
  startAttract(): void {
    if (this.attract) return;
    this.attract = true;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.look);
    this.moveT = 0;
  }

  /** 0.8 s eased dolly to a station (null station = the OTS play camera). */
  goTo(name: StationName, station: Station): void {
    if (this.attract) {
      this.attract = false;
      this.station = name;
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(this.look);
      if (name === 'PLAY') {
        this.toPos.copy(this.playBase);
        this.toLook.copy(this.playLook);
      } else {
        this.toPos.copy(station.pos);
        this.toLook.copy(station.lookAt);
      }
      this.moveT = 0;
      return;
    }
    if (name === this.station && this.moveT >= 1) return;
    this.station = name;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.look);
    if (name === 'PLAY') {
      this.toPos.copy(this.playBase);
      this.toLook.copy(this.playLook);
    } else {
      this.toPos.copy(station.pos);
      this.toLook.copy(station.lookAt);
    }
    this.moveT = 0;
  }

  get atPlay(): boolean {
    return this.station === 'PLAY';
  }

  get settled(): boolean {
    return this.moveT >= 1;
  }

  /**
   * Play-camera zoom (owner playtest, post-M4): ↑ zooms in, ↓ zooms out, in
   * 4° FOV steps. Applies only to the OTS play view — stations keep their
   * framing. Returns false at the stops (caller skips the confirm click).
   */
  zoom(dir: 1 | -1): boolean {
    const next = Math.max(PLAY_FOV_MIN, Math.min(PLAY_FOV_MAX, this.playFov - dir * 4));
    if (next === this.playFov) return false;
    this.playFov = next;
    return true;
  }

  /** §4 contact feel — driven by the CONTACT event. */
  onContact(evMph: number, grade: Grade): void {
    const k = Math.max(0, Math.min(1, (evMph - 60) / 45));
    this.shakeDur = 0.08 + 0.06 * k;
    this.shakeLeft = this.shakeDur;
    this.shakeAmp = 0.008 + 0.02 * k;
    if (grade === 'PERFECT') this.kickLeft = 0.36;
  }

  update(timeS: number, dt: number): void {
    // Eased dolly progress.
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / MOVE_S);
    }
    const e = this.moveT < 1 ? this.moveT * this.moveT * (3 - 2 * this.moveT) : 1;

    // Live target (PLAY sways; stations are static; attract drifts).
    let targetPos: THREE.Vector3;
    let targetLook: THREE.Vector3;
    if (this.attract) {
      // 0.05 Hz drift between the two attract poses (design note 6).
      const u = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.05 * timeS);
      targetPos = this.attractPos.lerpVectors(this.attractA, this.attractB, u);
      targetLook = this.attractLook;
    } else if (this.station === 'PLAY') {
      const sway = Math.sin(2 * Math.PI * 0.1 * timeS) * 0.012;
      const bob = Math.cos(2 * Math.PI * 0.08 * timeS) * 0.008;
      targetPos = this.scratch.set(this.playBase.x + sway, this.playBase.y + bob, this.playBase.z);
      targetLook = this.playLook;
    } else {
      targetPos = this.toPos;
      targetLook = this.toLook;
    }

    if (e < 1) {
      this.camera.position.lerpVectors(this.fromPos, targetPos, e);
      this.look.lerpVectors(this.fromLook, targetLook, e);
    } else {
      this.camera.position.copy(targetPos);
      this.look.copy(targetLook);
    }

    // Contact shake (decaying band-limited wobble).
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const f = this.shakeLeft / this.shakeDur;
      const a = this.shakeAmp * f;
      this.camera.position.x += Math.sin(timeS * 147.3) * a;
      this.camera.position.y += Math.sin(timeS * 171.7 + 1.3) * a * 0.7;
    }

    // PERFECT FOV kick: fast out, smooth return (§4: 4°). The play view uses
    // the player's zoom; stations keep the base framing.
    let fov = this.station === 'PLAY' && !this.attract ? this.playFov : BASE_FOV;
    if (this.kickLeft > 0) {
      this.kickLeft = Math.max(0, this.kickLeft - dt);
      const p = 1 - this.kickLeft / 0.36;
      const env = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
      fov += 4 * env;
    }
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(this.look);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
