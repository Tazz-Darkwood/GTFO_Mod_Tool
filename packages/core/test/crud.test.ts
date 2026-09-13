import { describe, expect, it } from 'vitest';
import type { Project, SchemaBundle, VanillaIndex } from '../src/index.js';
import { EditSession } from '../src/edit/editEngine.js';
import { reindentSnippet } from '../src/edit/textEdits.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import {
  buildReferenceIndex,
  findReferences,
  findReferencesToFile,
  pluginMentions,
} from '../src/index/references.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import { MemoryFileSystem } from '../src/io/fileSystem.js';
import {
  createBlockOps,
  deleteBlockOps,
  eligibleTargetFiles,
  suggestPersistentId,
} from '../src/project/blockOps.js';
import { createProjectFile, deleteProjectFile, validateNewFileId } from '../src/project/fileOps.js';
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
    Alarm: cls('Alarm', [
      { kind: 'ref', name: 'Wave', refType: 'Wave' },
      { kind: 'localizedText', name: 'Title' },
      { kind: 'list', name: 'Events', item: { kind: 'object', name: '', className: 'Event' } },
      { kind: 'scalar', name: 'Radius', scalar: 'Single' },
      ...META,
    ]),
    Wave: cls('Wave', [{ kind: 'scalar', name: 'Pause', scalar: 'Single' }, ...META]),
    Text: cls('Text', [...META]),
    Expedition: cls('Expedition', [
      { kind: 'scalar', name: 'SecondaryLayerEnabled', scalar: 'Boolean' },
      { kind: 'ref', name: 'SecondaryLayout', refType: 'Alarm' },
      ...META,
    ]),
  },
  classes: { Event: cls('Event', [{ kind: 'ref', name: 'ChainPuzzle', refType: 'Alarm' }]) },
  enums: {},
};
const vanilla: VanillaIndex = {
  types: { Wave: { '5': 'Vanilla wave', '4000000000': 'hashed' }, Alarm: { '1': 'v-alarm' } },
  fullBlockTypes: ['Wave'],
  blocks: {
    Wave: { '5': { Pause: 2.5, name: 'Vanilla wave', internalEnabled: true, persistentID: 5 } },
  },
};

