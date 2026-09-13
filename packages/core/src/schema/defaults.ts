/**
 * Starting values for new blocks, fields and list items, derived from the schema.
 */
import type { FieldSchema, SchemaBundle, TypeName } from '../model/types.js';
import { blockClass, nestedClass } from './schemaBundle.js';

const MAX_DEPTH = 2;

export function defaultValueFor(schema: SchemaBundle, field: FieldSchema, depth = 0): unknown {
  switch (field.kind) {
    case 'scalar':
      return field.scalar === 'Boolean' ? false : field.scalar === 'String' ? '' : 0;
    case 'enum':
      return schema.enums[field.enumName]?.members[0]?.value ?? 0;
    case 'ref':
    case 'localizedText':
      return 0;
    case 'list':
      return [];
    case 'builtin':
      return field.builtin === 'Vector2'
        ? { x: 0, y: 0 }
        : field.builtin === 'Vector3'
          ? { x: 0, y: 0, z: 0 }
          : { r: 1, g: 1, b: 1, a: 1 };
    case 'object': {
      if (depth >= MAX_DEPTH) return {};
      const cls = nestedClass(schema, field.className);
      if (!cls) return {};
      const obj: Record<string, unknown> = {};
      for (const f of cls.fields) obj[f.name] = defaultValueFor(schema, f, depth + 1);
      return obj;
    }
    case 'unknown':
      return null;
  }
}

/**
 * A blank block of `type`: every schema field with a default, meta fields last
 * (matching how modders lay their files out). `datablock` is added for partial files.
 */
export function defaultBlockValue(
  schema: SchemaBundle,
  type: TypeName,
  meta: { persistentID: number; name: string; withDatablockTag: boolean },
): Record<string, unknown> {
  const cls = blockClass(schema, type);
  const obj: Record<string, unknown> = {};
  const META = new Set(['name', 'internalenabled', 'persistentid', 'datablock']);
  if (cls) {
    for (const f of cls.fields) {
      if (META.has(f.name.toLowerCase())) continue;
      if (f.kind === 'unknown') continue; // inferred-from-vanilla oddities: leave out
      obj[f.name] = defaultValueFor(schema, f, 1);
    }
  }
  obj['name'] = meta.name;
  obj['internalEnabled'] = true;
  if (meta.withDatablockTag) obj['datablock'] = type;
  obj['persistentID'] = meta.persistentID;
  return obj;
}
