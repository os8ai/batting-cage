import type { DomainEvent, Medal, PbKind, SwingRecord, TierMph } from '../../../core/types';

/**
 * LED-board page state machine (§9 — the full M3 inventory: LIVE, SWING CARD,
 * TAKE/MISS, RECAP with score count-up + medal stamp, CEREMONY flashes,
 * INITIALS entry, ATTRACT-1/2/3 carousel, COACH overlays). Pure logic, no
 * canvas/Three — headless-tested in tests/boardPages.test.ts.
 *
 * Two drives, both deterministic:
 *  - handle(event): domain events flip the in-round pages (the M1 reveal
 *    beat) and stage the post-round ceremony queue.
 *  - advance(simT): walks the staged post-round sequence and the attract
 *    carousel on the sim clock, emitting BoardSignals the presentation maps
 *    to cues (count-up loop, medal stamp, unlock klaxon — §10 ceremony rows).
 */

export type CeremonyItem =
  | { kind: 'PB'; pb: PbKind; value: number }
  | { kind: 'CLUB'; ft: number; tier: TierMph }
  | { kind: 'UNLOCK'; tier: TierMph };

export type BoardPage =
  | { kind: 'IDLE' }
  | { kind: 'LIVE'; pitch: number; tier: TierMph; spinup: boolean; score: number }
  | { kind: 'SWING_CARD'; record: SwingRecord; tier: TierMph; score: number }
  | { kind: 'NO_DIST_CARD'; record: SwingRecord; tier: TierMph; score: number }
  | {
      kind: 'RECAP';
      tier: TierMph;
      records: SwingRecord[];
      score: number;
      medal: Medal | null;
      /** Sim time the recap (and its count-up) started. */
      start: number;
    }
  | { kind: 'CEREMONY'; item: CeremonyItem; start: number }
  | { kind: 'INITIALS'; tier: TierMph; score: number; slots: [number, number, number]; cursor: number }
  | { kind: 'ROUND_OVER'; tier: TierMph; score: number; medal: Medal | null; bestCarryFt: number; start: number }
  | { kind: 'ATTRACT'; variant: 1 | 2 | 3; carouselTier: TierMph };

export type BoardSignal =
  | { kind: 'COUNT_UP_START' }
  | { kind: 'COUNT_UP_END'; medal: Medal | null }
  | { kind: 'CEREMONY'; item: CeremonyItem }
  | { kind: 'INITIALS_DONE'; initials: string }
  | { kind: 'PAGE_FLIP' };

/** §9 attract/locker data, set by main from the save snapshot (one-way). */
export interface AttractData {
  firstRun: boolean;
  top5ByTier: Array<{ tier: TierMph; entries: Array<{ initials: string; score: number }> }>;
  pbs: Array<{ tier: TierMph; bestRoundScore: number; longestCarryFt: number }>;
}

export type CoachLine =
  | 'WATCH THE LIGHT'
  | 'SPACE TO SWING'
  | 'SWING AS IT GETS BIG'
  | 'WAIT FOR THE GREEN LIGHT';

// Sequencing constants (board beats; sim-clock seconds).
export const COUNT_UP_S = 2.0;
export const RECAP_HOLD_S = 4.5;
export const CEREMONY_S = 2.2;
export const ROUND_OVER_S = 12;
export const ATTRACT_PAGE_S = 6;

/**
 * ATTRACT-2/3 list layout (M4 design note 10): the M3 6-row pitch overlapped
 * 7-row glyphs by one row. On the 40-row board a header (row 0) + four
 * entries at a clean 8-row pitch is the densest overlap-free fit
 * (33 + 7 = 40); entry five of a full top-5 is simply not displayed.
 */
