import { migrateToCurrent, type MigrateResult } from './migrate';
import type { SaveV1 } from './schema';

/**
 * Export/import of the whole save document (§Inputs-outputs e: browser
 * storage is evictable; the PB career must survive a cache clear). Pure
 * text ↔ document here; the download/file-picker DOM lives in the ESC sheet.
 */
export function exportSaveJson(save: SaveV1): string {
  return JSON.stringify(save, null, 2);
}

export function suggestedExportName(nowISO: string): string {
  return `batting-cage-save-${nowISO.slice(0, 10)}.json`;
}

/** Parse → guard → migrate. Refusals surface a reason for the board message. */
export function importSaveJson(text: string): MigrateResult {
  if (text.length > 8 * 1024 * 1024) return { ok: false, reason: 'MALFORMED' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'NOT_JSON' };
  }
  return migrateToCurrent(parsed);
}
