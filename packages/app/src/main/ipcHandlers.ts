import { spawn } from 'node:child_process';
import { CREDITS } from '@shared/credits';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcApi } from '@shared/ipc';
import type { ProjectHost } from './projectHost.js';
import { loadRecent, pushRecent } from './recent.js';
import { checkForUpdate, downloadAndLaunch } from './updater.js';

type Handler<K extends keyof IpcApi> = (...args: Parameters<IpcApi[K]>) => ReturnType<IpcApi[K]>;

function handle<K extends keyof IpcApi>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
}

export function registerIpc(host: ProjectHost, getWindow: () => BrowserWindow | null): void {
  handle('dialog:pickFolder', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Open a rundown folder (the one containing GameData_*.json and PartialData)',
      properties: ['openDirectory'],
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  handle('project:open', async (root) => {
    const s = await host.open(root);
    await pushRecent(root);
    return s;
  });
  handle('project:close', () => host.close());
  handle('project:summary', async () => (host.isOpen ? host.summary() : null));
  handle('project:refresh', () => host.refresh());
  handle('project:recent', () => loadRecent());
  handle('project:nextId', async (type, targetFile) => host.nextId(type, targetFile));
  handle('project:targetFiles', async (type) => host.targetFiles(type));
  handle('files:list', async () => host.listFiles());
  handle('files:create', (req) => host.createFile(req));
  handle('files:delete', (fileId) => host.deleteFile(fileId));
  handle('files:references', async (fileId) => host.fileReferences(fileId));
  handle('file:getText', async (fileId) => host.fileText(fileId));
  handle('file:setText', async (fileId, text, opts) => host.setFileText(fileId, text, opts));
  handle('blocks:list', async (q) => host.listBlocks(q));
  handle('blocks:get', async (blockId) => host.blockDetail(blockId));
  handle('blocks:locate', async (q) => host.locateBlock(q));
  handle('blocks:searchRefs', async (q) => host.searchRefs(q));
  handle('blocks:resolveRef', async (q) => host.resolveRef(q));
  handle('blocks:references', async (q) => host.references(q));
  handle('blocks:create', async (req) => host.createBlock(req));
  handle('blocks:delete', async (blockId) => host.deleteBlock(blockId));
  handle('rundown:tree', async () => host.rundownTree());
  handle('layout:detail', async (id) => host.layoutDetail(id));
  handle('layout:generated', async (id) => host.layoutGenerated(id));
  handle('lgtuner:config', async (id) => host.lgtunerConfig(id));
  handle('lgtuner:prefabs', async () => host.lgtunerPrefabs());
  handle('lgtuner:create', async (id) => host.lgtunerCreate(id));
  handle('rundown:op', async (op) => host.rundownOp(op));
  handle('diagnostics:list', async (fileId) => host.diagnostics(fileId));
  handle('edit:apply', async (target, op) => host.applyEdit(target, op));
  handle('edit:applyMany', async (target, ops) => host.applyMany(target, ops));
  handle('edit:applyFix', async (fix) => host.applyFix(fix));
  handle('edit:undo', async (fileId) => host.undo(fileId));
  handle('edit:redo', async (fileId) => host.redo(fileId));
  handle('file:save', (fileId, force) => host.save(fileId, force));
  handle('file:saveAll', () => host.saveAll());
  handle('file:revert', (fileId) => host.revert(fileId));
  handle('app:version', async () => app.getVersion());
  handle('update:check', async () => {
    try {
      return await checkForUpdate();
    } catch {
      return null;
    }
  });
  handle('update:install', async (info) => {
    try {
      const p = await downloadAndLaunch(info, (received, total) => {
        for (const w of BrowserWindow.getAllWindows())
          w.webContents.send('update:progress', { received, total });
      });
      return { ok: true as const, path: p };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
  handle('app:openUrl', async (url) => {
    // Only the project's own pages and the credited projects; never arbitrary URLs from file contents.
    const credited = Object.values(CREDITS).some((c) => c.url === url);
    if (
      credited ||
      /^https:\/\/(ko-fi\.com\/tazzdarkwood|github\.com\/Tazz-Darkwood\/GTFO_Mod_Tool)(\/|$)/.test(
        url,
      )
    ) {
      await shell.openExternal(url);
    }
  });
  handle('file:openExternal', async (fileId, line) => {
    const abs = host.absPath(fileId);
    if (!abs) return;
    // Prefer VS Code when available (it can jump to a line); fall back to the OS default.
    const child = spawn('code', ['-g', line ? `${abs}:${line}` : abs], {
      shell: true,
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => void shell.openPath(abs));
    child.unref();
  });
  handle('schema:type', async (type) => host.schemaType(type));
  handle('schema:class', async (name) => host.schemaClass(name));
  handle('schema:enum', async (name) => host.schemaEnum(name));
  handle('schema:types', async () => host.schemaTypes());
  handle('schema:closure', async (type) => host.schemaClosure(type));
}
