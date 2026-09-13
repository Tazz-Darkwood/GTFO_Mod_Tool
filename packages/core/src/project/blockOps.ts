/**
 * Block-level operations expressed as EditOps: id suggestion, target file
 * eligibility, materialising a new block (blank / copy of vanilla / copy of a
 * project block / pasted text) and create/delete op builders.
 */
import type {
  Block,
  BlockId,
  EditOp,
  FileId,
  FileShape,
  JsonPath,
  Project,
  SourceFile,
  TypeName,
} from '../model/types.js';
import { existsInProject } from '../index/typeResolution.js';
import { defaultBlockValue } from '../schema/defaults.js';
import { EditError } from '../edit/textEdits.js';
import { parseDocument, properties, propertyNode, valueOf } from '../text/jsoncDoc.js';
import { formatValueBlock } from '../text/scalarFormat.js';
import type { EditTarget } from '../edit/editEngine.js';

/** Vanilla dumps contain hashed ids (> 1e9) that are useless as a "next id" basis. */
const MAX_SENSIBLE_ID = 1_000_000;

export interface IdSuggestion {
  id: number;
  basis: 'project' | 'wrapper' | 'vanilla' | 'none';
}

export function suggestPersistentId(
  project: Project,
  type: TypeName,
  targetFile?: FileId,
): IdSuggestion {
  let candidate = 0;
  let basis: IdSuggestion['basis'] = 'none';
  const ids = project.index.byType.get(type);
  if (ids && ids.size) {
    candidate = Math.max(...ids.keys()) + 1;
    basis = 'project';
  }
  const target = targetFile ? project.files.get(targetFile) : undefined;
  if (target?.shape === 'wrapper' && target.tree) {
    const last = propertyNode(target.tree, 'LastPersistentID', false);
    if (last && last.valueNode.type === 'number') {
      const n = (last.valueNode.value as number) + 1;
      if (n > candidate) {
        candidate = n;
        basis = 'wrapper';
      }
    }
  }
  if (candidate === 0) {
    const vanillaIds = Object.keys(project.vanilla.types[type] ?? {})
      .map(Number)
      .filter((n) => Number.isFinite(n) && n < MAX_SENSIBLE_ID);
    if (vanillaIds.length) {
      candidate = Math.max(...vanillaIds) + 1;
      basis = 'vanilla';
    }
  }
  if (candidate === 0) candidate = 1;
  const res = project.resolutions.get(type);
  const collides = (n: number) =>
    existsInProject(project.index, type, n) ||
    ((!res || res.baseline === 'vanilla') &&
      project.vanilla.types[type]?.[String(n)] !== undefined);
  while (collides(candidate)) candidate++;
  return { id: candidate, basis };
}

export interface TargetFile {
  fileId: FileId;
  shape: FileShape;
  /** The file already holds blocks of this type. */
  containsType: boolean;
  blockCount: number;
}

/** Files a new block of `type` may go into: the type's wrapper first, then partial-array files (those holding the type first). */
export function eligibleTargetFiles(project: Project, type: TypeName): TargetFile[] {
  const out: TargetFile[] = [];
  for (const f of project.files.values()) {
    if (!f.tree || f.parseErrors.length) continue;
    if (f.shape === 'wrapper') {
      if (f.wrapperType !== type) continue;
    } else if (f.shape !== 'partial-array') continue;
    const blocks = project.index.byFile.get(f.id) ?? [];
    out.push({
      fileId: f.id,
      shape: f.shape,
      containsType: blocks.some((b) => b.type === type),
      blockCount: blocks.length,
    });
  }
  return out.sort((a, b) => {
    const rank = (t: TargetFile) => (t.shape === 'wrapper' ? 0 : t.containsType ? 1 : 2);
    return rank(a) - rank(b) || a.fileId.localeCompare(b.fileId);
  });
}

export type BlockSource =
  | { kind: 'blank' }
  | { kind: 'vanilla'; id: number }
  | { kind: 'project'; blockId: BlockId }
  | { kind: 'text'; text: string };

