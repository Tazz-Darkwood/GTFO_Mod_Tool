/**
 * The typed contract between the Electron main process and the renderer.
 * Only plain, structured-clone-safe data crosses this boundary (no Maps, no parser nodes).
 */
import type {
  ClassSchema,
  Diagnostic,
  DiagnosticFix,
  DimensionNode,
  EditOp,
  EnumSchema,
  ExpeditionNode,
  FieldSchema,
  FileShape,
  JsonPath,
  LayerNode,
  LayoutDetail,
  LinkNode,
  ObjectiveDetail,
  RundownNode,
  RundownTree,
  TextRange,
  Tier,
  TierNode,
  TypeName,
  WaveNode,
  ZoneNode,
} from '@gtfo/core';

export type {
  ClassSchema,
  Diagnostic,
  DiagnosticFix,
  DimensionNode,
  EditOp,
  EnumSchema,
  ExpeditionNode,
  FieldSchema,
  FileShape,
  JsonPath,
  LayerNode,
  LayoutDetail,
  LinkNode,
  ObjectiveDetail,
  RundownNode,
  RundownTree,
  TextRange,
  Tier,
  TierNode,
  TypeName,
  WaveNode,
  ZoneNode,
};

export interface TypeSummaryDto {
  type: TypeName;
  /** Blocks of this type defined in the project (not vanilla). */
  count: number;
  baseline: 'vanilla' | 'wrapper-file' | 'none';
  wrapperFile?: string;
  problems: number;
  /** Number of vanilla blocks known for this type. */
  vanillaCount: number;
  /** Full vanilla blocks are available (so "copy of vanilla" is possible). */
  hasFullVanilla: boolean;
}

export interface CountsDto {
  error: number;
  warning: number;
  info: number;
}

export interface ProjectSummaryDto {
  root: string;
  fileCount: number;
  blockCount: number;
  shapes: Record<string, number>;
  types: TypeSummaryDto[];
  diagnostics: CountsDto;
  dirtyFiles: string[];
  externallyModified: string[];
  schemaCommit: string;
}

export interface FileDto {
  id: string;
  shape: FileShape;
  wrapperType?: TypeName;
  dirty: boolean;
  externallyModified: boolean;
  parseErrors: number;
  blockCount: number;
  problems: number;
  /** Distinct block types held by the file. */
  types: TypeName[];
  /** New blocks may be inserted here (wrapper or partial-array without parse errors). */
  canHoldBlocks: boolean;
  /** Size of the text in characters. */
  size: number;
}

export interface BlockSummaryDto {
  blockId: string;
  type?: TypeName;
  persistentID?: number;
  name?: string;
  file: string;
  line: number;
  problems: number;
  plugin?: string;
}

export interface BlockDetailDto extends BlockSummaryDto {
  path: JsonPath;
  range: TextRange;
  /** Plain JSON value of the block (comments dropped). */
  value: unknown;
  /** For each JSON pointer inside the block whose token is a scalar: its source representation. */
  tokenStyles: Record<string, 'string' | 'int' | 'float' | 'bool' | 'null'>;
  /** Source ranges of object/array nodes inside the block, by pointer ("" = the block itself). */
  tokenRanges: Record<string, { offset: number; length: number }>;
  dirty: boolean;
  fileShape: FileShape;
}

export interface BlockPageDto {
  items: BlockSummaryDto[];
  total: number;
}

export interface RefCandidateDto {
  id: number;
  name: string;
  source: 'project' | 'vanilla';
  blockId?: string;
}

export interface ReferenceDto {
  blockId: string;
  file: string;
  type?: TypeName;
  persistentID?: number;
  name?: string;
  field: string;
  path: JsonPath;
  range: TextRange;
  via: 'ref' | 'localizedText';
}

export interface PluginMentionDto {
  file: string;
  line: number;
  col: number;
  snippet: string;
}

export interface ReferencesDto {
  refs: ReferenceDto[];
  mentions: PluginMentionDto[];
}

export interface EditTargetDto {
  file: string;
  blockId?: string;
}

export interface EditResultDto {
  ok: true;
  file: FileDto;
  block?: BlockDetailDto;
  summary: ProjectSummaryDto;
}
export interface ParseErrorDto {
  offset: number;
  length: number;
  line: number;
  col: number;
  message: string;
}
export interface EditFailureDto {
  ok: false;
  error: string;
  parseErrors?: ParseErrorDto[];
}

export type BlockSourceDto =
  | { kind: 'blank' }
  | { kind: 'vanilla'; id: number }
  | { kind: 'project'; blockId: string }
  | { kind: 'text'; text: string };

export interface CreateBlockRequestDto {
  type: TypeName;
  targetFile: string;
  persistentID: number;
  name: string;
  source: BlockSourceDto;
}

export type RundownOpDto =
  | {
      kind: 'addExpedition';
      rundownBlockId: string;
      tier: Tier;
      prefix: string;
      publicName: string;
    }
  | { kind: 'duplicateExpedition'; rundownBlockId: string; tier: Tier; index: number }
  | { kind: 'moveExpedition'; rundownBlockId: string; from: Tier; index: number; to: Tier }
  | { kind: 'deleteExpedition'; rundownBlockId: string; tier: Tier; index: number }
  | { kind: 'addZone'; layoutBlockId: string }
  | { kind: 'duplicateZone'; layoutBlockId: string; index: number }
  | { kind: 'deleteZone'; layoutBlockId: string; index: number };

