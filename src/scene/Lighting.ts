import * as THREE from 'three';
import { FT_TO_M, RELEASE_DIST_M } from '../core/constants';

/**
 * §4 lighting rig: six high-bay fixtures in a line above the cage; two cast
 * real-time shadows (key over the plate, fill over the machine), four are
 * emissive-only housings that read through bloom. Pools of light on the turf;
 * the facility beyond falls off to near-dark. Dust motes drift in the two key
 * beams (High preset — M1 builds High only).
 */
export class Lighting {
  readonly group = new THREE.Group();
  /** Fixture housings to include in the selective-bloom pass. */
  readonly glowMeshes: THREE.Mesh[] = [];


  constructor() {
    // Near-dark base so the facility never goes fully black.
    this.group.add(new THREE.HemisphereLight(0x39414d, 0x101113, 0.5));

    const fixtureY = 16.5 * FT_TO_M;
    const lineZ = [2, 12, 22, 32, 42, 52].map((ft) => ft * FT_TO_M);
    const housingGeo = new THREE.CylinderGeometry(0.32, 0.42, 0.3, 12);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.7 });
    const lensGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xfff3dc,
      emissive: 0xfff0d0,
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });

    // One instanced draw each for the six housings and six lenses (§12).
    const housings = new THREE.InstancedMesh(housingGeo, housingMat, 6);
    const lenses = new THREE.InstancedMesh(lensGeo, lensMat, 6);
    const im = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const z = lineZ[i]!;
      im.makeTranslation(0, fixtureY, z);
      housings.setMatrixAt(i, im);
      im.makeTranslation(0, fixtureY - 0.17, z);
      lenses.setMatrixAt(i, im);
    }
    this.group.add(housings, lenses);
    this.glowMeshes.push(lenses as unknown as THREE.Mesh);

    // Key: shadow caster over the plate (§4 — 2048 soft).
    const key = new THREE.SpotLight(0xfff2dd, 260, 0, 0.62, 0.45, 1.6);
    key.position.set(0, fixtureY, 2 * FT_TO_M);
    key.target.position.set(0, 0, 0.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 12;
    this.group.add(key, key.target);

    // Fill: shadow caster over the machine (1024).
    const fill = new THREE.SpotLight(0xf4ecdc, 200, 0, 0.6, 0.5, 1.6);
    fill.position.set(0, fixtureY, 42 * FT_TO_M);
    fill.target.position.set(0, 0, RELEASE_DIST_M);
    fill.castShadow = true;
    fill.shadow.mapSize.set(1024, 1024);
    fill.shadow.bias = -0.0004;
    fill.shadow.radius = 5;
    fill.shadow.camera.near = 1;
    fill.shadow.camera.far = 12;
    this.group.add(fill, fill.target);

    // Mid-tunnel pools from the emissive-only fixtures (no shadows — cheap).
    for (const zFt of [12, 22, 32, 52]) {
      const pool = new THREE.SpotLight(0xf2e9d8, 90, 0, 0.55, 0.6, 1.7);
      pool.position.set(0, fixtureY, zFt * FT_TO_M);
      pool.target.position.set(0, 0, zFt * FT_TO_M);
      this.group.add(pool, pool.target);
    }

    // (Dust motes were tried here and cut — they read as falling snow on the
    // dark facility backdrop. Owner playtest, M1.)
  }

  update(_dt: number, _timeS: number): void {
    // No per-frame lighting animation in M1.
  }
}
