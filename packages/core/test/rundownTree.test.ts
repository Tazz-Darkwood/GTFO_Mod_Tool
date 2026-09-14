import { describe, expect, it } from 'vitest';
import type { Project, SchemaBundle, VanillaIndex } from '../src/index.js';
import { EditSession } from '../src/edit/editEngine.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import { buildRundownTree, layoutDetailFor } from '../src/index/rundownTree.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import {
  addExpeditionOps,
  addZoneOps,
  deleteZoneOps,
  duplicateExpeditionOps,
  duplicateZoneOps,
  moveExpeditionOps,
  nextLocalIndex,
} from '../src/project/expeditionOps.js';
import { blocksFor, buildSourceFile } from '../src/project/projectLoader.js';
import { parseDocument } from '../src/text/jsoncDoc.js';
import { validateProject } from '../src/validate/validator.js';

const cls = (name: string, fields: SchemaBundle['blockTypes'][string]['fields']) => {
  const fieldsByLowerName: Record<string, number> = {};
  fields.forEach((f, i) => (fieldsByLowerName[f.name.toLowerCase()] = i));
  return { name, fields, fieldsByLowerName };
};
const META = [
  { kind: 'scalar', name: 'name', scalar: 'String' },
  { kind: 'scalar', name: 'internalEnabled', scalar: 'Boolean' },
  { kind: 'scalar', name: 'persistentID', scalar: 'UInt32' },
] as const;

