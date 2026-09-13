import type { TypeName } from '../model/types.js';

const WRAPPER_FILE = /^GameData_(.+?)DataBlock_bin\.json$/i;
const VANILLA_FILE = /^(.+?)DataBlock\.json$/i;

/**
 * Canonical short type name: strips a `GameData.` prefix and a `DataBlock`
 * suffix, case-insensitively, and trims whitespace.
 *   "SurvivalWaveSettings" | "SurvivalWaveSettingsDataBlock" | "GameData.SurvivalWaveSettingsDataBlock"
 *   -> "SurvivalWaveSettings"
 */
export function canonicalType(raw: string): TypeName {
  let s = raw.trim();
  if (/^GameData\./i.test(s)) s = s.slice('GameData.'.length);
  if (/DataBlock$/i.test(s)) s = s.slice(0, -'DataBlock'.length);
  return s;
}

/** Type encoded in an MTFO wrapper file name, or undefined. */
export function wrapperFileType(fileName: string): TypeName | undefined {
  const m = WRAPPER_FILE.exec(fileName);
  return m ? m[1] : undefined;
}

/** Type encoded in an OriginalDataBlocks vanilla dump file name, or undefined. */
export function vanillaFileType(fileName: string): TypeName | undefined {
  const m = VANILLA_FILE.exec(fileName);
  return m ? m[1] : undefined;
}

/** Case-insensitive lookup of a canonical type name among known types. */
export function matchKnownType(
  raw: string,
  known: Iterable<TypeName>,
): { type: TypeName; exact: boolean } | undefined {
  const c = canonicalType(raw);
  let loose: TypeName | undefined;
  const lower = c.toLowerCase();
  for (const k of known) {
    if (k === c) return { type: k, exact: true };
    if (!loose && k.toLowerCase() === lower) loose = k;
  }
  return loose ? { type: loose, exact: false } : undefined;
}