function makeProject(files: Record<string, string>, root = '/root'): Project {
  const map = new Map();
  const index = emptyIndex();
  for (const [id, text] of Object.entries(files)) {
    const f = buildSourceFile(id, `${root}/${id}`, text, { mtimeMs: 1, size: text.length });
    map.set(id, f);
    indexAddBlocks(index, id, blocksFor(f));
  }
  const p: Project = {
    rootPath: root,
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

const PROJECT = {
  'PartialData/alarms.json': `[
  {
    "Wave": 7,
    "Title": 9,
    "Events": [{ "ChainPuzzle": 2 }],
    "Radius": 1.0, // one
    "name": "a1",
    "internalEnabled": true,
    "datablock": "Alarm",
    "persistentID": 100
  },
  {
    "Wave": 0,
    "Title": "literal",
    "Events": [],
    "Radius": 2.0,
    "name": "a2",
    "internalEnabled": true,
    "datablock": "Alarm",
    "persistentID": 101
  }
]`,
  'PartialData/waves.json': `[{"Pause":1.0,"name":"w","internalEnabled":true,"datablock":"Wave","persistentID":7}]`,
  'PartialData/single.json': `{"Wave":7,"Title":0,"Events":[],"Radius":1.0,"name":"solo","internalEnabled":true,"datablock":"Alarm","persistentID":2}`,
  'PartialData/exp.json': `[{"SecondaryLayerEnabled":false,"SecondaryLayout":101,"name":"e","internalEnabled":true,"datablock":"Expedition","persistentID":1}]`,
  'Custom/LGTuner/A.json': `{ "LevelLayoutID": 100, "note": "100 appears here; 1000 too", "x": 1000 }`,
};

describe('reference index', () => {
  const p = makeProject(PROJECT);
  const idx = buildReferenceIndex(p);
  it('finds refs through lists, localized text, and gated-off fields', () => {
    expect(findReferences(p, 'Wave', 7, idx).map((r) => `${r.name}:${r.field}`)).toEqual([
      'a1:Wave',
      'solo:Wave',
    ]);
    expect(findReferences(p, 'Text', 9, idx)[0]).toMatchObject({
      via: 'localizedText',
      name: 'a1',
    });
    expect(findReferences(p, 'Alarm', 2, idx).map((r) => [r.field, r.path.join('.')])).toEqual([
      ['ChainPuzzle', '0.Events.0.ChainPuzzle'],
    ]);
    expect(findReferences(p, 'Alarm', 101, idx).map((r) => r.name)).toEqual(['e']); // gate off: still counted
    expect(findReferences(p, 'Wave', 0, idx)).toEqual([]);
  });
  it('lists references into a file from other files', () => {
    expect(
      findReferencesToFile(p, 'PartialData/waves.json', idx)
        .map((r) => r.file)
        .sort(),
    ).toEqual(['PartialData/alarms.json', 'PartialData/single.json']);
  });
  it('finds plugin mentions for custom-range ids only', () => {
    expect(pluginMentions(p, 1000).map((m) => m.line)).toEqual([1, 1]);
    expect(pluginMentions(p, 100)).toEqual([]);
  });
});

describe('block ops', () => {
  it('suggests ids from the project, then vanilla, skipping collisions and hashed ids', () => {
    const p = makeProject(PROJECT);
    expect(suggestPersistentId(p, 'Alarm')).toEqual({ id: 102, basis: 'project' });
    expect(suggestPersistentId(p, 'Wave')).toEqual({ id: 8, basis: 'project' });
    expect(suggestPersistentId(p, 'Text')).toEqual({ id: 1, basis: 'none' });
    const q = makeProject({ 'PartialData/x.json': '[]' });
    expect(suggestPersistentId(q, 'Wave')).toEqual({ id: 6, basis: 'vanilla' }); // 4e9 ignored, 5 taken
    const w = makeProject({
      'GameData_WaveDataBlock_bin.json':
        '{"Headers":[],"Blocks":[{"name":"w","internalEnabled":true,"persistentID":3}],"LastPersistentID":40}',
    });
    expect(suggestPersistentId(w, 'Wave', 'GameData_WaveDataBlock_bin.json')).toEqual({
      id: 41,
      basis: 'wrapper',
    });
  });

  it('lists eligible target files in a sensible order', () => {
    const p = makeProject({
      ...PROJECT,
      'GameData_AlarmDataBlock_bin.json': '{"Headers":[],"Blocks":[],"LastPersistentID":0}',
    });
    const t = eligibleTargetFiles(p, 'Alarm');
    expect(t.map((x) => x.fileId)).toEqual([
      'GameData_AlarmDataBlock_bin.json',
      'PartialData/alarms.json',
      'PartialData/exp.json',
      'PartialData/waves.json',
    ]);
    expect(t[1]!.containsType).toBe(true);
    expect(t.some((x) => x.fileId.includes('single'))).toBe(false);
  });

  it('creates a blank block, a vanilla copy, and a raw copy that keeps comments', () => {
    const p = makeProject(PROJECT);
    const s = new EditSession(p);
    const blank = createBlockOps(p, {
      type: 'Alarm',
      targetFile: 'PartialData/alarms.json',
      persistentID: 102,
      name: 'new',
      source: { kind: 'blank' },
    });
    s.applyMany(blank.target, blank.ops);
    let text = p.files.get('PartialData/alarms.json')!.text;
    expect(parseDocument(text).errors).toEqual([]);
    expect(p.index.byType.get('Alarm')!.get(102)![0]!.name).toBe('new');
    expect(text).toMatch(/"datablock": "Alarm",\n\s+"persistentID": 102\n\s+}\n]$/);

    const van = createBlockOps(p, {
      type: 'Wave',
      targetFile: 'PartialData/waves.json',
      persistentID: 8,
      name: 'copy of vanilla',
      source: { kind: 'vanilla', id: 5 },
    });
    s.applyMany(van.target, van.ops);
    const w = p.index.byType.get('Wave')!.get(8)![0]!;
    expect(w.name).toBe('copy of vanilla');
    expect(p.files.get('PartialData/waves.json')!.text).toContain('"Pause": 2.5');

    const raw = createBlockOps(p, {
      type: 'Alarm',
      targetFile: 'PartialData/alarms.json',
      persistentID: 103,
      name: 'dup',
      source: { kind: 'project', blockId: 'PartialData/alarms.json#/0' },
    });
    expect(raw.ops[0]!.op).toBe('insertRaw');
    s.applyMany(raw.target, raw.ops);
    text = p.files.get('PartialData/alarms.json')!.text;
    const dup = p.index.byType.get('Alarm')!.get(103)![0]!;
    expect(dup.name).toBe('dup');
    expect(text.split('// one').length).toBe(3); // comment travelled with the copy
    expect(parseDocument(text).errors).toEqual([]);
    expect(p.diagnostics.filter((d) => d.code === 'D001')).toEqual([]);

    // One undo step per applyMany.
    s.undoFile('PartialData/alarms.json');
    expect(p.index.byType.get('Alarm')!.has(103)).toBe(false);
    expect(p.index.byType.get('Alarm')!.has(102)).toBe(true);
  });

  it('copies into a wrapper file without the datablock tag and bumps LastPersistentID', () => {
    const p = makeProject({
      ...PROJECT,
      'GameData_AlarmDataBlock_bin.json':
        '{\n  "Headers": [],\n  "Blocks": [],\n  "LastPersistentID": 0\n}',
    });
    const s = new EditSession(p);
    const plan = createBlockOps(p, {
      type: 'Alarm',
      targetFile: 'GameData_AlarmDataBlock_bin.json',
      persistentID: 500,
      name: 'in wrapper',
      source: { kind: 'project', blockId: 'PartialData/alarms.json#/1' },
    });
    s.applyMany(plan.target, plan.ops);
    const text = p.files.get('GameData_AlarmDataBlock_bin.json')!.text;
    expect(text).not.toContain('datablock');
    expect(text).toContain('"LastPersistentID": 500');
    expect(parseDocument(text).errors).toEqual([]);
    expect(p.index.byType.get('Alarm')!.get(500)![0]!.file).toBe(
      'GameData_AlarmDataBlock_bin.json',
    );
  });

  it('refuses bad targets and duplicate ids', () => {
    const p = makeProject(PROJECT);
    expect(() =>
      createBlockOps(p, {
        type: 'Alarm',
        targetFile: 'PartialData/single.json',
        persistentID: 9,
        name: 'x',
        source: { kind: 'blank' },
      }),
    ).toThrow(/single-block/);
    expect(() =>
      createBlockOps(p, {
        type: 'Alarm',
        targetFile: 'PartialData/alarms.json',
        persistentID: 100,
        name: 'x',
        source: { kind: 'blank' },
      }),
    ).toThrow(/already exists/);
    expect(() =>
      createBlockOps(p, {
        type: 'Alarm',
        targetFile: 'PartialData/alarms.json',
        persistentID: 9,
        name: 'x',
        source: { kind: 'vanilla', id: 1 },
      }),
    ).toThrow(/No full vanilla/);
  });

  it('deletes blocks and refuses single-block files', () => {
    const p = makeProject(PROJECT);
    const s = new EditSession(p);
    const del = deleteBlockOps(p, 'PartialData/alarms.json#/0');
    s.applyMany(del.target, del.ops);
    expect(p.index.byType.get('Alarm')!.has(100)).toBe(false);
    expect(
      p.files.get('PartialData/alarms.json')!.text.trim().startsWith('[\n  {\n    "Wave": 0'),
    ).toBe(true);
    expect(() => deleteBlockOps(p, 'PartialData/single.json#')).toThrow(/delete the file/);
  });
});

