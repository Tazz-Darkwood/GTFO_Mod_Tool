import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Where the generated schema bundle lives.
 * - dev:       <repo>/packages/schema/dist
 * - packaged:  <resources>/schema   (copied by electron-builder extraResources)
 * - override:  GTFO_SCHEMA_DIR
 */
export function schemaDir(): string {
  const fromEnv = process.env['GTFO_SCHEMA_DIR'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (app.isPackaged) return path.join(process.resourcesPath, 'schema');
  const candidates = [
    path.resolve(app.getAppPath(), '..', 'schema', 'dist'),
    path.resolve(process.cwd(), 'packages', 'schema', 'dist'),
  ];
  for (const c of candidates) if (existsSync(path.join(c, 'schema-bundle.json'))) return c;
  throw new Error(
    `Schema bundle not found. Run "npm run schema:build". Looked in: ${candidates.join(', ')}`,
  );
}
