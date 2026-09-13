#!/usr/bin/env -S npx tsx
/**
 * gtfo-validate <rundown folder> [--json] [--min-severity error|warning|info] [--code R001,...]
 * Prints every problem the tool finds in an MTFO rundown folder.
 */
import path from 'node:path';
import { Command } from 'commander';
import {
  assertSchemaBundle,
  assertVanillaIndex,
  loadProject,
  NodeFileSystem,
  RULES,
  validateProject,
  type Diagnostic,
  type RuleCode,
  type Severity,
} from '@gtfo/core';
import { loadAllVanillaBlocks, loadSchemaBundle, loadVanillaIndex } from '@gtfo/schema';

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const program = new Command()
  .name('gtfo-validate')
  .argument('<folder>', 'rundown folder (the one containing GameData_*.json / PartialData)')
  .option('--json', 'machine-readable output')
  .option('--min-severity <sev>', 'error | warning | info', 'info')
  .option('--code <codes>', 'comma-separated rule codes to show')
  .option('--summary', 'only print counts per rule')
  .action(
    async (
      folder: string,
      opts: { json?: boolean; minSeverity: Severity; code?: string; summary?: boolean },
    ) => {
      const root = path.resolve(folder);
      const t0 = Date.now();
      const [schema, vanillaRaw] = await Promise.all([loadSchemaBundle(), loadVanillaIndex()]);
      const vanilla = assertVanillaIndex(vanillaRaw);
      vanilla.blocks = await loadAllVanillaBlocks(vanilla);
      const project = await loadProject(
        root,
        new NodeFileSystem(),
        assertSchemaBundle(schema),
        vanilla,
        { sep: path.sep },
      );
      const all = validateProject(project);
      const elapsed = Date.now() - t0;

      const codes = opts.code ? new Set(opts.code.split(',').map((s) => s.trim())) : undefined;
      const diags = all.filter(
        (d) =>
          SEV_ORDER[d.severity] <= SEV_ORDER[opts.minSeverity] && (!codes || codes.has(d.code)),
      );

      if (opts.json) {
        const shapes = countBy([...project.files.values()].map((f) => f.shape));
        console.log(
          JSON.stringify(
            { root, files: project.files.size, shapes, elapsedMs: elapsed, diagnostics: diags },
            null,
            2,
          ),
        );
        process.exit(diags.some((d) => d.severity === 'error') ? 1 : 0);
      }

      const shapes = countBy([...project.files.values()].map((f) => f.shape));
      console.log(`Project: ${root}`);
      console.log(
        `Files: ${project.files.size}  (${Object.entries(shapes)
          .map(([k, v]) => `${k}=${v}`)
          .join(
            ', ',
          )})  Blocks: ${project.index.byId.size}  Types: ${project.index.byType.size}  [${elapsed} ms]`,
      );
      console.log('');

      const byCode = new Map<string, Diagnostic[]>();
      for (const d of diags) {
        const list = byCode.get(d.code) ?? [];
        list.push(d);
        byCode.set(d.code, list);
      }
      const ordered = [...byCode.entries()].sort(
        (a, b) =>
          SEV_ORDER[a[1][0]!.severity] - SEV_ORDER[b[1][0]!.severity] || a[0].localeCompare(b[0]),
      );
      console.log('Summary:');
      for (const [code, list] of ordered) {
        console.log(
          `  ${pad(code, 5)} ${pad(list[0]!.severity, 8)} ${pad(String(list.length), 5)} ${RULES[code as RuleCode]?.title ?? ''}`,
        );
      }
      if (opts.summary) return;
      console.log('');
      for (const [code, list] of ordered) {
        console.log(`== ${code} ${RULES[code as RuleCode]?.title ?? ''} (${list.length})`);
        for (const d of list) {
          const loc = d.range ? `:${d.range.line}:${d.range.col}` : '';
          console.log(`  ${d.file}${loc}`);
          console.log(`      ${d.message}${d.fix ? `  [fix: ${d.fix.title}]` : ''}`);
        }
        console.log('');
      }
      process.exit(diags.some((d) => d.severity === 'error') ? 1 : 0);
    },
  );

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(2);
});