const schema: SchemaBundle = {
  meta: { repo: '', commit: 't', builtAt: '' },
  blockTypes: {
    GameSetup: cls('GameSetup', [
      {
        kind: 'list',
        name: 'RundownIdsToLoad',
        item: { kind: 'ref', name: '', refType: 'Rundown' },
      },
      ...META,
    ]),
    Rundown: cls('Rundown', [
      {
        kind: 'list',
        name: 'TierA',
        item: { kind: 'object', name: '', className: 'ExpeditionInTierData' },
      },
      {
        kind: 'list',
        name: 'TierB',
        item: { kind: 'object', name: '', className: 'ExpeditionInTierData' },
      },
      ...META,
    ]),
    LevelLayout: cls('LevelLayout', [
      { kind: 'scalar', name: 'ZoneAliasStart', scalar: 'Int32' },
      {
        kind: 'list',
        name: 'Zones',
        item: { kind: 'object', name: '', className: 'ExpeditionZoneData' },
      },
      ...META,
    ]),
    WardenObjective: cls('WardenObjective', [
      { kind: 'enum', name: 'Type', enumName: 'eWardenObjectiveType' },
      { kind: 'ref', name: 'ChainedPuzzleToActive', refType: 'ChainedPuzzle' },
      {
        kind: 'list',
        name: 'WavesOnGotoWin',
        item: { kind: 'object', name: '', className: 'GenericEnemyWaveData' },
      },
      ...META,
    ]),
    ChainedPuzzle: cls('ChainedPuzzle', [...META]),
    SurvivalWaveSettings: cls('SurvivalWaveSettings', [...META]),
    SurvivalWavePopulation: cls('SurvivalWavePopulation', [...META]),
  },
  classes: {
    ExpeditionInTierData: cls('ExpeditionInTierData', [
      { kind: 'scalar', name: 'Enabled', scalar: 'Boolean' },
      { kind: 'object', name: 'Descriptive', className: 'DescriptiveData' },
      { kind: 'ref', name: 'LevelLayoutData', refType: 'LevelLayout' },
      { kind: 'object', name: 'MainLayerData', className: 'LayerData' },
      { kind: 'scalar', name: 'SecondaryLayerEnabled', scalar: 'Boolean' },
      { kind: 'ref', name: 'SecondaryLayout', refType: 'LevelLayout' },
      { kind: 'object', name: 'SecondaryLayerData', className: 'LayerData' },
    ]),
    DescriptiveData: cls('DescriptiveData', [
      { kind: 'scalar', name: 'Prefix', scalar: 'String' },
      { kind: 'scalar', name: 'PublicName', scalar: 'String' },
    ]),
    LayerData: cls('LayerData', [
      { kind: 'object', name: 'ObjectiveData', className: 'WardenObjectiveLayerData' },
    ]),
    WardenObjectiveLayerData: cls('WardenObjectiveLayerData', [
      { kind: 'ref', name: 'DataBlockId', refType: 'WardenObjective' },
    ]),
    ExpeditionZoneData: cls('ExpeditionZoneData', [
      { kind: 'enum', name: 'LocalIndex', enumName: 'eLocalZoneIndex' },
      { kind: 'scalar', name: 'AliasOverride', scalar: 'Int32' },
      { kind: 'enum', name: 'BuildFromLocalIndex', enumName: 'eLocalZoneIndex' },
      { kind: 'enum', name: 'SubComplex', enumName: 'SubComplex' },
      { kind: 'enum', name: 'StartExpansion', enumName: 'eZoneBuildFromExpansionType' },
      { kind: 'object', name: 'CoverageMinMax', className: 'Vector2' },
      { kind: 'scalar', name: 'CustomGeomorph', scalar: 'String' },
      { kind: 'object', name: 'AltitudeData', className: 'ZoneAltitudeData' },
      { kind: 'ref', name: 'ChainedPuzzleToEnter', refType: 'ChainedPuzzle' },
      { kind: 'ref', name: 'LightSettings', refType: 'LightSettings' },
      {
        kind: 'list',
        name: 'EnemySpawningInZone',
        item: { kind: 'object', name: '', className: 'EnemySpawningData' },
      },
      {
        kind: 'list',
        name: 'EventsOnEnter',
        item: { kind: 'object', name: '', className: 'Event' },
      },
    ]),
    Vector2: cls('Vector2', [
      { kind: 'scalar', name: 'x', scalar: 'Single' },
      { kind: 'scalar', name: 'y', scalar: 'Single' },
    ]),
    ZoneAltitudeData: cls('ZoneAltitudeData', [
      { kind: 'enum', name: 'AllowedZoneAltitude', enumName: 'eWantedZoneHeighs' },
    ]),
    EnemySpawningData: cls('EnemySpawningData', [
      { kind: 'scalar', name: 'GroupType', scalar: 'Int32' },
    ]),
    Event: cls('Event', [{ kind: 'scalar', name: 'Type', scalar: 'Int32' }]),
    GenericEnemyWaveData: cls('GenericEnemyWaveData', [
      { kind: 'ref', name: 'WaveSettings', refType: 'SurvivalWaveSettings' },
      { kind: 'ref', name: 'WavePopulation', refType: 'SurvivalWavePopulation' },
    ]),
  },
  enums: {
    eZoneBuildFromExpansionType: {
      name: 'eZoneBuildFromExpansionType',
      members: [
        'Towards_Random',
        'Towards_Forward',
        'Towards_Backward',
        'Towards_Right',
        'Towards_Left',
      ].map((name, value) => ({ name, value })),
      isFlags: false,
    },
    eWantedZoneHeighs: {
      name: 'eWantedZoneHeighs',
      members: [
        { name: 'LowMidHigh', value: 0 },
        { name: 'OnlyHigh', value: 2 },
      ],
      isFlags: false,
    },
    eLocalZoneIndex: {
      name: 'eLocalZoneIndex',
      members: [0, 1, 2, 3, 4].map((v) => ({ name: `Zone_${v}`, value: v })),
      isFlags: false,
      open: true,
    },
    SubComplex: {
      name: 'SubComplex',
      members: [
        { name: 'Mining', value: 0 },
        { name: 'DataCenter', value: 1 },
      ],
      isFlags: false,
    },
    eWardenObjectiveType: {
      name: 'eWardenObjectiveType',
      members: [
        { name: 'HSU_FindSample', value: 0 },
        { name: 'Reactor_Startup', value: 1 },
      ],
      isFlags: false,
    },
  },
};
const vanilla: VanillaIndex = {
  types: {
    LevelLayout: { '5': 'Vanilla layout' },
    ChainedPuzzle: { '4': 'Vanilla alarm' },
    SurvivalWavePopulation: { '16': 'vpop' },
  },
  fullBlockTypes: [],
};

