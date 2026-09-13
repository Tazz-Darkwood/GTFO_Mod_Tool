import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { VanillaIndex } from '@gtfo/core';

/**
 * Full vanilla blocks ship with the app for every type except the giants
 * (Text 16 MB, LevelLayout 8.8 MB, WardenObjective 2.6 MB), which are index-only.
 */
export const INDEX_ONLY_TYPES = ['Text', 'LevelLayout', 'WardenObjective'];

const VANILLA_FILE = /^(.+?)DataBlock\.json$/;

export interface VanillaBuildResult {
  index: VanillaIndex;
  fullBlocks: Record<string, unknown[]>;
  skipped: string[];
  blockCounts: Record<string, number>;
}

function displayNameOf(block: Record<string, unknown>, prop: string): string {
  const v = block[prop];
  let s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export async function buildVanillaIndex(
  repoDir: string,
  displayName: Record<string, string>,
): Promise<VanillaBuildResult> {
  const entries = await fsp.readdir(repoDir);
  const types: VanillaIndex['types'] = {};
  const fullBlocks: Record<string, unknown[]> = {};
  const skipped: string[] = [];
  const blockCounts: Record<string, number> = {};

  for (const name of entries.sort()) {
    const m = VANILLA_FILE.exec(name);
    if (!m) continue;
    const type = m[1]!;
    const text = await fsp.readFile(path.join(repoDir, name), 'utf8');
    const data = parseJsonc(text) as { Blocks?: unknown[] } | null;
    if (!data || !Array.isArray(data.Blocks)) {
      skipped.push(name);
      continue;
    }
    const nameProp = displayName[type] ?? 'name';
    const ids: Record<string, string> = {};
    for (const b of data.Blocks) {
      if (!b || typeof b !== 'object') continue;
      const rec = b as Record<string, unknown>;
      const id = rec['persistentID'];
      if (typeof id !== 'number') continue;
      ids[String(id)] = displayNameOf(rec, nameProp);
    }
    types[type] = ids;
    blockCounts[type] = data.Blocks.length;
    if (!INDEX_ONLY_TYPES.includes(type)) fullBlocks[type] = data.Blocks;
  }
  const fullBlockTypes = Object.keys(fullBlocks).sort();
  return { index: { types, fullBlockTypes }, fullBlocks, skipped, blockCounts };
}
