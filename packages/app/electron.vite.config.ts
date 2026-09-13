import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const shared = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    // Bundle everything (workspace packages, chokidar, fuzzysort) so the packaged app ships no node_modules.
    plugins: [],
    resolve: { alias: shared },
    build: { rollupOptions: { external: ['electron'] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
  },
  renderer: {
    plugins: [react({ jsxRuntime: 'automatic' })],
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') } },
  },
});