export const ATTRACT_LIST_HEADER_ROW = 0;
export const ATTRACT_LIST_ENTRY_ROWS: readonly number[] = [9, 17, 25, 33];
export const ATTRACT_LIST_MAX_ENTRIES = ATTRACT_LIST_ENTRY_ROWS.length;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class BoardPageMachine {
  page: BoardPage = { kind: 'IDLE' };

  /** FTUE coaching overlay on the LIVE page (null = none). */
  coachLine: CoachLine | null = null;
  private coachEnabled = false;
  private missedLast = false;

  private tier: TierMph = 40;
  private pitch = 0;
  private score = 0;
  private pending: SwingRecord | null = null;

  // Post-round sequence.
  private ceremonies: CeremonyItem[] = [];
  private recapEnd = 0;
  private countUpStarted = true;
  private countUpDone = true;
  private recapMedal: Medal | null = null;
  private lastBestCarryFt = 0;
  private initialsRequested: string | null = null;
  private attract: AttractData = { firstRun: true, top5ByTier: [], pbs: [] };
  private attractIdx = 0;
  private attractEpoch = 0;

  /** First-run coaching on/off (career state, set by main; §FTUE). */
  setCoachEnabled(on: boolean): void {
    this.coachEnabled = on;
    if (!on) this.coachLine = null;
  }

  /** Locker snapshot for ATTRACT-2/3 (set at boot + after each save write). */
  setAttractData(data: AttractData): void {
    this.attract = data;
  }

  get attractData(): AttractData {
    return this.attract;
  }

  /**
   * Round entered the tier's top-5 (recorder outcome): queue the INITIALS
   * page into the post-round sequence, prefilled with the last-used initials.
   */
  requestInitials(defaultInitials: string): void {
    this.initialsRequested = (defaultInitials.toUpperCase() + 'AAA').slice(0, 3);
  }

  /** Feed one domain event; returns true when the visible page changed. */
  handle(e: DomainEvent): boolean {
    switch (e.type) {
      case 'TOKEN':
        this.tier = e.tier;
        this.pitch = 0;
        this.score = 0;
        this.pending = null;
        this.ceremonies = [];
        this.initialsRequested = null;
        this.page = { kind: 'LIVE', pitch: 0, tier: this.tier, spinup: true, score: 0 };
        return true;
      case 'FEED':
        this.pitch = e.pitch;
        this.pending = null;
        if (this.coachEnabled && e.pitch === 1) this.coachLine = 'WATCH THE LIGHT';
        this.page = { kind: 'LIVE', pitch: e.pitch, tier: this.tier, spinup: false, score: this.score };
        return true;
      case 'RELEASE':
        if (this.coachEnabled) {
          this.coachLine = this.missedLast ? 'SWING AS IT GETS BIG' : 'SPACE TO SWING';
          return true;
        }
        return false;
      case 'PRESS_IGNORED':
        if (this.coachEnabled && e.reason === 'PRE_RELEASE') {
          this.coachLine = 'WAIT FOR THE GREEN LIGHT';
          return true;
        }
        return false;
      case 'SWING_JUDGED':
        this.pending = e.record; // reveal waits for the §5 board beat
        this.score += e.record.points;
        this.missedLast = e.record.grade === 'MISS' || e.record.grade === 'TAKE';
        if (this.coachLine === 'SPACE TO SWING' || this.coachLine === 'SWING AS IT GETS BIG') {
          this.coachLine = null;
        }
        return false;
      case 'BOARD_REVEAL': {
        if (!this.pending) return false;
        const r = this.pending;
        this.page =
          r.carryFt !== null
            ? { kind: 'SWING_CARD', record: r, tier: this.tier, score: this.score }
            : { kind: 'NO_DIST_CARD', record: r, tier: this.tier, score: this.score };
        return true;
      }
      case 'BOARD_HOLD_END':
        if (this.page.kind !== 'SWING_CARD' && this.page.kind !== 'NO_DIST_CARD') return false;
        this.page = { kind: 'LIVE', pitch: this.pitch, tier: this.tier, spinup: false, score: this.score };
        return true;
      case 'ROUND_END':
        this.coachLine = null;
        this.score = e.score;
        this.recapMedal = e.medal;
        this.countUpStarted = false;
        this.countUpDone = false;
        this.recapEnd = e.t + RECAP_HOLD_S;
        this.lastBestCarryFt = e.records.reduce((b, r) => Math.max(b, r.carryFt ?? 0), 0);
        this.page = { kind: 'RECAP', tier: e.tier, records: e.records, score: e.score, medal: e.medal, start: e.t };
        return true;
      // Ceremony events stage flashes; the page flips on advance().
      case 'NEW_PB':
        this.ceremonies.push({ kind: 'PB', pb: e.kind, value: e.value });
        return false;
      case 'CLUB_ENTERED':
        this.ceremonies.push({ kind: 'CLUB', ft: e.ft, tier: e.tier });
        return false;
      case 'TIER_UNLOCKED':
        this.ceremonies.push({ kind: 'UNLOCK', tier: e.tier });
        return false;
      default:
        return false;
    }
  }

  /**
   * Drive the staged sequences on the sim clock. Returns the signals that
   * fired (page flips, count-up envelope, ceremony stamps) — presentation
   * maps them to repaints and §10 ceremony cues.
   */
  advance(simT: number): BoardSignal[] {
    const out: BoardSignal[] = [];
    switch (this.page.kind) {
      case 'IDLE':
        this.enterAttract(simT);
        out.push({ kind: 'PAGE_FLIP' });
        break;
      case 'RECAP': {
        if (!this.countUpStarted) {
          this.countUpStarted = true;
          out.push({ kind: 'COUNT_UP_START' });
        }
        if (!this.countUpDone && simT >= this.page.start + COUNT_UP_S) {
          this.countUpDone = true;
          out.push({ kind: 'COUNT_UP_END', medal: this.recapMedal });
        }
        if (simT >= this.recapEnd) out.push(...this.nextCeremonyOr(simT));
        break;
      }
      case 'CEREMONY':
        if (simT >= this.page.start + CEREMONY_S) out.push(...this.nextCeremonyOr(simT));
        break;
      case 'ROUND_OVER':
        if (simT >= this.page.start + ROUND_OVER_S) {
          this.enterAttract(simT);
          out.push({ kind: 'PAGE_FLIP' });
        }
        break;
      case 'ATTRACT': {
        const idx = Math.floor((simT - this.attractEpoch) / ATTRACT_PAGE_S);
        if (idx !== this.attractIdx) {
          this.attractIdx = idx;
          this.page = this.attractPage();
          out.push({ kind: 'PAGE_FLIP' });
        }
        break;
      }
      default:
        break;
    }
    return out;
  }

  /** The count-up display value at simT (RECAP page only; ~12 Hz repaint). */
  countUpValue(simT: number): number {
    if (this.page.kind !== 'RECAP') return this.score;
    const u = Math.min(1, Math.max(0, (simT - this.page.start) / COUNT_UP_S));
    return Math.round(this.page.score * u);
  }

  /** INITIALS entry (§9): arrows cycle A–Z / move cursor, SPACE confirms. */
  initialsInput(input: 'up' | 'down' | 'left' | 'right' | 'confirm', simT: number): BoardSignal[] {
    if (this.page.kind !== 'INITIALS') return [];
    const p = this.page;
    if (input === 'up' || input === 'down') {
      const d = input === 'up' ? 1 : 25;
      p.slots[p.cursor] = (p.slots[p.cursor]! + d) % 26;
      return [{ kind: 'PAGE_FLIP' }];
    }
    if (input === 'left' || input === 'right') {
      p.cursor = Math.min(2, Math.max(0, p.cursor + (input === 'right' ? 1 : -1)));
      return [{ kind: 'PAGE_FLIP' }];
    }
    // confirm: advance; confirming the last slot finishes (3 presses on the
    // defaults = skip — solo flow stays one-key, §What 7).
    if (p.cursor < 2) {
      p.cursor += 1;
      return [{ kind: 'PAGE_FLIP' }];
    }
    const initials = p.slots.map((i) => LETTERS[i]!).join('');
    this.page = {
      kind: 'ROUND_OVER',
      tier: p.tier,
      score: p.score,
      medal: this.recapMedal,
      bestCarryFt: this.lastBestCarryFt,
      start: simT,
    };
    return [{ kind: 'INITIALS_DONE', initials }, { kind: 'PAGE_FLIP' }];
  }

  get inInitials(): boolean {
    return this.page.kind === 'INITIALS';
  }

  private nextCeremonyOr(simT: number): BoardSignal[] {
    const item = this.ceremonies.shift();
    if (item) {
      this.page = { kind: 'CEREMONY', item, start: simT };
      return [{ kind: 'CEREMONY', item }, { kind: 'PAGE_FLIP' }];
    }
    if (this.initialsRequested !== null) {
      const slots = this.initialsRequested.split('').map((c) => Math.max(0, LETTERS.indexOf(c))) as [
        number,
        number,
        number,
      ];
      this.initialsRequested = null;
      this.page = { kind: 'INITIALS', tier: this.tier, score: this.score, slots, cursor: 0 };
      return [{ kind: 'PAGE_FLIP' }];
    }
    this.page = {
      kind: 'ROUND_OVER',
      tier: this.tier,
      score: this.score,
      medal: this.recapMedal,
      bestCarryFt: this.lastBestCarryFt,
      start: simT,
    };
    return [{ kind: 'PAGE_FLIP' }];
  }

  private enterAttract(simT: number): void {
    this.attractEpoch = simT;
    this.attractIdx = 0;
    this.page = this.attractPage();
  }

  private attractPage(): BoardPage {
    // First-run shows exactly one action: INSERT TOKEN (§What 11 / Flow 1).
    if (this.attract.firstRun) return { kind: 'ATTRACT', variant: 1, carouselTier: 40 };
    const variant = ((this.attractIdx % 3) + 1) as 1 | 2 | 3;
    const withScores = this.attract.top5ByTier.filter((t) => t.entries.length > 0);
    const carousel =
      withScores.length > 0 ? withScores[Math.floor(this.attractIdx / 3) % withScores.length]!.tier : 40;
    return { kind: 'ATTRACT', variant, carouselTier: carousel };
  }
}
