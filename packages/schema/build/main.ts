/**
 * Build the schema bundle + vanilla index from UntiIted/OriginalDataBlocks.
 *   npm run schema:build            (uses/refreshes packages/schema/.cache)
 *   npm run schema:build -- --no-fetch
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SchemaBundle } from '@gtfo/core';
import { applyOverrides, unannotatedUInt32Fields, type Overrides } from './applyOverrides.js';
import { augmentFromVanilla } from './augmentFromVanilla.js';
import { buildVanillaIndex } from './buildVanillaIndex.js';
import { parseEnumText } from './parseEnums.js';
import { newRegistry, parseTypeListText, typeListToClass } from './parseTypeList.js';

const REPO_URL = 'https://github.com/UntiIted/OriginalDataBlocks';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const cacheDir = path.join(pkgDir, '.cache', 'OriginalDataBlocks');
const distDir = path.join(pkgDir, 'dist');
const overridesDir = path.join(pkgDir, 'overrides');

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function fetchRepo(noFetch: boolean): string {
  if (!existsSync(cacheDir)) {
    console.log(`Cloning ${REPO_URL} ...`);
    execFileSync('git', ['clone', '--depth', '1', REPO_URL, cacheDir], { stdio: 'inherit' });
  } else if (!noFetch) {
    try {
      execFileSync('git', ['-C', cacheDir, 'pull', '--ff-only', '--quiet'], { stdio: 'inherit' });
    } catch {
      console.warn('git pull failed; using cached checkout');
    }
  }
  return execFileSync('git', ['-C', cacheDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const noFetch = process.argv.includes('--no-fetch');
  const commit = fetchRepo(noFetch);

  // --- TypeList ------------------------------------------------------------
  const typeListDir = path.join(cacheDir, 'TypeList');
  const reg = newRegistry();
  const blockTypes: SchemaBundle['blockTypes'] = {};
  const files = (await fsp.readdir(typeListDir)).filter((f) => f.endsWith('.txt')).sort();
  for (const f of files) {
    const m = /^GameData\.(.+?)DataBlock\.txt$/.exec(f);
    if (!m) {
      console.warn(`skipping unexpected TypeList file ${f}`);
      continue;
    }
    const typeName = m[1]!;
    const text = await fsp.readFile(path.join(typeListDir, f), 'utf8');
    const entries = parseTypeListText(text, f);
    blockTypes[typeName] = typeListToClass(typeName, entries, reg);
  }

  // --- Enums ---------------------------------------------------------------
  const ov: Overrides = {
    refTargets: await readJson(path.join(overridesDir, 'refTargets.json'), {}),
    soundFields:
      (await readJson(path.join(overridesDir, 'soundFields.json'), { fields: [] as string[] }))
        .fields ?? [],
    soundFieldPatterns:
      (await readJson(path.join(overridesDir, 'soundFields.json'), { patterns: [] as string[] }))
        .patterns ?? [],
    soundClasses:
      (await readJson(path.join(overridesDir, 'soundFields.json'), { classes: [] as string[] }))
        .classes ?? [],
    enumFlags: await readJson(path.join(overridesDir, 'enumFlags.json'), []),
    enumOpen: await readJson(path.join(overridesDir, 'enumOpen.json'), []),
    displayName: await readJson(path.join(overridesDir, 'displayName.json'), {}),
  };
  const enumsDir = path.join(typeListDir, 'Enums');
  const enums: SchemaBundle['enums'] = {};
  for (const f of (await fsp.readdir(enumsDir)).filter((x) => x.endsWith('.txt')).sort()) {
    const name = f.slice(0, -4);
    enums[name] = parseEnumText(
      name,
      await fsp.readFile(path.join(enumsDir, f), 'utf8'),
      ov.enumFlags.includes(name),
    );
  }

  const classes: SchemaBundle['classes'] = {};
  for (const [k, v] of reg.classes) classes[k] = v;

  const raw: SchemaBundle = {
    meta: { repo: REPO_URL, commit, builtAt: new Date().toISOString() },
    blockTypes,
    classes,
    enums,
  };
  const overridden = applyOverrides(raw, ov);
  const unusedRefTargets = overridden.unusedRefTargets;
  const augmented = await augmentFromVanilla(overridden.bundle, cacheDir);
  const bundle = augmented.bundle;

  // --- Vanilla -------------------------------------------------------------
  const vanilla = await buildVanillaIndex(cacheDir, ov.displayName);

  // --- Write ---------------------------------------------------------------
  await fsp.mkdir(path.join(distDir, 'vanilla-blocks'), { recursive: true });
  await fsp.writeFile(path.join(distDir, 'schema-bundle.json'), JSON.stringify(bundle));
  await fsp.writeFile(path.join(distDir, 'vanilla-index.json'), JSON.stringify(vanilla.index));
  for (const [t, blocks] of Object.entries(vanilla.fullBlocks)) {
    await fsp.writeFile(path.join(distDir, 'vanilla-blocks', `${t}.json`), JSON.stringify(blocks));
  }

  // --- Report --------------------------------------------------------------
  const enumRefs = new Set<string>();
  const missingEnums = new Set<string>();
  const walk = (cls: { fields: SchemaBundle['blockTypes'][string]['fields'] }) => {
    for (const f of cls.fields) {
      let x = f;
      while (x.kind === 'list') x = x.item;
      if (x.kind === 'enum') {
        enumRefs.add(x.enumName);
        if (!enums[x.enumName]) missingEnums.add(x.enumName);
      }
    }
  };
  Object.values(bundle.blockTypes).forEach(walk);
  Object.values(bundle.classes).forEach(walk);
  const unknownFields: string[] = [];
  const scanUnknown = (cls: {
    name: string;
    fields: SchemaBundle['blockTypes'][string]['fields'];
  }) => {
    for (const f of cls.fields) {
      let x = f;
      while (x.kind === 'list') x = x.item;
      if (x.kind === 'unknown') unknownFields.push(`${cls.name}.${f.name}: ${x.declared}`);
    }
  };
  Object.values(bundle.blockTypes).forEach(scanUnknown);
  Object.values(bundle.classes).forEach(scanUnknown);

  const typesWithoutVanilla = Object.keys(bundle.blockTypes).filter((t) => !vanilla.index.types[t]);
  const vanillaWithoutType = Object.keys(vanilla.index.types).filter((t) => !bundle.blockTypes[t]);
  const unannotated = unannotatedUInt32Fields(bundle);

  console.log(`commit            ${commit}`);
  console.log(`block types       ${Object.keys(bundle.blockTypes).length}`);
  console.log(
    `nested classes    ${Object.keys(bundle.classes).length}  (conflicts: ${reg.conflicts.length})`,
  );
  for (const c of reg.conflicts) console.log(`   variant ${c.variantName}`);
  console.log(
    `enums             ${Object.keys(enums).length}  referenced: ${enumRefs.size}  missing: ${[...missingEnums].join(', ') || '-'}`,
  );
  console.log(
    `flag enums        ${Object.values(enums)
      .filter((e) => e.isFlags)
      .map((e) => e.name)
      .join(', ')}`,
  );
  console.log(
    `unknown fields    ${unknownFields.length - augmented.added.length} declared + ${augmented.added.length} inferred from vanilla dumps`,
  );
  for (const u of unknownFields.filter((x) => !x.includes('inferred:'))) console.log(`   ${u}`);
  for (const u of augmented.added) console.log(`   + ${u}`);
  console.log(
    `vanilla types     ${Object.keys(vanilla.index.types).length}  skipped files: ${vanilla.skipped.join(', ') || '-'}`,
  );
  console.log(`full-block types  ${vanilla.index.fullBlockTypes.length}`);
  console.log(`types w/o vanilla ${typesWithoutVanilla.join(', ') || '-'}`);
  console.log(`vanilla w/o type  ${vanillaWithoutType.join(', ') || '-'}`);
  console.log(`unused refTargets ${unusedRefTargets.join(', ') || '-'}`);
  console.log(
    `unannotated UInt32 fields (${unannotated.length}) — candidates for overrides/refTargets.json:`,
  );
  for (const u of unannotated) console.log(`   ${u}`);
  const bundleSize = (await fsp.stat(path.join(distDir, 'schema-bundle.json'))).size;
  const indexSize = (await fsp.stat(path.join(distDir, 'vanilla-index.json'))).size;
  console.log(
    `written dist/schema-bundle.json (${(bundleSize / 1024).toFixed(0)} KB), vanilla-index.json (${(indexSize / 1024).toFixed(0)} KB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
