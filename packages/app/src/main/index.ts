import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { registerIpc } from './ipcHandlers.js';
import { ProjectHost } from './projectHost.js';
import { schemaDir } from './schemaLocator.js';

let win: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 600,
    title: 'GTFO Datablock Studio',
    backgroundColor: '#15171b',
    autoHideMenuBar: true,
    // Packaged builds take the icon from the exe; in dev, point at the source asset.
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'));
  w.on('closed', () => {
    win = null;
  });
  return w;
}

app.whenReady().then(async () => {
  const host = new ProjectHost((event, payload) => {
    for (const b of BrowserWindow.getAllWindows()) b.webContents.send(event, payload);
  });
  try {
    await host.init(schemaDir());
  } catch (e) {
    dialog.showErrorBox('GTFO Datablock Studio', (e as Error).message);
    app.quit();
    return;
  }
  registerIpc(host, () => win);
  win = createWindow();

  // Don't let unsaved edits vanish with the window.
  win.on('close', (e) => {
    if (!host.isOpen || process.env['GTFO_SCREENSHOT']) return;
    const dirty = host.summary().dirtyFiles;
    if (dirty.length === 0) return;
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      buttons: ['Save all and close', 'Close without saving', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `${dirty.length} file${dirty.length === 1 ? ' has' : 's have'} unsaved changes.`,
      detail: dirty.join('\n'),
    });
    if (choice === 2) {
      e.preventDefault();
      return;
    }
    if (choice === 0) {
      e.preventDefault();
      void host.saveAll().then((r) => {
        if (r.conflicts.length) {
          dialog.showErrorBox(
            'Some files were not saved',
            `Changed on disk by another program:\n${r.conflicts.join('\n')}\n\nSave them individually (overwrite) or revert, then close.`,
          );
          return;
        }
        win?.destroy();
      });
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
  });

  // Developer hooks for unattended checks:
  //   GTFO_OPEN=<folder>      open a project as soon as the window is ready
  //   GTFO_SCREENSHOT=<png>   capture the window a few seconds later and quit
  const autoOpen = process.env['GTFO_OPEN'];
  const shot = process.env['GTFO_SCREENSHOT'];
  if (autoOpen || shot) {
    win.webContents.on('console-message', (event) => {
      const e = event as unknown as {
        level: string;
        message: string;
        lineNumber: number;
        sourceId: string;
      };
      console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
    win.webContents.on('preload-error', (_e, preloadPath, error) =>
      console.error(`[preload-error] ${preloadPath}: ${error.message}`),
    );
    win.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.error(`[did-fail-load] ${code} ${desc} ${url}`),
    );
    win.webContents.on('render-process-gone', (_e, details) =>
      console.error(`[render-process-gone] ${details.reason}`),
    );
    win.webContents.once('did-finish-load', async () => {
      if (autoOpen) {
        const nav = process.env['GTFO_NAV_CODE'] ?? null;
        const fix = process.env['GTFO_AUTO_FIX'] ?? null;
        const edit = process.env['GTFO_AUTO_EDIT'] ?? null;
        const fold = process.env['GTFO_AUTO_FOLD'] ?? null;
        await win!.webContents.executeJavaScript(
          `window.__gtfoAutoOpen = ${JSON.stringify(autoOpen)}; window.__gtfoAutoNav = ${JSON.stringify(nav)}; window.__gtfoAutoFix = ${JSON.stringify(fix)}; window.__gtfoAutoEdit = ${JSON.stringify(edit)}; window.__gtfoAutoFold = ${JSON.stringify(fold)}; window.dispatchEvent(new Event('gtfo-auto-open'))`,
        );
      }
      if (shot) {
        setTimeout(
          async () => {
            try {
              const img = await win!.webContents.capturePage();
              const { writeFile } = await import('node:fs/promises');
              await writeFile(shot, img.toPNG());
              console.log(`screenshot written to ${shot}`);
            } catch (e) {
              console.error(e);
            }
            app.quit();
          },
          Number(process.env['GTFO_SCREENSHOT_DELAY'] ?? 5000),
        );
      }
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
