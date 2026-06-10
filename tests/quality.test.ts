import { describe, expect, it } from 'vitest';
import { AutoDetectProbe, decidePreset, PRESETS, PROBE_FRAMES, PROBE_WARMUP_FRAMES } from '../src/app/Quality';
import { busForSource, clampVolumes } from '../src/audio/buses';

/** §11 preset table + auto-detect decision logic (E8). */

describe('§11 preset table', () => {
  it('HIGH: full fidelity', () => {
    expect(PRESETS.HIGH).toMatchObject({
      renderScale: 1,
      shadowCasters: 2,
      keyShadowMapSize: 2048,
      fillShadowMapSize: 1024,
      bloom: 'FULL',
      smaa: true,
      clothPanels: 'ALL',
      clothHz: 60,
      settledShadows: true,
    });
  });

  it('MEDIUM: 1 caster/1024, half-res bloom, far+ceiling cloth @30, settled shadows on', () => {
    expect(PRESETS.MEDIUM).toMatchObject({
      renderScale: 1,
      shadowCasters: 1,
      keyShadowMapSize: 1024,
      bloom: 'HALF',
      smaa: false,
      clothPanels: ['far', 'ceiling'],
      clothHz: 30,
      settledShadows: true,
    });
  });

  it('LOW: blob shadows, ACES only, sway shader only, 85% scale', () => {
    expect(PRESETS.LOW).toMatchObject({
      renderScale: 0.85,
      shadowCasters: 0,
      bloom: 'OFF',
      smaa: false,
      clothPanels: [],
      settledShadows: false,
    });
  });
});

describe('auto-detect decision (§11: <55 → MEDIUM, <40 → LOW)', () => {
  it('threshold table', () => {
    expect(decidePreset(60)).toBe('HIGH');
    expect(decidePreset(55)).toBe('HIGH');
    expect(decidePreset(54.9)).toBe('MEDIUM');
    expect(decidePreset(40)).toBe('MEDIUM');
    expect(decidePreset(39.9)).toBe('LOW');
    expect(decidePreset(12)).toBe('LOW');
  });

  it('the probe discards warmup, needs ~120 frames, decides once', () => {
    const probe = new AutoDetectProbe();
    let decided: string | null = null;
    let frames = 0;
    while (decided === null) {
      decided = probe.feed(1 / 90); // a 90 fps machine
      frames += 1;
      expect(frames).toBeLessThan(PROBE_FRAMES + PROBE_WARMUP_FRAMES + 2);
    }
    expect(decided).toBe('HIGH');
    expect(frames).toBe(PROBE_FRAMES + PROBE_WARMUP_FRAMES);
  });

  it('a 30 fps machine probes to LOW; a 48 fps machine to MEDIUM', () => {
    for (const [fps, want] of [
      [30, 'LOW'],
      [48, 'MEDIUM'],
    ] as const) {
      const probe = new AutoDetectProbe();
      let decided: string | null = null;
      while (decided === null) decided = probe.feed(1 / fps);
      expect(decided).toBe(want);
    }
  });

  it('the median rides out hitches', () => {
    const probe = new AutoDetectProbe();
    let i = 0;
    let decided: string | null = null;
    while (decided === null) {
      // Mostly 60 fps with every 10th frame a 100 ms hitch.
      decided = probe.feed(++i % 10 === 0 ? 0.1 : 1 / 60);
    }
    expect(decided).toBe('HIGH');
  });
});

describe('volume buses (§10: Master/SFX/Ambience)', () => {
  it('clamps to [0,1] and fills gaps', () => {
    expect(clampVolumes({ master: 1.7, sfx: -0.3, ambience: 0.5 })).toEqual({
      master: 1,
      sfx: 0,
      ambience: 0.5,
    });
    expect(clampVolumes({})).toEqual({ master: 1, sfx: 1, ambience: 1 });
    expect(clampVolumes({ master: Number.NaN })).toEqual({ master: 1, sfx: 1, ambience: 1 });
  });

  it('routing: the room-tone bed rides Ambience; every cue rides SFX', () => {
    expect(busForSource('roomTone')).toBe('ambience');
    for (const cue of ['contactWood', 'whirrLoop', 'medalStamp', 'countUpStart', 'boardTick', 'panelClick']) {
      expect(busForSource(cue)).toBe('sfx');
    }
  });
});