export interface CreateBlockRequest {
  type: TypeName;
  targetFile: FileId;
  persistentID: number;
  name: string;
  source: BlockSource;
}

export type Materialized =
  { kind: 'value'; value: Record<string, unknown> } | { kind: 'raw'; text: string };

/** Turn a source into the JSON (value or raw text) of the new block with name/id/datablock applied. */
export function materializeBlock(
  project: Project,
  req: CreateBlockRequest,
  targetShape: FileShape,
): Materialized {
  const withTag = targetShape !== 'wrapper';
  const finalize = (obj: Record<string, unknown>): Record<string, unknown> => {
    // Keep the source's field order but put meta last, the way modders write them.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (['name', 'internalenabled', 'datablock', 'persistentid'].includes(k.toLowerCase()))
        continue;
      out[k] = v;
    }
    out['name'] = req.name;
    out['internalEnabled'] =
      typeof obj['internalEnabled'] === 'boolean' ? obj['internalEnabled'] : true;
    if (withTag) out['datablock'] = req.type;
    out['persistentID'] = req.persistentID;
    return out;
  };
  switch (req.source.kind) {
    case 'blank':
      return {
        kind: 'value',
        value: defaultBlockValue(project.schema, req.type, {
          persistentID: req.persistentID,
          name: req.name,
          withDatablockTag: withTag,
        }),
      };
    case 'vanilla': {
      const v = project.vanilla.blocks?.[req.type]?.[String(req.source.id)];
      if (!v || typeof v !== 'object')
        throw new EditError(
          `No full vanilla data for ${req.type} #${req.source.id} (only its name is known)`,
        );
      return { kind: 'value', value: finalize(v as Record<string, unknown>) };
    }
    case 'project': {
      const b = project.index.byId.get(req.source.blockId);
      const f = b ? project.files.get(b.file) : undefined;
      if (!b || !f) throw new EditError('Source block no longer exists');
      return { kind: 'raw', text: retagRaw(f, b, req, withTag) };
    }
    case 'text': {
      const { tree, errors } = parseDocument(req.source.text);
      if (!tree || errors.length || tree.type !== 'object')
        throw new EditError('Clipboard text is not a JSON object');
      return { kind: 'value', value: finalize(valueOf(tree) as Record<string, unknown>) };
    }
  }
}

function jsonValue(text: string): unknown {
  const { tree } = parseDocument(text);
  return tree ? valueOf(tree) : undefined;
}

/**
 * Copy a block's source text verbatim (comments included) and rewrite its meta
 * fields in place: name, persistentID, and the datablock tag (added, kept or removed).
 */
function retagRaw(
  file: SourceFile,
  block: Block,
  req: CreateBlockRequest,
  withTag: boolean,
): string {
  const node = block.node;
  let text = file.text.slice(node.offset, node.offset + node.length);
  const base = node.offset;
  const edits: { offset: number; length: number; content: string }[] = [];
  const props = properties(node);
  const find = (k: string) => props.find((p) => p.key.toLowerCase() === k.toLowerCase());
  const nameP = find('name');
  const idP = find('persistentID');
  const tagP = find('datablock');
  if (nameP)
    edits.push({
      offset: nameP.valueNode.offset - base,
      length: nameP.valueNode.length,
      content: JSON.stringify(req.name),
    });
  if (idP)
    edits.push({
      offset: idP.valueNode.offset - base,
      length: idP.valueNode.length,
      content: String(req.persistentID),
    });
  if (tagP) {
    if (withTag)
      edits.push({
        offset: tagP.valueNode.offset - base,
        length: tagP.valueNode.length,
        content: JSON.stringify(req.type),
      });
    else {
      // Remove `"datablock": "...",` including its trailing comma or the preceding one.
      const start = tagP.propertyNode.offset - base;
      let end = start + tagP.propertyNode.length;
      const after = text.slice(end).match(/^\s*,/);
      if (after) end += after[0].length;
      let lineStart = start;
      while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
      const onlyWs = text.slice(lineStart, start).trim() === '';
      const nl = text.indexOf('\n', end);
      const restOfLine = nl >= 0 ? text.slice(end, nl) : text.slice(end);
      if (onlyWs && restOfLine.trim() === '' && nl >= 0) {
        edits.push({ offset: lineStart, length: nl + 1 - lineStart, content: '' });
      } else edits.push({ offset: start, length: end - start, content: '' });
      if (!after) {
        // It was the last property: drop the comma after the previous one.
        const before = text.slice(0, start).match(/,\s*$/);
        if (before) edits.push({ offset: start - before[0].length, length: 1, content: '' });
      }
    }
  }
  // Apply from the end so offsets stay valid.
  edits.sort((a, b) => b.offset - a.offset);
  for (const e of edits)
    text = text.slice(0, e.offset) + e.content + text.slice(e.offset + e.length);
  if (!nameP || !idP || (withTag && !tagP)) {
    // Missing meta: fall back to value-based construction on top of the raw copy.
    const value = jsonValue(text) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (!['name', 'internalenabled', 'datablock', 'persistentid'].includes(k.toLowerCase()))
        out[k] = v;
    out['name'] = req.name;
    out['internalEnabled'] =
      typeof value['internalEnabled'] === 'boolean' ? value['internalEnabled'] : true;
    if (withTag) out['datablock'] = req.type;
    out['persistentID'] = req.persistentID;
    return formatValueBlock(out, file.style.indentUnit ?? '  ', '');
  }
  return text;
}

