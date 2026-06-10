import * as THREE from 'three';
import { Diagnostics } from './app/Diagnostics';
import { EventBus } from './app/events';
import { GameLoop } from './app/GameLoop';
import { AutoDetectProbe, PRESETS, type Preset } from './app/Quality';
import { AudioEngine } from './audio/AudioEngine';
import { createCueContext, cuesForBoardSignal, cuesForEvent } from './audio/cueMap';
import { TIERS } from './core/constants';
import { CageSim } from './core/sim';
import { ModeStack, routeSpace } from './input/modes';
import { attachPointer } from './input/pointer';
import { attachSwingInput } from './input/swing';
import { attachUiKeys } from './input/uiKeys';
import { bootPersistence, downloadText, pickFileText, requestDurableStorage } from './persist/browser';
import { exportSaveJson, importSaveJson, suggestedExportName } from './persist/exportImport';
import { refusalMessage } from './persist/migrate';
import { Recorder, type RoundOutcome } from './persist/recorder';
import { careerFromSave, TIER_KEYS, type SaveV1 } from './persist/schema';
import { CageScene } from './scene/CageScene';
import { CameraRig } from './scene/CameraRig';
import { PostFX } from './scene/PostFX';
import type { AttractData, BoardSignal } from './ui/diegetic/boardPages/pageMachine';
import { EscSheet } from './ui/overlay/EscSheet';
import { showSplash } from './ui/overlay/Splash';
import { KeyHints, Toasts } from './ui/overlay/Toasts';

// M3 boot (Flow 2): persistence first — the save id seeds the sim (§6
// determinism: replays differ between careers, repeat within one), the career
// snapshot gates the tiers, and the loadout auto-resumes.
const persisted = bootPersistence();
const save: SaveV1 = persisted.save;
const recorder = new Recorder(persisted.store, save, persisted.clock);

const totalRounds = (s: SaveV1): number =>
  TIER_KEYS.reduce((n, k) => n + s.tiers[k].lifetimeAverages.rounds, 0);

const sim = new CageSim({
  seed: save.meta.saveId,
  career: careerFromSave(save),
  handedness: save.loadout.handedness,
});
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
audio.boardAnchor.object.position.copy(cage.board.group.position);
cage.scene.add(
  audio.machineAnchor.object,
  audio.plateAnchor.object,
  audio.panelAnchor.object,
  audio.boardAnchor.object,
  audio.impacts.group,
  audio.ballAnchor
);

const diag = new Diagnostics(document.body);
const modes = new ModeStack();
const toasts = new Toasts(document.body);
const keyHints = new KeyHints(document.body);

// -- quality presets (§11) ----------------------------------------------------

function applyPreset(preset: Preset): void {
  const cfg = PRESETS[preset];
  cage.lighting.applyShadowPreset(cfg.shadowCasters, cfg.keyShadowMapSize, cfg.fillShadowMapSize);
  postfx.applyPreset(cfg.bloom, cfg.smaa);
  cage.net.setQuality(cfg.clothPanels, cfg.clothHz);
  cage.setSettledShadows(cfg.settledShadows);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * cfg.renderScale);
  postfx.setSize(window.innerWidth, window.innerHeight);
}

// First run probes ~120 hidden frames at High, then decides (design note 7).
let probe: AutoDetectProbe | null = save.settings.qualityPreset === null ? new AutoDetectProbe() : null;
applyPreset(save.settings.qualityPreset ?? 'HIGH');

// -- loadout auto-resume (§Flow 2: returning player's loadout preselected) ----

function attractDataFromSave(s: SaveV1): AttractData {
  return {
    firstRun: totalRounds(s) === 0,
    top5ByTier: TIER_KEYS.map((k, i) => ({
      tier: TIERS[i]!,
      entries: s.tiers[k].top5.map((e) => ({ initials: e.initials, score: e.score })),
    })),
    pbs: TIER_KEYS.map((k, i) => ({
      tier: TIERS[i]!,
      bestRoundScore: s.tiers[k].pbs.bestRoundScore,
      longestCarryFt: s.tiers[k].pbs.longestCarryFt,
    })),
  };
}

