import { describe, expect, it } from 'vitest';
import type { Project, SchemaBundle, VanillaIndex } from '../src/index.js';
import { EditSession } from '../src/edit/editEngine.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import { MemoryFileSystem } from '../src/io/fileSystem.js';
import { checkExternalChange, reloadFromDisk, saveFile } from '../src/io/saveGuard.js';
import { writeAtomic } from '../src/io/atomicWrite.js';
import { blocksFor, buildSourceFile } from '../src/project/projectLoader.js';
import { formatScalar } from '../src/text/scalarFormat.js';
import { parseDocument } from '../src/text/jsoncDoc.js';
import { splitBom } from '../src/text/textStyle.js';

const schema: SchemaBundle = {
  meta: { repo: '', commit: 't', builtAt: '' },
  blockTypes: {
    Fog: {
      name: 'Fog',
      fields: [
        { kind: 'scalar', name: 'Density', scalar: 'Single' },
        { kind: 'scalar', name: 'Count', scalar: 'Int32' },
        { kind: 'enum', name: 'Mode', enumName: 'eMode' },
        { kind: 'list', name: 'Tags', item: { kind: 'scalar', name: '', scalar: 'String' } },
        { kind: 'object', name: 'Color', className: 'Color' },
        { kind: 'scalar', name: 'name', scalar: 'String' },
        { kind: 'scalar', name: 'persistentID', scalar: 'UInt32' },
      ],
      fieldsByLowerName: {
        density: 0,
        count: 1,
        mode: 2,
        tags: 3,
        color: 4,
        name: 5,
        persistentid: 6,
      },
    },
  },
  classes: {
    Color: {
      name: 'Color',
      fields: [{ kind: 'scalar', name: 'r', scalar: 'Single' }],
      fieldsByLowerName: { r: 0 },
    },
  },
  enums: {
    eMode: {
      name: 'eMode',
      members: [
        { name: 'Off', value: 0 },
        { name: 'Soft', value: 1 },
        { name: 'Hard', value: 2 },
      ],
      isFlags: false,
    },
  },
};
const vanilla: VanillaIndex = { types: {}, fullBlockTypes: [] };

function project(files: Record<string, string>): Project {
  const map = new Map();
  const index = emptyIndex();
  for (const [id, text] of Object.entries(files)) {
    const { text: t, bom } = splitBom(text);
    const f = buildSourceFile(id, `/root/${id}`, text, { mtimeMs: 1, size: text.length });
    void t;
    void bom;
    map.set(id, f);
    indexAddBlocks(index, id, blocksFor(f));
  }
  return {
    rootPath: '/root',
    files: map,
    index,
    resolutions: computeResolutions(map.values(), vanilla, schema),
    diagnostics: [],
    schema,
    vanilla,
  };
}

/** Assert that only the given span changed between two texts. */
function onlySpanChanged(before: string, after: string, oldSpan: string, newSpan: string) {
  const i = before.indexOf(oldSpan);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(after.slice(0, i)).toBe(before.slice(0, i));
  expect(after.slice(i, i + newSpan.length)).toBe(newSpan);
  expect(after.slice(i + newSpan.length)).toBe(before.slice(i + oldSpan.length));
}

const FIX_A = `[
  {
    "Density": 1.0, //thick
    "Count": 3,
    "Mode": "Soft",
    "Tags": ["a//not-a-comment", "b"],
    "Color": { "r": 0.5 },
    "name": "Fog //one",
    "datablock": "Fog",
    "persistentID": 1
  }
]`;

