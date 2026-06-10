import type { DomainEvent, SwingRecord, TierMph } from '../../../core/types';

/**
 * LED-board page state machine (§9 — the M1 page subset: LIVE, SWING CARD,
 * TAKE/MISS; recap/ceremony/attract/initials/coach pages are M3). Pure logic,
 * no canvas/Three — headless-tested in tests/boardPages.test.ts.
 *
 * The card reveal follows the §5 beat: SWING_JUDGED only stashes the record;
 * the page flips at BOARD_REVEAL (plate + 0.6 s) and back at BOARD_HOLD_END.
 */
export type BoardPage =
  | { kind: 'IDLE' }
  | { kind: 'LIVE'; pitch: number; tier: TierMph; spinup: boolean }
  | { kind: 'SWING_CARD'; record: SwingRecord; tier: TierMph }
  | { kind: 'NO_DIST_CARD'; record: SwingRecord; tier: TierMph } // TAKE / MISS / FOUL (§6: no distance)
  | { kind: 'ROUND_OVER'; tier: TierMph; contactCount: number; bestCarryFt: number };

export class BoardPageMachine {
  page: BoardPage = { kind: 'IDLE' };
  private tier: TierMph = 40;
  private pitch = 0;
  private pending: SwingRecord | null = null;

  /** Feed one domain event; returns true when the visible page changed. */
  handle(e: DomainEvent): boolean {
    switch (e.type) {
      case 'TOKEN':
        this.tier = e.tier;
        this.pitch = 0;
        this.pending = null;
        this.page = { kind: 'LIVE', pitch: 0, tier: this.tier, spinup: true };
        return true;
      case 'FEED':
        this.pitch = e.pitch;
        this.pending = null;
        this.page = { kind: 'LIVE', pitch: e.pitch, tier: this.tier, spinup: false };
        return true;
      case 'SWING_JUDGED':
        this.pending = e.record; // reveal waits for the §5 board beat
        return false;
      case 'BOARD_REVEAL': {
        if (!this.pending) return false;
        const r = this.pending;
        this.page =
          r.carryFt !== null
            ? { kind: 'SWING_CARD', record: r, tier: this.tier }
            : { kind: 'NO_DIST_CARD', record: r, tier: this.tier };
        return true;
      }
      case 'BOARD_HOLD_END':
        this.page = { kind: 'LIVE', pitch: this.pitch, tier: this.tier, spinup: false };
        return true;
      case 'ROUND_END': {
        const contact = e.records.filter((r) => r.carryFt !== null);
        this.page = {
          kind: 'ROUND_OVER',
          tier: e.tier,
          contactCount: contact.length,
          bestCarryFt: contact.length ? Math.max(...contact.map((r) => r.carryFt!)) : 0,
        };
        return true;
      }
      default:
        return false;
    }
  }
}
