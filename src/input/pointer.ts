import * as THREE from 'three';

/**
 * Mouse click parity (§Inputs): panels and board prompts are clickable; the
 * mouse never swings. M1 wires the machine-panel buttons; more click targets
 * join in M3 with the full station set.
 */
export function attachPointer(opts: {
  dom: HTMLElement;
  camera: THREE.Camera;
  panelFace: THREE.Mesh;
  onPanelButton: (index: number, uv: THREE.Vector2) => void;
}): () => void {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const handler = (e: PointerEvent) => {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, opts.camera);
    const hits = ray.intersectObject(opts.panelFace, false);
    const hit = hits[0];
    if (hit?.uv) opts.onPanelButton(-1, hit.uv);
  };
  opts.dom.addEventListener('pointerdown', handler);
  return () => opts.dom.removeEventListener('pointerdown', handler);
}
