/**
 * Core data model for GTFO Datablock Studio.
 *
 * Vocabulary
 * - datablock TYPE: e.g. "SurvivalWaveSettings". Canonical short name (no "DataBlock" suffix).
 * - BLOCK: one entry of a type, identified by (type, persistentID).
 * - SourceFile SHAPE: how a JSON file packages blocks (MTFO wrapper, PartialData array, ...).
 */
import type { Node as JsoncNode, ParseError } from 'jsonc-parser';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Canonical datablock type name, e.g. "LevelLayout". */
export type TypeName = string;
/** Project-relative POSIX path, e.g. "PartialData/General/FogSettings.json". */
export type FileId = string;
/** `${fileId}#${jsonPointer}` where the pointer addresses the block's object node. */
export type BlockId = string;
/** Path of property names / array indices from a file's root value. */
export type JsonPath = (string | number)[];

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

export type FileShape =
  /** `{ Headers, Blocks: [...], LastPersistentID }` — type comes from the file name. */
  | 'wrapper'
  /** PartialData: top-level array of blocks, each with a `datablock` field. */
  | 'partial-array'
  /** PartialData: a single block object at the root. */
  | 'partial-single'
  /** Plugin-specific config under `Custom/` (EOS, LGTuner, ...). Read-only in v1. */
  | 'plugin'
  /** PartialData bookkeeping (`_config.json`, `_persistentID.json`). */
  | 'meta'
  | 'unknown';

export interface TextStyle {
  eol: '\n' | '\r\n';
  bom: boolean;
  /** Dominant indent unit ("  ", "    ", "\t") or null when undetectable. */
  indentUnit: string | null;
}

export interface SourceFile {
  id: FileId;
  absPath: string;
  /** Current text, including unsaved edits. */
  text: string;
  /** Text as last read from or written to disk. */
  savedText: string;
  loadedMtimeMs: number;
  loadedSize: number;
  style: TextStyle;
  /** Undefined when the file could not be parsed at all. */
  tree: JsoncNode | undefined;
  parseErrors: ParseError[];
  shape: FileShape;
  /** For `wrapper` files: type parsed from `GameData_<T>DataBlock_bin.json`. */
  wrapperType?: TypeName;
  blocks: BlockId[];
  dirty: boolean;
  externallyModified: boolean;
}

// ---------------------------------------------------------------------------
// Blocks and index
// ---------------------------------------------------------------------------

export interface Block {
  id: BlockId;
  file: FileId;
  /** Undefined when the block has no resolvable type (missing/unknown `datablock`). */
  type: TypeName | undefined;
  /** Undefined when missing or non-numeric (string GUIDs are unsupported in v1). */
  persistentID: number | undefined;
  name: string | undefined;
  /** Path from the file root to this block's object node. */
  path: JsonPath;
  node: JsoncNode;
  /** Raw `datablock` string before canonicalisation, when present. */
  declaredTypeRaw?: string;
  /**
   * Set when the block was contributed by a plugin config file (e.g.
   * ExtraChainedPuzzleCustomization's PuzzleTypes.json defines ChainedPuzzleType
   * IDs). Such blocks take part in reference resolution and duplicate checks but
   * are not validated against the datablock schema.
   */
  plugin?: string;
}

export interface BlockIndex {
  /** type -> persistentID -> blocks (length > 1 means duplicate). */
  byType: Map<TypeName, Map<number, Block[]>>;
  byId: Map<BlockId, Block>;
  /** Blocks whose type could not be determined. */
  untyped: Block[];
  byFile: Map<FileId, Block[]>;
}

/**
 * How the game resolves a type at runtime for this project.
 * - `wrapper-file`: a `GameData_<T>DataBlock_bin.json` exists -> it REPLACES vanilla entirely.
 * - `vanilla`: no wrapper file -> the game's own blocks are the baseline; partials add on top.
 * - `none`: no wrapper and no vanilla data known for this type.
 */
export interface TypeResolution {
  type: TypeName;
  baseline: 'vanilla' | 'wrapper-file' | 'none';
  wrapperFile?: FileId;
}

