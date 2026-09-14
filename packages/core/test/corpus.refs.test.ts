/** Read-only corpus checks for the reference index and block-op helpers. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { promises as fsp } from 'node:fs';
import type { Project } from '../src/index.js';
import { assertSchemaBundle, assertVanillaIndex } from '../src/schema/schemaBundle.js';
import { loadProject } from '../src/project/projectLoader.js';
import { NodeFileSystem } from '../src/io/nodeFs.js';
import { validateProject } from '../src/validate/validator.js';
import { buildReferenceIndex, findReferences } from '../src/index/references.js';
import { eligibleTargetFiles, suggestPersistentId } from '../src/project/blockOps.js';
import { buildRundownTree } from '../src/index/rundownTree.js';
import { duplicateZoneOps } from '../src/project/expeditionOps.js';
import { EditSession } from '../src/edit/editEngine.js';

const DEFAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../Time - Copy/BepInEx/plugins/Mathiast - Time/Time',
);
const corpus = process.env['GTFO_CORPUS'] ?? DEFAULT;
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema',
  'dist',
);

describe.skipIf(!existsSync(corpus))('corpus: references and block ops', () => {
  let project: Project;
  beforeAll(async () => {
    const schema = assertSchemaBundle(
      JSON.parse(await fsp.readFile(path.join(distDir, 'schema-bundle.json'), 'utf8')),
    );
    const vanilla = assertVanillaIndex(
      JSON.parse(await fsp.readFile(path.join(distDir, 'vanilla-index.json'), 'utf8')),
    );
    project = await loadProject(corpus, new NodeFileSystem(), schema, vanilla, { sep: path.sep });
    validateProject(project);
  });

  it('finds who references the wave block that never loads', () => {
    const idx = buildReferenceIndex(project);
    const refs = findReferences(project, 'SurvivalWaveSettings', 8874, idx);
    expect(
      refs.some(
        (r) => r.file.endsWith('L2X2 Overload Objective.json') && r.field === 'WaveSettings',
      ),
    ).toBe(true);
    const layoutRefs = findReferences(project, 'LevelLayout', 69001, idx);
    expect(layoutRefs.some((r) => r.file === 'PartialData/Rundown_DB.json')).toBe(true);
  });

  it('suggests ids above the project range and lists sensible targets', () => {
    const s = suggestPersistentId(project, 'LevelLayout');
    expect(s.basis).toBe('project');
    for (const id of project.index.byType.get('LevelLayout')!.keys())
      expect(s.id).toBeGreaterThan(id);
    expect(project.vanilla.types['LevelLayout']?.[String(s.id)]).toBeUndefined();
    const t = eligibleTargetFiles(project, 'SurvivalWaveSettings');
    expect(t[0]!.fileId).toBe('PartialData/General/ReactorSurvivalWaves.json');
    expect(t.filter((x) => x.containsType).map((x) => x.fileId)).toContain(
      'PartialData/General/SurvivalWaveSetting.json',
    );
    expect(t.some((x) => x.shape === 'partial-single')).toBe(false);
  });
  it('builds the rundown tree for Time', () => {
    const tree = buildRundownTree(project);
    expect(tree.loadedRundownIds).toEqual([666]);
    expect(tree.rundowns).toHaveLength(1);
    const rd = tree.rundowns[0]!;
    expect(rd).toMatchObject({ id: 666, name: 'Time', loaded: true });
    const exps = rd.tiers.flatMap((t) => t.expeditions);
    expect(exps).toHaveLength(13);
    const a1 = exps.find((e) => e.prefix === 'A1')!;
    expect(a1.layers[0]!.layout).toMatchObject({ id: 69001, resolution: 'project' });
    const zones = (a1.layers[0]!.layout!.detail as { zones: { alias: number }[] }).zones;
    expect(zones).toHaveLength(14);
    expect(zones[0]!.alias).toBe(502);
    expect(a1.problems).toBeGreaterThanOrEqual(4);
    const a2 = exps.find((e) => e.prefix === 'A2')!;
    expect(a2.layers[1]!.layout!.id).toBe(69021);
    expect(a2.layers[2]).toMatchObject({ enabled: false });
    expect(a2.layers[2]!.layout!.id).toBe(69022);
    const b2 = exps.find((e) => e.prefix === 'B2')!;
    const waves = b2.layers
      .flatMap((l) => l.objectives)
      .flatMap(
        (o) =>
          (
            o.detail as
              { waves: { settings: { id: number; resolution: string } | null }[] } | undefined
          )?.waves ?? [],
      );
    expect(waves.some((w) => w.settings?.id === 8874 && w.settings.resolution === 'missing')).toBe(
      true,
    );
  });

  it('duplicates a zone in memory and undoes it byte-identically', () => {
    const layout = project.index.byType.get('LevelLayout')!.get(69001)![0]!;
    const before = project.files.get(layout.file)!.text;
    const s = new EditSession(project);
    const plan = duplicateZoneOps(project, layout.id, 0);
    s.applyMany(plan.target, plan.ops);
    const zones = (
      buildRundownTree(project).rundowns[0]!.tiers[0]!.expeditions.find((e) => e.prefix === 'A1')!
        .layers[0]!.layout!.detail as { zones: { localIndex: number }[] }
    ).zones;
    expect(zones).toHaveLength(15);
    expect(zones[1]!.localIndex).toBe(14);
    s.undoFile(layout.file);
    expect(project.files.get(layout.file)!.text).toBe(before);
    validateProject(project);
  });
});
