import { describe, expect, it } from 'vitest';
import type {
  ClassSchema,
  FieldSchema,
  Project,
  SchemaBundle,
  VanillaIndex,
} from '../src/index.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import { blocksFor, buildSourceFile } from '../src/project/projectLoader.js';
import { validateProject } from '../src/validate/validator.js';

// ---------------------------------------------------------------------------
// Tiny schema: two block types and one nested class with an event list.
// ---------------------------------------------------------------------------
function cls(name: string, fields: FieldSchema[]): ClassSchema {
  const fieldsByLowerName: Record<string, number> = {};
  fields.forEach((f, i) => (fieldsByLowerName[f.name.toLowerCase()] = i));
  return { name, fields, fieldsByLowerName };
}
const COMMON: FieldSchema[] = [
  { kind: 'scalar', name: 'name', scalar: 'String' },
  { kind: 'scalar', name: 'internalEnabled', scalar: 'Boolean' },
  { kind: 'scalar', name: 'persistentID', scalar: 'UInt32' },
];
const schema: SchemaBundle = {
  meta: { repo: '', commit: 't', builtAt: '' },
  blockTypes: {
    Alarm: cls('Alarm', [
      { kind: 'ref', name: 'Wave', refType: 'Wave' },
      { kind: 'enum', name: 'Kind', enumName: 'eKind' },
      { kind: 'scalar', name: 'Radius', scalar: 'Single' },
      { kind: 'list', name: 'Events', item: { kind: 'object', name: '', className: 'Event' } },
      { kind: 'localizedText', name: 'Title' },
      ...COMMON,
    ]),
    Wave: cls('Wave', [{ kind: 'scalar', name: 'Pause', scalar: 'Single' }, ...COMMON]),
    Text: cls('Text', COMMON),
  },
  classes: {
    Event: cls('Event', [
      { kind: 'enum', name: 'Type', enumName: 'eWardenObjectiveEventType' },
      { kind: 'scalar', name: 'Delay', scalar: 'Single' },
    ]),
  },
  enums: {
    eKind: {
      name: 'eKind',
      members: [
        { name: 'Soft', value: 0 },
        { name: 'Hard', value: 1 },
      ],
      isFlags: false,
    },
    eWardenObjectiveEventType: {
      name: 'eWardenObjectiveEventType',
      members: [
        { name: 'None', value: 0 },
        { name: 'Open', value: 1 },
      ],
      isFlags: false,
    },
  },
};
const vanilla: VanillaIndex = {
  types: { Wave: { '5': 'Vanilla wave' }, Text: { '9': 'hello' } },
  fullBlockTypes: [],
};

function makeProject(files: Record<string, string>, v: VanillaIndex = vanilla): Project {
  const map = new Map();
  const index = emptyIndex();
  for (const [id, text] of Object.entries(files)) {
    const f = buildSourceFile(id, `/root/${id}`, text, { mtimeMs: 1, size: text.length });
    map.set(id, f);
    indexAddBlocks(index, id, blocksFor(f));
  }
  return {
    rootPath: '/root',
    files: map,
    index,
    resolutions: computeResolutions(map.values(), v, schema),
    diagnostics: [],
    schema,
    vanilla: v,
  };
}
const codes = (p: Project) =>
  validateProject(p)
    .map((d) => d.code)
    .sort();