export interface TargetFileDto {
  fileId: string;
  shape: FileShape;
  containsType: boolean;
  blockCount: number;
}

export type SaveResultDto =
  { ok: true } | { ok: false; reason: 'conflict' | 'missing' | 'error'; message?: string };

/** Request/response signatures for `ipcRenderer.invoke`. */
export interface IpcApi {
  'dialog:pickFolder': () => Promise<string | null>;
  'project:open': (root: string) => Promise<ProjectSummaryDto>;
  'project:close': () => Promise<void>;
  'project:summary': () => Promise<ProjectSummaryDto | null>;
  'project:refresh': () => Promise<ProjectSummaryDto>;
  'project:recent': () => Promise<string[]>;
  'project:nextId': (type: TypeName, targetFile?: string) => Promise<{ id: number; basis: string }>;
  'project:targetFiles': (type: TypeName) => Promise<TargetFileDto[]>;
  'files:list': () => Promise<FileDto[]>;
  'files:create': (req: {
    path: string;
    kind: 'partial-array' | 'wrapper';
  }) => Promise<{ ok: true; file: FileDto; summary: ProjectSummaryDto } | EditFailureDto>;
  'files:delete': (
    fileId: string,
  ) => Promise<{ ok: true; summary: ProjectSummaryDto } | EditFailureDto>;
  'files:references': (fileId: string) => Promise<ReferenceDto[]>;
  'file:getText': (fileId: string) => Promise<string>;
  'file:setText': (
    fileId: string,
    text: string,
    opts?: { undoGroup?: string },
  ) => Promise<EditResultDto | EditFailureDto>;
  'blocks:list': (q: {
    type?: TypeName;
    query?: string;
    limit?: number;
    offset?: number;
  }) => Promise<BlockPageDto>;
  'blocks:get': (blockId: string) => Promise<BlockDetailDto | null>;
  'blocks:locate': (q: {
    file: string;
    type?: TypeName;
    persistentID: number;
  }) => Promise<BlockSummaryDto | null>;
  'blocks:searchRefs': (q: {
    refType: TypeName;
    query: string;
    limit?: number;
    /** Restrict to one source (e.g. only vanilla for "copy of vanilla"). */
    source?: 'project' | 'vanilla';
  }) => Promise<RefCandidateDto[]>;
  'blocks:resolveRef': (q: { refType: TypeName; id: number }) => Promise<RefCandidateDto | null>;
  'blocks:references': (q: { type: TypeName; id: number }) => Promise<ReferencesDto>;
  'blocks:create': (
    req: CreateBlockRequestDto,
  ) => Promise<(EditResultDto & { blockId: string }) | EditFailureDto>;
  'blocks:delete': (blockId: string) => Promise<EditResultDto | EditFailureDto>;
  /** Rundown → tiers → expeditions → layers/zones navigator data; null when the project defines no Rundown block. */
  'rundown:tree': () => Promise<RundownTree | null>;
  /** Navigator mutations, each one undo step. */
  'rundown:op': (op: RundownOpDto) => Promise<EditResultDto | EditFailureDto>;
  'diagnostics:list': (fileId?: string) => Promise<Diagnostic[]>;
  'edit:apply': (target: EditTargetDto, op: EditOp) => Promise<EditResultDto | EditFailureDto>;
  'edit:applyMany': (
    target: EditTargetDto,
    ops: EditOp[],
  ) => Promise<EditResultDto | EditFailureDto>;
  'edit:applyFix': (fix: DiagnosticFix) => Promise<EditResultDto | EditFailureDto>;
  'edit:undo': (fileId: string) => Promise<EditResultDto | EditFailureDto | null>;
  'edit:redo': (fileId: string) => Promise<EditResultDto | EditFailureDto | null>;
  'file:save': (fileId: string, force?: boolean) => Promise<SaveResultDto>;
  'file:saveAll': () => Promise<{ saved: string[]; conflicts: string[] }>;
  'file:revert': (fileId: string) => Promise<void>;
  'file:openExternal': (fileId: string, line?: number) => Promise<void>;
  /** Open an allow-listed https URL in the system browser (project page, Ko-fi). */
  'app:openUrl': (url: string) => Promise<void>;
  'schema:type': (type: TypeName) => Promise<ClassSchema | null>;
  'schema:class': (className: string) => Promise<ClassSchema | null>;
  'schema:enum': (enumName: string) => Promise<EnumSchema | null>;
  'schema:types': () => Promise<TypeName[]>;
  /** Everything the form needs to render one block type: the root class plus all reachable classes and enums. */
  'schema:closure': (type: TypeName) => Promise<SchemaClosureDto | null>;
}

export interface SchemaClosureDto {
  root: ClassSchema;
  classes: Record<string, ClassSchema>;
  enums: Record<string, EnumSchema>;
}

export type IpcChannel = keyof IpcApi;

/** Events pushed from main to the renderer. */
export interface IpcEvents {
  'project:changed': ProjectSummaryDto;
  'file:externalChange': { fileId: string; wasDirty: boolean };
  'project:error': { message: string };
}

/** What the preload script exposes as `window.gtfo`. */
export interface GtfoBridge {
  invoke<K extends IpcChannel>(channel: K, ...args: Parameters<IpcApi[K]>): ReturnType<IpcApi[K]>;
  on<K extends keyof IpcEvents>(event: K, handler: (payload: IpcEvents[K]) => void): () => void;
}
