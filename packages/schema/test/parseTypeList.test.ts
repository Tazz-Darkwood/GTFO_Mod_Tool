import { describe, expect, it } from 'vitest';
import { newRegistry, parseTypeListText, typeListToClass } from '../build/parseTypeList.js';
import { looksLikeFlags, parseEnumText } from '../build/parseEnums.js';

const WARDEN_SNIPPET = `(enum) eWardenObjectiveType: Type
LocalizedText: MainObjective
   Boolean: HasTranslation
   Boolean: HasValue
   Boolean: ShouldLocalize
(ItemDataBlock) UInt32: GenericItemFromStart
Single: ShowHelpDelay
List<GenericEnemyWaveData>: WavesOnGotoWin
   (SurvivalWaveSettingsDataBlock) UInt32: WaveSettings
   (SurvivalWavePopulationDataBlock) UInt32: WavePopulation
   Int32: AreaDistance
   Boolean: TriggerAlarm
   LocalizedText: IntelMessage
      Boolean: HasTranslation
      Boolean: HasValue
      Boolean: ShouldLocalize
(enum) List<eLocalZoneIndex>: ZonesWithBulkheadEntrance
List<List<ZonePlacementData>>: ZonePlacementDatas
   (enum) eDimensionIndex: DimensionIndex
   (enum) eLocalZoneIndex: LocalIndex
   ZonePlacementWeights: Weights
      Single: Start
      Single: Middle
      Single: End
Vector3: Position
UInt32: SoundID
String: name
Boolean: internalEnabled
UInt32: persistentID
`;

describe('parseTypeList', () => {
  it('builds a nested entry tree by 3-space indentation', () => {
    const entries = parseTypeListText(WARDEN_SNIPPET, 'test.txt');
    expect(entries.map((e) => e.name)).toEqual([
      'Type',
      'MainObjective',
      'GenericItemFromStart',
      'ShowHelpDelay',
      'WavesOnGotoWin',
      'ZonesWithBulkheadEntrance',
      'ZonePlacementDatas',
      'Position',
      'SoundID',
      'name',
      'internalEnabled',
      'persistentID',
    ]);
    const waves = entries[4]!;
    expect(waves.children.map((c) => c.name)).toEqual([
      'WaveSettings',
      'WavePopulation',
      'AreaDistance',
      'TriggerAlarm',
      'IntelMessage',
    ]);
    expect(waves.children[4]!.children).toHaveLength(3);
  });

  it('converts to FieldSchema with refs, enums, lists, LocalizedText and hoisted classes', () => {
    const reg = newRegistry();
    const cls = typeListToClass(
      'WardenObjective',
      parseTypeListText(WARDEN_SNIPPET, 'test.txt'),
      reg,
    );
    const f = Object.fromEntries(cls.fields.map((x) => [x.name, x]));
    expect(f['Type']).toEqual({ kind: 'enum', name: 'Type', enumName: 'eWardenObjectiveType' });
    expect(f['MainObjective']).toEqual({ kind: 'localizedText', name: 'MainObjective' });
    expect(f['GenericItemFromStart']).toEqual({
      kind: 'ref',
      name: 'GenericItemFromStart',
      refType: 'Item',
    });
    expect(f['ShowHelpDelay']).toEqual({ kind: 'scalar', name: 'ShowHelpDelay', scalar: 'Single' });
    expect(f['WavesOnGotoWin']).toEqual({
      kind: 'list',
      name: 'WavesOnGotoWin',
      item: { kind: 'object', name: '', className: 'GenericEnemyWaveData' },
    });
    expect(f['ZonesWithBulkheadEntrance']).toEqual({
      kind: 'list',
      name: 'ZonesWithBulkheadEntrance',
      item: { kind: 'enum', name: '', enumName: 'eLocalZoneIndex' },
    });
    expect(f['ZonePlacementDatas']).toEqual({
      kind: 'list',
      name: 'ZonePlacementDatas',
      item: {
        kind: 'list',
        name: '',
        item: { kind: 'object', name: '', className: 'ZonePlacementData' },
      },
    });
    expect(f['Position']).toEqual({ kind: 'builtin', name: 'Position', builtin: 'Vector3' });
    expect(f['persistentID']).toEqual({ kind: 'scalar', name: 'persistentID', scalar: 'UInt32' });

    const wave = reg.classes.get('GenericEnemyWaveData')!;
    expect(wave.fields.map((x) => x.kind)).toEqual([
      'ref',
      'ref',
      'scalar',
      'scalar',
      'localizedText',
    ]);
    expect(wave.fieldsByLowerName['wavesettings']).toBe(0);
    expect(reg.classes.get('ZonePlacementData')!.fields[2]).toEqual({
      kind: 'object',
      name: 'Weights',
      className: 'ZonePlacementWeights',
    });
    expect(reg.classes.get('ZonePlacementWeights')!.fields).toHaveLength(3);
    expect(reg.conflicts).toEqual([]);
  });

  it('keeps conflicting nested class definitions as variants', () => {
    const reg = newRegistry();
    typeListToClass('A', parseTypeListText('Foo: X\n   Int32: a\n', 'a.txt'), reg);
    typeListToClass('B', parseTypeListText('Foo: Y\n   Int32: a\n   Int32: b\n', 'b.txt'), reg);
    typeListToClass('C', parseTypeListText('Foo: Z\n   Int32: a\n', 'c.txt'), reg);
    expect([...reg.classes.keys()]).toEqual(['Foo', 'Foo@B.Y']);
    expect(reg.conflicts).toHaveLength(1);
  });

  it('rejects malformed lines', () => {
    expect(() => parseTypeListText('  Int32: bad indent\n', 'x.txt')).toThrow(/indent/);
    expect(() => parseTypeListText('garbage\n', 'x.txt')).toThrow(/cannot parse/);
  });
});

describe('parseEnums', () => {
  it('parses name - value lines', () => {
    const e = parseEnumText('eZoneExpansionType', 'Random - 0\nCollapsed - 1\nExpansional - 2\n');
    expect(e.members).toEqual([
      { name: 'Random', value: 0 },
      { name: 'Collapsed', value: 1 },
      { name: 'Expansional', value: 2 },
    ]);
    expect(e.isFlags).toBe(false);
  });
  it('detects flag enums conservatively', () => {
    expect(looksLikeFlags([{ value: 0 }, { value: 1 }, { value: 2 }, { value: 4 }])).toBe(true);
    expect(looksLikeFlags([{ value: 0 }, { value: 1 }, { value: 2 }])).toBe(false);
    expect(looksLikeFlags([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }])).toBe(false);
  });
});
