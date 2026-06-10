/**
 * The one-click splash (Flow 2): "STEP INTO THE CAGE". The click is the
 * browser audio-unlock gesture; the returned promise resolves on click so
 * boot can overlap remaining init Slow-Roads-style. Plain HTML/CSS — one of
 * the spec's two permitted flat surfaces.
 */
export function showSplash(parent: HTMLElement): { clicked: Promise<void>; dismiss: () => void } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;background:#07080a;color:#ffb000;cursor:pointer;user-select:none;' +
    'font-family:"Courier New",monospace;transition:opacity .6s ease';
  el.innerHTML =
    '<div style="font-size:42px;letter-spacing:14px;text-shadow:0 0 18px rgba(255,176,0,.55)">BATTING CAGE</div>' +
    '<div style="margin-top:10px;font-size:13px;letter-spacing:6px;color:#8a6a20">ONE BUTTON · SIX SPEEDS · HOW FAR WOULD IT GO</div>' +
    '<div data-id="cta" style="margin-top:48px;padding:14px 34px;border:1px solid #ffb000;font-size:18px;' +
    'letter-spacing:8px;box-shadow:0 0 24px rgba(255,176,0,.25) inset">STEP INTO THE CAGE</div>';
  parent.appendChild(el);

  const cta = el.querySelector<HTMLDivElement>('[data-id=cta]')!;
  let pulse = 0;
  const pulseTimer = window.setInterval(() => {
    pulse = (pulse + 1) % 2;
    cta.style.opacity = pulse ? '0.65' : '1';
  }, 700);

  const clicked = new Promise<void>((resolve) => {
    el.addEventListener('click', () => resolve(), { once: true });
  });

  const dismiss = () => {
    window.clearInterval(pulseTimer);
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 650);
  };

  return { clicked, dismiss };
}
