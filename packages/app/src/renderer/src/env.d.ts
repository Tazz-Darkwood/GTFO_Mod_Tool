import type { GtfoBridge } from '@shared/ipc';

declare global {
  interface Window {
    gtfo: GtfoBridge;
  }
}

declare module '*.css';

export {};
