import { hasUnsafeKeys, isSave, SCHEMA_VERSION, type SaveV1 } from './schema';

/**
 * Linear vN→vN+1 migration chain (§Data model). v1 is current, so the chain
 * is scaffold: future versions register an upgrader keyed by their FROM
 * version. Saves from a NEWER schema are refused (the board shows why);
 * v0 (no document) is handled by the caller creating a fresh career.
 */
export type RefusalReason = 'NOT_JSON' | 'NOT_OBJECT' | 'UNSAFE_KEYS' | 'NEWER_SCHEMA' | 'MALFORMED';

export type MigrateResult = { ok: true; save: SaveV1 } | { ok: false; reason: RefusalReason };

/** FROM-version → upgrader producing FROM+1. Empty while v1 is current. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateToCurrent(u: unknown): MigrateResult {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return { ok: false, reason: 'NOT_OBJECT' };
  if (hasUnsafeKeys(u)) return { ok: false, reason: 'UNSAFE_KEYS' };

  let doc = u as Record<string, unknown>;
  const meta = doc.meta;
  const version =
    typeof meta === 'object' && meta !== null && typeof (meta as Record<string, unknown>).schemaVersion === 'number'
      ? ((meta as Record<string, unknown>).schemaVersion as number)
      : NaN;
  if (!Number.isInteger(version)) return { ok: false, reason: 'MALFORMED' };
  if (version > SCHEMA_VERSION) return { ok: false, reason: 'NEWER_SCHEMA' };

  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: 'MALFORMED' };
    doc = step(doc);
  }
  return isSave(doc) ? { ok: true, save: doc } : { ok: false, reason: 'MALFORMED' };
}

/** Player-facing refusal line for the LED board (§14.18). */
export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case 'NEWER_SCHEMA':
      return 'SAVE FROM A NEWER VERSION';
    case 'NOT_JSON':
      return 'NOT A SAVE FILE';
    default:
      return 'SAVE FILE REJECTED';
  }
}
