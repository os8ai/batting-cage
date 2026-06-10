import { isSave, type SaveV1 } from './schema';

/**
 * Double-buffered verify-then-promote save store (§Data model durability).
 * Write: serialize → `bc.save.next` → re-parse verify → promote to `bc.save`
 * (retaining `bc.save.bak`). Boot recovery ladder: save → next-if-verified →
 * bak → fresh. Storage is injected — headless suites drive an in-memory fake
 * with a torn-write simulator; the browser passes localStorage.
 */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEY_SAVE = 'bc.save';
export const KEY_NEXT = 'bc.save.next';
export const KEY_BAK = 'bc.save.bak';

export type LoadSource = 'save' | 'next' | 'bak';

export class SaveStore {
  constructor(private kv: KVStorage) {}

  /**
   * Verify-then-promote write. Returns false (prior save intact) when any
   * step fails — quota, torn write, or a verify mismatch.
   */
  write(save: SaveV1): boolean {
    let json: string;
    try {
      json = JSON.stringify(save);
    } catch {
      return false;
    }
    try {
      this.kv.setItem(KEY_NEXT, json);
      // Re-parse what storage actually holds — the verify step.
      const back = this.kv.getItem(KEY_NEXT);
      if (back === null) return false;
      let parsed: unknown;
      try {
        parsed = JSON.parse(back);
      } catch {
        return false;
      }
      if (!isSave(parsed)) return false;
      // Promote, retaining the previous good save as .bak.
      const current = this.kv.getItem(KEY_SAVE);
      if (current !== null) this.kv.setItem(KEY_BAK, current);
      this.kv.setItem(KEY_SAVE, back);
      this.kv.removeItem(KEY_NEXT);
      return true;
    } catch {
      return false;
    }
  }

  /** Boot recovery ladder. Null = no recoverable career (fresh start). */
  load(): { save: SaveV1; source: LoadSource } | null {
    for (const [key, source] of [
      [KEY_SAVE, 'save'],
      [KEY_NEXT, 'next'],
      [KEY_BAK, 'bak'],
    ] as Array<[string, LoadSource]>) {
      const raw = this.tryGet(key);
      if (raw === null) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isSave(parsed)) return { save: parsed, source };
      } catch {
        // fall through the ladder
      }
    }
    return null;
  }

  /** Remove every save key (ESC-sheet reset-data, two-step confirmed). */
  clear(): void {
    for (const key of [KEY_SAVE, KEY_NEXT, KEY_BAK]) {
      try {
        this.kv.removeItem(key);
      } catch {
        // best effort
      }
    }
  }

  private tryGet(key: string): string | null {
    try {
      return this.kv.getItem(key);
    } catch {
      return null;
    }
  }
}
