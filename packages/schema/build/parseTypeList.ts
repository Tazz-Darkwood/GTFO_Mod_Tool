/**
 * Parse the community TypeList format (UntiIted/OriginalDataBlocks/TypeList/*.txt).
 *
 * One field per line:   `[(Annotation) ]DeclaredType: FieldName`
 * Nesting is expressed by 3-space indentation; children describe the fields of
 * an object-typed field or the element type of a List<>.
 * Annotation is `enum` (DeclaredType is then an enum name, possibly wrapped in
 * List<>) or `<T>DataBlock` (the field is a UInt32 persistentID reference to T).
 */
import type { ClassSchema, FieldSchema, ScalarKind } from '@gtfo/core';

export interface TypeListEntry {
  annotation?: string;
  declared: string;
  name: string;
  children: TypeListEntry[];
  line: number;
}

const LINE = /^( *)(?:\(([A-Za-z0-9_]+)\)\s+)?(\S+):\s+(.+?)\s*$/;
const INDENT = 3;

export function parseTypeListText(text: string, fileName = '<memory>'): TypeListEntry[] {
  const roots: TypeListEntry[] = [];
  const stack: { depth: number; entry: TypeListEntry }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (raw.trim() === '') return;
    const m = LINE.exec(raw);
    if (!m) throw new Error(`${fileName}:${i + 1}: cannot parse line: ${JSON.stringify(raw)}`);
    const indent = m[1]!.length;
    if (indent % INDENT !== 0) {
      throw new Error(`${fileName}:${i + 1}: indent ${indent} is not a multiple of ${INDENT}`);
    }
    const depth = indent / INDENT;
    const entry: TypeListEntry = {
      annotation: m[2],
      declared: m[3]!,
      name: m[4]!,
      children: [],
      line: i + 1,
    };
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    if (stack.length === 0) roots.push(entry);
    else stack[stack.length - 1]!.entry.children.push(entry);
    stack.push({ depth, entry });
  });
  return roots;
}

// ---------------------------------------------------------------------------
// Conversion to FieldSchema with nested-class hoisting
// ---------------------------------------------------------------------------

const SCALARS: Record<string, ScalarKind> = {
  UInt32: 'UInt32',
  UInt16: 'UInt32',
  Byte: 'UInt32',
  UInt64: 'UInt32',
  Int32: 'Int32',
  Int16: 'Int32',
  Int64: 'Int32',
  Single: 'Single',
  Double: 'Single',
  Boolean: 'Boolean',
  String: 'String',
};
const BUILTINS = new Set(['Vector2', 'Vector3', 'Color']);

export interface ClassRegistry {
  /** className -> variants (same name, different field lists) */
  classes: Map<string, ClassSchema>;
  conflicts: { className: string; variantName: string; owner: string }[];
}

export function newRegistry(): ClassRegistry {
  return { classes: new Map(), conflicts: [] };
}

function signature(fields: FieldSchema[]): string {
  return JSON.stringify(fields);
}

export function makeClass(name: string, fields: FieldSchema[]): ClassSchema {
  const fieldsByLowerName: Record<string, number> = {};
  fields.forEach((f, i) => {
    fieldsByLowerName[f.name.toLowerCase()] = i;
  });
  return { name, fields, fieldsByLowerName };
}

/**
 * Register a nested class. Identical definitions are deduplicated by name;
 * conflicting definitions get a variant name `Class@Owner.Field` so both survive.
 * Returns the class name to reference.
 */
export function registerClass(
  reg: ClassRegistry,
  name: string,
  fields: FieldSchema[],
  owner: string,
): string {
  const existing = reg.classes.get(name);
  if (!existing) {
    reg.classes.set(name, makeClass(name, fields));
    return name;
  }
  if (signature(existing.fields) === signature(fields)) return name;
  // Look for an existing variant with the same signature.
  for (const [n, c] of reg.classes) {
    if (n.startsWith(name + '@') && signature(c.fields) === signature(fields)) return n;
  }
  const variantName = `${name}@${owner}`;
  reg.classes.set(variantName, makeClass(variantName, fields));
  reg.conflicts.push({ className: name, variantName, owner });
  return variantName;
}

function unwrapList(declared: string): string | undefined {
  const m = /^List<(.+)>$/.exec(declared);
  return m ? m[1] : undefined;
}

function refTargetFromAnnotation(annotation: string | undefined): string | undefined {
  if (!annotation || annotation === 'enum') return undefined;
  if (/DataBlock$/.test(annotation)) return annotation.slice(0, -'DataBlock'.length);
  return undefined;
}

export function entryToField(entry: TypeListEntry, reg: ClassRegistry, owner: string): FieldSchema {
  return convert(entry.declared, entry.annotation, entry.children, entry.name, reg, owner);
}

function convert(
  declared: string,
  annotation: string | undefined,
  children: TypeListEntry[],
  name: string,
  reg: ClassRegistry,
  owner: string,
): FieldSchema {
  const inner = unwrapList(declared);
  if (inner !== undefined) {
    const item = convert(inner, annotation, children, '', reg, `${owner}.${name}[]`);
    return { kind: 'list', name, item };
  }
  if (annotation === 'enum') return { kind: 'enum', name, enumName: declared };
  const refType = refTargetFromAnnotation(annotation);
  if (refType) return { kind: 'ref', name, refType };
  if (declared === 'LocalizedText') return { kind: 'localizedText', name };
  const scalar = SCALARS[declared];
  if (scalar) return { kind: 'scalar', name, scalar };
  if (BUILTINS.has(declared))
    return { kind: 'builtin', name, builtin: declared as 'Vector2' | 'Vector3' | 'Color' };
  if (children.length > 0) {
    const fields = children.map((c) => entryToField(c, reg, `${owner}.${name}`));
    const className = registerClass(reg, declared, fields, `${owner}.${name}`);
    return { kind: 'object', name, className };
  }
  return { kind: 'unknown', name, declared };
}

/** Convert one TypeList file (a datablock root) into its ClassSchema. */
export function typeListToClass(
  typeName: string,
  entries: TypeListEntry[],
  reg: ClassRegistry,
): ClassSchema {
  const fields = entries.map((e) => entryToField(e, reg, typeName));
  return makeClass(typeName, fields);
}
