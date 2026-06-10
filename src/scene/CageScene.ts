import * as THREE from 'three';
import {
  BALL_RADIUS_M,
  BACKSTOP_Z_M,
  CAGE_BACK_Z_M,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  CAGE_HEIGHT_M,
  FT_TO_M,
  SETTLED_POOL,
} from '../core/constants';
import type { CageSim } from '../core/sim';
import type { Handedness } from '../core/types';
import { Batter } from './actors/Batter';
import { Machine } from './actors/Machine';
import { Lighting } from './Lighting';
import { concreteTexture, netTexture, padTexture, plateMatTexture, steelTexture, turfTexture } from './textures';
import { LedBoard } from '../ui/diegetic/LedBoard';
import { MachinePanel } from '../ui/diegetic/MachinePanel';
import { StatsMonitor } from '../ui/diegetic/StatsMonitor';

export type StationName = 'PLAY' | 'PANEL' | 'RACK' | 'MONITOR' | 'BOARD';

export interface Station {
  pos: THREE.Vector3;
  lookAt: THREE.Vector3;
  /** World position the focus highlight ring sits at. */
  highlight: THREE.Vector3;
}

/**
 * §4 scene: the realistic indoor facility — 90×40×18 ft warehouse shell lit
 * near-dark, the 70×14×12 ft cage tunnel as the stage, worn turf, the §4
 * prop set, and the diegetic stations (board, panel, monitor, rack). Owns
 * actors and render-side state; zero rules logic.
 */
export class CageScene {
  readonly scene = new THREE.Scene();
  readonly machine = new Machine();
  readonly batter = new Batter();
  readonly board = new LedBoard();
  readonly panel = new MachinePanel();
  readonly monitor = new StatsMonitor();
  readonly lighting = new Lighting();
  /** Objects for the selective-bloom pass. */
  readonly glowObjects: THREE.Object3D[] = [];
  readonly stations: Record<StationName, Station>;

  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private settledBalls: THREE.Mesh[] = [];
  private focusRing: THREE.Mesh;
  private netBlip: THREE.Sprite;
  private netBlipAge = -1;
  private rackBats: Record<'WOOD' | 'METAL', THREE.Object3D>;
  private netUniforms = { uTime: { value: 0 } };

  // Previous/current tick ball position for interpolated rendering.
  private prev = new THREE.Vector3();
  private curr = new THREE.Vector3();
  private prevActive = false;
  private currActive = false;

