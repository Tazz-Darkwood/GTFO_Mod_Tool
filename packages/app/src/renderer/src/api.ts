import type { GtfoBridge } from '@shared/ipc';

/** Typed access to the preload bridge. */
export const api: GtfoBridge = window.gtfo;
