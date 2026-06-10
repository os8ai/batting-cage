/**
 * §10 volume buses: Master / SFX / Ambience (ESC sliders + M mute). The
 * GainNodes live in AudioEngine; this is the pure, headless-tested part —
 * clamping and the cue→bus routing table.
 */
export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 1, sfx: 1, ambience: 1 };

export function clampVolumes(v: Partial<Volumes>): Volumes {
  const c = (x: number | undefined, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;
  return {
    master: c(v.master, 1),
    sfx: c(v.sfx, 1),
    ambience: c(v.ambience, 1),
  };
}

export type Bus = 'sfx' | 'ambience';

/**
 * Every §10 cue is an SFX-bus voice except the room-tone bed (Ambience).
 * Engine-owned sources (room tone) are routed by name here so the inventory
 * test can assert the full routing.
 */
export function busForSource(source: string): Bus {
  return source === 'roomTone' ? 'ambience' : 'sfx';
}
