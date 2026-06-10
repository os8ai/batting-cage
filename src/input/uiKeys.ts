import type { TierMph } from '../core/types';

/**
 * Non-gameplay bindings. F3 = diagnostics (§Inputs, permanent).
 *
 * M0-DEBUG: digits 1–6 select the machine tier and R inserts a token. The
 * shipped game forbids direct tier-select keys (they bypass the diegetic
 * panel, §Inputs) — these exist only because M0 has no panel yet. Remove in
 * M1/M3 when the machine control panel and token slot land.
 */
const TIER_KEYS: Record<string, TierMph> = {
  Digit1: 40,
  Digit2: 50,
  Digit3: 60,
  Digit4: 70,
  Digit5: 80,
  Digit6: 90,
};

export function attachUiKeys(opts: {
  onTierSelect: (tier: TierMph) => void; // M0-DEBUG
  onToken: () => void; // M0-DEBUG (the token slot arrives in M3)
  onToggleDiagnostics: () => void;
}): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'F3') {
      e.preventDefault();
      opts.onToggleDiagnostics();
    } else if (e.code === 'KeyR') {
      opts.onToken();
    } else {
      const tier = TIER_KEYS[e.code];
      if (tier) opts.onTierSelect(tier);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
