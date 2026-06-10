import * as THREE from 'three';
import {
  CAGE_BACK_Z_M,
  CAGE_FAR_Z_M,
  CAGE_HALF_WIDTH_M,
  CAGE_HEIGHT_M,
  CLOTH_CEILING_PITCH_M,
  CLOTH_DT,
  CLOTH_NODE_PITCH_M,
  CLOTH_REST_ENERGY,
  CLOTH_SUBSTEPS,
  FT_TO_M,
  GRAVITY,
} from '../../core/constants';
import {
  applyImpulse,
  createCloth,
  settleEnergy,
  stepCloth,
  type ClothState,
} from '../../core/physics/cloth';
import type { DomainEvent, NetPanel } from '../../core/types';
import { netTexture } from '../textures';

/** §11 dynamic sections: the four cloth panels + the back panel behind the
 * backstop (M2-PLAN §3.3) — sized to the M1 net segmentation. */
const SIDE_DYNAMIC_LEN_M = 20 * FT_TO_M; // "first 20 ft of both side panels"
const CEILING_STRIP_LEN_M = 50 * FT_TO_M; // "ceiling strip over the lane"
const WEAVE_CELL_M = 0.0445; // one net cell ≈ 1.75 in (matches the M1 UV bake)

interface Panel {
  name: NetPanel;
  cloth: ClothState;
  mesh: THREE.Mesh;
  posAttr: THREE.BufferAttribute;
  /** World gravity transformed into the panel's local frame. */
  g: THREE.Vector3;
  active: boolean;
  /** Stepped since the last upload (covers the final settle frame too). */
  dirty: boolean;
}

/**
 * The netting actor (M2): four §11 Verlet panels + the back panel react to
 * NET_HIT impacts; the rest of the tunnel stays static mesh with the M1
 * vertex-sway shader. One-way coupled — this actor only LISTENS to domain
 * events; the sim never reads the cloth (boundary test E6).
 *
 * Cloth stepping runs on a fixed 60 Hz × 2-substep sub-accumulator on the
 * render loop (§11). Idle panels (settleEnergy below rest) are not stepped
 * and skip normal recompute, so quiet frames cost nothing (E2 spike budget).
 */
export class Net {
  readonly group = new THREE.Group();

  private panels: Panel[] = [];
  private byName = new Map<NetPanel, Panel>();
  private swayUniforms = { uTime: { value: 0 } };
  private acc = 0;
  private scratch = new THREE.Vector3();
  /** §11 preset: which panels stay simulated, and at what rate. */
  private enabled: Set<NetPanel> = new Set(['far', 'left', 'right', 'ceiling', 'back']);
  private clothDt = CLOTH_DT;

