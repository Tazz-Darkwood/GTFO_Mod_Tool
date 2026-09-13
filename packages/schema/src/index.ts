/**
 * Runtime access to the generated schema bundle and vanilla index.
 * The files in dist/ are produced by `npm run schema:build` and committed.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SchemaBundle, VanillaIndex } from '@gtfo/core';

const here = path.dirname(fileURLToPath(import.meta.url));
export const distDir = path.resolve(here, '..', 'dist');
export const schemaBundlePath = path.join(distDir, 'schema-bundle.json');
export const vanillaIndexPath = path.join(distDir, 'vanilla-index.json');
export const vanillaBlocksDir = path.join(distDir, 'vanilla-blocks');

export async function loadSchemaBundle(): Promise<SchemaBundle> {
  return loadSchemaBundleFrom(distDir);
}

export async function loadVanillaIndex(): Promise<VanillaIndex> {
  return loadVanillaIndexFrom(distDir);
}

// --- Directory-parameterised variants (used by the packaged desktop app) ----

export async function loadSchemaBundleFrom(dir: string): Promise<SchemaBundle> {
  return JSON.parse(
    await fsp.readFile(path.join(dir, 'schema-bundle.json'), 'utf8'),
  ) as SchemaBundle;
}

export async function loadVanillaIndexFrom(dir: string): Promise<VanillaIndex> {
  return JSON.parse(
    await fsp.readFile(path.join(dir, 'vanilla-index.json'), 'utf8'),
  ) as VanillaIndex;
}

export async function loadVanillaBlocksFrom(
  dir: string,
  type: string,
): Promise<unknown[] | undefined> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(dir, 'vanilla-blocks', `${type}.json`), 'utf8'),
    ) as unknown[];
  } catch {
    return undefined;
  }
}

export async function loadAllVanillaBlocksFrom(
  dir: string,
  index: VanillaIndex,
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  await Promise.all(
    index.fullBlockTypes.map(async (type) => {
      const blocks = await loadVanillaBlocksFrom(dir, type);
      if (!blocks) return;
      const byId: Record<string, unknown> = {};
      for (const b of blocks) {
        const id = (b as { persistentID?: unknown }).persistentID;
        if (typeof id === 'number') byId[String(id)] = b;
      }
      out[type] = byId;
    }),
  );
  return out;
}

/** All shipped full vanilla blocks, keyed type -> persistentID -> block. */
export async function loadAllVanillaBlocks(
  index: VanillaIndex,
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  await Promise.all(
    index.fullBlockTypes.map(async (type) => {
      const blocks = await loadVanillaBlocks(type);
      if (!blocks) return;
      const byId: Record<string, unknown> = {};
      for (const b of blocks) {
        const id = (b as { persistentID?: unknown }).persistentID;
        if (typeof id === 'number') byId[String(id)] = b;
      }
      out[type] = byId;
    }),
  );
  return out;
}

export async function loadVanillaBlocks(type: string): Promise<unknown[] | undefined> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(vanillaBlocksDir, `${type}.json`), 'utf8'),
    ) as unknown[];
  } catch {
    return undefined;
  }
}
