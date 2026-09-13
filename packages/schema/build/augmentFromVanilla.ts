/**
 * The TypeList lags the game: some fields present in the real dumps are
 * missing from it (e.g. MarkerDataCommon.FunctionComponentLinks). Walk every
 * vanilla block with the schema and add any unknown property as an `unknown`
 * field (declared "inferred:<jsontype>") so it is neither flagged nor typed.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';
import type { ClassSchema, FieldSchema, SchemaBundle } from '@gtfo/core';
import { walkObject } from '@gtfo/core';
import { makeClass } from './parseTypeList.js';

export interface AugmentResult {
  bundle: SchemaBundle;
  added: string[];
}

export async function augmentFromVanilla(
  bundle: SchemaBundle,
  repoDir: string,
): Promise<AugmentResult> {
  const additions = new Map<string, Map<string, string>>(); // className -> key -> jsonType
  const typeOf = (t: string) => (t === 'object' || t === 'array' ? t : t === 'null' ? 'null' : t);

  for (const [type, cls] of Object.entries(bundle.blockTypes)) {
    let text: string;
    try {
      text = await fsp.readFile(path.join(repoDir, `${type}DataBlock.json`), 'utf8');
    } catch {
      continue;
    }
    const tree = parseTree(text);
    if (!tree) continue;
    const blocksProp = tree.children?.find((p) => p.children?.[0]?.value === 'Blocks');
    const blocks = blocksProp?.children?.[1];
    if (!blocks || blocks.type !== 'array') continue;
    for (const block of blocks.children ?? []) {
      walkObject(bundle, cls, block, [], {
        onProperty(v) {
          if (v.field) return;
          let m = additions.get(v.cls.name);
          if (!m) {
            m = new Map();
            additions.set(v.cls.name, m);
          }
          if (!m.has(v.prop.key)) m.set(v.prop.key, typeOf(v.prop.valueNode.type));
        },
      });
    }
  }

  const added: string[] = [];
  const patch = (cls: ClassSchema): ClassSchema => {
    const m = additions.get(cls.name);
    if (!m) return cls;
    const extra: FieldSchema[] = [...m.entries()].map(([key, jt]) => {
      added.push(`${cls.name}.${key} (${jt})`);
      return { kind: 'unknown', name: key, declared: `inferred:${jt}` };
    });
    return makeClass(cls.name, [...cls.fields, ...extra]);
  };
  const blockTypes: SchemaBundle['blockTypes'] = {};
  for (const [k, c] of Object.entries(bundle.blockTypes)) blockTypes[k] = patch(c);
  const classes: SchemaBundle['classes'] = {};
  for (const [k, c] of Object.entries(bundle.classes)) classes[k] = patch(c);
  return { bundle: { ...bundle, blockTypes, classes }, added: added.sort() };
}
