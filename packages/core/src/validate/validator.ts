import { printParseErrorCode } from 'jsonc-parser';
import type {
  Block,
  Diagnostic,
  JsonPath,
  Project,
  SourceFile,
  TextRange,
} from '../model/types.js';
import { lineIndexFor, properties, propertyNode, rangeOf, type Node } from '../text/jsoncDoc.js';
import { findTrailingCommas } from '../text/trailingCommas.js';
import { RULES, type RuleCode } from './ruleCodes.js';
import { checkBlockShape } from './rules/blockShape.js';
import { checkDuplicates } from './rules/duplicates.js';
import { checkBlockContent } from './rules/content.js';
import { checkLgTuner } from './rules/lgtuner.js';

export interface DiagnosticInput {
  code: RuleCode;
  file: string;
  message: string;
  node?: Node;
  path?: JsonPath;
  blockId?: string;
  related?: Diagnostic['related'];
  fix?: Diagnostic['fix'];
  severity?: Diagnostic['severity'];
}

export class Reporter {
  readonly out: Diagnostic[] = [];
  constructor(private readonly project: Project) {}

  range(file: SourceFile, node: Node): TextRange {
    return rangeOf(node, lineIndexFor(file, file.text));
  }

  add(d: DiagnosticInput): Diagnostic {
    const file = this.project.files.get(d.file);
    const diag: Diagnostic = {
      code: d.code,
      severity: d.severity ?? RULES[d.code].severity,
      message: d.message,
      file: d.file,
      range: file && d.node ? this.range(file, d.node) : undefined,
      jsonPath: d.path,
      blockId: d.blockId,
      related: d.related,
      fix: d.fix,
    };
    this.out.push(diag);
    return diag;
  }
}

/** Run every rule over the whole project. Replaces `project.diagnostics`. */
export function validateProject(project: Project): Diagnostic[] {
  const r = new Reporter(project);

  for (const file of project.files.values()) {
    checkParse(project, file, r);
    checkTrailingCommas(project, file, r);
    if (file.shape === 'unknown' && file.tree) {
      r.add({
        code: 'P002',
        file: file.id,
        node: file.tree,
        message: 'File is not an MTFO wrapper, a PartialData block list, or a single block.',
      });
    }
    if (file.shape === 'wrapper' && file.tree) checkWrapperMeta(file, r);
  }

  for (const blocks of project.index.byFile.values()) {
    for (const block of blocks) {
      if (block.plugin) continue; // plugin-defined IDs: indexed, not schema-checked
      checkBlockShape(project, block, r);
      checkBlockContent(project, block, r);
    }
  }

  checkDuplicates(project, r);
  checkLgTuner(project, r);

  r.out.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : (a.range?.offset ?? 0) - (b.range?.offset ?? 0),
  );
  project.diagnostics = r.out;
  return r.out;
}

function checkParse(project: Project, file: SourceFile, r: Reporter): void {
  for (const e of file.parseErrors) {
    const li = lineIndexFor(file, file.text);
    const { line, col } = li.position(e.offset);
    r.out.push({
      code: 'P001',
      severity: 'error',
      message: `${printParseErrorCode(e.error)} at ${line}:${col}`,
      file: file.id,
      range: { offset: e.offset, length: e.length, line, col },
    });
  }
  void project;
}

/**
 * P003: trailing commas parse fine here (JSONC) but System.Text.Json, which MTFO
 * and PartialData use, throws on them and the whole block is dropped in game.
 */
function checkTrailingCommas(project: Project, file: SourceFile, r: Reporter): void {
  const commas = findTrailingCommas(file.text, file.tree);
  if (!commas.length) return;
  const li = lineIndexFor(file, file.text);
  const blocks = project.index.byFile.get(file.id) ?? [];
  const fix: Diagnostic['fix'] = {
    title:
      commas.length === 1 ? 'Remove the trailing comma' : `Remove ${commas.length} trailing commas`,
    edits: [{ file: file.id, op: { op: 'stripTrailingCommas', path: [] } }],
  };
  for (const c of commas) {
    const { line, col } = li.position(c.offset);
    const block = blocks.find(
      (b) => b.node.offset <= c.offset && c.offset < b.node.offset + b.node.length,
    );
    const what = c.container.type === 'array' ? 'a list' : 'an object';
    r.out.push({
      code: 'P003',
      severity: 'error',
      message: `Trailing comma at the end of ${what} (${line}:${col}). The game's JSON reader rejects it and skips the whole block.`,
      file: file.id,
      range: { offset: c.offset, length: 1, line, col },
      blockId: block?.id,
      fix,
    });
  }
}

function checkWrapperMeta(file: SourceFile, r: Reporter): void {
  const tree = file.tree!;
  const last = propertyNode(tree, 'LastPersistentID', false);
  const blocks = propertyNode(tree, 'Blocks', false);
  if (!last || last.valueNode.type !== 'number' || !blocks || blocks.valueNode.type !== 'array')
    return;
  let max = 0;
  for (const item of blocks.valueNode.children ?? []) {
    const id = propertyNode(item, 'persistentID');
    if (id && id.valueNode.type === 'number') max = Math.max(max, id.valueNode.value as number);
  }
  const lastVal = last.valueNode.value as number;
  if (max > lastVal) {
    r.add({
      code: 'W001',
      file: file.id,
      node: last.valueNode,
      path: ['LastPersistentID'],
      message: `LastPersistentID is ${lastVal} but the highest block ID is ${max}.`,
      fix: {
        title: `Set LastPersistentID to ${max}`,
        edits: [{ file: file.id, op: { op: 'set', path: ['LastPersistentID'], value: max } }],
      },
    });
  }
}

/** Convenience for rules: the property entries of a block. */
export function blockProps(block: Block) {
  return properties(block.node);
}
