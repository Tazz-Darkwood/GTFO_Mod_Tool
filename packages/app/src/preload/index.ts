import { contextBridge, ipcRenderer } from 'electron';
import type { GtfoBridge, IpcEvents } from '@shared/ipc';

const bridge: GtfoBridge = {
  invoke: ((channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)) as GtfoBridge['invoke'],
  on(event, handler) {
    const listener = (_e: Electron.IpcRendererEvent, payload: IpcEvents[typeof event]) =>
      handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
};

contextBridge.exposeInMainWorld('gtfo', bridge);
