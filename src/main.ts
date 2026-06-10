import * as THREE from 'three';
import { Diagnostics } from './app/Diagnostics';
import { EventBus } from './app/events';
import { GameLoop } from './app/GameLoop';
import { CageSim } from './core/sim';
import { attachSwingInput } from './input/swing';
import { attachUiKeys } from './input/uiKeys';
import { CageScene } from './scene/CageScene';
import { CameraRig } from './scene/CameraRig';
import { DebugHud } from './ui/overlay/DebugHud';

// M0 boots straight into the greybox scene (the splash/audio-unlock is M1+ —
// no audio exists yet). Session seed: fixed per visit; the save id arrives in M3.
const sim = new CageSim({ seed: (Date.now() & 0xffffffff) >>> 0 });
const bus = new EventBus();
sim.onEvent((e) => bus.publish(e));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const cage = new CageScene();
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const hud = new DebugHud(document.body);
const diag = new Diagnostics(document.body);
bus.subscribe((e) => hud.onEvent(e));

const loop = new GameLoop(
  sim,
  (alpha, nowMs) => {
    rig.update(nowMs / 1000);
    cage.update(sim, alpha);
    renderer.render(cage.scene, rig.camera);
    diag.frame(nowMs);
  },
  () => cage.postTick(sim)
);

attachSwingInput({
  onSwing: (domTimeMs) => {
    if (loop.paused) return;
    // Judge synchronously on arrival — analytic and sub-tick (§Architecture).
    sim.queueSwing(loop.simTimeOf(domTimeMs));
    diag.recordJudgeLatency(performance.now() - domTimeMs);
  },
});

attachUiKeys({
  onTierSelect: (tier) => {
    if (sim.selectTier(tier)) hud.setTier(tier);
  },
  onToken: () => {
    sim.insertToken();
  },
  onToggleDiagnostics: () => diag.toggle(),
});

// Window blur auto-pauses and voids any in-flight pitch — re-fed, no penalty (§Inputs).
window.addEventListener('blur', () => {
  loop.setPaused(true);
});
window.addEventListener('focus', () => {
  sim.voidCurrentPitch();
  loop.setPaused(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.setPaused(true);
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.resize(window.innerWidth / window.innerHeight);
});

loop.start();
