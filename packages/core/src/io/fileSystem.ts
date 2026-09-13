/**
 * Minimal file-system abstraction so core logic is testable with an in-memory
 * implementation and the Electron main process can plug in Node's fs.
 * Paths are absolute, platform-native strings.
 */
export interface FileStat {
  mtimeMs: number;
  size: number;
  isDirectory: boolean;
}

export interface FileSystem {
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, text: string): Promise<void>;
  stat(absPath: string): Promise<FileStat | undefined>;
  rename(from: string, to: string): Promise<void>;
  unlink(absPath: string): Promise<void>;
  /** Names (not paths) of entries directly inside a directory. */
  readdir(absPath: string): Promise<{ name: string; isDirectory: boolean }[]>;
  /** Create a directory and any missing parents (no-op if it exists). */
  mkdirp(absPath: string): Promise<void>;
}

/** Recursively list files under `root`; returns absolute paths. */
export async function walkFiles(fs: FileSystem, root: string, sep: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: { name: string; isDirectory: boolean }[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = dir.endsWith(sep) ? dir + e.name : dir + sep + e.name;
      if (e.isDirectory) stack.push(p);
      else out.push(p);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests, dry runs)
// ---------------------------------------------------------------------------

export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, { text: string; mtimeMs: number }>();
  private clock = 1_000;
  constructor(
    initial: Record<string, string> = {},
    private readonly sep = '/',
  ) {
    for (const [p, t] of Object.entries(initial))
      this.files.set(this.norm(p), { text: t, mtimeMs: this.clock++ });
  }
  private norm(p: string): string {
    return p.replace(/[\\/]+/g, this.sep);
  }
  async readFile(p: string): Promise<string> {
    const f = this.files.get(this.norm(p));
    if (!f) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return f.text;
  }
  async writeFile(p: string, text: string): Promise<void> {
    this.files.set(this.norm(p), { text, mtimeMs: this.clock++ });
  }
  async stat(p: string): Promise<FileStat | undefined> {
    const n = this.norm(p);
    const f = this.files.get(n);
    if (f) return { mtimeMs: f.mtimeMs, size: f.text.length, isDirectory: false };
    const prefix = n.endsWith(this.sep) ? n : n + this.sep;
    for (const k of this.files.keys())
      if (k.startsWith(prefix)) return { mtimeMs: 0, size: 0, isDirectory: true };
    return undefined;
  }
  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(this.norm(from));
    if (!f) throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
    this.files.delete(this.norm(from));
    this.files.set(this.norm(to), { text: f.text, mtimeMs: this.clock++ });
  }
  async unlink(p: string): Promise<void> {
    this.files.delete(this.norm(p));
  }
  async readdir(p: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const n = this.norm(p);
    const prefix = n.endsWith(this.sep) ? n : n + this.sep;
    const seen = new Map<string, boolean>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const i = rest.indexOf(this.sep);
      if (i < 0) seen.set(rest, false);
      else seen.set(rest.slice(0, i), true);
    }
    return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
  }
  async mkdirp(): Promise<void> {
    // Directories are implicit in the in-memory map.
  }
  /** Test helper: bump mtime without changing content. */
  touch(p: string): void {
    const f = this.files.get(this.norm(p));
    if (f) f.mtimeMs = this.clock++;
  }
  has(p: string): boolean {
    return this.files.has(this.norm(p));
  }
  list(): string[] {
    return [...this.files.keys()].sort();
  }
}
