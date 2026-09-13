/**
 * End-to-end check against the real rundown ("Time" by Mathiast).
 * Skipped unless GTFO_CORPUS points at the rundown folder, or the default
 * location exists. Never writes to the corpus.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertSchemaBundle,
  assertVanillaIndex,
  EditSession,
  loadProject,
  NodeFileSystem,
  validateProject,
  type Diagnostic,
  type Project,
} from '@gtfo/core';
import { loadAllVanillaBlocks, loadSchemaBundle, loadVanillaIndex } from '@gtfo/schema';

const DEFAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../Time - Copy/BepInEx/plugins/Mathiast - Time/Time',
);
const corpus = process.env['GTFO_CORPUS'] ?? DEFAULT;
const available = existsSync(corpus);

describe.skipIf(!available)('corpus: Time rundown', () => {
  let project: Project;
  let diags: Diagnostic[];
  const byCode = (code: string) => diags.filter((d) => d.code === code);

  beforeAll(async () => {
    const vanilla = assertVanillaIndex(await loadVanillaIndex());
    vanilla.blocks = await loadAllVanillaBlocks(vanilla);
    project = await loadProject(
      corpus,
      new NodeFileSystem(),
      assertSchemaBundle(await loadSchemaBundle()),
      vanilla,
      { sep: path.sep },
    );
    diags = validateProject(project);
  });

  it('parses every file and classifies shapes', () => {
    const shapes: Record<string, number> = {};
    for (const f of project.files.values()) shapes[f.shape] = (shapes[f.shape] ?? 0) + 1;
    expect(byCode('P001')).toEqual([]);
    expect(shapes['unknown'] ?? 0).toBe(0);
    expect(shapes).toMatchObject({
      wrapper: 82,
      'partial-array': 47,
      'partial-single': 42,
      meta: 2,
    });
    expect(shapes['plugin']).toBeGreaterThan(80);
  });

  it('finds the wave block with no datablock field and proposes the fix', () => {
    const b001 = byCode('B001');
    expect(b001).toHaveLength(1);
    const d = b001[0]!;
    expect(d.file).toBe('PartialData/General/SurvivalWaveSetting.json');
    expect(d.message).toContain('SurvivalWaveSettings');
    expect(d.fix?.edits[0]?.op).toEqual({
      op: 'setProperty',
      path: [],
      key: 'datablock',
      value: 'SurvivalWaveSettings',
    });
    const block = project.index.byId.get(d.blockId!)!;
    expect(block.persistentID).toBe(8874);
  });

  it('finds exactly the seven duplicate IDs', () => {
    const dups = byCode('D001').map((d) => {
      const b = project.index.byId.get(d.blockId!)!;
      return `${b.type}#${b.persistentID}`;
    });
    expect(dups.sort()).toEqual(
      [
        'EnemyGroup#79',
        'GearSightPart#48',
        'SurvivalWavePopulation#8766',
        'SurvivalWaveSettings#8883',
        'SurvivalWaveSettings#8903',
        'SurvivalWaveSettings#8904',
        'SurvivalWaveSettings#8905',
      ].sort(),
    );
  });

  it('finds the dangling wave reference and the swapped scout wave IDs', () => {
    const r001 = byCode('R001');
    const wave = r001.find(
      (d) => d.file.endsWith('L2X2 Overload Objective.json') && d.message.includes('#8874'),
    );
    expect(wave).toBeDefined();
    expect(wave!.jsonPath).toEqual(['WavesOnGotoWin', 0, 'WaveSettings']); // single-block file: paths start at the block root
    const scout = r001.filter(
      (d) =>
        d.file === 'PartialData/Rundown_DB.json' &&
        /ScoutWave(Settings|Population)/.test(d.message),
    );
    expect(scout).toHaveLength(2);
    expect(scout.every((d) => d.message.includes('swapped fields?'))).toBe(true);
    // Everything else flagged is a Text reference the rundown never defines.
    const rest = r001.filter((d) => d !== wave && !scout.includes(d));
    expect(rest.every((d) => d.message.includes('points to Text #'))).toBe(true);
    expect(rest.length).toBeLessThanOrEqual(3);
  });

  it('resolves plugin-defined puzzle types and disabled layers without noise', () => {
    expect(byCode('R001').filter((d) => d.message.includes('ChainedPuzzleType'))).toEqual([]);
    expect(byCode('R001').filter((d) => d.message.includes('LevelLayout'))).toEqual([]);
    expect(project.index.byType.get('ChainedPuzzleType')?.get(125)?.[0]?.plugin).toBe(
      'ExtraChainedPuzzleCustomization',
    );
  });

  it('keeps the total noise low', () => {
    const errors = diags.filter((d) => d.severity === 'error');
    expect(errors.length).toBeLessThan(20);
    expect(diags.length).toBeLessThan(120);
  });

  it('applying the datablock fix in memory removes the dangling wave reference (no disk writes)', () => {
    const d001Before = byCode('D001').length;
    const session = new EditSession(project);
    const b001 = byCode('B001')[0]!;
    const before = project.files.get(b001.file)!.text;
    session.applyFix(b001.fix!);
    const after = project.files.get(b001.file)!.text;
    expect(after).not.toBe(before);
    expect(after.length - before.length).toBeLessThan(60); // one added line
    const now = project.diagnostics;
    expect(now.filter((d) => d.code === 'B001')).toEqual([]);
    expect(now.filter((d) => d.code === 'R001' && d.message.includes('#8874'))).toEqual([]);
    expect(now.filter((d) => d.code === 'D001')).toHaveLength(d001Before);
    // Undo puts the exact original text back.
    session.undoFile(b001.file);
    expect(project.files.get(b001.file)!.text).toBe(before);
    expect(project.files.get(b001.file)!.dirty).toBe(false);
    // Re-run so later tests see the original state.
    diags = validateProject(project);
  });

  it('every quick fix the validator offers can be applied and leaves the JSON valid', () => {
    const session = new EditSession(project);
    const fixable = diags.filter((d) => d.fix);
    expect(fixable.length).toBeGreaterThan(5);
    for (const d of [...fixable].sort((x, y) => (y.range?.offset ?? 0) - (x.range?.offset ?? 0))) {
      session.applyFix(d.fix!);
    }
    for (const f of project.files.values()) expect(f.parseErrors).toEqual([]);
    const after = project.diagnostics;
    expect(after.filter((d) => d.code === 'E002')).toEqual([]);
    expect(after.filter((d) => d.code === 'B001')).toEqual([]);
    expect(after.filter((d) => d.code === 'W001')).toEqual([]);
    for (const f of [...project.files.values()].filter((x) => x.dirty)) session.forget(f.id);
  });
});
