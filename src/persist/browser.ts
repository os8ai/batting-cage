import type { PersistClock } from './recorder';
import { createFreshSave, type SaveV1 } from './schema';
import { SaveStore } from './store';

/**
 * Browser binding of the persistence layer — the only place that touches
 * localStorage (§Code-organization dependency rule). Everything testable
 * lives behind the injected interfaces in store/recorder.
 */
export interface BootedPersistence {
  store: SaveStore;
  save: SaveV1;
  /** True when no recoverable career existed (fresh document minted). */
  firstRun: boolean;
  clock: PersistClock;
}

export const browserClock: PersistClock = {
  nowISO: () => new Date().toISOString(),
  epochMs: () => Date.now(),
};

/** Mint a 32-bit save id from crypto — the sim seed (§6 determinism, M3). */
export function mintSaveId(): number {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return u[0]!;
}

export function bootPersistence(): BootedPersistence {
  const store = new SaveStore(window.localStorage);
  const loaded = store.load();
  if (loaded) return { store, save: loaded.save, firstRun: false, clock: browserClock };
  const save = createFreshSave(mintSaveId(), browserClock.nowISO());
  return { store, save, firstRun: true, clock: browserClock };
}

/** §Data model: navigator.storage.persist() requested at first save. */
export function requestDurableStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // advisory only
  }
}

/** ESC-sheet export: download the pretty JSON (§Inputs-outputs e). */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** ESC-sheet import: file picker → text. (Attached to the DOM so headless
 * drivers can intercept the chooser.) */
export function pickFileText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    const done = (text: string | null) => {
      input.remove();
      resolve(text);
    };
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      const reader = new FileReader();
      reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => done(null);
      reader.readAsText(f);
    };
    document.body.appendChild(input);
    input.click();
  });
}
