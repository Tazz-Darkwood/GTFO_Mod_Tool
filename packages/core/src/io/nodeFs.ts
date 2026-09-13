import { promises as fsp } from 'node:fs';
import type { FileStat, FileSystem } from './fileSystem.js';

/** Node.js-backed FileSystem. */
export class NodeFileSystem implements FileSystem {
  async readFile(p: string): Promise<string> {
    return fsp.readFile(p, 'utf8');
  }
  async writeFile(p: string, text: string): Promise<void> {
    const fh = await fsp.open(p, 'w');
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
  }
  async stat(p: string): Promise<FileStat | undefined> {
    try {
      const s = await fsp.stat(p);
      return { mtimeMs: s.mtimeMs, size: s.size, isDirectory: s.isDirectory() };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async rename(from: string, to: string): Promise<void> {
    await fsp.rename(from, to);
  }
  async unlink(p: string): Promise<void> {
    await fsp.unlink(p);
  }
  async readdir(p: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  }
  async mkdirp(p: string): Promise<void> {
    await fsp.mkdir(p, { recursive: true });
  }
}
