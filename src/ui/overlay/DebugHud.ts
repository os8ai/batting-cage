import type { DomainEvent, SwingRecord, TierMph } from '../../core/types';

/**
 * Dev fallback HUD (demoted in M1 per plan §2): the LED board now owns the
 * swing card; this HTML mirror is hidden by default and toggled with F3
 * alongside diagnostics. Fully removed in M3 with the complete board pages.
 */
export class DebugHud {
  visible = false;

  private root: HTMLDivElement;
  private status: HTMLDivElement;
  private card: HTMLDivElement;
  private strip: HTMLDivElement;
  private tier: TierMph = 40;
  private cells: string[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:12px;bottom:12px;color:#9aa;font:12px/1.4 monospace;z-index:20;' +
      'text-shadow:0 1px 2px #000;user-select:none;pointer-events:none;display:none';
    this.root.innerHTML =
      '<div data-id="status"></div>' +
      '<div data-id="card" style="margin-top:4px;font-size:13px;white-space:pre"></div>' +
      '<div data-id="strip" style="margin-top:4px;color:#789"></div>' +
      '<div style="margin-top:6px;color:#678">[SPACE] swing/confirm · [R] token · [arrows] panel · [TAB] stats · [H] hand · [B] bat · [M] mute</div>';
    parent.appendChild(this.root);
    this.status = this.root.querySelector('[data-id=status]')!;
    this.card = this.root.querySelector('[data-id=card]')!;
    this.strip = this.root.querySelector('[data-id=strip]')!;
    this.setTier(40);
    this.status.textContent = 'MACHINE 40 MPH — PRESS R TO INSERT TOKEN';
  }

  setTier(tier: TierMph): void {
    this.tier = tier;
    this.status.textContent = `MACHINE ${tier} MPH — PRESS R TO INSERT TOKEN`;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  onEvent(e: DomainEvent): void {
    switch (e.type) {
      case 'TOKEN':
        this.cells = [];
        this.strip.textContent = '';
        this.card.textContent = '';
        this.status.textContent = `TOKEN IN — ${e.tier} MPH — WHEELS SPINNING UP…`;
        break;
      case 'FEED':
        this.status.textContent = `PITCH ${e.pitch}/10 — ${this.tier} MPH`;
        break;
      case 'SWING_JUDGED':
        this.showCard(e.record);
        break;
      case 'ROUND_END':
        this.showRecap(e.records);
        break;
      default:
        break;
    }
  }

  private msReadout(r: SwingRecord): string {
    if (r.epsMs === null) return '';
    const v = Math.abs(Math.round(r.epsMs));
    return `${r.epsMs >= 0 ? 'LATE' : 'EARLY'} ${v} ms`;
  }

  private showCard(r: SwingRecord): void {
    let head: string;
    let line: string;
    if (r.grade === 'TAKE') {
      head = 'TAKE';
      line = '';
    } else if (r.grade === 'MISS') {
      head = 'MISS';
      line = this.msReadout(r);
    } else if (r.grade === 'FOUL') {
      head = 'FOUL';
      line = this.msReadout(r); // §6: FOUL shows the ms readout, no distance
    } else {
      head = `${r.carryFt} FT`;
      line =
        `${r.evMph!.toFixed(1)} MPH EV   ${r.laDeg!.toFixed(0)}° LA   ` +
        `${r.grade}   ${r.spray}   ${this.msReadout(r)}`;
    }
    this.card.textContent = `${head}\n${line}`;
    this.cells.push(this.cellFor(r));
    this.strip.textContent = this.cells.join('  ');
  }

  private cellFor(r: SwingRecord): string {
    if (r.grade === 'TAKE') return '·';
    if (r.grade === 'MISS') return 'K';
    if (r.grade === 'FOUL') return 'F';
    return `${r.carryFt}`;
  }

  private showRecap(records: SwingRecord[]): void {
    const contact = records.filter((r) => r.carryFt !== null);
    const best = contact.length ? Math.max(...contact.map((r) => r.carryFt!)) : 0;
    this.status.textContent = `ROUND OVER — ${this.tier} MPH — CONTACT ${contact.length}/10 — BEST ${best} FT`;
    this.card.textContent = 'PRESS R FOR ANOTHER ROUND';
  }
}
