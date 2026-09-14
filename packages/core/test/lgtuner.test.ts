import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Project, SchemaBundle, VanillaIndex } from '../src/index.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import { buildRundownTree } from '../src/index/rundownTree.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import { NodeFileSystem } from '../src/io/nodeFs.js';
import { findBepInExLog, matchLoad, parseTileLog, tilesForLayout } from '../src/logs/lgtunerLog.js';
import {
  lgtunerConfigs,
  lgtunerFileIdFor,
  lgtunerFor,
  lgtunerPrefabs,
  lgtunerSkeleton,
  parseLgTuner,
} from '../src/plugins/lgtuner.js';
import { blocksFor, buildSourceFile, loadProject } from '../src/project/projectLoader.js';
import { assertSchemaBundle, assertVanillaIndex } from '../src/schema/schemaBundle.js';
import { EditSession } from '../src/edit/editEngine.js';
import { validateProject } from '../src/validate/validator.js';
import { parseDocument } from '../src/text/jsoncDoc.js';
import { findTrailingCommas } from '../src/text/trailingCommas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus =
  process.env['GTFO_CORPUS'] ??
  path.resolve(here, '../../../../Time - Copy/BepInEx/plugins/Mathiast - Time/Time');
const distDir = path.resolve(here, '..', '..', 'schema', 'dist');

// ---------------------------------------------------------------------------
// Synthetic project
// ---------------------------------------------------------------------------

const cls = (name: string, fields: SchemaBundle['blockTypes'][string]['fields']) => {
  const fieldsByLowerName: Record<string, number> = {};
  fields.forEach((f, i) => (fieldsByLowerName[f.name.toLowerCase()] = i));
  return { name, fields, fieldsByLowerName };
};
const schema: SchemaBundle = {
  meta: { repo: '', commit: 't', builtAt: '' },
  blockTypes: {
    LevelLayout: cls('LevelLayout', [
      {
        kind: 'list',
        name: 'Zones',
        item: { kind: 'object', name: '', className: 'ExpeditionZoneData' },
      },
      { kind: 'scalar', name: 'name', scalar: 'String' },
      { kind: 'scalar', name: 'persistentID', scalar: 'UInt32' },
    ]),
  },
  classes: {
    ExpeditionZoneData: cls('ExpeditionZoneData', [
      { kind: 'enum', name: 'LocalIndex', enumName: 'eLocalZoneIndex' },
    ]),
  },
  enums: {
    eLocalZoneIndex: {
      name: 'eLocalZoneIndex',
      members: [0, 1, 2, 3, 4].map((v) => ({ name: `Zone_${v}`, value: v })),
      isFlags: false,
      open: true,
    },
  },
};
const vanilla: VanillaIndex = { types: {}, fullBlockTypes: [] };

function project(files: Record<string, string>): Project {
  const map = new Map();
  const index = emptyIndex();
  for (const [id, text] of Object.entries(files)) {
    const f = buildSourceFile(id, `/root/${id}`, text, { mtimeMs: 1, size: text.length });
    map.set(id, f);
    indexAddBlocks(index, id, blocksFor(f));
  }
  const p: Project = {
    rootPath: '/root',
    files: map,
    index,
    resolutions: computeResolutions(map.values(), vanilla, schema),
    diagnostics: [],
    schema,
    vanilla,
  };
  validateProject(p);
  return p;
}

const LAYOUT = `{ "Zones": [ { "LocalIndex": 0 }, { "LocalIndex": "Zone_1" }, { "LocalIndex": 49 } ], "name": "L", "datablock": "LevelLayout", "persistentID": 100 }`;

