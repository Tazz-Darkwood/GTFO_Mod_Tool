/**
 * ProjectHost is the main-process façade the UI talks to. It has no Electron
 * dependency, so it can be exercised directly against the corpus (in memory:
 * nothing here writes to disk).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IpcEvents } from '../src/shared/ipc';
import { ProjectHost } from '../src/main/projectHost';

const DEFAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../Time - Copy/BepInEx/plugins/Mathiast - Time/Time',
);
const corpus = process.env['GTFO_CORPUS'] ?? DEFAULT;
const schemaDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema',
  'dist',
);

describe.skipIf(!existsSync(corpus))('ProjectHost against the corpus', () => {
  const events: { event: keyof IpcEvents; payload: unknown }[] = [];
  const host = new ProjectHost((event, payload) => events.push({ event, payload }), {
    watch: false,
  });

  beforeAll(async () => {
    await host.init(schemaDir);
    await host.open(corpus);
  });
  afterAll(() => host.close());

  it('summarises the project with baselines and problem counts', () => {
    const s = host.summary();
    expect(s.fileCount).toBeGreaterThan(200);
    expect(s.diagnostics.error).toBeGreaterThanOrEqual(13);
    const enemyGroup = s.types.find((t) => t.type === 'EnemyGroup')!;
    expect(enemyGroup.baseline).toBe('wrapper-file');
    expect(enemyGroup.problems).toBeGreaterThan(0);
    const chained = s.types.find((t) => t.type === 'ChainedPuzzle')!;
    expect(chained.baseline).toBe('vanilla');
    expect(chained.vanillaCount).toBeGreaterThan(50);
    expect(chained.hasFullVanilla).toBe(true);
    expect(s.types.find((t) => t.type === 'LevelLayout')!.hasFullVanilla).toBe(false);
  });

  it('lists files with types and eligibility', () => {
    const files = host.listFiles();
    const waves = files.find((f) => f.id === 'PartialData/General/SurvivalWaveSetting.json')!;
    expect(waves.types).toEqual(['SurvivalWaveSettings']);
    expect(waves.canHoldBlocks).toBe(true);
    const single = files.find((f) => f.id.endsWith('L1X1 Main Layout.json'))!;
    expect(single.canHoldBlocks).toBe(false);
    expect(files.some((f) => f.id.startsWith('Custom/') && f.shape === 'plugin')).toBe(true);
  });

  it('lists and searches blocks', () => {
    const page = host.listBlocks({ type: 'LevelLayout' });
    expect(page.total).toBe(31);
    expect(page.items[0]!.persistentID).toBe(69001);
    const hit = host.listBlocks({ query: 'Compromise' });
    expect(hit.items.some((b) => b.name?.includes('Compromise'))).toBe(true);
  });

  it('returns block detail with token styles and ranges', () => {
    const b = host.listBlocks({ type: 'LevelLayout' }).items[0]!;
    const d = host.blockDetail(b.blockId)!;
    expect(d.range.line).toBe(1);
    expect(d.tokenStyles['/ZoneAliasStart']).toBe('int');
    expect(d.tokenStyles['/Zones/0/SubComplex']).toBe('string');
    expect(d.tokenStyles['/Zones/0/StartPosition_IndexWeight']).toBe('float');
    expect(d.tokenRanges['']).toEqual({ offset: d.range.offset, length: d.range.length });
    expect(d.tokenRanges['/Zones/0']).toBeDefined();
    expect((d.value as { ZoneAliasStart: number }).ZoneAliasStart).toBe(502);
  });

  it('reference search merges project and vanilla according to the baseline', () => {
    const all = host.searchRefs({ refType: 'ChainedPuzzle', query: '', limit: 1000 });
    expect(all.some((r) => r.source === 'project')).toBe(true);
    expect(all.some((r) => r.source === 'vanilla')).toBe(true);
    expect(
      host.searchRefs({ refType: 'ChainedPuzzle', query: 'Class S', limit: 5 }).length,
    ).toBeGreaterThan(0);
    const eg = host.searchRefs({ refType: 'EnemyGroup', query: '', limit: 1000 });
    expect(eg.every((r) => r.source === 'project')).toBe(true);
    // Explicit source filter overrides the baseline (used by "copy of vanilla").
    const egVan = host.searchRefs({
      refType: 'EnemyGroup',
      query: '',
      limit: 1000,
      source: 'vanilla',
    });
    expect(egVan.length).toBeGreaterThan(0);
    expect(egVan.every((r) => r.source === 'vanilla')).toBe(true);
    expect(host.resolveRef({ refType: 'ChainedPuzzleType', id: 125 })).toMatchObject({
      source: 'project',
    });
    expect(host.resolveRef({ refType: 'SurvivalWaveSettings', id: 8874 })).toBeNull();
  });

  it('reverse references and plugin mentions', () => {
    const r = host.references({ type: 'SurvivalWaveSettings', id: 8874 });
    expect(
      r.refs.some(
        (x) => x.file.endsWith('L2X2 Overload Objective.json') && x.field === 'WaveSettings',
      ),
    ).toBe(true);
    const layout = host.references({ type: 'LevelLayout', id: 69030 });
    expect(layout.refs.some((x) => x.file === 'PartialData/Rundown_DB.json')).toBe(true);
    expect(layout.mentions.some((m) => m.file === 'Custom/LGTuner/A3.json')).toBe(true); // "LevelLayoutID": 69030
    expect(
      host.fileReferences('PartialData/General/SurvivalWaveSetting.json').length,
    ).toBeGreaterThan(10);
  });

  it('suggests ids and target files', () => {
    expect(host.nextId('LevelLayout').basis).toBe('project');
    const t = host.targetFiles('SurvivalWaveSettings');
    expect(t.length).toBeGreaterThan(1);
    expect(t.every((x) => x.shape !== 'partial-single')).toBe(true);
  });

  it('schema closure contains everything the LevelLayout form needs', () => {
    const c = host.schemaClosure('LevelLayout')!;
    expect(c.root.name).toBe('LevelLayout');
    expect(c.classes['ExpeditionZoneData']).toBeDefined();
    expect(c.enums['eZoneExpansionType']).toBeDefined();
  });

  it('applies an edit, reports dirty state, and undoes it (in memory only)', () => {
    const b = host.listBlocks({ type: 'LevelLayout' }).items[0]!;
    const before = host.fileText(b.file);
    const r = host.applyEdit(
      { file: b.file, blockId: b.blockId },
      { op: 'set', path: ['Zones', 0, 'LightSettings'], value: 44 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.dirty).toBe(true);
    expect((r.block!.value as { Zones: { LightSettings: number }[] }).Zones[0]!.LightSettings).toBe(
      44,
    );
    expect(events.some((e) => e.event === 'project:changed')).toBe(true);
    expect(host.undo(b.file)?.ok).toBe(true);
    expect(host.fileText(b.file)).toBe(before);
  });

  it('creates a block from vanilla, locates it, and undoes byte-identically', () => {
    const file = 'PartialData/General/SurvivalWaveSetting.json';
    const before = host.fileText(file);
    const problemsBefore = host.diagnostics().length;
    const id = host.nextId('SurvivalWaveSettings', file).id;
    const r = host.createBlock({
      type: 'SurvivalWaveSettings',
      targetFile: file,
      persistentID: id,
      name: 'Copy of vanilla 1',
      source: { kind: 'vanilla', id: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block!.persistentID).toBe(id);
    expect(r.block!.name).toBe('Copy of vanilla 1');
    expect(
      host.locateBlock({ file, type: 'SurvivalWaveSettings', persistentID: id })!.blockId,
    ).toBe(r.blockId);
    expect(r.summary.dirtyFiles).toEqual([file]);
    expect(host.diagnostics().length).toBe(problemsBefore); // a clean copy adds no problems
    const after = host.fileText(file);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.indexOf('"datablock": "SurvivalWaveSettings"')).toBeGreaterThan(0);
    expect(host.undo(file)?.ok).toBe(true);
    expect(host.fileText(file)).toBe(before);
  });

  it('refuses to create into a single-block file and duplicates a project block', () => {
    const layout = host.listBlocks({ type: 'LevelLayout' }).items[0]!;
    const bad = host.createBlock({
      type: 'LevelLayout',
      targetFile: layout.file,
      persistentID: 1,
      name: 'x',
      source: { kind: 'blank' },
    });
    expect(bad.ok).toBe(false);
    const file = 'PartialData/General/SurvivalWaveSetting.json';
    const src = host
      .listBlocks({ type: 'SurvivalWaveSettings' })
      .items.find((b) => b.file === file)!;
    const id = host.nextId('SurvivalWaveSettings', file).id;
    const r = host.createBlock({
      type: 'SurvivalWaveSettings',
      targetFile: file,
      persistentID: id,
      name: 'dup',
      source: { kind: 'project', blockId: src.blockId },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(host.diagnostics().filter((d) => d.code === 'D001').length).toBe(7); // no new duplicates
    host.undo(file);
  });

  it('deletes a block, which removes its duplicate report, and undoes', () => {
    const file = 'PartialData/General/SurvivalWaveSetting.json';
    const before = host.fileText(file);
    const dup = host.diagnostics().find((d) => d.code === 'D001' && d.message.includes('#8883'))!;
    const r = host.deleteBlock(dup.blockId!);
    expect(r.ok).toBe(true);
    expect(
      host.diagnostics().filter((d) => d.code === 'D001' && d.message.includes('#8883')),
    ).toEqual([]);
    expect(host.undo(file)?.ok).toBe(true);
    expect(host.fileText(file)).toBe(before);
  });

  it('setFileText refuses broken JSON, accepts good text, and coalesces undo groups', () => {
    const file = 'PartialData/FogSettings.json';
    const before = host.fileText(file);
    const bad = host.setFileText(file, before + ' [');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.parseErrors?.length).toBeGreaterThan(0);
    const t1 = before.replace('"FogDensity": 0,', '"FogDensity": 0.5,');
    expect(host.setFileText(file, t1, { undoGroup: 'g' }).ok).toBe(true);
    const t2 = t1.replace('"FogAmbience": 0,', '"FogAmbience": "oops",');
    const r2 = host.setFileText(file, t2, { undoGroup: 'g' });
    expect(r2.ok).toBe(true);
    expect(host.diagnostics().some((d) => d.file === file && d.code === 'T001')).toBe(true);
    expect(host.undo(file)?.ok).toBe(true);
    expect(host.fileText(file)).toBe(before); // both commits were one step
    expect(host.undo(file)).toBeNull();
  });

  it('applies the B001 quick fix in memory and clears the dependent R001', () => {
    const b001 = host.diagnostics().find((d) => d.code === 'B001')!;
    const before = host.fileText(b001.file);
    expect(host.applyFix(b001.fix!).ok).toBe(true);
    expect(host.diagnostics().filter((d) => d.code === 'B001')).toEqual([]);
    expect(
      host.diagnostics().filter((d) => d.code === 'R001' && d.message.includes('#8874')),
    ).toEqual([]);
    host.undo(b001.file);
    expect(host.fileText(b001.file)).toBe(before);
  });

  it('rejects edits that would not parse', () => {
    const b = host.listBlocks({ type: 'LevelLayout' }).items[0]!;
    const r = host.applyEdit(
      { file: b.file, blockId: b.blockId },
      { op: 'set', path: ['Nope', 'deeper', 'x'], value: 1 },
    );
    expect(r.ok).toBe(false);
  });
  it('serves the rundown tree and refreshes it after edits', () => {
    const tree = host.rundownTree()!;
    expect(tree.rundowns[0]!.name).toBe('Time');
    const exps = tree.rundowns[0]!.tiers.flatMap((t) => t.expeditions);
    expect(exps).toHaveLength(13);
    const a1 = exps.find((e) => e.prefix === 'A1')!;
    const layoutId = a1.layers[0]!.layout!.blockId!;
    const zonesBefore = (a1.layers[0]!.layout!.detail as { zones: unknown[] }).zones.length;
    const r = host.rundownOp({ kind: 'addZone', layoutBlockId: layoutId });
    expect(r.ok).toBe(true);
    const after = host
      .rundownTree()!
      .rundowns[0]!.tiers.flatMap((t) => t.expeditions)
      .find((e) => e.prefix === 'A1')!;
    expect((after.layers[0]!.layout!.detail as { zones: unknown[] }).zones.length).toBe(
      zonesBefore + 1,
    );
    const file = host.blockDetail(layoutId)!.file;
    expect(host.undo(file)?.ok).toBe(true);
    expect(
      (
        host
          .rundownTree()!
          .rundowns[0]!.tiers.flatMap((t) => t.expeditions)
          .find((e) => e.prefix === 'A1')!.layers[0]!.layout!.detail as { zones: unknown[] }
      ).zones.length,
    ).toBe(zonesBefore);
    const bad = host.rundownOp({
      kind: 'moveExpedition',
      rundownBlockId: tree.rundowns[0]!.blockId,
      from: 'A',
      index: 0,
      to: 'A',
    });
    expect(bad.ok).toBe(false);
  });
});
