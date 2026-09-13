import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'packages/app/src/shared'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