export interface RefLookupResult {
  source: 'project' | 'vanilla';
  name: string;
  block?: Block;
}

// ---------------------------------------------------------------------------
// Schema (compiled from the community TypeList)
// ---------------------------------------------------------------------------

export type ScalarKind = 'UInt32' | 'Int32' | 'Single' | 'Boolean' | 'String';
export type BuiltinKind = 'Vector2' | 'Vector3' | 'Color';

export type FieldSchema =
  | { kind: 'scalar'; name: string; scalar: ScalarKind; display?: 'soundId' }
  | { kind: 'enum'; name: string; enumName: string }
  /** UInt32 that references another block type's persistentID; 0 means "none". */
  | { kind: 'ref'; name: string; refType: TypeName }
  /** Serialized as a UInt32 Text-block ID, a literal string, or (rarely) an object. */
  | { kind: 'localizedText'; name: string }
  | { kind: 'object'; name: string; className: string }
  | { kind: 'list'; name: string; item: FieldSchema }
  | { kind: 'builtin'; name: string; builtin: BuiltinKind }
  /** Declared type we do not understand (Dictionary<>, il2cpp oddities). Rendered raw. */
  | { kind: 'unknown'; name: string; declared: string };

export interface ClassSchema {
  name: string;
  fields: FieldSchema[];
  /** lower-cased field name -> index into `fields`, for case-insensitive lookup. */
  fieldsByLowerName: Record<string, number>;
}

export interface EnumMember {
  name: string;
  value: number;
}

export interface EnumSchema {
  name: string;
  members: EnumMember[];
  isFlags: boolean;
  /** The game treats the value as a plain integer; numbers beyond the named members are normal (e.g. zone indices). */
  open?: boolean;
}

export interface SchemaBundle {
  meta: { repo: string; commit: string; builtAt: string };
  /** Datablock types (root classes), keyed by canonical type name. */
  blockTypes: Record<TypeName, ClassSchema>;
  /** Nested classes hoisted out of the TypeList, keyed by class name. */
  classes: Record<string, ClassSchema>;
  enums: Record<string, EnumSchema>;
}

// ---------------------------------------------------------------------------
// Vanilla baseline
// ---------------------------------------------------------------------------

export interface VanillaIndex {
  /** type -> persistentID -> display name. Covers every type. */
  types: Record<TypeName, Record<string, string>>;
  /** Types for which full blocks are available on demand (`vanilla-blocks/<T>.json`). */
  fullBlockTypes: TypeName[];
  /**
   * Full vanilla blocks by type and persistentID, when the host has loaded them.
   * Used to suppress findings on values a wrapper block inherited unchanged from the game.
   */
  blocks?: Record<TypeName, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export interface TextRange {
  offset: number;
  length: number;
  line: number; // 1-based
  col: number; // 1-based
}

export interface RelatedInfo {
  file: FileId;
  range?: TextRange;
  message: string;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  file: FileId;
  range?: TextRange;
  jsonPath?: JsonPath;
  blockId?: BlockId;
  related?: RelatedInfo[];
  fix?: DiagnosticFix;
}

export interface DiagnosticFix {
  title: string;
  edits: { file: FileId; blockId?: BlockId; op: EditOp }[];
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** Paths in EditOps are relative to the block root (not the file root). */
export type EditOp =
  | { op: 'set'; path: JsonPath; value: unknown }
  | { op: 'insert'; path: JsonPath; index?: number; value: unknown }
  | { op: 'remove'; path: JsonPath }
  | { op: 'setProperty'; path: JsonPath; key: string; value: unknown }
  /** Insert a JSONC snippet (comments kept, re-indented) as a new list entry. */
  | { op: 'insertRaw'; path: JsonPath; index?: number; text: string }
  /** Replace the value at `path` with a JSONC snippet. */
  | { op: 'setRaw'; path: JsonPath; text: string };

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  rootPath: string;
  files: Map<FileId, SourceFile>;
  index: BlockIndex;
  resolutions: Map<TypeName, TypeResolution>;
  diagnostics: Diagnostic[];
  schema: SchemaBundle;
  vanilla: VanillaIndex;
}
