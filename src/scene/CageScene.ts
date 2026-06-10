import * as THREE from 'three';
import {
  BALL_RADIUS_M,
  CAGE_BACK_Z_M,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  CAGE_HEIGHT_M,
  FT_TO_M,
  MACHINE_BODY_DIST_M,
  RELEASE_HEIGHT_M,
  SETTLED_POOL,
} from '../core/constants';
import type { CageSim } from '../core/sim';
import type { Handedness } from '../core/types';

/**
 * M0 greybox per §4 dimensions: wireframe cage, flat turf, box machine with a
 * working status light (the locked release cue), capsule batter, sphere ball
 * with a soft ground-shadow blob (locked depth cue). Materials/lighting are
 * M1; this scene only has to make the timing readable.
 */
export class CageScene {
  readonly scene = new THREE.Scene();

  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private settledBalls: THREE.Mesh[] = [];
  private statusLight: THREE.Mesh;
  private lightMat: THREE.MeshStandardMaterial;
  private batter: THREE.Mesh;

  // Previous/current tick ball position for interpolated rendering.
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3();
  private prevActive = false;
  private currActive = false;

  constructor() {
    this.scene.background = new THREE.Color(0x0c0e10);
    this.scene.fog = new THREE.Fog(0x0c0e10, 25, 60);

    // Lighting: simple key + ambience (the §4 rig is M1).
    this.scene.add(new THREE.HemisphereLight(0x8899aa, 0x222426, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 5.2, 2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
    fill.position.set(-2, 4.5, 12);
    this.scene.add(fill);

    // Turf floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 40),
      new THREE.MeshStandardMaterial({ color: 0x2c5e34, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 12;
    this.scene.add(floor);

    // Cage tunnel: 70 × 14 × 12 ft wireframe box (§4).
    const cageLen = CAGE_FAR_Z_M - CAGE_BACK_Z_M;
    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(CAGE_HALF_WIDTH_M * 2, CAGE_HEIGHT_M, cageLen)),
      new THREE.LineBasicMaterial({ color: 0x4a4f55 })
    );
    cage.position.set(0, CAGE_HEIGHT_M / 2, CAGE_BACK_Z_M + cageLen / 2);
    this.scene.add(cage);

    // Net hint: translucent side/far planes so impacts read in greybox.
    const netMat = new THREE.MeshBasicMaterial({
      color: 0x303438,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const farNet = new THREE.Mesh(new THREE.PlaneGeometry(CAGE_HALF_WIDTH_M * 2, CAGE_HEIGHT_M), netMat);
    farNet.position.set(0, CAGE_HEIGHT_M / 2, CAGE_FAR_Z_M);
    this.scene.add(farNet);
    for (const side of [-1, 1]) {
      const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(cageLen, CAGE_HEIGHT_M), netMat);
      sideNet.rotation.y = Math.PI / 2;
      sideNet.position.set(side * CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M / 2, CAGE_BACK_Z_M + cageLen / 2);
      this.scene.add(sideNet);
    }

    // Home plate (17 in) + backstop pad hint.
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.4318, 0.02, 0.4318),
      new THREE.MeshStandardMaterial({ color: 0xdddddd })
    );
    plate.position.set(0, 0.011, 0.1);
    this.scene.add(plate);
    const backstop = new THREE.Mesh(
      new THREE.BoxGeometry(8 * FT_TO_M, 7 * FT_TO_M, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x23262b })
    );
    backstop.position.set(0, (7 * FT_TO_M) / 2, -4 * FT_TO_M);
    this.scene.add(backstop);

    // Pitching machine: navy box on the centerline, release aperture at 46 ft.
    const machine = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1d2d52, roughness: 0.6 })
    );
    machine.position.set(0, RELEASE_HEIGHT_M - 0.15, MACHINE_BODY_DIST_M);
    this.scene.add(machine);

    // Status light on top of the guard, batter's eye line (§4) — the timing anchor.
    this.lightMat = new THREE.MeshStandardMaterial({
      color: 0x332200,
      emissive: 0x000000,
      emissiveIntensity: 2,
    });
    this.statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), this.lightMat);
    this.statusLight.position.set(0, RELEASE_HEIGHT_M + 0.55, MACHINE_BODY_DIST_M);
    this.scene.add(this.statusLight);

    // Capsule batter (greybox; the rig is M1).
    this.batter = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 1.15, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x777d85, roughness: 0.9 })
    );
    this.scene.add(this.batter);
    this.setHandedness('R');

    // Live ball + soft contact ground shadow (locked depth cue, §4).
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS_M, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.45 })
    );
    this.ball.visible = false;
    this.scene.add(this.ball);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS_M * 1.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.visible = false;
    this.scene.add(this.ballShadow);

    // Settled-ball pool (balls remain on the floor for the round, §7).
    const settledMat = new THREE.MeshStandardMaterial({ color: 0xcfcfc8, roughness: 0.6 });
    for (let i = 0; i < SETTLED_POOL; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS_M, 12, 8), settledMat);
      m.visible = false;
      this.scene.add(m);
      this.settledBalls.push(m);
    }
  }

  /** Handedness = which batter's box the batter occupies (§What). A righty
   * stands in the third-base-side box (+X); the plate is at his right. */
  setHandedness(h: Handedness): void {
    const off = 0.85; // ~box center offset from the plate centerline
    this.batter.position.set(h === 'R' ? off : -off, 0.85, 0.15);
  }

  /** Copy sim ball state after each fixed tick (snapshot N-1 → N pair). */
  postTick(sim: CageSim): void {
    this.prev.copy(this.curr);
    this.prevActive = this.currActive;
    this.curr.set(sim.ball.px, sim.ball.py, sim.ball.pz);
    this.currActive = sim.ball.active && !sim.ball.asleep;
  }

  /** Interpolated render update (§Architecture: snapshots lerped by alpha). */
  update(sim: CageSim, alpha: number): void {
    const visible = this.currActive && this.prevActive;
    this.ball.visible = visible;
    this.ballShadow.visible = visible;
    if (visible) {
      this.ball.position.lerpVectors(this.prev, this.curr, alpha);
      this.ballShadow.position.set(this.ball.position.x, 0.012, this.ball.position.z);
      // Shadow fades and tightens with height — the depth cue.
      const h = Math.max(0, this.ball.position.y);
      const s = 1 + h * 0.35;
      this.ballShadow.scale.setScalar(s);
      (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.4 - h * 0.045);
    }

    for (let i = 0; i < this.settledBalls.length; i++) {
      const mesh = this.settledBalls[i]!;
      const b = sim.settled[i];
      if (b) {
        mesh.visible = true;
        mesh.position.set(b.px, b.py, b.pz);
      } else {
        mesh.visible = false;
      }
    }

    // Status light (§5 cues): amber blink FEED→RELEASE, green snap at RELEASE.
    const state = sim.lightState();
    if (state === 'green') {
      this.lightMat.emissive.setHex(0x00ff44);
      this.lightMat.color.setHex(0x00ff44);
    } else if (state === 'amber') {
      const blink = Math.sin(sim.t * 12) > 0;
      this.lightMat.emissive.setHex(blink ? 0xffaa00 : 0x1a1100);
      this.lightMat.color.setHex(blink ? 0xffaa00 : 0x332200);
    } else {
      this.lightMat.emissive.setHex(0x000000);
      this.lightMat.color.setHex(0x332200);
    }
  }
}
