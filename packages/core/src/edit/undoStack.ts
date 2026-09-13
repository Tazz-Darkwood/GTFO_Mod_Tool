/** Per-file text snapshots for undo/redo. */
export class UndoStack {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private readonly cap = 50) {}

  push(before: string): void {
    this.past.push(before);
    if (this.past.length > this.cap) this.past.shift();
    this.future = [];
  }
  /** Returns the text to restore, recording `current` for redo. */
  undo(current: string): string | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    return prev;
  }
  redo(current: string): string | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
