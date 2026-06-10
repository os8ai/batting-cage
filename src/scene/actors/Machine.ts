import * as THREE from 'three';
import {
  LOAD_T,
  MACHINE_BODY_DIST_M,
  RELEASE_DIST_M,
  RELEASE_HEIGHT_M,
  SPINUP_S,
  TIERS,
} from '../../core/constants';
import type { CageSim } from '../../core/sim';
import type { DomainEvent, TierMph } from '../../core/types';

/**
 * §4/§5 pitching machine actor: two-wheel machine on a tripod with a 12-ball
 * hopper feeder inside a steel mesh guard; amber/green status light on top of
 * the guard at the batter's eye line. Owns meshes and cue animations, zero
 * rules logic. Every animation derives from sim time and domain events — the
 * §5 cadence is frame-identical because the clock it reads is (M1 E2).
 */
export class Machine {
  readonly group = new THREE.Group();
  /** Bloom targets: the status light lens. */
  readonly statusLight: THREE.Mesh;

  private lightMat: THREE.MeshStandardMaterial;
  private wheelTop: THREE.Mesh;
  private wheelBottom: THREE.Mesh;
  private feedBall: THREE.Mesh;

  // Sim-time-anchored animation state (set from domain events).
  private tokenAt = -1;
  private feedAt = -1;
  private feeding = false;
  private spinning = false;
  private tierRate = 1;
  private wheelAngle = 0;
  private lastSimT = 0;

  // Feed-path waypoints (local space; aperture toward the plate is -z).
  private hopperMouth = new THREE.Vector3(0.28, 1.55, 0.35);
  private throat = new THREE.Vector3(0, RELEASE_HEIGHT_M, 0.12);