function refreshCareerSurfaces(): void {
  cage.panel.setUnlocked(sim.unlockedTiers);
  cage.monitor.setSave(save);
  cage.board.setAttractData(attractDataFromSave(save));
}

cage.setHandedness(save.loadout.handedness);
rig.setHandedness(save.loadout.handedness);
cage.setBat(save.loadout.bat);
const cueCtx = createCueContext(save.loadout.bat);
if (sim.selectTier(save.loadout.lastTier)) {
  cage.machine.setTier(save.loadout.lastTier);
  audio.setTier(save.loadout.lastTier);
  cage.panel.setSelected(save.loadout.lastTier);
}
cage.board.machine.setCoachEnabled(totalRounds(save) === 0);
refreshCareerSurfaces();
audio.setVolumes(save.settings.volumes);
audio.setMuted(save.settings.muted);

// -- ESC sheet: pause + the flat system concession (§UX) ----------------------

const escSheet = new EscSheet(document.body, {
  onPreset: (preset) => {
    applyPreset(preset);
    save.settings.qualityPreset = preset;
    recorder.markDirty();
    probe = null; // a manual choice ends the auto-detect
  },
  onVolumes: (v) => {
    save.settings.volumes = audio.setVolumes(v);
    recorder.markDirty();
  },
  onExport: () => {
    recorder.flush();
    downloadText(suggestedExportName(persisted.clock.nowISO()), exportSaveJson(save));
    toasts.show('SAVE EXPORTED');
  },
  onImport: () => {
    void pickFileText().then((text) => {
      if (text === null) return;
      const result = importSaveJson(text);
      if (!result.ok) {
        // §14.18: refused with a board message, prior save intact.
        cage.board.showNotice(refusalMessage(result.reason), sim.t);
        toasts.show(refusalMessage(result.reason));
        return;
      }
      if (!persisted.store.write(result.save)) {
        toasts.show('IMPORT FAILED TO WRITE');
        return;
      }
      window.location.reload(); // boot re-reads the promoted save
    });
  },
  onReset: () => {
    persisted.store.clear();
    window.location.reload();
  },
});

function openEscSheet(): void {
  modes.push('ESC');
  escSheet.setState(save.settings.qualityPreset, audio.getVolumes());
  escSheet.open();
  loop.setPaused(true); // sim pause…
  audio.suspend(); // …+ AudioContext suspend (§ESC pause)
}

function closeEscSheet(): void {
  escSheet.close();
  modes.pop('ESC');
  audio.resume();
  recorder.flush();
  if (!document.hidden) loop.setPaused(false);
}

// -- persistence subscriber (FIRST: the round outcome feeds the board) -------

let lastOutcome: RoundOutcome | null = null;
let durableRequested = false;
bus.subscribe((e) => {
  const outcome = recorder.onEvent(e);
  if (e.type === 'ROUND_END') {
    lastOutcome = outcome;
    if (!durableRequested) {
      durableRequested = true;
      requestDurableStorage();
    }
  }
});

// -- presentation subscribers — one-way: core events → actors/board/audio ----

bus.subscribe((e) => {
  cage.board.onEvent(e);
  cage.machine.onEvent(e);
  cage.batter.onEvent(e);
  cage.net.onEvent(e);
  for (const trig of cuesForEvent(e, cueCtx)) audio.trigger(trig, sim.currentTier);
  if (e.type === 'CONTACT') {
    rig.onContact(e.evMph, cueCtx.lastGrade ?? 'GOOD');
    cage.setBattedTrail(true);
  }
  if (e.type === 'FEED' || e.type === 'BALL_SETTLED' || e.type === 'ROUND_END') cage.setBattedTrail(false);
  if (e.type === 'TOKEN') {
    goToStation('PLAY');
    cage.startSweep(); // between-round feeder-cart sweep, inside SPINUP's 3 s
  }
  if (e.type === 'TIER_UNLOCKED') {
    cage.panel.setUnlocked(sim.unlockedTiers); // relight live (§UX)
  }
  if (e.type === 'ROUND_END') {
    if (lastOutcome?.madeTop5) cage.board.machine.requestInitials(save.loadout.lastInitials);
    cage.board.machine.setCoachEnabled(false); // first round complete → coaching done
    refreshCareerSurfaces();
    // Off-device backup nudge after a PB (browser storage is evictable).
    if (e.isPB) toasts.show('NEW PB · ESC TO EXPORT SAVE', 5000);
  }
  if (e.type === 'TOKEN') keyHints.hide();
});