  constructor() {
    this.scene.background = new THREE.Color(0x07080a);
    this.scene.fog = new THREE.Fog(0x07080a, 30, 75);

    this.scene.add(this.lighting.group);
    this.buildFacility();
    this.buildCage();
    this.buildPlateArea();
    this.rackBats = this.buildRack();

    // Actors & diegetic surfaces.
    this.scene.add(this.machine.group);
    this.scene.add(this.batter.group);
    this.board.placeAt(75.5 * FT_TO_M);
    this.scene.add(this.board.group);
    this.panel.group.position.set(-1.55, 0, 1.15);
    this.panel.group.rotation.y = 0.9; // angled toward the batter's box
    this.scene.add(this.panel.group);
    this.monitor.group.position.set(-(CAGE_HALF_WIDTH_M + 0.35), 1.55, 12 * FT_TO_M);
    this.monitor.group.rotation.y = Math.PI / 2; // face into the cage
    this.scene.add(this.monitor.group);

    this.glowObjects.push(this.board.face, this.machine.statusLight, ...this.lighting.glowMeshes);

    // Live ball + soft contact ground shadow (locked depth cue, §4).
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS_M, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.45 })
    );
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS_M * 1.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.visible = false;
    this.scene.add(this.ballShadow);

    const settledMat = new THREE.MeshStandardMaterial({ color: 0xdedcd2, roughness: 0.55 });
    const settledGeo = new THREE.SphereGeometry(BALL_RADIUS_M, 12, 8);
    for (let i = 0; i < SETTLED_POOL; i++) {
      const m = new THREE.Mesh(settledGeo, settledMat);
      m.castShadow = true;
      m.visible = false;
      this.scene.add(m);
      this.settledBalls.push(m);
    }

    // Net-impact blip: a brief soft flash at NET_HIT so ceiling/side catches
    // read from the play camera (placeholder until M2's cloth reaction —
    // owner playtest: an unseen ceiling catch looks like a ground bounce).
    const blipCanvas = document.createElement('canvas');
    blipCanvas.width = blipCanvas.height = 64;
    const bctx = blipCanvas.getContext('2d')!;
    const bg = bctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    bg.addColorStop(0, 'rgba(255,240,200,0.9)');
    bg.addColorStop(0.4, 'rgba(255,220,150,0.35)');
    bg.addColorStop(1, 'rgba(255,200,120,0)');
    bctx.fillStyle = bg;
    bctx.fillRect(0, 0, 64, 64);
    const blipTex = new THREE.CanvasTexture(blipCanvas);
    this.netBlip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: blipTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.netBlip.visible = false;
    this.scene.add(this.netBlip);

    // Focus highlight ring (station selection cue, §UX).
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 28),
      new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);
    this.glowObjects.push(this.focusRing);

    this.stations = {
      PLAY: {
        pos: new THREE.Vector3(), // CameraRig owns the OTS framing
        lookAt: new THREE.Vector3(),
        highlight: new THREE.Vector3(0.85, 0.02, 0.1),
      },
      PANEL: {
        pos: new THREE.Vector3(-0.55, 1.62, 2.6),
        lookAt: new THREE.Vector3(-1.55, 1.2, 1.15),
        highlight: new THREE.Vector3(-1.55, 0.02, 1.15),
      },
      RACK: {
        pos: new THREE.Vector3(-0.9, 1.5, 1.6),
        lookAt: new THREE.Vector3(-1.95, 1.3, 0.35),
        highlight: new THREE.Vector3(-1.8, 0.02, 0.35),
      },
      MONITOR: {
        pos: new THREE.Vector3(-0.9, 1.55, 12 * FT_TO_M),
        lookAt: new THREE.Vector3(-(CAGE_HALF_WIDTH_M + 0.35), 1.55, 12 * FT_TO_M),
        highlight: new THREE.Vector3(-1.7, 0.02, 12 * FT_TO_M),
      },
      BOARD: {
        pos: new THREE.Vector3(0, 2.2, 9),
        lookAt: new THREE.Vector3(0, 9.5 * FT_TO_M + 2, 75.5 * FT_TO_M),
        highlight: new THREE.Vector3(0, 0.02, 9),
      },
    };
  }

  // -- construction -----------------------------------------------------------

  private buildFacility(): void {
    const concrete = concreteTexture();
    const pad = padTexture();
    const halfW = 20 * FT_TO_M;
    const height = 18 * FT_TO_M;
    const zMin = -14 * FT_TO_M;
    const zMax = 76 * FT_TO_M;
    const len = zMax - zMin;

    // Concrete floor under everything.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, len),
      new THREE.MeshStandardMaterial({ map: concrete, color: 0x5a5c60, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.002, (zMin + zMax) / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ map: concrete, color: 0x46484c, roughness: 0.95 });
    const mkWall = (w: number, h: number): THREE.Mesh => new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);

    const far = mkWall(halfW * 2, height);
    far.position.set(0, height / 2, zMax);
    far.rotation.y = Math.PI;
    this.scene.add(far);
    const near = mkWall(halfW * 2, height);
    near.position.set(0, height / 2, zMin);
    this.scene.add(near);
    for (const side of [-1, 1]) {
      const wall = mkWall(len, height);
      wall.rotation.y = (side * Math.PI) / 2;
      wall.position.set(side * halfW, height / 2, (zMin + zMax) / 2);
      this.scene.add(wall);
    }
    // Ceiling (near-dark; fixtures live below it).
    const ceil = mkWall(halfW * 2, len);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, height, (zMin + zMax) / 2);
    this.scene.add(ceil);

    // Padded lower walls (§4) — vinyl panels to 7 ft on both side walls.
    const padMat = new THREE.MeshStandardMaterial({ map: pad, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const pads = new THREE.Mesh(new THREE.PlaneGeometry(len, 7 * FT_TO_M), padMat);
      pads.rotation.y = (side * Math.PI) / 2;
      pads.position.set(side * (halfW - 0.02), (7 * FT_TO_M) / 2, (zMin + zMax) / 2);
      this.scene.add(pads);
    }

    // Dark sibling cage silhouette beyond the -x netting (§4).
    const sibling = new THREE.Group();
    const silMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 1 });
    const silFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.4, 14), silMat);
    for (const fx of [-16.5 * FT_TO_M, -12.5 * FT_TO_M]) {
      const f = silFrame.clone();
      f.position.set(fx, 1.7, 8);
      sibling.add(f);
    }
    const silNet = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 1, transparent: true, opacity: 0.85 })
    );
    silNet.rotation.y = Math.PI / 2;
    silNet.position.set(-14.5 * FT_TO_M, 1.7, 8);
    sibling.add(silNet);
    this.scene.add(sibling);

    // EXIT door + glowing sign on the near wall (-z, behind the batter).
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 }));
    door.position.set(-3.4, 1.05, zMin + 0.05);
    this.scene.add(door);
    const exitSign = this.textPlane('EXIT', 96, 48, '#16331c', '#46ff7a', 0.5, 0.25);
    exitSign.position.set(-3.4, 2.45, zMin + 0.06);
    this.scene.add(exitSign);
    this.glowObjects.push(exitSign);

    // Safety signage on the +x side wall (§4).
    const sign = this.textPlane('HELMETS BEYOND THIS POINT', 512, 96, '#5a1212', '#e8e2d2', 2.2, 0.42);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(halfW - 0.04, 2.6, 6);
    this.scene.add(sign);

    // Bench + rolling ball cart outside the -x netting.
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.8 });
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.4), benchMat);
    seat.position.y = 0.45;
    bench.add(seat);
    for (const lx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), benchMat);
      leg.position.set(lx, 0.225, 0);
      bench.add(leg);
    }
    bench.position.set(-3.6, 0, 2.5);
    this.scene.add(bench);

    const cart = new THREE.Group();
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.5, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
    bin.position.y = 0.55;
    cart.add(bin);
    const cartBalls = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BALL_RADIUS_M, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0xe8e6da, roughness: 0.6 }),
      7
    );
    const cm = new THREE.Matrix4();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      cm.makeTranslation(Math.cos(a) * 0.16, 0.78, Math.sin(a) * 0.16);
      cartBalls.setMatrixAt(i, cm);
    }
    cart.add(cartBalls);
    cart.position.set(-3.4, 0, 5.5);
    this.scene.add(cart);
  }

  private textPlane(
    text: string,
    cw: number,
    chh: number,
    bg: string,
    fg: string,
    w: number,
    h: number
  ): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = chh;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, chh);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.floor(chh * 0.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, chh / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  }

  private buildCage(): void {
    const cageLen = CAGE_FAR_Z_M - CAGE_BACK_Z_M;
    const cageMidZ = CAGE_BACK_Z_M + cageLen / 2;

    // Turf strip the length of the tunnel (worn lanes baked into the map).
    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(CAGE_HALF_WIDTH_M * 2, cageLen),
      new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: 0.95 })
    );
    turf.rotation.x = -Math.PI / 2;
    turf.rotation.z = Math.PI; // texture v=0 (plate wear) at the plate end
    turf.position.set(0, 0, cageMidZ);
    turf.receiveShadow = true;
    this.scene.add(turf);

    // Galvanized frame: uprights every 10 ft + corner rails (instanced).
    const steel = steelTexture();
    const frameMat = new THREE.MeshStandardMaterial({ map: steel, color: 0xb9bdc2, roughness: 0.45, metalness: 0.85 });
    const unit = new THREE.CylinderGeometry(0.032, 0.032, 1, 8);
    const uprightZs: number[] = [];
    for (let zFt = -8; zFt <= 62; zFt += 10) uprightZs.push(zFt * FT_TO_M);
    const railLens = [cageLen, cageLen, CAGE_HALF_WIDTH_M * 2, CAGE_HALF_WIDTH_M * 2];
    const count = uprightZs.length * 2 + railLens.length + uprightZs.length; // uprights + long rails + roof cross members
    const frame = new THREE.InstancedMesh(unit, frameMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3();
    let idx = 0;
    for (const z of uprightZs) {
      for (const side of [-1, 1]) {
        m.compose(
          up.set(side * CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M / 2, z),
          q.identity(),
          new THREE.Vector3(1, CAGE_HEIGHT_M, 1)
        );
        frame.setMatrixAt(idx++, m);
      }
    }
    // Top long rails both sides.
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (const side of [-1, 1]) {
      m.compose(up.set(side * CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, cageMidZ), q, new THREE.Vector3(1, cageLen, 1));
      frame.setMatrixAt(idx++, m);
    }
    // End-cap top rails.
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    for (const z of [CAGE_BACK_Z_M, CAGE_FAR_Z_M]) {
      m.compose(up.set(0, CAGE_HEIGHT_M, z), q, new THREE.Vector3(1, CAGE_HALF_WIDTH_M * 2, 1));
      frame.setMatrixAt(idx++, m);
    }
    // Roof cross members at each upright pair.
    for (const z of uprightZs) {
      m.compose(up.set(0, CAGE_HEIGHT_M, z), q, new THREE.Vector3(1, CAGE_HALF_WIDTH_M * 2, 1));
      frame.setMatrixAt(idx++, m);
    }
    frame.count = idx;
    frame.castShadow = true;
    this.scene.add(frame);

    // Netting: alpha-tested weave with a subtle vertex sway (§11). ONE shared
    // material/texture for every panel (weave density baked into each plane's
    // UVs) — six panels, one material, no texture clones. Sized so M2's
    // Verlet panels can replace sections without re-modeling.
    const netMat = new THREE.MeshStandardMaterial({
      map: netTexture(),
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.9,
      color: 0x8a8a8e,
    });
    netMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.netUniforms.uTime;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' +
            'transformed += normal * 0.02 * sin(uTime * 0.7 + position.x * 1.3 + position.y * 0.9 + position.z * 0.6);'
        );
    };

    const addNet = (w: number, h: number, pos: [number, number, number], rotY: number, rotX = 0): void => {
      const geo = new THREE.PlaneGeometry(w, h, 8, 4);
      // Bake the weave repeat (one cell ≈ 1.75 in) into the UVs.
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (w / 0.0445), uv.getY(i) * (h / 0.0445));
      }
      const mesh = new THREE.Mesh(geo, netMat);
      mesh.position.set(...pos);
      mesh.rotation.y = rotY;
      mesh.rotation.x = rotX;
      this.scene.add(mesh);
    };

    const midY = CAGE_HEIGHT_M / 2;
    addNet(cageLen, CAGE_HEIGHT_M, [-CAGE_HALF_WIDTH_M, midY, cageMidZ], Math.PI / 2);
    addNet(cageLen, CAGE_HEIGHT_M, [CAGE_HALF_WIDTH_M, midY, cageMidZ], -Math.PI / 2);
    addNet(CAGE_HALF_WIDTH_M * 2, CAGE_HEIGHT_M, [0, midY, CAGE_FAR_Z_M], Math.PI);
    addNet(CAGE_HALF_WIDTH_M * 2, CAGE_HEIGHT_M, [0, midY, CAGE_BACK_Z_M], 0);
    addNet(CAGE_HALF_WIDTH_M * 2, cageLen, [0, CAGE_HEIGHT_M, cageMidZ], 0, -Math.PI / 2);
    // Door flap near the plate end (-x side), slightly ajar.
    addNet(0.9, 2.1, [-CAGE_HALF_WIDTH_M + 0.12, 1.05, 0.9], Math.PI / 2 + 0.18);
  }

  private buildPlateArea(): void {
    // Worn rubber mat with painted boxes (12×12 ft, §4).
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(12 * FT_TO_M, 12 * FT_TO_M),
      new THREE.MeshStandardMaterial({ map: plateMatTexture(), roughness: 0.97 })
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, 0.006, 0.1);
    mat.receiveShadow = true;
    this.scene.add(mat);

    // Home plate: 17 in pentagon.
    const s = 0.4318; // 17 in
    const shape = new THREE.Shape();
    shape.moveTo(-s / 2, 0);
    shape.lineTo(s / 2, 0);
    shape.lineTo(s / 2, -s * 0.5);
    shape.lineTo(0, -s);
    shape.lineTo(-s / 2, -s * 0.5);
    shape.closePath();
    const plate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xdcdad0, roughness: 0.8 })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 0.012, 0.32);
    this.scene.add(plate);

    // Backstop pad 4 ft behind the plate (§4).
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(8 * FT_TO_M, 7 * FT_TO_M, 0.16),
      new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.85 })
    );
    pad.position.set(0, (7 * FT_TO_M) / 2, BACKSTOP_Z_M);
    pad.castShadow = true;
    pad.receiveShadow = true;
    this.scene.add(pad);
  }

  private buildRack(): Record<'WOOD' | 'METAL', THREE.Object3D> {
    const rack = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.5, metalness: 0.7 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.03), new THREE.MeshStandardMaterial({ color: 0x26282d, roughness: 0.8 }));
    rack.add(back);
    for (const hx of [-0.12, 0.12]) {
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), steel);
      hook.rotation.x = Math.PI / 2;
      hook.position.set(hx, 0.28, 0.06);
      rack.add(hook);
    }
    // Display bats: simple cylinders standing in the rack (the held bat is
    // the batter's prop; the rack shows the spare).
    const woodBat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.014, 0.84, 10),
      new THREE.MeshStandardMaterial({ color: 0xa9742f, roughness: 0.55 })
    );
    woodBat.position.set(-0.12, -0.02, 0.07);
    rack.add(woodBat);
    const metalBat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.015, 0.84, 10),
      new THREE.MeshStandardMaterial({ color: 0xc3c8cf, roughness: 0.3, metalness: 0.85 })
    );
    metalBat.position.set(0.12, -0.02, 0.07);
    rack.add(metalBat);

    rack.position.set(-1.98, 1.25, 0.35);
    rack.rotation.y = Math.PI / 2 - 0.15;
    this.scene.add(rack);
    return { WOOD: woodBat, METAL: metalBat };
  }

  // -- runtime ----------------------------------------------------------------

  setHandedness(h: Handedness): void {
    this.batter.setHandedness(h);
  }

  /** The rack shows the bat NOT in the batter's hands. */
  setBat(b: 'WOOD' | 'METAL'): void {
    this.batter.setBat(b);
    this.rackBats.WOOD.visible = b !== 'WOOD';
    this.rackBats.METAL.visible = b !== 'METAL';
  }

  /** NET_HIT cue — flash at the ball's current render position. */
  flashNetHit(): void {
    this.netBlip.position.copy(this.ball.position);
    this.netBlipAge = 0;
    this.netBlip.visible = true;
  }

  showFocus(at: THREE.Vector3 | null): void {
    if (at) {
      this.focusRing.position.set(at.x, at.y, at.z);
      this.focusRing.visible = true;
    } else {
      this.focusRing.visible = false;
    }
  }

  /** Copy sim ball state after each fixed tick (snapshot N-1 → N pair). */
  postTick(sim: CageSim): void {
    this.prev.copy(this.curr);
    this.prevActive = this.currActive;
    this.curr.set(sim.ball.px, sim.ball.py, sim.ball.pz);
    this.currActive = sim.ball.active && !sim.ball.asleep;
  }

  /** Interpolated render update (§Architecture: snapshots lerped by alpha). */
  update(sim: CageSim, alpha: number, dt: number, timeS: number): void {
    const visible = this.currActive && this.prevActive;
    this.ball.visible = visible;
    this.ballShadow.visible = visible;
    if (visible) {
      this.ball.position.lerpVectors(this.prev, this.curr, alpha);
      this.ballShadow.position.set(this.ball.position.x, 0.012, this.ball.position.z);
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

    this.machine.update(sim);
    this.batter.update(dt);
    this.board.update(timeS);
    this.panel.update(timeS);
    this.lighting.update(dt, timeS);
    this.netUniforms.uTime.value = timeS;
    if (this.focusRing.visible) {
      (this.focusRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.25 * Math.sin(timeS * 5);
    }

    if (this.netBlipAge >= 0) {
      this.netBlipAge += dt;
      const life = 0.35;
      if (this.netBlipAge >= life) {
        this.netBlipAge = -1;
        this.netBlip.visible = false;
      } else {
        const k = this.netBlipAge / life;
        this.netBlip.scale.setScalar(0.25 + k * 0.9);
        this.netBlip.material.opacity = 1 - k;
      }
    }
  }
}
