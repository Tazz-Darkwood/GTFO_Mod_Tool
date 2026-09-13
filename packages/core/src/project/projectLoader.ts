import type {
  Block,
  Diagnostic,
  FileId,
  Project,
  SchemaBundle,
  SourceFile,
  VanillaIndex,
} from '../model/types.js';
import { parseDocument } from '../text/jsoncDoc.js';
import { detectStyle, splitBom } from '../text/textStyle.js';
import { walkFiles, type FileSystem } from '../io/fileSystem.js';
import { emptyIndex, indexAddBlocks, indexRemoveFile } from '../index/blockIndex.js';
import { computeResolutions } from '../index/typeResolution.js';
import { extractBlocks } from './blockExtractor.js';
import { detectShape } from './fileShape.js';
import { wrapperFileType } from './typeNames.js';

export interface LoadOptions {
  /** Path separator of the host platform ('\\' on Windows). */
  sep?: string;
}

const JSON_EXT = /\.jsonc?$/i;

/** Which files under the rundown root are part of the project. */
export function isProjectFile(fileId: FileId): boolean {
  if (!JSON_EXT.test(fileId)) return false;
  if (fileId.includes('/')) {
    return /^(PartialData|Custom)\//i.test(fileId);
  }
  return /^GameData_.*\.json$/i.test(fileId);
}

export function toFileId(rootPath: string, absPath: string, sep: string): FileId {
  let rel = absPath.startsWith(rootPath) ? absPath.slice(rootPath.length) : absPath;
  if (rel.startsWith(sep)) rel = rel.slice(sep.length);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/** Parse text into a SourceFile (pure; no I/O). */
export function buildSourceFile(
  id: FileId,
  absPath: string,
  raw: string,
  stat: { mtimeMs: number; size: number },
): SourceFile {
  const { text: unbommed, bom } = splitBom(raw);
  const style = detectStyle(unbommed, bom);
  // Internal text is always LF; the file's EOL is restored on write.
  const text = unbommed.replace(/\r\n/g, '\n');
  const { tree, errors } = parseDocument(text);
  const shape = detectShape(id, tree);
  const base = id.slice(id.lastIndexOf('/') + 1);
  const wrapperType = shape === 'wrapper' ? wrapperFileType(base) : undefined;
  return {
    id,
    absPath,
    text,
    savedText: text,
    loadedMtimeMs: stat.mtimeMs,
    loadedSize: stat.size,
    style,
    tree,
    parseErrors: errors,
    shape,
    wrapperType,
    blocks: [],
    dirty: false,
    externallyModified: false,
  };
}

export function blocksFor(file: SourceFile): Block[] {
  const blocks = extractBlocks({
    id: file.id,
    tree: file.tree,
    shape: file.shape,
    wrapperType: file.wrapperType,
  });
  file.blocks = blocks.map((b) => b.id);
  return blocks;
}

export async function readSourceFile(
  fs: FileSystem,
  rootPath: string,
  absPath: string,
  sep: string,
): Promise<SourceFile> {
  const [raw, st] = await Promise.all([fs.readFile(absPath), fs.stat(absPath)]);
  return buildSourceFile(toFileId(rootPath, absPath, sep), absPath, raw, {
    mtimeMs: st?.mtimeMs ?? 0,
    size: st?.size ?? raw.length,
  });
}

/**
 * Load a rundown folder into a Project. Validation is NOT run here so callers
 * (CLI, app) can decide when; use `validateProject` from validate/.
 */
export async function loadProject(
  rootPath: string,
  fs: FileSystem,
  schema: SchemaBundle,
  vanilla: VanillaIndex,
  opts: LoadOptions = {},
): Promise<Project> {
  const sep = opts.sep ?? (rootPath.includes('\\') ? '\\' : '/');
  const all = await walkFiles(fs, rootPath, sep);
  const candidates = all.filter((p) => isProjectFile(toFileId(rootPath, p, sep)));

  const files = new Map<FileId, SourceFile>();
  const index = emptyIndex();
  const loaded = await Promise.all(candidates.map((p) => readSourceFile(fs, rootPath, p, sep)));
  for (const f of loaded) {
    files.set(f.id, f);
    indexAddBlocks(index, f.id, blocksFor(f));
  }
  const resolutions = computeResolutions(files.values(), vanilla, schema);
  const diagnostics: Diagnostic[] = [];
  return { rootPath, files, index, resolutions, diagnostics, schema, vanilla };
}

/** Replace one file's text (after an edit or external change) and re-index it. */
export function replaceFileText(
  project: Project,
  fileId: FileId,
  newText: string,
  markSaved = false,
): SourceFile {
  const old = project.files.get(fileId);
  if (!old) throw new Error(`Unknown file ${fileId}`);
  const rebuilt = buildSourceFile(fileId, old.absPath, newText, {
    mtimeMs: old.loadedMtimeMs,
    size: old.loadedSize,
  });
  rebuilt.savedText = markSaved ? newText : old.savedText;
  rebuilt.dirty = rebuilt.text !== rebuilt.savedText;
  rebuilt.externallyModified = old.externallyModified;
  // Keep the original BOM/EOL style: the edited text is always LF internally.
  rebuilt.style = old.style;
  indexRemoveFile(project.index, fileId);
  project.files.set(fileId, rebuilt);
  indexAddBlocks(project.index, fileId, blocksFor(rebuilt));
  if (rebuilt.shape === 'wrapper' || old.shape === 'wrapper') {
    project.resolutions = computeResolutions(
      project.files.values(),
      project.vanilla,
      project.schema,
    );
  }
  return rebuilt;
}
