import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import * as THREE from 'three';

/**
 * §How post chain on the WebGL2 baseline: pmndrs `postprocessing` merged-pass
 * EffectPass — selective bloom (LED board, status light, fixtures) → ACES
 * filmic tonemapping → SMAA. §11 presets rebuild the chain (a menu moment —
 * full rebuild on ESC change is acceptable, M3-PLAN design note 7):
 * HIGH = full bloom + SMAA · MEDIUM = half-res bloom · LOW = ACES only.
 */
export type BloomMode = 'FULL' | 'HALF' | 'OFF';

export class PostFX {
  private composer: EffectComposer;
  private bloom: SelectiveBloomEffect | null = null;
  private pass: EffectPass | null = null;
  private glow = new Set<THREE.Object3D>();
  private mode: { bloom: BloomMode; smaa: boolean } = { bloom: 'FULL', smaa: true };
  private w = 0;
  private h = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera
  ) {
    // The chain owns tonemapping; the renderer must not double-apply it.
    renderer.toneMapping = THREE.NoToneMapping;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));
    this.buildPass();
  }

  private buildPass(): void {
    if (this.pass) {
      this.composer.removePass(this.pass);
      this.pass.dispose();
      this.pass = null;
    }
    this.bloom = null;
    const effects = [];
    if (this.mode.bloom !== 'OFF') {
      // HIGH keeps the library-default half-res bloom buffer (the M1/M2
      // chain — full-res costs ~1 ms/frame and slips vsync); MEDIUM halves
      // it again (§11 "half-res bloom" relative to High).
      this.bloom = new SelectiveBloomEffect(this.scene, this.camera, {
        mipmapBlur: true,
        intensity: 1.15,
        luminanceThreshold: 0.12,
        luminanceSmoothing: 0.2,
        radius: 0.7,
        resolutionScale: this.mode.bloom === 'HALF' ? 0.25 : 0.5,
      });
      this.bloom.ignoreBackground = true;
      this.bloom.inverted = false;
      for (const obj of this.glow) this.bloom.selection.add(obj);
      effects.push(this.bloom);
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    if (this.mode.smaa) effects.push(new SMAAEffect());
    this.pass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.pass);
    if (this.w > 0) this.composer.setSize(this.w, this.h);
  }

  /** §11 preset switch — rebuilds the merged pass. */
  applyPreset(bloom: BloomMode, smaa: boolean): void {
    if (this.mode.bloom === bloom && this.mode.smaa === smaa) return;
    this.mode = { bloom, smaa };
    this.buildPass();
  }

  /** Mark an object as a bloom source (board face, status light, fixtures). */
  addGlow(obj: THREE.Object3D): void {
    this.glow.add(obj);
    this.bloom?.selection.add(obj);
  }

  removeGlow(obj: THREE.Object3D): void {
    this.glow.delete(obj);
    this.bloom?.selection.delete(obj);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
