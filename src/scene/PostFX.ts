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
 * filmic tonemapping → SMAA (High preset; Medium/Low fallbacks are M3).
 */
export class PostFX {
  private composer: EffectComposer;
  private bloom: SelectiveBloomEffect;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // The chain owns tonemapping; the renderer must not double-apply it.
    renderer.toneMapping = THREE.NoToneMapping;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new SelectiveBloomEffect(scene, camera, {
      mipmapBlur: true,
      intensity: 1.15,
      luminanceThreshold: 0.12,
      luminanceSmoothing: 0.2,
      radius: 0.7,
    });
    this.bloom.ignoreBackground = true;
    this.bloom.inverted = false;

    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const smaa = new SMAAEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, smaa));
  }

  /** Mark an object as a bloom source (board face, status light, fixtures). */
  addGlow(obj: THREE.Object3D): void {
    this.bloom.selection.add(obj);
  }

  removeGlow(obj: THREE.Object3D): void {
    this.bloom.selection.delete(obj);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
