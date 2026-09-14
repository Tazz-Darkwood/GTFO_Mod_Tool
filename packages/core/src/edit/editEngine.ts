/**
 * Applies EditOps to a Project: builds minimal text edits, re-parses the file,
 * re-indexes, re-validates, and keeps per-file undo history.
 */
import type {
  Block,
  BlockId,
  Diagnostic,
  DiagnosticFix,
  EditOp,
  FieldSchema,
  FileId,
  Project,
  SourceFile,
} from '../model/types.js';
import { splitBlockId } from '../project/blockExtractor.js';
import { replaceFileText } from '../project/projectLoader.js';
import { blockClass } from '../schema/schemaBundle.js';
import { schemaAtPath } from '../schema/fieldLookup.js';
import { parseDocument, pointerToPath } from '../text/jsoncDoc.js';
import { findTrailingCommas } from '../text/trailingCommas.js';
import { validateProject } from '../validate/validator.js';
import { applyTextEdits, buildEdits, EditError, type TextEdit } from './textEdits.js';
import { UndoStack } from './undoStack.js';

export interface EditResult {
  file: SourceFile;
  edits: TextEdit[];
  /** The edited block re-located after the change (same path), if the op targeted a block. */
  block?: Block;
  diagnostics: Diagnostic[];
}

export interface EditTarget {
  file: FileId;
  /** Block whose root the op's path is relative to; omit for file-root paths. */
  blockId?: BlockId;
}

/** Offsets of trailing commas in `after` that do not correspond to one already present in `before`. */
function newTrailingCommas(
  before: string,
  beforeTree: Parameters<typeof findTrailingCommas>[1],
  after: string,
  afterTree: Parameters<typeof findTrailingCommas>[1],
  edits: TextEdit[],
): number[] {
  const afterCommas = findTrailingCommas(after, afterTree);
  if (!afterCommas.length) return [];
  const sorted = [...edits].sort((a, b) => a.offset - b.offset);
  const mapOffset = (offset: number): number | undefined => {
    let delta = 0;
    for (const e of sorted) {
      if (offset < e.offset) break;
      if (offset < e.offset + e.length) return undefined; // inside a replaced span
      delta += e.content.length - e.length;
    }
    return offset + delta;
  };
  const kept = new Set<number>();
  for (const c of findTrailingCommas(before, beforeTree)) {
    const m = mapOffset(c.offset);
    if (m !== undefined) kept.add(m);
  }
  return afterCommas.map((c) => c.offset).filter((o) => !kept.has(o));
}

export class EditSession {
  private readonly undo = new Map<FileId, UndoStack>();
  /** Last source-edit undo group per file (see replaceText). */
  private readonly lastGroup = new Map<FileId, string>();

  constructor(readonly project: Project) {}

  private stack(fileId: FileId): UndoStack {
    let s = this.undo.get(fileId);
    if (!s) {
      s = new UndoStack();
      this.undo.set(fileId, s);
    }
    return s;
  }

  /** Field schema at an op's target, for representation-preserving formatting. */
  private fieldFor(block: Block | undefined, op: EditOp): FieldSchema | undefined {
    if (!block?.type) return undefined;
    const cls = blockClass(this.project.schema, block.type);
    if (!cls) return undefined;
    const path = op.op === 'setProperty' ? [...op.path, op.key] : op.path;
    return schemaAtPath(this.project.schema, cls, path)?.field;
  }

  /** Compute the new text for one op without touching the project. */
  preview(
    target: EditTarget,
    op: EditOp,
  ): { file: SourceFile; edits: TextEdit[]; newText: string } {
    const file = this.project.files.get(target.file);
    if (!file) throw new EditError(`Unknown file ${target.file}`);
    if (!file.tree)
      throw new EditError(`${target.file} has parse errors; fix them in a text editor first`);
    const block = target.blockId ? this.project.index.byId.get(target.blockId) : undefined;
    if (target.blockId && !block) throw new EditError(`Unknown block ${target.blockId}`);
    const basePath = block ? block.path : [];
    const edits = buildEdits(file.text, file.tree, basePath, op, {
      style: file.style,
      field: this.fieldFor(block, op),
      enums: this.project.schema.enums,
    });
    let newText = applyTextEdits(file.text, edits);
    let check = parseDocument(newText);
    if (check.errors.length && !file.parseErrors.length) {
      throw new EditError(
        `Edit would produce invalid JSON (${check.errors.length} error(s)); refused`,
      );
    }
    // Safety net: the game's reader rejects trailing commas, so an edit must never
    // introduce one. Commas that were already in the file are left alone (P003 reports them).
    const introduced = newTrailingCommas(file.text, file.tree, newText, check.tree, edits);
    if (introduced.length) {
      newText = applyTextEdits(
        newText,
        introduced.map((offset) => ({ offset, length: 1, content: '' })),
      );
      check = parseDocument(newText);
    }
    return { file, edits, newText };
  }

