/**
 * Swing-clip retiming math (§6 K anchor). The core judges every swing with a
 * fixed keydown→contact offset of K = 150 ms (`SWING_CONTACT_OFFSET_S`); the
 * batter's swing clip — whatever its source (the procedural rig today, a
 * Mixamo clip later) — must reach its contact frame at exactly that moment.
 * Pure math, no Three.js: headless-tested in tests/swingRetiming.test.ts (E5).
 */
export interface SwingClipMeta {
  /** Total clip duration, seconds (at timeScale 1). */
  durationS: number;
  /** Clip-local time of the contact frame, seconds (at timeScale 1). */
  contactTimeS: number;
}

/**
 * Playback timeScale so that keydown (clip start) → contact frame takes
 * exactly `targetOffsetS` of wall time: contactTimeS / rate = target.
 */
export function swingTimeScale(meta: SwingClipMeta, targetOffsetS: number): number {
  if (!(targetOffsetS > 0)) throw new Error('targetOffsetS must be > 0');
  if (!(meta.contactTimeS > 0) || meta.contactTimeS > meta.durationS) {
    throw new Error('contactTimeS must be inside the clip');
  }
  return meta.contactTimeS / targetOffsetS;
}

/** Wall-clock delay from clip start to the contact frame at a given timeScale. */
export function contactDelayS(meta: SwingClipMeta, timeScale: number): number {
  return meta.contactTimeS / timeScale;
}

/** Wall-clock duration of the whole retimed clip. */
export function retimedDurationS(meta: SwingClipMeta, timeScale: number): number {
  return meta.durationS / timeScale;
}
