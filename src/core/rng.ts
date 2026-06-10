/**
 * mulberry32 — the spec-mandated seeded RNG (§External dependencies).
 * Per-pitch streams are derived from (session seed, round counter, pitch #)
 * per §6 Determinism, so identical inputs replay identically.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed combine (save/session id, round counter, pitch #). */
export function pitchSeed(sessionSeed: number, round: number, pitch: number): number {
  let h = sessionSeed >>> 0;
  h = (h ^ Math.imul(round + 1, 2654435761)) >>> 0;
  h = (h ^ Math.imul(pitch + 1, 40503)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function pitchRng(sessionSeed: number, round: number, pitch: number): Rng {
  return mulberry32(pitchSeed(sessionSeed, round, pitch));
}
