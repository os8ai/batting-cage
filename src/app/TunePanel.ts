import GUI from 'lil-gui';
import { TIERS } from '../core/constants';
import {
  applyTuning,
  MEDAL_THRESHOLDS,
  POINT_MULTIPLIERS,
  resetTuning,
  serializeTuning,
  tuningSnapshot,
  WINDOWS_MS,
  type TuningPatch,
} from '../core/tuning';

/**
 * Dev-only lil-gui tuning panel (M4-PLAN P0.2). Loaded exclusively via
 * `if (import.meta.env.DEV && ?tune=1) await import(...)` in main.ts, so the
 * module — and lil-gui with it — is dead-code-eliminated from dist/
 * (asserted by scripts/load-budget.mjs and the boundaries guard test).
 *
 * Edits mutate the live core/tuning.ts tables (read per-judgment, so a
 * window change applies to the very next pitch), persist to localStorage
 * `bc.tune` so a tuning session survives reloads, and print a paste-ready
 * tables JSON to the console on demand.
 */

const STORE_KEY = 'bc.tune';

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, serializeTuning());
  } catch {
    /* storage full/blocked — panel keeps working in-memory */
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw !== null) applyTuning(JSON.parse(raw) as TuningPatch);
  } catch {
    /* corrupt stash — launch values stand */
  }
}

export function mountTunePanel(): GUI {
  restore();

  const gui = new GUI({ title: 'TUNE (dev)' });

  const windows = gui.addFolder('§6 windows (|ε| ms)');
  for (const t of TIERS) {
    const f = windows.addFolder(`${t} mph`);
    f.close();
    for (const k of ['P', 'GR', 'GD', 'FL'] as const) {
      f.add(WINDOWS_MS[t], k, 5, 250, 1).onChange(persist);
    }
  }
  windows.close();

  const scoring = gui.addFolder('§8 multipliers');
  scoring.add(POINT_MULTIPLIERS, 'PERFECT', 1, 2.5, 0.05).onChange(persist);
  scoring.add(POINT_MULTIPLIERS, 'GREAT', 0.8, 2, 0.05).onChange(persist);
  scoring.add(POINT_MULTIPLIERS, 'GOOD', 0.5, 1.5, 0.05).onChange(persist);
  // FOUL_POINTS is a scalar let — bridge through applyTuning.
  scoring
    .add({ FOUL: tuningSnapshot().foulPoints }, 'FOUL', 0, 200, 5)
    .onChange((v: number) => {
      applyTuning({ foulPoints: v });
      persist();
    });
  scoring.close();

  const medals = gui.addFolder('§8 medals');
  for (const t of TIERS) {
    const f = medals.addFolder(`${t} mph`);
    f.close();
    f.add(MEDAL_THRESHOLDS[t], 'bronze', 500, 8000, 50).onChange(persist);
    f.add(MEDAL_THRESHOLDS[t], 'silver', 500, 8000, 50).onChange(persist);
    f.add(MEDAL_THRESHOLDS[t], 'gold', 500, 8000, 50).onChange(persist);
    f.add(MEDAL_THRESHOLDS[t], 'platinum', 500, 8000, 50).onChange(persist);
    f.add(MEDAL_THRESHOLDS[t], 'platinumCarryFt', 1000, 4500, 50).onChange(persist);
  }
  medals.close();

  gui.add(
    {
      'copy to console': () => {
        // Paste-ready: drop into core/tuning.ts LAUNCH_* tables or bc.tune.
        console.log('[tune] current tables:\n' + serializeTuning());
      },
    },
    'copy to console'
  );
  gui.add(
    {
      reset: () => {
        resetTuning();
        try {
          localStorage.removeItem(STORE_KEY);
        } catch {
          /* ignore */
        }
        // Rebuild controllers against the restored values.
        gui.destroy();
        mountTunePanel();
      },
    },
    'reset'
  );

  return gui;
}