describe('validator', () => {
  it('reports parse errors and unknown shapes', () => {
    const p = makeProject({
      'PartialData/bad.json': '[ { "persistentID": 1, ]',
      'PartialData/odd.json': '{ "foo": 1 }',
    });
    const d = validateProject(p);
    expect(d.map((x) => x.code)).toContain('P001');
    expect(d.map((x) => x.code)).toContain('P002');
    expect(d.find((x) => x.code === 'P001')!.range!.line).toBe(1);
  });

  it('B001: missing datablock infers the type from siblings and proposes a fix', () => {
    const p = makeProject({
      'PartialData/a.json':
        '[{"name":"x","persistentID":1,"datablock":"Wave"},{"name":"y","persistentID":2}]',
    });
    const d = validateProject(p).filter((x) => x.code === 'B001');
    expect(d).toHaveLength(1);
    expect(d[0]!.fix!.edits[0]!.op).toEqual({
      op: 'setProperty',
      path: [],
      key: 'datablock',
      value: 'Wave',
    });
  });

  it('B001: infers from field names when there are no siblings', () => {
    const p = makeProject({
      'PartialData/a.json':
        '{"Wave":5,"Kind":0,"Radius":1.0,"Events":[],"name":"x","persistentID":1}',
    });
    const d = validateProject(p).find((x) => x.code === 'B001')!;
    expect(d.fix!.edits[0]!.op).toMatchObject({ key: 'datablock', value: 'Alarm' });
  });

  it('B002/B003/B004/B005/B006 cover ids, names and type tags', () => {
    const p = makeProject({
      'PartialData/a.json': `[
        {"datablock":"Wave"},
        {"datablock":"Wave","persistentID":"guid-1","name":""},
        {"datablock":"wave","persistentID":3,"name":"lower"},
        {"datablock":"Nope","persistentID":4,"name":"n"}
      ]`,
    });
    const d = validateProject(p);
    const by = (c: string) => d.filter((x) => x.code === c);
    expect(by('B002')).toHaveLength(1);
    expect(by('B003')).toHaveLength(1);
    expect(by('B004')).toHaveLength(1);
    expect(by('B005')).toHaveLength(1);
    const b006 = by('B006');
    expect(b006).toHaveLength(2);
    expect(b006.find((x) => x.severity === 'warning')!.fix!.title).toBe('Change to "Wave"');
    expect(b006.find((x) => x.severity === 'error')!.message).toContain('Nope');
  });

  it('D001 duplicates across files, D002 vanilla override only without a wrapper file', () => {
    const p = makeProject({
      'PartialData/a.json': '[{"datablock":"Wave","persistentID":7,"name":"a"}]',
      'PartialData/b.json':
        '[{"datablock":"Wave","persistentID":7,"name":"b"},{"datablock":"Wave","persistentID":5,"name":"override"}]',
    });
    const d = validateProject(p);
    const d001 = d.filter((x) => x.code === 'D001');
    expect(d001).toHaveLength(1);
    expect(d001[0]!.file).toBe('PartialData/b.json');
    expect(d001[0]!.related![0]!.file).toBe('PartialData/a.json');
    expect(d.filter((x) => x.code === 'D002')).toHaveLength(1);

    // With a wrapper file for Wave, vanilla is replaced: no D002, and vanilla #5 no longer resolves.
    const p2 = makeProject({
      'GameData_WaveDataBlock_bin.json':
        '{"Headers":[],"Blocks":[{"name":"w","internalEnabled":true,"persistentID":1}],"LastPersistentID":1}',
      'PartialData/b.json':
        '[{"datablock":"Wave","persistentID":5,"name":"override"},{"datablock":"Alarm","persistentID":1,"name":"al","Wave":5}]',
    });
    const d2 = validateProject(p2);
    expect(d2.filter((x) => x.code === 'D002')).toHaveLength(0);
    expect(d2.filter((x) => x.code === 'R001')).toHaveLength(0); // #5 is defined in the project
    const p3 = makeProject({
      'GameData_WaveDataBlock_bin.json': '{"Headers":[],"Blocks":[],"LastPersistentID":1}',
      'PartialData/b.json': '[{"datablock":"Alarm","persistentID":1,"name":"al","Wave":5}]',
    });
    expect(codes(p3)).toContain('R001');
  });

  it('R001 through nested lists and LocalizedText, with 0 meaning none', () => {
    const p = makeProject({
      'PartialData/a.json': `[{"datablock":"Alarm","persistentID":1,"name":"a","Wave":0,"Title":9,"Events":[{"Type":1,"Delay":1.0}]},
                              {"datablock":"Alarm","persistentID":2,"name":"b","Wave":404,"Title":404}]`,
    });
    const r = validateProject(p).filter((x) => x.code === 'R001');
    expect(r.map((x) => x.jsonPath)).toEqual([
      [1, 'Wave'],
      [1, 'Title'],
    ]);
  });

  it('R001 hints when a custom-range ID lives under another type', () => {
    const p = makeProject({
      'PartialData/a.json': `[{"datablock":"Alarm","persistentID":1,"name":"a","Wave":8776},{"datablock":"Text","persistentID":8776,"name":"oops"}]`,
    });
    const r = validateProject(p).filter((x) => x.code === 'R001');
    expect(r[0]!.message).toContain('swapped fields?');
  });

  it('T001/T002/T003/T004 type and field checks; plugin events are exempt', () => {
    const p = makeProject({
      'PartialData/a.json': `[{"datablock":"Alarm","persistentID":1,"name":"a","radius":"2.5","Kind":true,"Bogus":1,
         "Events":[{"Type":1,"Delay":1.0,"Extra":1},{"Type":10019,"Delay":1.0,"Extra":1,"MoreExtra":{}}]}]`,
    });
    const d = validateProject(p);
    expect(d.filter((x) => x.code === 'T004').map((x) => x.jsonPath)).toEqual([[0, 'radius']]);
    expect(d.filter((x) => x.code === 'T002')).toHaveLength(1);
    expect(d.filter((x) => x.code === 'T001').map((x) => x.jsonPath)).toEqual([[0, 'Kind']]);
    expect(d.filter((x) => x.code === 'T003').map((x) => x.jsonPath)).toEqual([
      [0, 'Bogus'],
      [0, 'Events', 0, 'Extra'],
    ]);
    expect(d.filter((x) => x.code === 'E001')).toHaveLength(0); // 10019 is a plugin event type, not an enum error
  });

  it('E001/E002 enum values; flags accept any integer; open enums accept any integer', () => {
    const s2: SchemaBundle = {
      ...schema,
      enums: {
        ...schema.enums,
        eKind: {
          name: 'eKind',
          members: [
            { name: 'Soft', value: 0 },
            { name: 'Hard', value: 1 },
          ],
          isFlags: false,
          open: false,
        },
      },
    };
    const p = makeProject({
      'PartialData/a.json': `[
        {"datablock":"Alarm","persistentID":1,"name":"a","Kind":"hard"},
        {"datablock":"Alarm","persistentID":2,"name":"b","Kind":"Nope"},
        {"datablock":"Alarm","persistentID":3,"name":"c","Kind":7}
      ]`,
    });
    p.schema = s2;
    const d = validateProject(p);
    const e002 = d.filter((x) => x.code === 'E002');
    expect(e002).toHaveLength(1);
    expect(e002[0]!.fix!.edits[0]!.op).toEqual({ op: 'set', path: ['Kind'], value: 'Hard' });
    const e001 = d.filter((x) => x.code === 'E001');
    expect(e001.map((x) => x.severity)).toEqual(['error', 'warning']);

    p.schema = { ...s2, enums: { ...s2.enums, eKind: { ...s2.enums['eKind']!, open: true } } };
    expect(
      validateProject(p)
        .filter((x) => x.code === 'E001')
        .map((x) => x.severity),
    ).toEqual(['error']);
    p.schema = { ...s2, enums: { ...s2.enums, eKind: { ...s2.enums['eKind']!, isFlags: true } } };
    expect(
      validateProject(p)
        .filter((x) => x.code === 'E001')
        .map((x) => x.severity),
    ).toEqual(['error']);
  });

  it('suppresses findings on values inherited unchanged from vanilla', () => {
    const v: VanillaIndex = {
      types: { Alarm: { '1': 'v' } },
      fullBlockTypes: ['Alarm'],
      blocks: {
        Alarm: {
          '1': {
            name: 'v',
            internalEnabled: true,
            persistentID: 1,
            Wave: 999,
            Kind: 'Nope',
            Legacy: 1,
          },
        },
      },
    };
    const p = makeProject(
      {
        'GameData_AlarmDataBlock_bin.json':
          '{"Headers":[],"Blocks":[{"name":"v","internalEnabled":true,"persistentID":1,"Wave":999,"Kind":"Nope","Legacy":1},' +
          '{"name":"mine","internalEnabled":true,"persistentID":2,"Wave":999}],"LastPersistentID":2}',
      },
      v,
    );
    const d = validateProject(p);
    expect(d.filter((x) => x.blockId?.endsWith('/Blocks/0'))).toEqual([]);
    expect(d.filter((x) => x.blockId?.endsWith('/Blocks/1')).map((x) => x.code)).toEqual(['R001']);
  });

  it('W001 stale LastPersistentID with a fix', () => {
    const p = makeProject({
      'GameData_WaveDataBlock_bin.json':
        '{"Headers":[],"Blocks":[{"name":"w","internalEnabled":true,"persistentID":9}],"LastPersistentID":3}',
    });
    const w = validateProject(p).find((x) => x.code === 'W001')!;
    expect(w.fix!.edits[0]!.op).toEqual({ op: 'set', path: ['LastPersistentID'], value: 9 });
  });
});
