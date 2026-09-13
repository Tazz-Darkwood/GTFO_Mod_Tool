import type { ClassSchema, FieldSchema, JsonPath, SchemaBundle } from '../model/types.js';
import { nestedClass } from './schemaBundle.js';

export interface FieldMatch {
  field: FieldSchema;
  index: number;
  /** The JSON key differs from the schema name only by case. */
  caseMismatch: boolean;
}

/** Find a field by JSON key; exact first, then case-insensitive. */
export function resolveField(cls: ClassSchema, key: string): FieldMatch | undefined {
  const i = cls.fieldsByLowerName[key.toLowerCase()];
  if (i === undefined) return undefined;
  const field = cls.fields[i]!;
  return { field, index: i, caseMismatch: field.name !== key };
}

/** The class a `object` field refers to (or undefined for other kinds). */
export function classOfField(bundle: SchemaBundle, field: FieldSchema): ClassSchema | undefined {
  return field.kind === 'object' ? nestedClass(bundle, field.className) : undefined;
}

/** Walk a path from a root class; returns the schema at the end (field or class). */
export function schemaAtPath(
  bundle: SchemaBundle,
  root: ClassSchema,
  path: JsonPath,
): { field?: FieldSchema; cls?: ClassSchema } | undefined {
  let cls: ClassSchema | undefined = root;
  let field: FieldSchema | undefined;
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (!field || field.kind !== 'list') return undefined;
      field = field.item;
      cls = field.kind === 'object' ? nestedClass(bundle, field.className) : undefined;
      continue;
    }
    if (!cls) return undefined;
    const m = resolveField(cls, seg);
    if (!m) return undefined;
    field = m.field;
    cls = field.kind === 'object' ? nestedClass(bundle, field.className) : undefined;
  }
  return { field, cls };
}

/** Unwrap list nesting to the innermost item schema. */
export function innermost(field: FieldSchema): FieldSchema {
  let f = field;
  while (f.kind === 'list') f = f.item;
  return f;
}
