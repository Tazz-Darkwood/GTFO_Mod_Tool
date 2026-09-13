import { createContext, useContext } from 'react';
import type { BlockDetailDto, Diagnostic, EditOp, SchemaClosureDto } from '@shared/ipc';

export interface EditorCtx {
  block: BlockDetailDto;
  closure: SchemaClosureDto;
  /** Diagnostics for this block, keyed by block-relative JSON pointer. */
  problems: Map<string, Diagnostic[]>;
  /** Block-relative pointer to scroll to and flash (from a problem click). */
  focusPointer: string | null;
  apply(op: EditOp): Promise<boolean>;
  /** Several ops as one undo step (later ops see earlier ones). */
  applyMany(ops: EditOp[]): Promise<boolean>;
  goToBlock(blockId: string): void;
  /**
   * Source text of the object/array at a block-relative pointer, comments and
   * formatting included; undefined for scalars or when the text is unavailable.
   */
  rawSlice(pointer: string): string | undefined;
}

export const EditorContext = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('EditorContext missing');
  return ctx;
}
