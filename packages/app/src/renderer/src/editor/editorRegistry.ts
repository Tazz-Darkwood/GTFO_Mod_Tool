/**
 * The mounted source editor registers itself here so the store can flush a
 * pending draft before any other mutation and route undo/redo to CodeMirror
 * while the user is typing in it.
 */
export interface SourceEditorHandle {
  fileId: string;
  /** Commit a pending, parseable draft now. Resolves when main has accepted it (or there was nothing to do). */
  flush(): Promise<void>;
  undo(): boolean;
  redo(): boolean;
  hasFocus(): boolean;
  pending(): boolean;
  parseErrors(): number;
  /** Fold every foldable region; with `keepRoot` the top-level object/array stays open so its keys remain visible. */
  foldAll(keepRoot: boolean): void;
  unfoldAll(): void;
  /** Test hook: replace the first occurrence of `find` as if the user typed it. Returns false when not found. */
  debugReplace(find: string, replace: string): boolean;
}

let current: SourceEditorHandle | null = null;

export function registerSourceEditor(h: SourceEditorHandle): () => void {
  current = h;
  return () => {
    if (current === h) current = null;
  };
}

export function sourceEditor(): SourceEditorHandle | null {
  return current;
}
