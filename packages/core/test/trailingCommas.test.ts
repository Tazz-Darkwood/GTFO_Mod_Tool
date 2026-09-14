import { describe, expect, it } from 'vitest';
import type { Project, SchemaBundle, VanillaIndex } from '../src/index.js';
import { EditSession } from '../src/edit/editEngine.js';
import { emptyIndex, indexAddBlocks } from '../src/index/blockIndex.js';
import { computeResolutions } from '../src/index/typeResolution.js';
import { blocksFor, buildSourceFile } from '../src/project/projectLoader.js';
import { parseDocument } from '../src/text/jsoncDoc.js';
import { findTrailingCommas, stripTrailingCommas } from '../src/text/trailingCommas.js';
import { validateProject } from '../src/validate/validator.js';

const schema: SchemaBundle = {
  meta: { repo: '', commit: 't', builtAt: '' },
  blockTypes: {
    Fog: {
      name: 'Fog',
      fields: [
        { kind: 'list', name: 'Tags', item: { kind: 'scalar', name: '', scalar: 'String' } },
        { kind: 'scalar', name: 'name', scalar: 'String' },
        { kind: 'scalar', name: 'persistentID', scalar: 'UInt32' },
      ],
      fieldsByLowerName: { tags: 0, name: 1, persistentid: 2 },
    },
  },
  classes: {},
  enums: {},
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

const WITH_COMMAS = `[
  {
    "Tags": ["a", "b",], // list with a trailing comma
    "name": "one",
    "datablock": "Fog",
    "persistentID": 1, // and the block itself
  },
  {
    "Tags": [],
    "name": "two",
    "datablock": "Fog",
    "persistentID": 2
  },
]`;

describe('trailing commas', () => {
  it('finds every trailing comma, including after a comment, and nothing else', () => {
    const { tree } = parseDocument(WITH_COMMAS);
    const found = findTrailingCommas(WITH_COMMAS, tree);
    expect(found.map((c) => WITH_COMMAS.slice(c.offset - 3, c.offset + 1))).toEqual([
      '"b",',
      ': 1,',
      '  },',
    ]);
    const clean = stripTrailingCommas(WITH_COMMAS, tree);
    expect(findTrailingCommas(clean, parseDocument(clean).tree)).toEqual([]);
    expect(() => JSON.parse(clean.replace(/\/\/[^\n]*/g, ''))).not.toThrow();
    expect(clean).toContain('"Tags": ["a", "b"], // list');
    expect(clean).toContain('"persistentID": 1 // and the block itself');
    expect(clean.trimEnd().endsWith('}\n]')).toBe(true);
    // Files without trailing commas are untouched.
    expect(stripTrailingCommas(clean, parseDocument(clean).tree)).toBe(clean);
  });

  it('P003 is reported per comma, attributed to the block, and the fix removes them all', () => {
    const p = project({ 'PartialData/c.json': WITH_COMMAS });
    const d = validateProject(p).filter((x) => x.code === 'P003');
    expect(d).toHaveLength(3);
    expect(d[0]!.blockId).toBe('PartialData/c.json#/0');
    expect(d[1]!.blockId).toBe('PartialData/c.json#/0');
    expect(d[2]!.blockId).toBeUndefined(); // the file-level list
    expect(d[0]!.range!.line).toBe(3);
    const s = new EditSession(p);
    s.applyFix(d[0]!.fix!);
    const text = p.files.get('PartialData/c.json')!.text;
    expect(findTrailingCommas(text, parseDocument(text).tree)).toEqual([]);
    expect(validateProject(p).filter((x) => x.code === 'P003')).toEqual([]);
    // Undo brings the commas back in one step.
    s.undoFile('PartialData/c.json');
    expect(p.files.get('PartialData/c.json')!.text).toBe(WITH_COMMAS);
  });

  it('edits never introduce a trailing comma but leave pre-existing ones alone', () => {
    const p = project({ 'PartialData/c.json': WITH_COMMAS });
    const s = new EditSession(p);
    const t = { file: 'PartialData/c.json', blockId: 'PartialData/c.json#/1' };
    s.apply(t, { op: 'insert', path: ['Tags'], value: 'x' });
    s.apply(t, { op: 'insert', path: ['Tags'], value: 'y' });
    s.apply(t, { op: 'remove', path: ['Tags', 1] });
    s.apply(t, { op: 'remove', path: ['persistentID'] });
    s.apply(t, { op: 'setProperty', path: [], key: 'persistentID', value: 2 });
    const text = p.files.get('PartialData/c.json')!.text;
    const commas = findTrailingCommas(text, parseDocument(text).tree);
    expect(commas).toHaveLength(3); // exactly the three that were there before
    expect(text).toContain('"Tags": [\n      "x"\n    ],');
  });
});
