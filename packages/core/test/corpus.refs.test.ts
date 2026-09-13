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
});
