import type { TierMph } from '../core/types';

/**
 * Input-mode stack (M3-PLAN design note 5), owned by main: PLAY → INITIALS
 * (board entry) → ESC (system sheet). The swing path is untouched — SPACE
 * only reaches queueSwing in PLAY mode with a round live (fence 1 stays
 * clean); routeSpace is the pure, headless-tested gate.
 */
export type InputMode = 'PLAY' | 'INITIALS' | 'ESC';

export class ModeStack {
  private stack: InputMode[] = ['PLAY'];

  get mode(): InputMode {
    return this.stack[this.stack.length - 1]!;
  }

  push(mode: InputMode): void {
    if (this.mode !== mode) this.stack.push(mode);
  }

  /** Pop the top mode (optionally only when it matches). */
  pop(expected?: InputMode): void {
    if (this.stack.length > 1 && (expected === undefined || this.mode === expected)) {
      this.stack.pop();
    }
  }

  reset(): void {
    this.stack = ['PLAY'];
  }
}

export type SpaceAction = 'NONE' | 'INITIALS_CONFIRM' | 'SWING' | 'PANEL_CONFIRM' | 'TOKEN';

export interface SpaceContext {
  mode: InputMode;
  paused: boolean;
  inRound: boolean;
  station: 'PLAY' | 'PANEL' | 'RACK' | 'MONITOR' | 'BOARD';
  /** Tier under panel focus vs the confirmed selection. */
  panelFocusTier: TierMph;
  selectedTier: TierMph;
}

/**
 * Where a SPACE keydown goes. §UX: in a round it is THE swing (and nothing
 * else); at the panel it confirms an unconfirmed focus; otherwise at idle it
 * inserts a token — which is what makes the hot-seat handoff one key
 * (round end → SPACE → re-token at the same tier, §14.13).
 */
export function routeSpace(c: SpaceContext): SpaceAction {
  if (c.paused || c.mode === 'ESC') return 'NONE';
  if (c.mode === 'INITIALS') return 'INITIALS_CONFIRM';
  if (c.inRound) return 'SWING';
  if (c.station === 'PANEL' && c.panelFocusTier !== c.selectedTier) return 'PANEL_CONFIRM';
  return 'TOKEN';
}