describe('replaceText (editable source)', () => {
  it('refuses broken JSON, coalesces undo by group, re-validates', () => {
    const p = makeProject(PROJECT);
    const s = new EditSession(p);
    const f = 'PartialData/waves.json';
    const original = p.files.get(f)!.text;
    expect(() => s.replaceText(f, '[ {')).toThrow(/JSON error/);
    s.replaceText(f, original.replace('"Pause":1.0', '"Pause":2.0'), { undoGroup: 'g1' });
    s.replaceText(f, original.replace('"Pause":1.0', '"Pause":3.0'), { undoGroup: 'g1' });
    s.replaceText(f, original.replace('"Pause":1.0', '"Pause":"x"'), { undoGroup: 'g2' });
    expect(p.diagnostics.some((d) => d.code === 'T001' && d.file === f)).toBe(true);
    s.undoFile(f);
    expect(p.files.get(f)!.text).toContain('"Pause":3.0'); // back to the end of group g1
    s.undoFile(f);
    expect(p.files.get(f)!.text).toBe(original); // g1 collapsed into one step
    expect(s.canUndo(f)).toBe(false);
  });
});

describe('reindentSnippet', () => {
  it('re-bases continuation lines onto the target indent', () => {
    const snippet = '    {\n      "a": 1,\n      "b": [\n        2\n      ]\n    }';
    expect(reindentSnippet(snippet, '\t')).toBe('{\n\t  "a": 1,\n\t  "b": [\n\t    2\n\t  ]\n\t}');
    expect(reindentSnippet('42', '  ')).toBe('42');
  });
});

describe('file ops', () => {
  it('creates and deletes files, keeping the project in sync', async () => {
    const fs = new MemoryFileSystem({
      '/root/PartialData/alarms.json': PROJECT['PartialData/alarms.json'],
    });
    const p = makeProject({ 'PartialData/alarms.json': PROJECT['PartialData/alarms.json'] });
    expect(validateNewFileId(p, 'PartialData/alarms.json', 'partial-array')).toMatch(/exists/);
    expect(validateNewFileId(p, 'Custom/x.json', 'partial-array')).toMatch(/PartialData/);
    expect(validateNewFileId(p, 'GameData_AlarmDataBlock_bin.json', 'wrapper')).toBeUndefined();
    const f = await createProjectFile(fs, p, 'PartialData/Levels/New/waves.json', 'partial-array', {
      sep: '/',
    });
    expect(f.shape).toBe('partial-array');
    expect(await fs.readFile('/root/PartialData/Levels/New/waves.json')).toBe('[]\n');
    expect(p.files.has(f.id)).toBe(true);
    const w = await createProjectFile(fs, p, 'GameData_WaveDataBlock_bin.json', 'wrapper', {
      sep: '/',
    });
    expect(w.shape).toBe('wrapper');
    expect(p.resolutions.get('Wave')!.baseline).toBe('wrapper-file');
    await expect(
      createProjectFile(fs, p, 'GameData_WaveDataBlock_bin.json', 'wrapper', { sep: '/' }),
    ).rejects.toThrow(/exists/);
    await deleteProjectFile(fs, p, 'GameData_WaveDataBlock_bin.json');
    expect(fs.has('/root/GameData_WaveDataBlock_bin.json')).toBe(false);
    expect(p.resolutions.get('Wave')!.baseline).toBe('vanilla');
  });
});
