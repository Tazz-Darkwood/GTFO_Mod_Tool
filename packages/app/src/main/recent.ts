import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX = 8;

function file(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

export async function loadRecent(): Promise<string[]> {
  try {
    const list = JSON.parse(await fsp.readFile(file(), 'utf8')) as string[];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function pushRecent(root: string): Promise<void> {
  const list = [root, ...(await loadRecent()).filter((x) => x !== root)].slice(0, MAX);
  await fsp.mkdir(path.dirname(file()), { recursive: true });
  await fsp.writeFile(file(), JSON.stringify(list, null, 2));
}