describe('EditSession: scalar sets preserve everything around the token', () => {
  it('A: trailing comment and // inside strings survive; only the value token changes', () => {
    const p = project({ 'PartialData/a.json': FIX_A });
    const s = new EditSession(p);
    const before = p.files.get('PartialData/a.json')!.text;
    s.apply(
      { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' },
      { op: 'set', path: ['Count'], value: 7 },
    );
    onlySpanChanged(before, p.files.get('PartialData/a.json')!.text, '"Count": 3', '"Count": 7');
    expect(p.files.get('PartialData/a.json')!.dirty).toBe(true);
  });

  it('C: number and enum representation is kept', () => {
    const p = project({ 'PartialData/a.json': FIX_A });
    const s = new EditSession(p);
    const t = { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' };
    s.apply(t, { op: 'set', path: ['Density'], value: 2 });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Density": 2.0, //thick');
    s.apply(t, { op: 'set', path: ['Density'], value: 2.5 });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Density": 2.5, //thick');
    s.apply(t, { op: 'set', path: ['Mode'], value: { $enum: 'Hard' } });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Mode": "Hard"');
    s.apply(t, { op: 'set', path: ['Mode'], value: 1 });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Mode": 1');
    s.apply(t, { op: 'set', path: ['Mode'], value: { $enum: 'Hard' } });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Mode": 2'); // int stays int
    s.apply(t, { op: 'set', path: ['Count'], value: '9' });
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Count": 9'); // numeric string into numeric field
  });

  it('formatScalar keeps decimal style only when the original had one', () => {
    expect(formatScalar(2, '1.0')).toBe('2.0');
    expect(formatScalar(2, '1')).toBe('2');
    expect(formatScalar(2.5, '1.0')).toBe('2.5');
    expect(formatScalar(true, 'false')).toBe('true');
    expect(formatScalar('x"y', '"a"')).toBe('"x\\"y"');
  });
});

describe('EditSession: structural edits match neighbouring indentation', () => {
  it('B: tab-indented file gets tab-indented inserts, and an appended property after a trailing comment', () => {
    const tabs =
      '[\n\t{\n\t\t"Count": 3, //c\n\t\t"Tags": [\n\t\t\t"a"\n\t\t],\n\t\t"datablock": "Fog",\n\t\t"persistentID": 1 //last\n\t}\n]';
    const p = project({ 'PartialData/t.json': tabs });
    const s = new EditSession(p);
    const t = { file: 'PartialData/t.json', blockId: 'PartialData/t.json#/0' };
    s.apply(t, { op: 'insert', path: ['Tags'], value: 'b' });
    expect(p.files.get('PartialData/t.json')!.text).toContain(
      '\t\t"Tags": [\n\t\t\t"a",\n\t\t\t"b"\n\t\t],',
    );
    s.apply(t, { op: 'setProperty', path: [], key: 'name', value: 'x' });
    const text = p.files.get('PartialData/t.json')!.text;
    expect(text).toContain('\t\t"persistentID": 1, //last\n\t\t"name": "x"\n\t}');
    expect(parseDocument(text).errors).toEqual([]);
    expect(JSON.parse(text.replace(/\/\/[^\n]*/g, ''))[0].name).toBe('x');
  });

  it('D: mixed 2/4-space file: inserted property follows its siblings, nested object is pretty-printed at the right depth', () => {
    const mixed =
      '{\n    "Count": 3,\n    "Color": {\n      "r": 0.5\n    },\n    "datablock": "Fog",\n    "persistentID": 1\n}';
    const p = project({ 'PartialData/m.json': mixed });
    const s = new EditSession(p);
    const t = { file: 'PartialData/m.json', blockId: 'PartialData/m.json#' };
    s.apply(t, { op: 'setProperty', path: [], key: 'Mode', value: 'Soft' });
    s.apply(t, { op: 'setProperty', path: ['Color'], key: 'g', value: 1 });
    s.apply(t, { op: 'set', path: ['Tags'], value: ['x', 'y'] });
    const text = p.files.get('PartialData/m.json')!.text;
    // New properties are appended in order; each follows its siblings' indentation (4 spaces at root, 2 inside Color).
    expect(text).toContain('    "persistentID": 1,\n    "Mode": "Soft",\n    "Tags": [');
    expect(text).toContain('      "r": 0.5,\n      "g": 1\n    },');
    // A brand-new container has no siblings to copy, so it uses the file's dominant unit (4 spaces here).
    expect(text).toContain('    "Tags": [\n        "x",\n        "y"\n    ]\n}');
    expect(parseDocument(text).errors).toEqual([]);
  });

  it('remove uses jsonc-parser and keeps the document valid', () => {
    const p = project({ 'PartialData/a.json': FIX_A });
    const s = new EditSession(p);
    s.apply(
      { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' },
      { op: 'remove', path: ['Tags', 0] },
    );
    const text = p.files.get('PartialData/a.json')!.text;
    expect(text).toContain('"Tags": ["b"]');
    s.apply(
      { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' },
      { op: 'remove', path: ['Color'] },
    );
    expect(p.files.get('PartialData/a.json')!.text).not.toContain('Color');
    expect(parseDocument(p.files.get('PartialData/a.json')!.text).errors).toEqual([]);
  });

  it('inserting into an empty container and setting a missing leaf both work', () => {
    const p = project({
      'PartialData/e.json':
        '{\n  "Tags": [],\n  "Color": {},\n  "datablock": "Fog",\n  "persistentID": 1\n}',
    });
    const s = new EditSession(p);
    const t = { file: 'PartialData/e.json', blockId: 'PartialData/e.json#' };
    s.apply(t, { op: 'insert', path: ['Tags'], value: 'a' });
    s.apply(t, { op: 'set', path: ['Color', 'r'], value: 0.25 });
    const text = p.files.get('PartialData/e.json')!.text;
    expect(text).toContain('"Tags": [\n    "a"\n  ],');
    expect(text).toContain('"Color": {\n    "r": 0.25\n  },');
  });

  it('refuses an edit that would break the JSON', () => {
    const p = project({ 'PartialData/a.json': FIX_A });
    const s = new EditSession(p);
    expect(() =>
      s.apply(
        { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' },
        { op: 'set', path: ['Nope', 'deeper'], value: 1 },
      ),
    ).toThrow();
  });
});

describe('EditSession: undo/redo and re-validation', () => {
  it('restores exact text and refreshes diagnostics', () => {
    const p = project({ 'PartialData/a.json': FIX_A });
    const s = new EditSession(p);
    const t = { file: 'PartialData/a.json', blockId: 'PartialData/a.json#/0' };
    const original = p.files.get('PartialData/a.json')!.text;
    const r1 = s.apply(t, { op: 'set', path: ['Mode'], value: 'Nope' });
    expect(r1.diagnostics.some((d) => d.code === 'E001')).toBe(true);
    const r2 = s.undoFile('PartialData/a.json')!;
    expect(p.files.get('PartialData/a.json')!.text).toBe(original);
    expect(r2.diagnostics.some((d) => d.code === 'E001')).toBe(false);
    expect(p.files.get('PartialData/a.json')!.dirty).toBe(false);
    s.redoFile('PartialData/a.json');
    expect(p.files.get('PartialData/a.json')!.text).toContain('"Mode": "Nope"');
    expect(s.canUndo('PartialData/a.json')).toBe(true);
  });
});

describe('atomic save and external-change guard', () => {
  it('E: CRLF + BOM round-trip, tmp file cleaned up, conflict detected only on real content change', async () => {
    const raw =
      '﻿[\r\n  {\r\n    "Count": 3,\r\n    "datablock": "Fog",\r\n    "persistentID": 1\r\n  }\r\n]';
    const fs = new MemoryFileSystem({ '/root/PartialData/w.json': raw });
    const st = (await fs.stat('/root/PartialData/w.json'))!;
    const file = buildSourceFile('PartialData/w.json', '/root/PartialData/w.json', raw, st);
    expect(file.style).toEqual({ eol: '\r\n', bom: true, indentUnit: '  ' });
    const p = project({});
    p.files.set(file.id, file);
    indexAddBlocks(p.index, file.id, blocksFor(file));
    const s = new EditSession(p);
    s.apply(
      { file: file.id, blockId: 'PartialData/w.json#/0' },
      { op: 'set', path: ['Count'], value: 4 },
    );

    expect(await checkExternalChange(fs, file)).toBe('clean');
    fs.touch('/root/PartialData/w.json');
    expect(await checkExternalChange(fs, file)).toBe('clean'); // mtime only
    const r = await saveFile(fs, p, file.id);
    expect(r.ok).toBe(true);
    const onDisk = await fs.readFile('/root/PartialData/w.json');
    expect(onDisk).toBe(raw.replace('"Count": 3', '"Count": 4'));
    expect(fs.list().filter((x) => x.includes('gtfo-tmp'))).toEqual([]);
    expect(file.dirty).toBe(false);

    // Someone edits the file behind our back, then we edit too -> conflict unless forced.
    await fs.writeFile('/root/PartialData/w.json', raw.replace('"Count": 3', '"Count": 99'));
    s.apply(
      { file: file.id, blockId: 'PartialData/w.json#/0' },
      { op: 'set', path: ['Count'], value: 5 },
    );
    const c = await saveFile(fs, p, file.id);
    expect(c).toEqual({ ok: false, reason: 'conflict' });
    const reloaded = await reloadFromDisk(fs, p, file.id);
    expect(reloaded.text).toContain('"Count": 99');
    expect(reloaded.dirty).toBe(false);
  });

  it('writeAtomic falls back to unlink+rename when rename over an existing file fails', async () => {
    const fs = new MemoryFileSystem({ '/x.json': 'old' });
    const origRename = fs.rename.bind(fs);
    let failures = 1;
    fs.rename = async (from, to) => {
      if (failures-- > 0 && fs.has(to)) throw new Error('EPERM');
      return origRename(from, to);
    };
    await writeAtomic(fs, '/x.json', 'new', { eol: '\n', bom: false, indentUnit: null });
    expect(await fs.readFile('/x.json')).toBe('new');
    expect(fs.list()).toEqual(['/x.json']);
  });
});
