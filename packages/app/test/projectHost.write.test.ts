/**
 * File create/delete and save go to disk, so they run on a scratch copy of the
 * corpus in the OS temp directory.
 */
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe.skipIf(!existsSync(corpus))('ProjectHost file operations on a scratch copy', () => {
  let scratch: string;
  const host = new ProjectHost(() => undefined, { watch: false });

  beforeAll(async () => {
    scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'gtfo-scratch-'));
    // Only PartialData + one wrapper are needed; keep the copy small and fast.
    await fsp.cp(path.join(corpus, 'PartialData'), path.join(scratch, 'PartialData'), {
      recursive: true,
    });
    await fsp.copyFile(
      path.join(corpus, 'GameData_GameSetupDataBlock_bin.json'),
      path.join(scratch, 'GameData_GameSetupDataBlock_bin.json'),
    );
    await host.init(schemaDir);
    await host.open(scratch);
  });
  afterAll(async () => {
    await host.close();
    await fsp.rm(scratch, { recursive: true, force: true });
  });

  it('creates a list file, fills it, saves, and deletes it', async () => {
    const created = await host.createFile({
      path: 'PartialData/Levels/New Level/Waves.json',
      kind: 'partial-array',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.file.canHoldBlocks).toBe(true);
    const abs = path.join(scratch, 'PartialData', 'Levels', 'New Level', 'Waves.json');
    expect(await fsp.readFile(abs, 'utf8')).toBe('[]\n');
    expect(host.listFiles().some((f) => f.id === created.file.id)).toBe(true);

    const id = host.nextId('SurvivalWaveSettings', created.file.id).id;
    const made = host.createBlock({
      type: 'SurvivalWaveSettings',
      targetFile: created.file.id,
      persistentID: id,
      name: 'New wave',
      source: { kind: 'blank' },
    });
    expect(made.ok).toBe(true);
    expect(host.summary().dirtyFiles).toEqual([created.file.id]);
    const saved = await host.save(created.file.id);
    expect(saved.ok).toBe(true);
    const onDisk = await fsp.readFile(abs, 'utf8');
    expect(onDisk).toContain('"datablock": "SurvivalWaveSettings"');
    expect(onDisk).toContain(`"persistentID": ${id}`);
    expect(JSON.parse(onDisk)).toHaveLength(1);

    const del = await host.deleteFile(created.file.id);
    expect(del.ok).toBe(true);
    expect(existsSync(abs)).toBe(false);
    expect(host.listFiles().some((f) => f.id === created.file.id)).toBe(false);
    expect(host.summary().dirtyFiles).toEqual([]);
  });

  it('validates new file paths and wrapper uniqueness', async () => {
    expect((await host.createFile({ path: 'Custom/x.json', kind: 'partial-array' })).ok).toBe(
      false,
    );
    expect(
      (await host.createFile({ path: 'PartialData/FogSettings.json', kind: 'partial-array' })).ok,
    ).toBe(false);
    expect(
      (await host.createFile({ path: 'GameData_GameSetupDataBlock_bin.json', kind: 'wrapper' })).ok,
    ).toBe(false);
    const w = await host.createFile({
      path: 'GameData_FogSettingsDataBlock_bin.json',
      kind: 'wrapper',
    });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.summary.types.find((t) => t.type === 'FogSettings')!.baseline).toBe('wrapper-file');
    expect(
      await fsp.readFile(path.join(scratch, 'GameData_FogSettingsDataBlock_bin.json'), 'utf8'),
    ).toContain('"Blocks": []');
    expect((await host.deleteFile('GameData_FogSettingsDataBlock_bin.json')).ok).toBe(true);
    expect(host.summary().types.find((t) => t.type === 'FogSettings')!.baseline).toBe('vanilla');
  });
});
