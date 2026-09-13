#!/usr/bin/env -S npx tsx
/**
 * gtfo-tool set <folder> <file> <json-pointer> <value>   change one value in place
 * gtfo-tool fix <folder> [--code B001,E002] [--dry-run]    apply the validator's quick fixes
 */
import path from 'node:path';
import { Command } from 'commander';
import {
  assertSchemaBundle,
  assertVanillaIndex,
  EditSession,
  loadProject,
  NodeFileSystem,
  pointerToPath,
  saveFile,
  validateProject,
  type Project,
} from '@gtfo/core';
import { loadAllVanillaBlocks, loadSchemaBundle, loadVanillaIndex } from '@gtfo/schema';

async function open(folder: string): Promise<Project> {
  const [schema, vanillaRaw] = await Promise.all([loadSchemaBundle(), loadVanillaIndex()]);
  const vanilla = assertVanillaIndex(vanillaRaw);
  vanilla.blocks = await loadAllVanillaBlocks(vanilla);
  const project = await loadProject(
    path.resolve(folder),
    new NodeFileSystem(),
    assertSchemaBundle(schema),
    vanilla,
    { sep: path.sep },
  );
  validateProject(project);
  return project;
}

function parseValue(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function showDiff(before: string, after: string, fileId: string): void {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  console.log(`--- ${fileId} (lines ${start + 1}-${Math.max(endA, endB) + 1})`);
  for (let i = start; i <= endA; i++) console.log(`- ${a[i]}`);
  for (let i = start; i <= endB; i++) console.log(`+ ${b[i]}`);
}

const program = new Command().name('gtfo-tool');

program
  .command('set')
  .argument('<folder>')
  .argument('<file>', 'project-relative file, e.g. PartialData/General/FogSettings.json')
  .argument('<pointer>', 'JSON pointer from the file root, e.g. /0/FogDensity')
  .argument('<value>', 'JSON value (strings may be unquoted)')
  .option('--dry-run', 'show the change without writing')
  .action(
    async (
      folder: string,
      file: string,
      pointer: string,
      value: string,
      opts: { dryRun?: boolean },
    ) => {
      const project = await open(folder);
      const fileId = file.replace(/\\/g, '/');
      const session = new EditSession(project);
      const before = project.files.get(fileId)?.text;
      if (before === undefined) throw new Error(`No such project file: ${fileId}`);
      // Accept "Zones/0/LightSettings" as well as "/Zones/0/LightSettings" (Git Bash rewrites leading slashes).
      const ptr = pointer.startsWith('/') ? pointer : '/' + pointer;
      session.apply(
        { file: fileId },
        { op: 'set', path: pointerToPath(ptr), value: parseValue(value) },
      );
      showDiff(before, project.files.get(fileId)!.text, fileId);
      if (opts.dryRun) return;
      const r = await saveFile(new NodeFileSystem(), project, fileId);
      console.log(r.ok ? 'saved' : `NOT saved: ${r.reason}`);
    },
  );

program
  .command('fix')
  .argument('<folder>')
  .option('--code <codes>', 'only these rule codes (comma-separated)')
  .option('--dry-run', 'show changes without writing')
  .action(async (folder: string, opts: { code?: string; dryRun?: boolean }) => {
    const project = await open(folder);
    const codes = opts.code ? new Set(opts.code.split(',').map((s) => s.trim())) : undefined;
    const fixable = project.diagnostics.filter((d) => d.fix && (!codes || codes.has(d.code)));
    console.log(`${fixable.length} fixable problem(s)`);
    const session = new EditSession(project);
    const before = new Map([...project.files].map(([id, f]) => [id, f.text]));
    let applied = 0;
    // Apply in reverse document order so earlier offsets stay valid within one validation pass.
    for (const d of [...fixable].sort((x, y) => (y.range?.offset ?? 0) - (x.range?.offset ?? 0))) {
      try {
        session.applyFix(d.fix!);
        applied++;
        console.log(`  ${d.code} ${d.file}:${d.range?.line ?? '?'}  ${d.fix!.title}`);
      } catch (e) {
        console.log(`  ${d.code} ${d.file}: skipped (${(e as Error).message})`);
      }
    }
    const changed = [...project.files.values()].filter((f) => f.dirty);
    for (const f of changed) showDiff(before.get(f.id)!, f.text, f.id);
    const after = validateProject(project);
    console.log(
      `applied ${applied}; problems before ${fixable.length + (project.diagnostics.length - after.length)} -> after ${after.length}`,
    );
    if (opts.dryRun) return;
    const fs = new NodeFileSystem();
    for (const f of changed) {
      const r = await saveFile(fs, project, f.id);
      console.log(`${r.ok ? 'saved' : 'NOT saved (' + r.reason + ')'}  ${f.id}`);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(2);
});
