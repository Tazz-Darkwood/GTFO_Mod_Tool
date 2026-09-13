import { describe, expect, it } from 'vitest';
import { canonicalType, wrapperFileType, matchKnownType } from '../src/project/typeNames.js';
import { detectShape } from '../src/project/fileShape.js';
import { extractBlocks } from '../src/project/blockExtractor.js';
import { parseDocument, propertyNode, pathToPointer, pointerToPath } from '../src/text/jsoncDoc.js';
import { detectIndentUnit, detectStyle, lineIndentAt, splitBom } from '../src/text/textStyle.js';

describe('typeNames', () => {
  it('canonicalises type names', () => {
    expect(canonicalType('SurvivalWaveSettings')).toBe('SurvivalWaveSettings');
    expect(canonicalType(' SurvivalWaveSettingsDataBlock ')).toBe('SurvivalWaveSettings');
    expect(canonicalType('GameData.RundownDataBlock')).toBe('Rundown');
    expect(canonicalType('chainedpuzzledatablock')).toBe('chainedpuzzle');
  });
  it('reads wrapper file names', () => {
    expect(wrapperFileType('GameData_LevelLayoutDataBlock_bin.json')).toBe('LevelLayout');
    expect(wrapperFileType('Rundown_DB.json')).toBeUndefined();
  });
  it('matches known types loosely', () => {
    expect(matchKnownType('chainedpuzzle', ['ChainedPuzzle'])).toEqual({
      type: 'ChainedPuzzle',
      exact: false,
    });
    expect(matchKnownType('ChainedPuzzleDataBlock', ['ChainedPuzzle'])).toEqual({
      type: 'ChainedPuzzle',
      exact: true,
    });
    expect(matchKnownType('Nope', ['ChainedPuzzle'])).toBeUndefined();
  });
});

describe('detectShape', () => {
  const tree = (s: string) => parseDocument(s).tree;
  it('classifies wrappers, partials, plugin, meta, unknown', () => {
    expect(
      detectShape(
        'GameData_FogSettingsDataBlock_bin.json',
        tree('{"Headers":[],"Blocks":[],"LastPersistentID":1}'),
      ),
    ).toBe('wrapper');
    expect(
      detectShape('GameData_LevelLayoutDataBlock_bin.json', tree('{"Headers":[],"Blocks":[]}')),
    ).toBe('wrapper');
    expect(
      detectShape('PartialData/x.json', tree('[{"persistentID":1,"datablock":"FogSettings"}]')),
    ).toBe('partial-array');
    expect(detectShape('PartialData/x.json', tree('[]'))).toBe('partial-array');
    expect(detectShape('PartialData/x.json', tree('  \n{"Zones":[],"persistentID":69001}'))).toBe(
      'partial-single',
    );
    expect(detectShape('Custom/LGTuner/A3.json', tree('{"LevelLayoutID":69030}'))).toBe('plugin');
    expect(detectShape('PartialData/_persistentID.json', tree('[]'))).toBe('meta');
    expect(detectShape('PartialData/x.json', tree('{"foo":1}'))).toBe('unknown');
    expect(detectShape('PartialData/x.json', tree('[1,2]'))).toBe('unknown');
    expect(detectShape('PartialData/x.json', undefined)).toBe('unknown');
  });
});

describe('extractBlocks', () => {
  it('reads wrapper blocks with the file type', () => {
    const { tree } = parseDocument(
      '{"Headers":[],"Blocks":[{"name":"a","persistentID":5},{"name":"b","persistentID":"guid"}],"LastPersistentID":5}',
    );
    const blocks = extractBlocks({
      id: 'GameData_FogSettingsDataBlock_bin.json',
      tree,
      shape: 'wrapper',
      wrapperType: 'FogSettings',
    });
    expect(blocks.map((b) => [b.type, b.persistentID, b.name, b.id])).toEqual([
      ['FogSettings', 5, 'a', 'GameData_FogSettingsDataBlock_bin.json#/Blocks/0'],
      ['FogSettings', undefined, 'b', 'GameData_FogSettingsDataBlock_bin.json#/Blocks/1'],
    ]);
  });
  it('reads partial blocks with datablock tags in any casing / suffix', () => {
    const { tree } = parseDocument(`[
      {"name":"a","persistentID":1,"datablock":"ChainedPuzzle"},
      {"name":"b","persistentID":2,"datablock":"ChainedPuzzleDataBlock"},
      {"name":"c","persistentID":3,"DataBlock":"chainedpuzzle"},
      {"name":"d","persistentID":4}
    ]`);
    const blocks = extractBlocks({ id: 'PartialData/p.json', tree, shape: 'partial-array' });
    expect(blocks.map((b) => b.type)).toEqual([
      'ChainedPuzzle',
      'ChainedPuzzle',
      'chainedpuzzle',
      undefined,
    ]);
    expect(blocks[3]!.path).toEqual([3]);
  });
  it('reads a single-block file at the root path', () => {
    const { tree } = parseDocument(
      '{"ZoneAliasStart":1,"name":"L","persistentID":69001,"datablock":"LevelLayout"}',
    );
    const [b] = extractBlocks({ id: 'PartialData/L.json', tree, shape: 'partial-single' });
    expect(b!.path).toEqual([]);
    expect(b!.id).toBe('PartialData/L.json#');
  });
});

describe('jsoncDoc helpers', () => {
  it('parses comments and finds properties case-insensitively', () => {
    const { tree, errors } = parseDocument('{ "Type": 2, //Rifle\n "url": "http://x//y" }');
    expect(errors).toEqual([]);
    expect(propertyNode(tree!, 'type')!.valueNode.value).toBe(2);
    expect(propertyNode(tree!, 'type', false)).toBeUndefined();
    expect(propertyNode(tree!, 'url')!.valueNode.value).toBe('http://x//y');
  });
  it('round-trips pointers', () => {
    expect(pathToPointer(['Blocks', 3, 'a/b'])).toBe('/Blocks/3/a~1b');
    expect(pointerToPath('/Blocks/3/a~1b')).toEqual(['Blocks', 3, 'a/b']);
    expect(pointerToPath('')).toEqual([]);
  });
});

describe('textStyle', () => {
  it('detects BOM, EOL and indentation', () => {
    const { text, bom } = splitBom('﻿{\r\n\t"a": 1\r\n}');
    expect(bom).toBe(true);
    const style = detectStyle(text, bom);
    expect(style).toEqual({ eol: '\r\n', bom: true, indentUnit: '\t' });
    expect(detectIndentUnit('{\n  "a": {\n    "b": 1\n  }\n}')).toBe('  ');
    expect(detectIndentUnit('{\n    "a": {\n        "b": 1\n    }\n}')).toBe('    ');
    expect(detectIndentUnit('{"a":1}')).toBeNull();
  });
  it('reads the indent of the line containing an offset', () => {
    const t = '{\n    "a": 1,\n  "b": 2\n}';
    expect(lineIndentAt(t, t.indexOf('"a"'))).toBe('    ');
    expect(lineIndentAt(t, t.indexOf('"b"'))).toBe('  ');
  });
});
