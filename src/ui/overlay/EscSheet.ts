import type { Volumes } from '../../audio/buses';
import type { Preset } from '../../app/Quality';

/**
 * The ESC system sheet — the spec's one flat between-rounds concession (§UX):
 * quality preset, Master/SFX/Ambience volumes, export/import save, reset data
 * (two-step confirm), key reference. Plain HTML/CSS; arrows/enter work on the
 * native controls, mouse has full parity, ESC closes (handled by main).
 */
export interface EscSheetHandlers {
  onPreset: (preset: Preset) => void;
  onVolumes: (v: Volumes) => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
}

const KEY_REF: Array<[string, string]> = [
  ['SPACE', 'swing · insert token · confirm'],
  ['ARROWS', 'machine panel · initials'],
  ['ENTER', 'confirm'],
  ['TAB', 'stats monitor · next page'],
  ['H / B', 'handedness · bat'],
  ['M', 'mute'],
  ['ESC', 'pause + this sheet'],
  ['F3', 'diagnostics'],
];

export class EscSheet {
  private el: HTMLDivElement;
  private resetArmed = false;
  private resetBtn!: HTMLButtonElement;
  visible = false;

  constructor(
    parent: HTMLElement,
    private handlers: EscSheetHandlers
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;' +
      'background:rgba(4,5,8,0.82);color:#d8d2c2;font-family:"Courier New",monospace;user-select:none';
    parent.appendChild(this.el);
    this.build();
  }

  private build(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
      'min-width:460px;max-width:540px;border:1px solid #6b5a26;background:#0c0d10;padding:26px 34px;' +
      'box-shadow:0 0 40px rgba(255,176,0,.12)';
    panel.innerHTML =
      '<div style="font-size:20px;letter-spacing:8px;color:#ffb000;margin-bottom:18px">PAUSED</div>' +
      '<div style="display:grid;grid-template-columns:130px 1fr;gap:10px 14px;align-items:center;font-size:13px">' +
      '<label>QUALITY</label><select data-id="preset" style="background:#15171c;color:#d8d2c2;border:1px solid #3a3e44;padding:4px;font-family:inherit">' +
      '<option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option><option value="LOW">LOW</option></select>' +
      '<label>MASTER</label><input data-id="master" type="range" min="0" max="100" value="100">' +
      '<label>SFX</label><input data-id="sfx" type="range" min="0" max="100" value="100">' +
      '<label>AMBIENCE</label><input data-id="ambience" type="range" min="0" max="100" value="100">' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:20px">' +
      '<button data-id="export">EXPORT SAVE</button>' +
      '<button data-id="import">IMPORT SAVE</button>' +
      '<button data-id="reset">RESET DATA</button>' +
      '</div>' +
      '<div data-id="keys" style="margin-top:20px;border-top:1px solid #26282d;padding-top:12px;font-size:11px;color:#8d8675"></div>' +
      '<div style="margin-top:16px;font-size:11px;color:#6b6450">ESC TO RESUME</div>';
    this.el.appendChild(panel);

    for (const b of panel.querySelectorAll('button')) {
      (b as HTMLButtonElement).style.cssText =
        'background:#15171c;color:#d8d2c2;border:1px solid #3a3e44;padding:6px 12px;font-family:inherit;' +
        'font-size:12px;cursor:pointer;letter-spacing:1px';
    }
    const keys = panel.querySelector<HTMLDivElement>('[data-id=keys]')!;
    keys.innerHTML = KEY_REF.map(
      ([k, what]) =>
        `<div style="display:flex;gap:12px;margin:2px 0"><span style="color:#cfa845;min-width:64px">${k}</span><span>${what}</span></div>`
    ).join('');

    const preset = panel.querySelector<HTMLSelectElement>('[data-id=preset]')!;
    preset.onchange = () => this.handlers.onPreset(preset.value as Preset);
    const slider = (id: string) => panel.querySelector<HTMLInputElement>(`[data-id=${id}]`)!;
    const onSlide = () => {
      this.handlers.onVolumes({
        master: Number(slider('master').value) / 100,
        sfx: Number(slider('sfx').value) / 100,
        ambience: Number(slider('ambience').value) / 100,
      });
    };
    for (const id of ['master', 'sfx', 'ambience']) slider(id).oninput = onSlide;

    panel.querySelector<HTMLButtonElement>('[data-id=export]')!.onclick = () => this.handlers.onExport();
    panel.querySelector<HTMLButtonElement>('[data-id=import]')!.onclick = () => this.handlers.onImport();
    this.resetBtn = panel.querySelector<HTMLButtonElement>('[data-id=reset]')!;
    this.resetBtn.onclick = () => {
      // Two-step confirm (§9 ESC sheet): arm, then destroy.
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.resetBtn.textContent = 'REALLY RESET?';
        this.resetBtn.style.borderColor = '#a33';
        this.resetBtn.style.color = '#ff8d80';
        return;
      }
      this.disarmReset();
      this.handlers.onReset();
    };
  }

  private disarmReset(): void {
    this.resetArmed = false;
    this.resetBtn.textContent = 'RESET DATA';
    this.resetBtn.style.borderColor = '#3a3e44';
    this.resetBtn.style.color = '#d8d2c2';
  }

  /** Reflect persisted settings when opening. */
  setState(preset: Preset | null, volumes: Volumes): void {
    const q = this.el.querySelector<HTMLSelectElement>('[data-id=preset]')!;
    q.value = preset ?? 'HIGH';
    const set = (id: string, v: number) => {
      this.el.querySelector<HTMLInputElement>(`[data-id=${id}]`)!.value = String(Math.round(v * 100));
    };
    set('master', volumes.master);
    set('sfx', volumes.sfx);
    set('ambience', volumes.ambience);
  }

  open(): void {
    this.visible = true;
    this.disarmReset();
    this.el.style.display = 'flex';
  }

  close(): void {
    this.visible = false;
    this.disarmReset();
    this.el.style.display = 'none';
  }
}
