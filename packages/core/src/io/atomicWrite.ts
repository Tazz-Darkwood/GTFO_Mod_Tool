import type { TextStyle } from '../model/types.js';
import { applyStyleForWrite } from '../text/textStyle.js';
import type { FileStat, FileSystem } from './fileSystem.js';

let counter = 0;

/**
 * Write `text` (LF, no BOM) to `absPath` via a temp file in the same directory
 * and an atomic rename, restoring the file's BOM/EOL style. MTFO's live-edit
 * watcher therefore never sees a half-written file.
 */
export async function writeAtomic(
  fs: FileSystem,
  absPath: string,
  text: string,
  style: TextStyle,
): Promise<FileStat> {
  const tmp = `${absPath}.gtfo-tmp-${process.pid}-${++counter}`;
  const payload = applyStyleForWrite(text, style);
  await fs.writeFile(tmp, payload);
  try {
    await fs.rename(tmp, absPath);
  } catch (e) {
    // Some Windows setups refuse to replace a file that another process holds open for reading.
    try {
      await fs.unlink(absPath);
      await fs.rename(tmp, absPath);
    } catch {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }
  const st = await fs.stat(absPath);
  return st ?? { mtimeMs: Date.now(), size: payload.length, isDirectory: false };
}