export interface CreateBlockPlan {
  target: EditTarget;
  ops: EditOp[];
  /** Path the new block will have once inserted. */
  expectedPath: JsonPath;
}

export function createBlockOps(project: Project, req: CreateBlockRequest): CreateBlockPlan {
  const file = project.files.get(req.targetFile);
  if (!file) throw new EditError(`Unknown file ${req.targetFile}`);
  if (!file.tree || file.parseErrors.length)
    throw new EditError(`${req.targetFile} has parse errors`);
  if (file.shape === 'partial-single')
    throw new EditError(
      'A single-block file cannot hold a second block; pick a list file or create a new one',
    );
  if (file.shape !== 'wrapper' && file.shape !== 'partial-array')
    throw new EditError(`${req.targetFile} cannot hold datablocks`);
  if (file.shape === 'wrapper' && file.wrapperType !== req.type)
    throw new EditError(`${req.targetFile} only holds ${file.wrapperType} blocks`);
  if (existsInProject(project.index, req.type, req.persistentID))
    throw new EditError(`${req.type} #${req.persistentID} already exists in the project`);

  const mat = materializeBlock(project, req, file.shape);
  const containerPath: JsonPath = file.shape === 'wrapper' ? ['Blocks'] : [];
  const container =
    file.shape === 'wrapper' ? propertyNode(file.tree, 'Blocks', false)?.valueNode : file.tree;
  const count = container?.children?.length ?? 0;
  const ops: EditOp[] = [
    mat.kind === 'raw'
      ? { op: 'insertRaw', path: containerPath, text: mat.text }
      : { op: 'insert', path: containerPath, value: mat.value },
  ];
  if (file.shape === 'wrapper') {
    const last = propertyNode(file.tree, 'LastPersistentID', false);
    const cur = last && last.valueNode.type === 'number' ? (last.valueNode.value as number) : -1;
    if (last && req.persistentID > cur)
      ops.push({ op: 'set', path: ['LastPersistentID'], value: req.persistentID });
  }
  return { target: { file: req.targetFile }, ops, expectedPath: [...containerPath, count] };
}

export function deleteBlockOps(
  project: Project,
  blockId: BlockId,
): { target: EditTarget; ops: EditOp[] } {
  const b = project.index.byId.get(blockId);
  if (!b) throw new EditError('Block no longer exists');
  if (b.plugin) throw new EditError('Plugin-defined entries are edited in their own file');
  const f = project.files.get(b.file);
  if (!f) throw new EditError('File no longer exists');
  if (f.shape === 'partial-single' || b.path.length === 0)
    throw new EditError('This file holds only this block; delete the file instead');
  return { target: { file: b.file }, ops: [{ op: 'remove', path: b.path }] };
}