  /** Apply one op, re-index, re-validate. */
  apply(target: EditTarget, op: EditOp): EditResult {
    const { file, edits, newText } = this.preview(target, op);
    if (newText === file.text)
      return {
        file,
        edits: [],
        block: target.blockId ? this.project.index.byId.get(target.blockId) : undefined,
        diagnostics: this.project.diagnostics,
      };
    this.stack(file.id).push(file.text);
    this.lastGroup.delete(file.id);
    return this.commit(file.id, newText, target.blockId);
  }

  /** Apply every edit of a diagnostic fix (all edits of one file are combined into one undo step). */
  applyFix(fix: DiagnosticFix): EditResult[] {
    const results: EditResult[] = [];
    // Group by file so a multi-edit fix is one undo step per file.
    const byFile = new Map<FileId, DiagnosticFix['edits']>();
    for (const e of fix.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
    for (const [fileId, edits] of byFile) {
      const before = this.project.files.get(fileId)?.text;
      let last: EditResult | undefined;
      for (const e of edits) last = this.apply({ file: fileId, blockId: e.blockId }, e.op);
      if (before !== undefined && edits.length > 1) {
        // Collapse the intermediate undo entries into one.
        const s = this.stack(fileId);
        for (let i = 1; i < edits.length; i++) s.undo(before); // drop extras
        s.clear();
        s.push(before);
      }
      if (last) results.push(last);
    }
    return results;
  }

  /** Apply several ops to one target as a single undo step (later ops see earlier ones). */
  applyMany(target: EditTarget, ops: EditOp[]): EditResult {
    const file = this.project.files.get(target.file);
    if (!file) throw new EditError(`Unknown file ${target.file}`);
    if (ops.length === 0)
      return { file, edits: [], block: undefined, diagnostics: this.project.diagnostics };
    const before = file.text;
    // Apply sequentially so each op sees the re-parsed tree; collapse the undo entries afterwards.
    let last: EditResult | undefined;
    for (const op of ops) last = this.apply(target, op);
    const s = this.stack(target.file);
    s.clear();
    if (this.project.files.get(target.file)!.text !== before) s.push(before);
    this.lastGroup.delete(target.file);
    return last!;
  }

  /**
   * Replace a file's whole text (editable source view). Refuses text that does
   * not parse. Consecutive commits with the same `undoGroup` share one undo step.
   */
  replaceText(fileId: FileId, newText: string, opts: { undoGroup?: string } = {}): EditResult {
    const file = this.project.files.get(fileId);
    if (!file) throw new EditError(`Unknown file ${fileId}`);
    const check = parseDocument(newText.replace(/\r\n/g, '\n'));
    if (check.errors.length) {
      const err = new EditError(`Text has ${check.errors.length} JSON error(s)`);
      (err as EditError & { parseErrors?: typeof check.errors }).parseErrors = check.errors;
      throw err;
    }
    const text = newText.replace(/\r\n/g, '\n');
    if (text === file.text) return { file, edits: [], diagnostics: this.project.diagnostics };
    const group = opts.undoGroup;
    if (!group || this.lastGroup.get(fileId) !== group) this.stack(fileId).push(file.text);
    if (group) this.lastGroup.set(fileId, group);
    else this.lastGroup.delete(fileId);
    return this.commit(fileId, text, undefined);
  }

  /** Find a block by identity after its path-based id may have shifted. */
  locateBlock(fileId: FileId, type: string | undefined, persistentID: number): Block | undefined {
    const blocks = this.project.index.byFile.get(fileId) ?? [];
    return blocks.find((b) => b.persistentID === persistentID && (!type || b.type === type));
  }

  undoFile(fileId: FileId): EditResult | undefined {
    const file = this.project.files.get(fileId);
    if (!file) return undefined;
    const prev = this.stack(fileId).undo(file.text);
    if (prev === undefined) return undefined;
    this.lastGroup.delete(fileId);
    return this.commit(fileId, prev, undefined);
  }

  redoFile(fileId: FileId): EditResult | undefined {
    const file = this.project.files.get(fileId);
    if (!file) return undefined;
    const next = this.stack(fileId).redo(file.text);
    if (next === undefined) return undefined;
    return this.commit(fileId, next, undefined);
  }

  canUndo(fileId: FileId): boolean {
    return this.undo.get(fileId)?.canUndo ?? false;
  }
  canRedo(fileId: FileId): boolean {
    return this.undo.get(fileId)?.canRedo ?? false;
  }

  /** Forget history for a file (after revert or external reload). */
  forget(fileId: FileId): void {
    this.undo.delete(fileId);
  }

  private commit(fileId: FileId, newText: string, blockId: BlockId | undefined): EditResult {
    const file = replaceFileText(this.project, fileId, newText);
    const diagnostics = validateProject(this.project);
    let block: Block | undefined;
    if (blockId) {
      // Block ids are path-based, so the same id addresses the same block after a value edit.
      block = this.project.index.byId.get(blockId);
      if (!block) {
        const { fileId: f, pointer } = splitBlockId(blockId);
        const path = pointerToPath(pointer);
        block = (this.project.index.byFile.get(f) ?? []).find(
          (b) => JSON.stringify(b.path) === JSON.stringify(path),
        );
      }
    }
    return { file, edits: [], block, diagnostics };
  }
}
