/**
 * Update check + one-click update for the portable build.
 *
 * A running portable exe cannot overwrite itself, so "update" downloads the
 * new portable exe next to the current one (electron-builder exposes that
 * folder as PORTABLE_EXECUTABLE_DIR), launches it and quits. The old file can
 * then be deleted by the user.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, shell } from 'electron';
import type { UpdateInfoDto } from '@shared/ipc';

const REPO = 'Tazz-Darkwood/GTFO_Mod_Tool';
const UA = { 'User-Agent': 'GTFO-Datablock-Studio', Accept: 'application/vnd.github+json' };

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export async function checkForUpdate(current = app.getVersion()): Promise<UpdateInfoDto | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: UA,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    assets?: { name: string; browser_download_url: string; size: number }[];
  };
  const latest = (j.tag_name ?? '').replace(/^v/, '');
  if (!latest || compareVersions(latest, current) <= 0) return null;
  const asset = j.assets?.find((a) => /portable\.exe$/i.test(a.name));
  return {
    current,
    latest,
    url: j.html_url ?? `https://github.com/${REPO}/releases`,
    assetName: asset?.name,
    assetUrl: asset?.browser_download_url,
    assetSize: asset?.size,
    notes: (j.body ?? '').slice(0, 4000),
    canInstall: app.isPackaged && !!asset,
  };
}

/** Folder the user launched the portable exe from (or the exe's folder when not portable). */
function installDir(): string {
  return process.env['PORTABLE_EXECUTABLE_DIR'] ?? path.dirname(process.execPath);
}

/**
 * Download the new exe next to the current one, launch it, and quit this
 * instance. Progress is reported as bytes received.
 */
export async function downloadAndLaunch(
  info: UpdateInfoDto,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  if (!info.canInstall || !info.assetUrl || !info.assetName) {
    await shell.openExternal(info.url);
    return info.url;
  }
  const dest = path.join(installDir(), info.assetName);
  const tmp = `${dest}.part`;
  const res = await fetch(info.assetUrl, {
    headers: { 'User-Agent': UA['User-Agent'] },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? info.assetSize ?? 0);
  let received = 0;
  const counter = new TransformStreamCounter((n) => {
    received += n;
    onProgress(received, total);
  });
  await pipeline(Readable.fromWeb(res.body as never).pipe(counter), createWriteStream(tmp));
  await fsp.rename(tmp, dest);
  const child = spawn(dest, [], { detached: true, stdio: 'ignore', cwd: installDir() });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return dest;
}

import { Transform } from 'node:stream';
class TransformStreamCounter extends Transform {
  constructor(private readonly onChunk: (n: number) => void) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.onChunk(chunk.length);
    cb(null, chunk);
  }
}
