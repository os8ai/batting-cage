import type { NetPanel } from '../core/types';

/**
 * §11 quality presets. The table is data; apply paths live in Lighting /
 * PostFX / Net / main (renderer scale). Auto-detect: a hidden ~120-frame
 * probe at High on first run; median fps < 55 → Medium, < 40 → Low (M3-PLAN
 * design note 7). The decision logic is pure and unit-tested.
 */
export type Preset = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PresetConfig {
  /** Render scale (× devicePixelRatio). */
  renderScale: number;
  /** Real-time shadow casters: 2 (key+fill), 1 (key), 0 (contact blobs only). */
  shadowCasters: 0 | 1 | 2;
  keyShadowMapSize: number;
  fillShadowMapSize: number;
  bloom: 'FULL' | 'HALF' | 'OFF';
  smaa: boolean;
  /** Cloth: which panels stay Verlet-simulated; [] = sway shader only. */
  clothPanels: NetPanel[] | 'ALL';
  clothHz: number;
  settledShadows: boolean;
}

export const PRESETS: Record<Preset, PresetConfig> = {
  HIGH: {
    renderScale: 1.0,
    shadowCasters: 2,
    keyShadowMapSize: 2048,
    fillShadowMapSize: 1024,
    bloom: 'FULL',
    smaa: true,
    clothPanels: 'ALL',
    clothHz: 60,
    settledShadows: true,
  },
  MEDIUM: {
    renderScale: 1.0,
    shadowCasters: 1,
    keyShadowMapSize: 1024,
    fillShadowMapSize: 1024,
    bloom: 'HALF',
    smaa: false,
    clothPanels: ['far', 'ceiling'], // §11: the two panels most hits test
    clothHz: 30,
    settledShadows: true,
  },
  LOW: {
    renderScale: 0.85,
    shadowCasters: 0,
    keyShadowMapSize: 512,
    fillShadowMapSize: 512,
    bloom: 'OFF', // ACES only
    smaa: false,
    clothPanels: [], // sway shader only
    clothHz: 30,
    settledShadows: false,
  },
};

/** Auto-detect thresholds (§11): < 55 fps median → Medium; < 40 → Low. */
export function decidePreset(medianFps: number): Preset {
  if (medianFps < 40) return 'LOW';
  if (medianFps < 55) return 'MEDIUM';
  return 'HIGH';
}

export const PROBE_FRAMES = 120;
export const PROBE_WARMUP_FRAMES = 30;

/**
 * Frame-dt collector for the first-run probe: feed render dts, read the
 * decision once enough frames landed (warmup discarded). Pure & testable.
 */
export class AutoDetectProbe {
  private dts: number[] = [];
  private seen = 0;

  /** Returns the decided preset once, null while still sampling. */
  feed(dtS: number): Preset | null {
    this.seen += 1;
    if (this.seen <= PROBE_WARMUP_FRAMES) return null;
    if (dtS > 0) this.dts.push(dtS);
    if (this.dts.length < PROBE_FRAMES) return null;
    const sorted = [...this.dts].sort((a, b) => a - b);
    const medianDt = sorted[Math.floor(sorted.length / 2)]!;
    return decidePreset(1 / medianDt);
  }
}
