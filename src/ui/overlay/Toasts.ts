/**
 * Flat-concession toasts (§UX): quality auto-detect result, export nudges,
 * import feedback. Bottom-center, auto-fading, queue of one.
 */
export class Toasts {
  private el: HTMLDivElement;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:80;display:none;' +
      'background:rgba(12,13,16,0.92);border:1px solid #6b5a26;color:#ffb000;padding:10px 22px;' +
      'font-family:"Courier New",monospace;font-size:13px;letter-spacing:3px;transition:opacity .4s ease';
    parent.appendChild(this.el);
  }

  show(text: string, holdMs = 3500): void {
    window.clearTimeout(this.hideTimer);
    this.el.textContent = text;
    this.el.style.display = 'block';
    this.el.style.opacity = '1';
    this.hideTimer = window.setTimeout(() => {
      this.el.style.opacity = '0';
      this.hideTimer = window.setTimeout(() => {
        this.el.style.display = 'none';
      }, 450);
    }, holdMs);
  }
}

/**
 * Auto-fading key-hint footer (§UX flat concessions). Shown at boot; fades
 * once play begins.
 */
export class KeyHints {
  private el: HTMLDivElement;
  private fadeTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:0;right:0;bottom:14px;z-index:70;text-align:center;pointer-events:none;' +
      'color:#8d8675;font-family:"Courier New",monospace;font-size:12px;letter-spacing:2px;' +
      'text-shadow:0 1px 2px #000;transition:opacity 1.2s ease;display:none';
    this.el.textContent = 'SPACE INSERT TOKEN / SWING · ARROWS SPEED · TAB STATS · H HAND · B BAT · ESC MENU';
    // Leave the render path entirely once faded: a display:block overlay —
    // even at opacity 0 — keeps the compositor blending DOM over the canvas
    // and slips vsync (measured: ~6% doubled frames during the fade window).
    this.el.addEventListener('transitionend', () => {
      if (this.el.style.opacity === '0') this.el.style.display = 'none';
    });
    parent.appendChild(this.el);
  }

  show(fadeAfterMs = 12_000): void {
    window.clearTimeout(this.fadeTimer);
    this.el.style.display = 'block';
    this.el.style.opacity = '1';
    this.fadeTimer = window.setTimeout(() => {
      this.el.style.opacity = '0';
    }, fadeAfterMs);
  }

  hide(): void {
    window.clearTimeout(this.fadeTimer);
    this.el.style.opacity = '0';
    this.el.style.display = 'none';
  }
}