// -- station interaction (camera director + machine panel) -------------------

function goToStation(name: 'PLAY' | 'PANEL' | 'RACK' | 'MONITOR' | 'BOARD'): void {
  rig.goTo(name, cage.stations[name]);
  cage.showFocus(name === 'PLAY' ? null : cage.stations[name].highlight);
  if (name !== 'PLAY') audio.confirmClick(); // §UX: audio confirm on every selection
}

function confirmPanel(): void {
  const tier = cage.panel.confirm();
  if (tier === null) {
    audio.refuseClick(); // locked pick (§UX refusal)
    return;
  }
  if (sim.selectTier(tier)) {
    cage.machine.setTier(tier);
    audio.setTier(tier);
    recorder.setLoadout({ lastTier: tier });
  }
  audio.confirmClick();
}

const idle = () => !sim.inRound;

// -- attract mode (design note 6): no round + no input for a beat ------------

const ATTRACT_AFTER_MS = 25_000;
let lastInputMs = performance.now() - ATTRACT_AFTER_MS; // boot lands in attract
function noteInput(): void {
  lastInputMs = performance.now();
  if (rig.attract) goToStation('PLAY'); // any key wakes (§What 10)
}

// -- board signal plumbing (ceremony cues, initials completion) --------------

function handleBoardSignals(signals: BoardSignal[]): void {
  for (const s of signals) {
    for (const trig of cuesForBoardSignal(s, sim.t)) audio.trigger(trig, sim.currentTier);
    if (s.kind === 'INITIALS_DONE') {
      recorder.setInitials(s.initials);
      modes.pop('INITIALS');
      goToStation('PLAY');
      refreshCareerSurfaces();
    }
  }
  if (cage.board.machine.inInitials && modes.mode === 'PLAY') {
    modes.push('INITIALS');
    goToStation('BOARD'); // push in for the entry (§UX board station)
  }
}

attachUiKeys({
  onArrow: (dir) => {
    noteInput();
    if (modes.mode === 'INITIALS') {
      handleBoardSignals(cage.board.initialsInput(dir, sim.t));
      audio.confirmClick();
      return;
    }
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
    noteInput();
    if (modes.mode === 'INITIALS') {
      handleBoardSignals(cage.board.initialsInput('confirm', sim.t));
      return;
    }
    if (idle() && rig.station === 'PANEL') confirmPanel();
  },
  onTab: () => {
    noteInput();
    if (modes.mode !== 'PLAY' || !idle()) return;
    if (rig.station !== 'MONITOR') {
      goToStation('MONITOR');
    } else {
      cage.monitor.cycle(); // §9: TAB cycles PBS/AVERAGES/MEDALS/SESSIONS/TREND
      audio.confirmClick();
    }
  },
  onEscape: () => {
    noteInput();
    if (modes.mode === 'ESC') {
      closeEscSheet();
      return;
    }
    if (modes.mode === 'INITIALS') {
      // Skippable (§What 7): accept the current letters.
      for (let i = 0; i < 3 && cage.board.machine.inInitials; i++) {
        handleBoardSignals(cage.board.initialsInput('confirm', sim.t));
      }
      return;
    }
    openEscSheet();
  },
  onMute: () => {
    noteInput();
    save.settings.muted = audio.toggleMute();
    recorder.markDirty();
  },
  onHandedness: () => {
    noteInput();
    if (!idle()) return;
    const h = cage.batter.handedness === 'R' ? 'L' : 'R';
    cage.setHandedness(h);
    rig.setHandedness(h);
    sim.handedness = h;
    recorder.setLoadout({ handedness: h });
    audio.confirmClick();
  },
  onBat: () => {
    noteInput();
    if (!idle()) return;
    const b = cage.batter.bat === 'WOOD' ? 'METAL' : 'WOOD';
    cage.setBat(b);
    cueCtx.bat = b;
    recorder.setLoadout({ bat: b });
    audio.confirmClick();
  },
  onToggleDiagnostics: () => {
    diag.toggle();
  },
});