  constructor() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.8 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x1d2d52, roughness: 0.55, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.95 });

    // Tripod: three splayed legs under the body hub.
    const legGeo = new THREE.CylinderGeometry(0.025, 0.035, 1.15, 8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.set(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3);
      leg.rotation.z = Math.cos(a) * 0.32;
      leg.rotation.x = -Math.sin(a) * 0.32;
      leg.castShadow = true;
      this.group.add(leg);
    }

    // Body housing with the wheel slot facing the plate.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.6), navy);
    body.position.set(0, RELEASE_HEIGHT_M, 0.25);
    body.castShadow = true;
    this.group.add(body);

    // Two pitching wheels, stacked vertically; the ball exits between them.
    const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.06, 24);
    this.wheelTop = new THREE.Mesh(wheelGeo, rubber);
    this.wheelTop.rotation.z = Math.PI / 2;
    this.wheelTop.position.set(0, RELEASE_HEIGHT_M + 0.155, -0.12);
    this.wheelBottom = this.wheelTop.clone();
    this.wheelBottom.position.y = RELEASE_HEIGHT_M - 0.155;
    this.group.add(this.wheelTop, this.wheelBottom);

    // Hopper: open feeder bin above the body with visible queued balls and a
    // short drop chute into the wheel throat.
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.22, 12, 1, true), steel);
    bin.position.set(0, RELEASE_HEIGHT_M + 0.42, 0.32);
    this.group.add(bin);
    const binFloor = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), navy);
    binFloor.rotation.x = -Math.PI / 2;
    binFloor.position.set(0, RELEASE_HEIGHT_M + 0.32, 0.32);
    this.group.add(binFloor);
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10, 1, true), steel);
    chute.position.set(0, RELEASE_HEIGHT_M + 0.18, 0.26);
    chute.rotation.x = 0.35;
    this.group.add(chute);
    const ballGeo = new THREE.SphereGeometry(0.0366, 12, 8);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 0.5 });
    const queued = new THREE.InstancedMesh(ballGeo, ballMat, 6);
    const bm = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bm.makeTranslation(Math.cos(a) * 0.075, RELEASE_HEIGHT_M + 0.36, 0.32 + Math.sin(a) * 0.075);
      queued.setMatrixAt(i, bm);
    }
    this.group.add(queued);
    this.hopperMouth.set(0, RELEASE_HEIGHT_M + 0.3, 0.28);

    // The fed ball (hopper mouth → wheel throat during FEED→RELEASE).
    this.feedBall = new THREE.Mesh(ballGeo, ballMat);
    this.feedBall.visible = false;
    this.group.add(this.feedBall);

    // Steel mesh guard: corner posts + top rails, one instanced draw (the
    // wire silhouette reads from the posts at play distance).
    const guardHalf = 0.75;
    const unitCyl = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
    const guard = new THREE.InstancedMesh(unitCyl, steel, 8);
    const gm = new THREE.Matrix4();
    const gq = new THREE.Quaternion();
    const gv = new THREE.Vector3();
    let gi = 0;
    for (const gx of [-guardHalf, guardHalf]) {
      for (const gz of [-guardHalf, guardHalf]) {
        gm.compose(gv.set(gx, 0.95, gz), gq.identity(), new THREE.Vector3(1, 1.9, 1));
        guard.setMatrixAt(gi++, gm);
      }
    }
    gq.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    for (const gz of [-guardHalf, guardHalf]) {
      gm.compose(gv.set(0, 1.9, gz), gq, new THREE.Vector3(1.5, guardHalf * 2, 1.5));
      guard.setMatrixAt(gi++, gm);
    }
    gq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (const gx of [-guardHalf, guardHalf]) {
      gm.compose(gv.set(gx, 1.9, 0), gq, new THREE.Vector3(1.5, guardHalf * 2, 1.5));
      guard.setMatrixAt(gi++, gm);
    }
    this.group.add(guard);

    // Status light on top of the guard at the batter's eye line (§4).
    this.lightMat = new THREE.MeshStandardMaterial({
      color: 0x332200,
      emissive: 0x000000,
      emissiveIntensity: 3,
    });
    this.statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), this.lightMat);
    this.statusLight.position.set(0, 2.0, -guardHalf);
    this.group.add(this.statusLight);
    const lightStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), steel);
    lightStem.position.set(0, 1.93, -guardHalf);
    this.group.add(lightStem);

    // Position: body center 47.5 ft from the plate; aperture at 46 ft (§4).
    this.group.position.set(0, 0, MACHINE_BODY_DIST_M);
    // Local -z faces the plate; aperture offset = body − release distance.
    this.throat.z = -(MACHINE_BODY_DIST_M - RELEASE_DIST_M);
  }

  setTier(tier: TierMph): void {
    this.tierRate = 0.75 + TIERS.indexOf(tier) * 0.13;
  }

  onEvent(e: DomainEvent): void {
    switch (e.type) {
      case 'TOKEN':
        this.tokenAt = e.t;
        this.spinning = true;
        this.setTier(e.tier);
        break;
      case 'FEED':
        this.feedAt = e.t;
        this.feeding = true;
        break;
      case 'RELEASE':
        this.feeding = false; // the sim's live ball takes over at the aperture
        break;
      case 'ROUND_END':
        this.spinning = false;
        this.feeding = false;
        break;
      default:
        break;
    }
  }

  /** All motion is a function of sim.t — frame-rate independent by design. */
  update(sim: CageSim): void {
    const t = sim.t;
    const dt = Math.max(0, t - this.lastSimT);
    this.lastSimT = t;

    // Wheel spin: 3 s spin-up ramp after token, slight dip while loading.
    let rate = 0;
    if (this.spinning) {
      const up = this.tokenAt >= 0 ? Math.min(1, (t - this.tokenAt) / SPINUP_S) : 1;
      rate = this.tierRate * (0.2 + 0.8 * up);
      if (this.feeding) {
        const lt = t - this.feedAt;
        if (lt > LOAD_T && lt < LOAD_T + 0.5) rate *= 0.9; // whirr dips under load
      }
    }
    this.wheelAngle += dt * rate * 40;
    this.wheelTop.rotation.x = this.wheelAngle;
    this.wheelBottom.rotation.x = -this.wheelAngle;

    // Fed ball: hopper mouth → drop arc → wheel throat (FEED→LOAD), then
    // held at the throat with load vibration until RELEASE.
    if (this.feeding && this.feedAt >= 0) {
      const lt = t - this.feedAt;
      this.feedBall.visible = lt >= 0;
      if (lt < LOAD_T) {
        const k = Math.min(1, lt / LOAD_T);
        const ease = k * k * (3 - 2 * k);
        this.feedBall.position.lerpVectors(this.hopperMouth, this.throat, ease);
        this.feedBall.position.y += Math.sin(ease * Math.PI) * 0.1; // small arc
      } else {
        this.feedBall.position.copy(this.throat);
        this.feedBall.position.x += Math.sin(t * 90) * 0.0035; // wheel-bite shudder
      }
    } else {
      this.feedBall.visible = false;
    }

    // Status light (§5 cues): amber blink FEED→RELEASE, green snap at RELEASE.
    const state = sim.lightState();
    if (state === 'green') {
      this.lightMat.emissive.setHex(0x00ff44);
      this.lightMat.color.setHex(0x00ff44);
    } else if (state === 'amber') {
      const blink = Math.sin(t * 12) > 0;
      this.lightMat.emissive.setHex(blink ? 0xffaa00 : 0x1a1100);
      this.lightMat.color.setHex(blink ? 0xffaa00 : 0x332200);
    } else {
      this.lightMat.emissive.setHex(0x000000);
      this.lightMat.color.setHex(0x332200);
    }
  }
}
