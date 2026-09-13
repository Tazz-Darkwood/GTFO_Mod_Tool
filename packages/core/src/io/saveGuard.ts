import type { FileId, Project, SourceFile } from '../model/types.js';
import { replaceFileText } from '../project/projectLoader.js';
import { splitBom } from '../text/textStyle.js';
import { writeAtomic } from './atomicWrite.js';
import type { FileSystem } from './fileSystem.js';

export type ExternalState = 'clean' | 'changed' | 'missing';

/**
 * Has the file on disk diverged from what we loaded/saved? A changed mtime alone
 * is not enough (some tools touch files); the content must actually differ.
 */
export async function checkExternalChange(
  fs: FileSystem,
  file: SourceFile,
): Promise<ExternalState> {
  const st = await fs.stat(file.absPath);
  if (!st) return 'missing';
  if (st.mtimeMs === file.loadedMtimeMs && st.size === file.loadedSize) return 'clean';
  const onDisk = splitBom(await fs.readFile(file.absPath)).text.replace(/\r\n/g, '\n');
  return onDisk === file.savedText ? 'clean' : 'changed';
}

export type SaveResult =
  { ok: true; file: SourceFile } | { ok: false; reason: 'conflict' | 'missing' };

/** Save one file. Refuses (conflict) when the disk copy changed since load unless `force`. */
export async function saveFile(
  fs: FileSystem,
  project: Project,
  fileId: FileId,
  opts: { force?: boolean } = {},
): Promise<SaveResult> {
  const file = project.files.get(fileId);
  if (!file) throw new Error(`Unknown file ${fileId}`);
  if (!opts.force) {
    const state = await checkExternalChange(fs, file);
    if (state === 'changed') return { ok: false, reason: 'conflict' };
  }
  const st = await writeAtomic(fs, file.absPath, file.text, file.style);
  file.savedText = file.text;
  file.dirty = false;
  file.externallyModified = false;
  file.loadedMtimeMs = st.mtimeMs;
  file.loadedSize = st.size;
  return { ok: true, file };
}

/** Re-read a file from disk, discarding unsaved edits. */
export async function reloadFromDisk(
  fs: FileSystem,
  project: Project,
  fileId: FileId,
): Promise<SourceFile> {
  const file = project.files.get(fileId);
  if (!file) throw new Error(`Unknown file ${fileId}`);
  const [raw, st] = await Promise.all([fs.readFile(file.absPath), fs.stat(file.absPath)]);
  const { text } = splitBom(raw);
  const rebuilt = replaceFileText(project, fileId, text.replace(/\r\n/g, '\n'), true);
  rebuilt.loadedMtimeMs = st?.mtimeMs ?? 0;
  rebuilt.loadedSize = st?.size ?? raw.length;
  rebuilt.externallyModified = false;
  return rebuilt;
}