attachSwingInput({
  onSwing: (domTimeMs) => {
    const action = routeSpace({
      mode: modes.mode,
      paused: loop.paused,
      inRound: sim.inRound,
      station: rig.attract ? 'PLAY' : rig.station,
      panelFocusTier: cage.panel.focusedTier,
      selectedTier: sim.currentTier,
    });
    if (action !== 'SWING') noteInput();
    switch (action) {
      case 'SWING':
        // Judge synchronously on arrival — analytic and sub-tick (§Architecture).
        sim.queueSwing(loop.simTimeOf(domTimeMs));
        diag.recordJudgeLatency(performance.now() - domTimeMs);
        break;
      case 'PANEL_CONFIRM':
        confirmPanel();
        break;
      case 'TOKEN':
        // The token slot (§UX station c): SPACE inserts; from round end this
        // is the one-key hot-seat re-token at the same tier (§14.13).
        sim.insertToken();
        break;
      case 'INITIALS_CONFIRM':
        handleBoardSignals(cage.board.initialsInput('confirm', sim.t));
        break;
      case 'NONE':
        break;
    }
  },
});

attachPointer({
  dom: renderer.domElement,
  camera: rig.camera,
  panelFace: cage.panel.faceMesh,
  onPanelButton: (_i, uv) => {
    noteInput();
    if (!idle() || modes.mode !== 'PLAY') return;
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
    if (probe) {
      const decided = probe.feed(dt);
      if (decided !== null) {
        probe = null;
        applyPreset(decided);
        save.settings.qualityPreset = decided;
        recorder.markDirty();
        toasts.show(`QUALITY ${decided} (AUTO)`);
      }
    }
    handleBoardSignals(cage.board.drive(sim.t));
    if (!rig.attract && idle() && modes.mode === 'PLAY' && nowMs - lastInputMs > ATTRACT_AFTER_MS) {
      rig.startAttract();
    }
    rig.update(timeS, dt);
    cage.update(sim, alpha, dt, timeS);
    audio.updateBall(cage.ballRenderPos(), dt);
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
  if (modes.mode === 'ESC') return; // the sheet owns the pause
  sim.voidCurrentPitch();
  loop.setPaused(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    loop.setPaused(true);
    recorder.flush(); // §Data model: flush on visibilitychange
  }
});
window.addEventListener('beforeunload', () => {
  recorder.flush();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
  rig.resize(window.innerWidth / window.innerHeight);
});

// Dev-only tuning panel (?tune=1, M4): the env guard is statically false in
// `vite build`, so the dynamic chunk — and lil-gui with it — never reaches
// dist/ (triple-fenced: env gate, devDependency, load-budget grep).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('tune')) {
  void import('./app/TunePanel').then((m) => m.mountTunePanel());
}

// Dev/CI hook (?dev=1): exposes the works for the scripted smoke/acceptance runs.
if (new URLSearchParams(window.location.search).has('dev')) {
  (window as unknown as Record<string, unknown>).__bc = {
    sim,
    loop,
    rig,
    cage,
    renderer,
    save,
    recorder,
    store: persisted.store,
    modes,
  };
}

// The splash click is the audio-unlock gesture; the loop starts under the fade.
void splash.clicked.then(async () => {
  await audio.unlock();
  audio.setMuted(save.settings.muted); // re-assert over the fresh bus graph
  splash.dismiss();
  keyHints.show();
  loop.start();
});