const FILES: Record<string, string> = {
  'GameData_GameSetupDataBlock_bin.json':
    '{"Headers":[],"Blocks":[{"RundownIdsToLoad":[666],"name":"Default","internalEnabled":true,"persistentID":1}],"LastPersistentID":1}',
  'PartialData/Rundown.json': `[
  {
    "TierA": [
      {
        "Enabled": true,
        "Descriptive": { "Prefix": "A1", "PublicName": "First" },
        "LevelLayoutData": 100,
        "MainLayerData": { "ObjectiveData": { "DataBlockId": 200 } },
        "SecondaryLayerEnabled": false,
        "SecondaryLayout": 5,
        "SecondaryLayerData": { "ObjectiveData": { "DataBlockId": 0 } }
      },
      {
        "Enabled": false,
        "Descriptive": { "Prefix": "A2", "PublicName": "Broken" },
        "LevelLayoutData": 999,
        "MainLayerData": { "ObjectiveData": { "DataBlockId": 0 } },
        "SecondaryLayerEnabled": false,
        "SecondaryLayout": 0
      }
    ],
    "TierB": [],
    "name": "Test rundown",
    "internalEnabled": true,
    "datablock": "Rundown",
    "persistentID": 666
  }
]`,
  'PartialData/Layout.json': `{
  "ZoneAliasStart": 500,
  "Zones": [
    { "LocalIndex": 0, "AliasOverride": -1, "BuildFromLocalIndex": 0, "SubComplex": "DataCenter", "ChainedPuzzleToEnter": 0, "LightSettings": 43, "EnemySpawningInZone": [], "EventsOnEnter": [] },
    { "LocalIndex": "Zone_1", // alarm zone
      "AliasOverride": -1, "BuildFromLocalIndex": 0, "SubComplex": 0, "ChainedPuzzleToEnter": 300, "LightSettings": 43, "EnemySpawningInZone": [{"GroupType":1},{"GroupType":2}], "EventsOnEnter": [{"Type":1}] },
    { "LocalIndex": 2, "AliasOverride": 777, "BuildFromLocalIndex": 1, "SubComplex": 0, "StartExpansion": "towards_right", "CoverageMinMax": { "x": 70.0, "y": 40.0 }, "CustomGeomorph": "Assets/geo.prefab", "AltitudeData": { "AllowedZoneAltitude": 2 }, "ChainedPuzzleToEnter": 4, "LightSettings": 43, "EnemySpawningInZone": [], "EventsOnEnter": [] }
  ],
  "name": "Layout one",
  "internalEnabled": true,
  "datablock": "LevelLayout",
  "persistentID": 100
}`,
  'PartialData/Objective.json': `[{ "Type": 1, "ChainedPuzzleToActive": 300, "WavesOnGotoWin": [{ "WaveSettings": 8874, "WavePopulation": 16 }], "name": "Obj", "internalEnabled": true, "datablock": "WardenObjective", "persistentID": 200 }]`,
  'PartialData/Alarms.json': `[{ "name": "Class S", "internalEnabled": true, "datablock": "ChainedPuzzle", "persistentID": 300 }]`,
};

