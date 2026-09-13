/**
 * Creating and deleting project files. These touch disk immediately (they are
 * explicit, confirmed user actions) and keep the in-memory project in sync.
 */
import type { FileId, Project, SourceFile, TextStyle, TypeName } from '../model/types.js';
import { indexAddBlocks, indexRemoveFile } from '../index/blockIndex.js';
import { computeResolutions } from '../index/typeResolution.js';
import { writeAtomic } from '../io/atomicWrite.js';
import type { FileSystem } from '../io/fileSystem.js';
import { EditError } from '../edit/textEdits.js';
import { blocksFor, isProjectFile, readSourceFile } from './projectLoader.js';
import { wrapperFileType } from './typeNames.js';

export type NewFileKind = 'partial-array' | 'wrapper';

export function newFileTemplate(kind: NewFileKind, style: TextStyle): string {
  const unit = style.indentUnit ?? '  ';
  return kind === 'wrapper'
    ? `{\n${unit}"Headers": [],\n${unit}"Blocks": [],\n${unit}"LastPersistentID": 0\n}\n`
    : '[]\n';
}

export function addFileToProject(project: Project, file: SourceFile): void {
  project.files.set(file.id, file);
  indexAddBlocks(project.index, file.id, blocksFor(file));
  if (file.shape === 'wrapper')
    project.resolutions = computeResolutions(
      project.files.values(),
      project.vanilla,
      project.schema,
    );
}

export function removeFileFromProject(project: Project, fileId: FileId): SourceFile | undefined {
  const f = project.files.get(fileId);
  if (!f) return undefined;
  indexRemoveFile(project.index, fileId);
  project.files.delete(fileId);
  if (f.shape === 'wrapper')
    project.resolutions = computeResolutions(
      project.files.values(),
      project.vanilla,
      project.schema,
    );
  return f;
}

export interface CreateFileOptions {
  sep: string;
  /** Indent style for the template; defaults to two spaces. */
  style?: TextStyle;
  /** For `wrapper`: the datablock type; the file name is derived from it. */
  type?: TypeName;
}

/** Validate a proposed project-relative path for a new file. Returns an error message or undefined. */
export function validateNewFileId(
  project: Project,
  fileId: FileId,
  kind: NewFileKind,
): string | undefined {
  if (!fileId || /^[\\/]|\.\.|[<>:"|?*]/.test(fileId)) return 'Invalid path';
  if (!/\.jsonc?$/i.test(fileId)) return 'The file name must end in .json';
  if (project.files.has(fileId)) return 'A file with that path already exists';
  if (!isProjectFile(fileId))
    return 'Datablock files must be GameData_*.json at the root or live under PartialData/ or Custom/';
  if (kind === 'wrapper') {
    if (fileId.includes('/')) return 'Wrapper files live in the rundown root';
    const t = wrapperFileType(fileId);
    if (!t) return 'Wrapper files are named GameData_<Type>DataBlock_bin.json';
    if ([...project.files.values()].some((f) => f.shape === 'wrapper' && f.wrapperType === t))
      return `A wrapper file for ${t} already exists`;
  } else if (!/^PartialData\//i.test(fileId)) return 'New block list files go under PartialData/';
  return undefined;
}

export function wrapperFileIdFor(type: TypeName): FileId {
  return `GameData_${type}DataBlock_bin.json`;
}

export async function createProjectFile(
  fs: FileSystem,
  project: Project,
  fileId: FileId,
  kind: NewFileKind,
  opts: CreateFileOptions,
): Promise<SourceFile> {
  const err = validateNewFileId(project, fileId, kind);
  if (err) throw new EditError(err);
  const style: TextStyle = opts.style ?? { eol: '\n', bom: false, indentUnit: '  ' };
  const absPath =
    project.rootPath + opts.sep + (opts.sep === '/' ? fileId : fileId.split('/').join(opts.sep));
  if (await fs.stat(absPath)) throw new EditError('A file with that path already exists on disk');
  const dir = absPath.slice(0, absPath.lastIndexOf(opts.sep));
  await fs.mkdirp(dir);
  await writeAtomic(fs, absPath, newFileTemplate(kind, style), style);
  const file = await readSourceFile(fs, project.rootPath, absPath, opts.sep);
  addFileToProject(project, file);
  return file;
}

export async function deleteProjectFile(
  fs: FileSystem,
  project: Project,
  fileId: FileId,
): Promise<void> {
  const f = project.files.get(fileId);
  if (!f) throw new EditError(`Unknown file ${fileId}`);
  await fs.unlink(f.absPath);
  removeFileFromProject(project, fileId);
}