  constructor() {
    const tex = netTexture();
    // Cloth panels get a plain (no-sway) clone of the weave material — the
    // solver owns their motion; double motion would read as jitter.
    const clothMat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.9,
      color: 0x8a8a8e,
    });
    const swayMat = clothMat.clone();
    swayMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.swayUniforms.uTime;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' +
            'transformed += normal * 0.02 * sin(uTime * 0.7 + position.x * 1.3 + position.y * 0.9 + position.z * 0.6);'
        );
    };

    const w = CAGE_HALF_WIDTH_M * 2;
    const h = CAGE_HEIGHT_M;
    const cageLen = CAGE_FAR_Z_M - CAGE_BACK_Z_M;

    // -- dynamic cloth panels (§11) -------------------------------------------
    // far end (full 14×12 ft) — the panel most batted balls test
    this.addClothPanel(clothMat, 'far', w, h, CLOTH_NODE_PITCH_M, (m) => {
      m.position.set(CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, CAGE_FAR_Z_M);
      m.rotation.y = Math.PI;
    });
    // first 20 ft of both sides (foul-ball territory)
    this.addClothPanel(clothMat, 'left', SIDE_DYNAMIC_LEN_M, h, CLOTH_NODE_PITCH_M, (m) => {
      m.position.set(CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, CAGE_BACK_Z_M);
      m.rotation.y = -Math.PI / 2;
    });
    this.addClothPanel(clothMat, 'right', SIDE_DYNAMIC_LEN_M, h, CLOTH_NODE_PITCH_M, (m) => {
      m.position.set(-CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, CAGE_BACK_Z_M + SIDE_DYNAMIC_LEN_M);
      m.rotation.y = Math.PI / 2;
    });
    // ceiling strip over the plate-to-machine lane (coarser pitch)
    this.addClothPanel(clothMat, 'ceiling', w, CEILING_STRIP_LEN_M, CLOTH_CEILING_PITCH_M, (m) => {
      m.position.set(-CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, CAGE_BACK_Z_M + CEILING_STRIP_LEN_M);
      m.rotation.x = Math.PI / 2;
    });
    // back panel behind the backstop (wild MISS ricochets)
    this.addClothPanel(clothMat, 'back', w, h, CLOTH_NODE_PITCH_M, (m) => {
      m.position.set(-CAGE_HALF_WIDTH_M, CAGE_HEIGHT_M, CAGE_BACK_Z_M);
    });

    // -- remaining netting: static mesh + sway shader (§11) -------------------
    const midY = h / 2;
    const sideStaticLen = cageLen - SIDE_DYNAMIC_LEN_M;
    const sideStaticMidZ = CAGE_BACK_Z_M + SIDE_DYNAMIC_LEN_M + sideStaticLen / 2;
    this.addStatic(swayMat, sideStaticLen, h, [CAGE_HALF_WIDTH_M, midY, sideStaticMidZ], Math.PI / 2);
    this.addStatic(swayMat, sideStaticLen, h, [-CAGE_HALF_WIDTH_M, midY, sideStaticMidZ], -Math.PI / 2);
    const ceilStaticLen = cageLen - CEILING_STRIP_LEN_M;
    const ceilStaticMidZ = CAGE_BACK_Z_M + CEILING_STRIP_LEN_M + ceilStaticLen / 2;
    this.addStatic(swayMat, w, ceilStaticLen, [0, CAGE_HEIGHT_M, ceilStaticMidZ], 0, -Math.PI / 2);
    // Door flap near the plate end (-x side), slightly ajar.
    this.addStatic(swayMat, 0.9, 2.1, [-CAGE_HALF_WIDTH_M + 0.12, 1.05, 0.9], Math.PI / 2 + 0.18);

    // Pre-settle every panel into its gravity belly so frame one is at rest.
    for (const p of this.panels) {
      for (let i = 0; i < Math.round(3 / CLOTH_DT); i++) {
        stepCloth(p.cloth, CLOTH_DT, CLOTH_SUBSTEPS, p.g.x, p.g.y, p.g.z);
      }
      this.writePanel(p);
      p.active = false;
    }
  }

  private addClothPanel(
    mat: THREE.Material,
    name: NetPanel,
    targetW: number,
    targetH: number,
    pitch: number,
    place: (m: THREE.Mesh) => void
  ): void {
    const colSpans = Math.max(2, Math.round(targetW / pitch));
    const rowSpans = Math.max(2, Math.round(targetH / pitch));
    const cols = colSpans + 1;
    const rows = rowSpans + 1;
    const cloth = createCloth(cols, rows, pitch, (c, r) => c === 0 || c === cols - 1 || r === 0 || r === rows - 1);

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(cloth.pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    const uvs = new Float32Array(cols * rows * 2);
    const scaleX = targetW / (colSpans * pitch);
    const scaleY = targetH / (rowSpans * pitch);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        uvs[i * 2] = (c * pitch * scaleX) / WEAVE_CELL_M;
        uvs[i * 2 + 1] = (r * pitch * scaleY) / WEAVE_CELL_M;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    place(mesh);
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.frustumCulled = false; // bounds change every impact; the cage is always in view
    mesh.updateMatrixWorld();
    this.group.add(mesh);

    // World gravity in the panel's local frame (rotation only — scale is xy).
    const g = new THREE.Vector3(0, -GRAVITY, 0).applyQuaternion(mesh.quaternion.clone().invert());

    const panel: Panel = { name, cloth, mesh, posAttr, g, active: true, dirty: false };
    this.panels.push(panel);
    this.byName.set(name, panel);
  }

  private addStatic(
    mat: THREE.Material,
    w: number,
    h: number,
    pos: [number, number, number],
    rotY: number,
    rotX = 0
  ): void {
    const geo = new THREE.PlaneGeometry(w, h, 8, 4);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (w / WEAVE_CELL_M), uv.getY(i) * (h / WEAVE_CELL_M));
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.rotation.y = rotY;
    mesh.rotation.x = rotX;
    this.group.add(mesh);
  }

  /**
   * §11 preset switch: only changes which panels step and the step rate —
   * the solver itself is untouched (M3-PLAN risk 5). Disabled panels rest in
   * their pre-settled gravity belly under the sway-shader look.
   */
  setQuality(panels: NetPanel[] | 'ALL', hz: number): void {
    this.enabled = new Set(panels === 'ALL' ? (['far', 'left', 'right', 'ceiling', 'back'] as NetPanel[]) : panels);
    this.clothDt = 1 / hz;
    for (const p of this.panels) {
      if (!this.enabled.has(p.name)) p.active = false;
    }
  }

  /** NET_HIT → momentum impulse into the struck panel along its normal. */
  onEvent(e: DomainEvent): void {
    if (e.type !== 'NET_HIT') return;
    const p = this.byName.get(e.panel);
    if (!p || !this.enabled.has(p.name)) return;
    // Impact world position → panel-local node grid (worldToLocal includes
    // the xy stretch, so local coords are cloth coords directly).
    const local = this.scratch.set(e.px, e.py, e.pz);
    p.mesh.worldToLocal(local);
    const cloth = p.cloth;
    const col = Math.round(local.x / cloth.spacing);
    const row = Math.round(-local.y / cloth.spacing);
    if (col < 0 || col >= cloth.cols || row < 0 || row >= cloth.rows) return;
    // The ball arrives along the panel normal (local −z); inject its pre-damp
    // speed there. applyImpulse clamps so a 102 EV rope can't tunnel (§3.4).
    applyImpulse(cloth, col, row, 0, 0, -e.speedMps);
    p.active = true;
  }

  /** Fixed-rate (60 Hz High / 30 Hz Medium) sub-accumulator (§11). */
  update(dt: number, timeS: number): void {
    this.swayUniforms.uTime.value = timeS;
    this.acc = Math.min(this.acc + dt, this.clothDt * 3); // hitch cap
    while (this.acc >= this.clothDt) {
      this.acc -= this.clothDt;
      for (const p of this.panels) {
        if (!p.active) continue;
        stepCloth(p.cloth, this.clothDt, CLOTH_SUBSTEPS, p.g.x, p.g.y, p.g.z);
        p.dirty = true;
        if (settleEnergy(p.cloth) < CLOTH_REST_ENERGY) p.active = false;
      }
    }
    for (const p of this.panels) {
      if (p.dirty) {
        this.writePanel(p);
        p.dirty = false;
      }
    }
  }

  /** Position upload + normals — once per render frame, active panels only. */
  private writePanel(p: Panel): void {
    p.posAttr.needsUpdate = true;
    p.mesh.geometry.computeVertexNormals();
  }
}
