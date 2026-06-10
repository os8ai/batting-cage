/**
 * Typed asset inventory (M1-PLAN P0). In M1 every asset is PROCEDURAL —
 * synthesized audio (audio/synth.ts), canvas-generated PBR textures
 * (scene/textures.ts), and a code-built rigged batter (scene/actors/Batter.ts)
 * — so nothing is fetched at runtime and the wire cost is bundled JS only.
 * When external content lands (the owner Mixamo step, CC0 texture cooks),
 * entries gain real URLs and the glTF/Draco/KTX2 loader path joins here;
 * byte budgets below are the §12 checkpoints those cooks must respect.
 */
export interface AssetEntry {
  kind: 'texture' | 'audio' | 'font' | 'model';
  name: string;
  source: 'procedural';
  /** Approximate in-memory cost (KB) — procedural assets have no wire cost. */
  approxKB: number;
  notes?: string;
}

export const MANIFEST: readonly AssetEntry[] = [
  { kind: 'texture', name: 'turf', source: 'procedural', approxKB: 4096, notes: '1024² RGBA, worn lanes baked' },
  { kind: 'texture', name: 'concrete', source: 'procedural', approxKB: 1024, notes: '512² RGBA' },
  { kind: 'texture', name: 'padVinyl', source: 'procedural', approxKB: 1024, notes: '512² RGBA' },
  { kind: 'texture', name: 'netWeave', source: 'procedural', approxKB: 256, notes: '256² RGBA alpha-tested' },
  { kind: 'texture', name: 'steel', source: 'procedural', approxKB: 1024, notes: '512² RGBA brushed' },
  { kind: 'font', name: 'dotMatrix5x7', source: 'procedural', approxKB: 4, notes: 'code-defined glyphs (DSEG atlas deferred with first external asset)' },
  { kind: 'audio', name: 'whirrLoop', source: 'procedural', approxKB: 282, notes: '1.5 s loop @48k mono' },
  { kind: 'audio', name: 'feedClunk', source: 'procedural', approxKB: 30 },
  { kind: 'audio', name: 'releaseThwip', source: 'procedural', approxKB: 19 },
  { kind: 'audio', name: 'woodCrack×3', source: 'procedural', approxKB: 124 },
  { kind: 'audio', name: 'metalPing×3', source: 'procedural', approxKB: 310 },
  { kind: 'audio', name: 'perfectThump', source: 'procedural', approxKB: 71 },
  { kind: 'audio', name: 'panelClick', source: 'procedural', approxKB: 8 },
  { kind: 'audio', name: 'tokenClink', source: 'procedural', approxKB: 53 },
  { kind: 'model', name: 'batterRig', source: 'procedural', approxKB: 64, notes: 'code-built hierarchy + programmatic clips; Mixamo swap point' },
];

export function manifestSummary(): string {
  const byKind = new Map<string, number>();
  for (const a of MANIFEST) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + a.approxKB);
  const parts = [...byKind.entries()].map(([k, kb]) => `${k} ${(kb / 1024).toFixed(1)} MB`);
  return `assets (all procedural, 0 B wire): ${parts.join(' · ')}`;
}