describe('LGTuner config parsing and rules', () => {
  it('parses a file and links it to its layout', () => {
    const p = project({
      'PartialData/L.json': LAYOUT,
      'Custom/LGTuner/L.json': `{
        "LevelLayoutID": 100, // the layout
        "ExtraComplexResourceToLoad": ["Mining", "tech"],
        "ZoneOverrides": [
          { "LocalIndex": "Zone_1", "OverrideGeomorphs": true, "Geomorphs": [ { "Geomorph": "Assets/a.prefab", "Direction": "Left" } ] },
          { "LocalIndex": 7 }
        ],
        "TileOverrides": [
          { "X": 0, "Z": 1, "Rotation": "Towards_Left", "Geomorph": "Assets/g.prefab" },
          { "X": -2, "Z": 3, "Rotation": "flip" },
          { "X": 0, "Z": 1 }
        ]
      }`,
    });
    const cfgs = lgtunerConfigs(p);
    expect(cfgs).toHaveLength(1);
    const c = cfgs[0]!;
    expect(c).toMatchObject({
      layoutId: 100,
      layoutResolution: 'project',
      layoutName: 'L',
      extraComplexes: ['Mining', 'tech'],
    });
    expect(c.zoneOverrides.map((z) => z.localIndex)).toEqual([1, 7]);
    expect(c.zoneOverrides[0]!.geomorphs[0]).toEqual({
      geomorph: 'Assets/a.prefab',
      direction: 'Left',
    });
    expect(c.tileOverrides.map((t) => [t.x, t.z, t.rotation])).toEqual([
      [0, 1, 'Towards_Left'],
      [-2, 3, 'flip'],
      [0, 1, 'None'],
    ]);
    expect(lgtunerFor(p, 'PartialData/L.json#')).toHaveLength(1);

    const codes = p.diagnostics.filter((d) => d.file === 'Custom/LGTuner/L.json');
    const byCode = (code: string) => codes.filter((d) => d.code === code);
    expect(byCode('L001')).toHaveLength(1); // (0,1) twice
    expect(byCode('L001')[0]!.range!.line).toBe(11);
    expect(byCode('L003')).toHaveLength(1); // LocalIndex 7
    expect(
      byCode('L005')
        .map((d) => d.message)
        .sort(),
    ).toEqual([expect.stringContaining('"flip"'), expect.stringContaining('"tech"')]);
    expect(byCode('L002')).toEqual([]);
    expect(byCode('L004')).toEqual([]);

    // Fixes: drop the duplicate tile, fix the casing.
    const s = new EditSession(p);
    s.applyFix(byCode('L001')[0]!.fix!);
    s.applyFix(p.diagnostics.find((d) => d.code === 'L005' && d.message.includes('flip'))!.fix!);
    const text = p.files.get('Custom/LGTuner/L.json')!.text;
    expect(text).toContain('"Rotation": "Flip"');
    expect(text.match(/"Z": 1/g)).toHaveLength(1);
    expect(text).toContain('// the layout');
    expect(validateProject(p).filter((d) => d.code === 'L001')).toEqual([]);
  });

  it('collects picker prefabs from the mod and builds a skeleton file', () => {
    const p = project({
      'PartialData/L.json': `{ "Zones": [ { "LocalIndex": 0, "CustomGeomorph": "Assets/Custom/zone.prefab" } ], "name": "My: Layout?", "datablock": "LevelLayout", "persistentID": 100 }`,
      'Custom/LGTuner/L.json': `{ "LevelLayoutID": 100, "TileOverrides": [ { "X": 1, "Z": 0, "Geomorph": "Assets/Custom/tile.prefab", "LeftPlug": "Assets/Plugs/p.prefab" } ] }`,
    });
    const pre = lgtunerPrefabs(p);
    expect(pre.geomorphs).toEqual(['Assets/Custom/tile.prefab', 'Assets/Custom/zone.prefab']);
    expect(pre.plugs).toEqual(['Assets/Plugs/p.prefab']);
    expect(lgtunerFileIdFor(p, 'PartialData/L.json#')).toBe('Custom/LGTuner/My Layout.json');
    const text = lgtunerSkeleton(100);
    expect(text).toContain('"LevelLayoutID": 100,');
    expect(text).toContain('"X": 0, //');
    // JSONC with comments, no trailing commas.
    const { tree, errors } = parseDocument(text);
    expect(errors).toEqual([]);
    expect(findTrailingCommas(text, tree)).toEqual([]);
  });

  it('flags a missing layout and two files for one layout', () => {
    const p = project({
      'PartialData/L.json': LAYOUT,
      'Custom/LGTuner/a.json': `{ "LevelLayoutID": 100 }`,
      'Custom/LGTuner/b.json': `{ "LevelLayoutID": 100 }`,
      'Custom/LGTuner/c.json': `{ "LevelLayoutID": 999 }`,
      'Custom/LGTuner/notes.json': `{ "hello": 1 }`,
    });
    const codes = p.diagnostics.filter((d) => d.file.startsWith('Custom/LGTuner/'));
    expect(codes.filter((d) => d.code === 'L004').map((d) => d.file)).toEqual([
      'Custom/LGTuner/b.json',
    ]);
    expect(codes.filter((d) => d.code === 'L002').map((d) => d.file)).toEqual([
      'Custom/LGTuner/c.json',
    ]);
    expect(parseLgTuner(p, p.files.get('Custom/LGTuner/notes.json')!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

const LOG = `[Info   :   BepInEx] Loading [LGTuner 1.2.2]
[Message:   LGTuner] tile info: 0 1 geo_64x64_service_floodways_I_HA_02 for Zone_0 : Reality
[Message:   LGTuner] tile info: 1 1 geo_x for 49 : Reality
[Message:   LGTuner] tile info: 0 1 geo_y for Zone_0 : Dimension_1
[Message:CheatConsole] Update Current Expedition to X4 : Slot Machine 2.0...
${'[Info   :Other] filler\n'.repeat(60)}[Message:   LGTuner] tile info: 0 -1 geo_z for Zone_2 : Reality
`;

describe('LGTuner tile log', () => {
  it('splits loads, reads names and numbers, keeps the expedition hint', () => {
    const loads = parseTileLog(LOG);
    expect(loads).toHaveLength(2);
    expect(loads[0]!.tiles).toEqual([
      {
        x: 0,
        z: 1,
        prefab: 'geo_64x64_service_floodways_I_HA_02',
        localIndex: 0,
        dimension: 'Reality',
      },
      { x: 1, z: 1, prefab: 'geo_x', localIndex: 49, dimension: 'Reality' },
      { x: 0, z: 1, prefab: 'geo_y', localIndex: 0, dimension: 'Dimension_1' },
    ]);
    expect(loads[0]!.expeditionHint).toBe('X4 : Slot Machine 2.0');
    expect(loads[0]!).toMatchObject({ lineStart: 2, lineEnd: 4 });
    expect(loads[1]!.tiles[0]).toMatchObject({ x: 0, z: -1, localIndex: 2 });
  });
});

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(corpus))('LGTuner on the corpus (read-only)', () => {
  let p: Project;
  beforeAll(async () => {
    const sch = assertSchemaBundle(
      JSON.parse(await fsp.readFile(path.join(distDir, 'schema-bundle.json'), 'utf8')),
    );
    const van = assertVanillaIndex(
      JSON.parse(await fsp.readFile(path.join(distDir, 'vanilla-index.json'), 'utf8')),
    );
    p = await loadProject(corpus, new NodeFileSystem(), sch, van, { sep: path.sep });
    validateProject(p);
  });

  it('offers the game’s geomorph and plug prefabs when vanilla blocks are loaded', async () => {
    const blocks = JSON.parse(
      await fsp.readFile(path.join(distDir, 'vanilla-blocks', 'ComplexResourceSet.json'), 'utf8'),
    ) as unknown[];
    const withVanilla: Project = {
      ...p,
      vanilla: { ...p.vanilla, blocks: { ComplexResourceSet: blocks as never } },
    };
    const pre = lgtunerPrefabs(withVanilla);
    expect(pre.geomorphs.length).toBeGreaterThan(200);
    expect(pre.plugs.length).toBeGreaterThan(20);
    expect(
      pre.geomorphs.some((g) => g.endsWith('geo_64x64_service_floodways_I_HA_02.prefab')),
    ).toBe(true);
  });

  it('reads the friend’s eight LGTuner files, all linked to project layouts', () => {
    const cfgs = lgtunerConfigs(p);
    expect(cfgs).toHaveLength(8);
    expect(cfgs.every((c) => c.layoutResolution === 'project')).toBe(true);
    expect(cfgs.every((c) => c.tileOverrides.length === 1)).toBe(true); // skeletons at (0,0)
    expect(p.diagnostics.filter((d) => d.code.startsWith('L'))).toEqual([]);
  });

  it('finds the BepInEx log next to the rundown and matches its load to an expedition', async () => {
    const fs = new NodeFileSystem();
    const log = await findBepInExLog(fs, corpus, path.sep);
    expect(log).not.toBeNull();
    expect(log!.toLowerCase()).toContain(`${path.sep}bepinex${path.sep}logoutput.log`);
    const loads = parseTileLog(await fs.readFile(log!));
    expect(loads).toHaveLength(1);
    const load = loads[0]!;
    expect(load.tiles).toHaveLength(12);
    expect(load.tiles.filter((t) => t.dimension === 'Dimension_1')).toHaveLength(2);
    expect(load.tiles.map((t) => t.localIndex)).toContain(49);
    expect(load.expeditionHint).toBe('X4 : Slot Machine 2.0');

    const tree = buildRundownTree(p);
    const matches = matchLoad(p, tree, load);
    expect(matches[0]).toMatchObject({ prefix: 'X4', score: 12 });
    const exp = tree.rundowns[0]!.tiers.flatMap((t) => t.expeditions).find(
      (e) => e.prefix === 'X4',
    )!;
    const main = exp.layers[0]!.layout!.blockId!;
    const tiles = tilesForLayout(p, exp, load, main);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.dimension === 'Reality')).toBe(true);
    // Every Reality tile belongs to exactly one of X4's layers.
    const reality = load.tiles.filter((t) => t.dimension === 'Reality');
    const covered = exp.layers
      .filter((l) => l.layout?.blockId)
      .flatMap((l) => tilesForLayout(p, exp, load, l.layout!.blockId!));
    expect(covered).toHaveLength(reality.length);
    expect(covered.some((t) => t.ambiguous)).toBe(false);
  });
});