function makeProject(files = FILES): Project {
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

describe('buildRundownTree', () => {
  const p = makeProject();
  const tree = buildRundownTree(p);
  const rd = tree.rundowns[0]!;
  const a1 = rd.tiers[0]!.expeditions[0]!;
  const a2 = rd.tiers[0]!.expeditions[1]!;

  it('finds the loaded rundown and its expeditions', () => {
    expect(tree.loadedRundownIds).toEqual([666]);
    expect(rd).toMatchObject({ id: 666, name: 'Test rundown', loaded: true });
    expect(rd.tiers.map((t) => t.expeditions.length)).toEqual([2, 0, 0, 0, 0]);
    expect(a1).toMatchObject({
      prefix: 'A1',
      publicName: 'First',
      enabled: true,
      path: ['TierA', 0],
    });
    expect(a2.enabled).toBe(false);
  });

  it('resolves layers: project layout with zones, vanilla secondary, missing layout', () => {
    const [main, secondary] = a1.layers;
    expect(main!.layout).toMatchObject({
      resolution: 'project',
      id: 100,
      name: 'Layout one',
      refPath: ['TierA', 0, 'LevelLayoutData'],
    });
    expect(main!.layout!.detail?.kind).toBe('layout');
    const zones = (
      main!.layout!.detail as {
        zones: {
          alias: number;
          localIndex: number;
          subComplex: string;
          enemyGroups: number;
          eventCount: number;
          alarm: unknown;
          startExpansion: string;
          coverage: { min: number; max: number };
          geomorph: boolean;
          altitude?: string;
        }[];
      }
    ).zones;
    expect(zones.map((z) => z.alias)).toEqual([500, 501, 777]);
    expect(zones.map((z) => z.localIndex)).toEqual([0, 1, 2]); // string enum normalised
    expect(zones[0]!.subComplex).toBe('DataCenter');
    expect(zones[1]).toMatchObject({ enemyGroups: 2, eventCount: 1 });
    expect(zones[1]!.alarm).toMatchObject({ resolution: 'project', name: 'Class S' });
    expect(zones[2]!.alarm).toMatchObject({ resolution: 'vanilla', name: 'Vanilla alarm' });
    // Graph fields: enum names canonicalised, coverage read, geomorph/altitude flagged.
    expect(zones[2]).toMatchObject({
      startExpansion: 'Towards_Right',
      coverage: { min: 70, max: 40 },
      geomorph: true,
      altitude: 'OnlyHigh',
    });
    expect(zones[0]).toMatchObject({
      startExpansion: '',
      coverage: { min: 0, max: 0 },
      geomorph: false,
    });
    expect(zones[0]!.altitude).toBeUndefined();
    expect(layoutDetailFor(p, main!.layout!.blockId!)!.zones).toHaveLength(3);
    expect(layoutDetailFor(p, 'PartialData/Alarms.json#/0')).toBeNull();
    expect(secondary).toMatchObject({ enabled: false });
    expect(secondary!.layout).toMatchObject({ resolution: 'vanilla', id: 5 });
    expect(a2.layers[0]!.layout).toMatchObject({ resolution: 'missing', id: 999 });
    expect(a2.layers[0]!.objectives).toEqual([]);
  });

  it('describes objectives with alarms and waves, and rolls problems up', () => {
    const obj = a1.layers[0]!.objectives[0]!;
    expect(obj.detail).toMatchObject({ kind: 'objective', type: 'Reactor_Startup' });
    const d = obj.detail as {
      alarms: { name?: string }[];
      waves: { on: string; settings: { resolution: string } | null }[];
    };
    expect(d.alarms[0]!.name).toBe('Class S');
    expect(d.waves[0]).toMatchObject({ on: 'GotoWin' });
    expect(d.waves[0]!.settings!.resolution).toBe('missing');
    // Objective has the dangling wave (R001) -> counted on the objective link and the expedition.
    expect(obj.problems).toBeGreaterThanOrEqual(1);
    expect(a1.problems).toBeGreaterThanOrEqual(obj.problems);
    // A2 is disabled, and the validator skips disabled expeditions on purpose (gates.ts).
    expect(a2.problems).toBe(0);
    expect(rd.problems).toBeGreaterThanOrEqual(a1.problems);
  });
});

describe('expedition and zone ops', () => {
  it('adds, duplicates, moves expeditions', () => {
    const p = makeProject();
    const s = new EditSession(p);
    const rdId = 'PartialData/Rundown.json#/0';
    const add = addExpeditionOps(p, rdId, 'B', { prefix: 'B1', publicName: 'New' });
    s.applyMany(add.target, add.ops);
    let tree = buildRundownTree(p);
    expect(tree.rundowns[0]!.tiers[1]!.expeditions[0]).toMatchObject({
      prefix: 'B1',
      publicName: 'New',
      enabled: true,
    });
    expect(add.createdPath).toEqual(['TierB', 0]);

    const dup = duplicateExpeditionOps(p, rdId, 'A', 0);
    s.applyMany(dup.target, dup.ops);
    tree = buildRundownTree(p);
    expect(tree.rundowns[0]!.tiers[0]!.expeditions.map((e) => e.prefix)).toEqual([
      'A1',
      'A1-copy',
      'A2',
    ]);
    expect(tree.rundowns[0]!.tiers[0]!.expeditions[1]!.layers[0]!.layout!.id).toBe(100);

    const mv = moveExpeditionOps(p, rdId, 'A', 2, 'B');
    s.applyMany(mv.target, mv.ops);
    tree = buildRundownTree(p);
    expect(tree.rundowns[0]!.tiers[0]!.expeditions.map((e) => e.prefix)).toEqual(['A1', 'A1-copy']);
    expect(tree.rundowns[0]!.tiers[1]!.expeditions.map((e) => e.prefix)).toEqual(['B1', 'A2']);
    expect(parseDocument(p.files.get('PartialData/Rundown.json')!.text).errors).toEqual([]);
    expect(() => moveExpeditionOps(p, rdId, 'A', 0, 'A')).toThrow();
  });

  it('adds, duplicates and deletes zones with sensible LocalIndex handling', () => {
    const p = makeProject();
    const s = new EditSession(p);
    const layoutId = 'PartialData/Layout.json#';
    const zones = () =>
      (
        buildRundownTree(p).rundowns[0]!.tiers[0]!.expeditions[0]!.layers[0]!.layout!.detail as {
          zones: {
            localIndex: number;
            buildFrom: number;
            alias: number;
            startExpansion: string;
            subComplex: string;
          }[];
        }
      ).zones;
    expect(
      nextLocalIndex(p, [{ LocalIndex: 0 }, { LocalIndex: 'Zone_1' }, { LocalIndex: 3 }]),
    ).toBe(2);

    const add = addZoneOps(p, layoutId);
    s.applyMany(add.target, add.ops);
    expect(zones().map((z) => [z.localIndex, z.buildFrom])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 2],
    ]);

    const dup = duplicateZoneOps(p, layoutId, 1);
    s.applyMany(dup.target, dup.ops);
    const text = p.files.get('PartialData/Layout.json')!.text;
    expect(text.split('// alarm zone').length).toBe(3); // comment travelled with the raw copy
    expect(text).toContain('"LocalIndex": "Zone_4"'); // string representation kept, bumped to next free
    expect(zones().map((z) => z.localIndex)).toEqual([0, 1, 4, 2, 3]);

    // Directional add: hangs off zone 0 towards the left, copying its complex.
    const left = addZoneOps(p, layoutId, { buildFrom: 0, direction: 'Left' });
    s.applyMany(left.target, left.ops);
    const added = zones()[zones().length - 1]!;
    expect(added).toMatchObject({
      localIndex: 5,
      buildFrom: 0,
      startExpansion: 'Towards_Left',
      alias: 505, // AliasOverride defaults to -1, not the schema's 0
    });
    expect(added.subComplex).toBe('DataCenter');
    expect(p.files.get('PartialData/Layout.json')!.text).not.toContain('$enum');
    expect(() => addZoneOps(p, layoutId, { direction: 'Sideways' })).toThrow(/direction/);
    s.undoFile('PartialData/Layout.json');

    const del = deleteZoneOps(p, layoutId, 1);
    expect(del.dependents).toEqual([3]); // zone 2 (now at index 3) builds from LocalIndex 1
    s.applyMany(del.target, del.ops);
    expect(zones().map((z) => z.localIndex)).toEqual([0, 4, 2, 3]);
    expect(parseDocument(p.files.get('PartialData/Layout.json')!.text).errors).toEqual([]);
  });
});
