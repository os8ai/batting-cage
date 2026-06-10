/**
 * Non-gameplay bindings (§Inputs — UI affordances, permitted by fence 1):
 * arrows = station/panel focus · ENTER mirrors SPACE for confirms · TAB =
 * stats monitor · ESC = back to play (the system sheet is M3) · M = mute ·
 * H/B = handedness/bat accelerators · F3 = diagnostics.
 *
 * M0-DEBUG retired in M1: digit tier keys are GONE (the diegetic machine
 * panel replaces them, §UX). R-token remains until M3's token slot station.
 */
export interface UiKeyHandlers {
  onArrow: (dir: 'up' | 'down' | 'left' | 'right') => void;
  onEnter: () => void;
  onTab: () => void;
  onEscape: () => void;
  onMute: () => void;
  onHandedness: () => void;
  onBat: () => void;
  onToken: () => void; // M0-DEBUG (the token slot station arrives in M3)
  onToggleDiagnostics: () => void;
}

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function attachUiKeys(h: UiKeyHandlers): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const arrow = ARROWS[e.code];
    if (arrow) {
      e.preventDefault();
      h.onArrow(arrow);
      return;
    }
    switch (e.code) {
      case 'F3':
        e.preventDefault();
        h.onToggleDiagnostics();
        break;
      case 'Enter':
        h.onEnter();
        break;
      case 'Tab':
        e.preventDefault();
        h.onTab();
        break;
      case 'Escape':
        h.onEscape();
        break;
      case 'KeyM':
        h.onMute();
        break;
      case 'KeyH':
        h.onHandedness();
        break;
      case 'KeyB':
        h.onBat();
        break;
      case 'KeyR':
        h.onToken();
        break;
      default:
        break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
