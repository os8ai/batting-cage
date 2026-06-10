import * as THREE from 'three';
import { Diagnostics } from './app/Diagnostics';
import { EventBus } from './app/events';
import { GameLoop } from './app/GameLoop';
import { AudioEngine } from './audio/AudioEngine';
import { createCueContext, cuesForEvent } from './audio/cueMap';
import { CageSim } from './core/sim';
import { attachPointer } from './input/pointer';
import { attachSwingInput } from './input/swing';
import { attachUiKeys } from './input/uiKeys';
import { CageScene } from './scene/CageScene';
import { CameraRig } from './scene/CameraRig';
import { PostFX } from './scene/PostFX';
import { DebugHud } from './ui/overlay/DebugHud';
import { showSplash } from './ui/overlay/Splash';

// M1 boot (Flow 2): splash → scene init under it → click unlocks audio →
// cage fades in. Session seed: fixed per visit; the save-id seed is M3.
const sim = new CageSim({ seed: (Date.now() & 0xffffffff) >>> 0 });
const bus = new EventBus();
sim.onEvent((e) => bus.publish(e));

const splash = showSplash(document.body);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false; // composer renders multiple passes; we reset per frame
document.body.appendChild(renderer.domElement);

const cage = new CageScene();
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const postfx = new PostFX(renderer, cage.scene, rig.camera);
for (const g of cage.glowObjects) postfx.addGlow(g);

const audio = new AudioEngine();
rig.camera.add(audio.listener);
audio.machineAnchor.object.position.set(0, 1.2, 14.5);
audio.plateAnchor.object.position.set(0, 0.8, 0.2);
audio.panelAnchor.object.position.copy(cage.panel.group.position).setY(1.2);
cage.scene.add(audio.machineAnchor.object, audio.plateAnchor.object, audio.panelAnchor.object);

const hud = new DebugHud(document.body);
const diag = new Diagnostics(document.body);

// Presentation subscribers — one-way: core events → actors/board/audio/camera.
const cueCtx = createCueContext('WOOD');
bus.subscribe((e) => {
  cage.board.onEvent(e);
  cage.machine.onEvent(e);
  cage.batter.onEvent(e);
  hud.onEvent(e);
  for (const trig of cuesForEvent(e, cueCtx)) audio.trigger(trig, sim.currentTier);
  if (e.type === 'CONTACT') {
    rig.onContact(e.evMph, cueCtx.lastGrade ?? 'GOOD');
    cage.setBattedTrail(true);
  }
  if (e.type === 'NET_HIT') cage.flashNetHit();
  if (e.type === 'FEED' || e.type === 'BALL_SETTLED' || e.type === 'ROUND_END') cage.setBattedTrail(false);
  if (e.type === 'TOKEN') goToStation('PLAY');
});

// -- station interaction (camera director + machine panel) -------------------

function goToStation(name: 'PLAY' | 'PANEL' | 'RACK' | 'MONITOR'): void {
  rig.goTo(name, cage.stations[name]);
  cage.showFocus(name === 'PLAY' ? null : cage.stations[name].highlight);
  if (name !== 'PLAY') audio.confirmClick(); // §UX: audio confirm on selection
}

function confirmPanel(): void {
  const tier = cage.panel.confirm();
  if (sim.selectTier(tier)) {
    cage.machine.setTier(tier);
    audio.setTier(tier);
    hud.setTier(tier);
  }
  audio.confirmClick();
}

const idle = () => !sim.inRound;

attachUiKeys({
  onArrow: (dir) => {
    if (!idle()) return;
    if (rig.station !== 'PANEL') {
      goToStation('PANEL');
      cage.panel.setSelected(sim.currentTier);
    } else if (dir === 'up') {
      cage.panel.moveFocus(-1);
      audio.confirmClick();
    } else if (dir === 'down') {
      cage.panel.moveFocus(1);
      audio.confirmClick();
    }
  },
  onEnter: () => {
    if (idle() && rig.station === 'PANEL') confirmPanel();
  },
  onTab: () => {
    if (!idle()) return;
    goToStation(rig.station === 'MONITOR' ? 'PLAY' : 'MONITOR');
  },
  onEscape: () => {
    if (idle()) goToStation('PLAY');
  },
  onMute: () => {
    audio.toggleMute();
  },
  onHandedness: () => {
    if (!idle()) return;
    const h = cage.batter.handedness === 'R' ? 'L' : 'R';
    cage.setHandedness(h);
    rig.setHandedness(h);
    sim.handedness = h;
    audio.confirmClick();
  },
  onBat: () => {
    if (!idle()) return;
    const b = cage.batter.bat === 'WOOD' ? 'METAL' : 'WOOD';
    cage.setBat(b);
    cueCtx.bat = b;
    audio.confirmClick();
  },
  onToken: () => {
    // M0-DEBUG path until M3's token-slot station.
    sim.insertToken();
  },
  onToggleDiagnostics: () => {
    diag.toggle();
    hud.toggle();
  },
});

attachSwingInput({
  onSwing: (domTimeMs) => {
    if (loop.paused) return;
    if (idle()) {
      // SPACE confirms at the panel when no round is running (§UX).
      if (rig.station === 'PANEL') confirmPanel();
      return;
    }
    // Judge synchronously on arrival — analytic and sub-tick (§Architecture).
    sim.queueSwing(loop.simTimeOf(domTimeMs));
    diag.recordJudgeLatency(performance.now() - domTimeMs);
  },
});

attachPointer({
  dom: renderer.domElement,
  camera: rig.camera,
  panelFace: cage.panel.faceMesh,
  onPanelButton: (_i, uv) => {
    if (!idle()) return;
    const btn = cage.panel.buttonAtUv(uv.x, uv.y);
    if (btn === null) return;
    if (rig.station !== 'PANEL') goToStation('PANEL');
    cage.panel.setFocus(btn);
    confirmPanel();
  },
});

// -- loop ---------------------------------------------------------------------

let lastFrameMs = 0;
const loop = new GameLoop(
  sim,
  (alpha, nowMs) => {
    const dt = lastFrameMs > 0 ? Math.min(0.1, (nowMs - lastFrameMs) / 1000) : 1 / 60;
    lastFrameMs = nowMs;
    const timeS = nowMs / 1000;
    rig.update(timeS, dt);
    cage.update(sim, alpha, dt, timeS);
    renderer.info.reset();
    postfx.render();
    diag.setRenderInfo(renderer.info);
    diag.frame(nowMs);
  },
  () => cage.postTick(sim)
);

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
  postfx.setSize(window.innerWidth, window.innerHeight);
  rig.resize(window.innerWidth / window.innerHeight);
});

// Dev/CI hook (?dev=1): exposes the sim + loop for the scripted smoke run.
if (new URLSearchParams(window.location.search).has('dev')) {
  (window as unknown as Record<string, unknown>).__bc = { sim, loop, rig, cage };
}

// The splash click is the audio-unlock gesture; the loop starts under the fade.
void splash.clicked.then(async () => {
  await audio.unlock();
  splash.dismiss();
  loop.start();
});
