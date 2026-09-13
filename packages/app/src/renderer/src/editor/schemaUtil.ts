import type { ClassSchema, EnumSchema, FieldSchema, JsonPath, SchemaClosureDto } from '@shared/ipc';

/** RFC 6901 pointer for a block-relative path. */
export function pointerOf(path: JsonPath): string {
  return path.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

export function resolveField(cls: ClassSchema, key: string): FieldSchema | undefined {
  const i = cls.fieldsByLowerName[key.toLowerCase()];
  return i === undefined ? undefined : cls.fields[i];
}

export function classOf(closure: SchemaClosureDto, name: string): ClassSchema | undefined {
  return closure.classes[name];
}

export function enumOf(closure: SchemaClosureDto, name: string): EnumSchema | undefined {
  return closure.enums[name];
}

/** A sensible starting value when adding a field or list item. */
export function defaultValue(field: FieldSchema, closure: SchemaClosureDto): unknown {
  switch (field.kind) {
    case 'scalar':
      return field.scalar === 'Boolean' ? false : field.scalar === 'String' ? '' : 0;
    case 'enum': {
      const e = enumOf(closure, field.enumName);
      return e?.members[0]?.value ?? 0;
    }
    case 'ref':
      return 0;
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
      const cls = classOf(closure, field.className);
      if (!cls) return {};
      const obj: Record<string, unknown> = {};
      for (const f of cls.fields) {
        // Keep new objects shallow: nested objects/lists start empty, scalars get defaults.
        obj[f.name] = f.kind === 'object' ? {} : defaultValue(f, closure);
      }
      return obj;
    }
    case 'unknown':
      return null;
  }
}

export function enumName(e: EnumSchema | undefined, value: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof value === 'string')
    return e.members.find((m) => m.name.toLowerCase() === value.toLowerCase())?.name;
  if (typeof value === 'number') {
    const exact = e.members.find((m) => m.value === value);
    if (exact) return exact.name;
    if (e.isFlags && value > 0) {
      const parts = e.members
        .filter((m) => m.value > 0 && (value & m.value) === m.value)
        .map((m) => m.name);
      if (parts.length) return parts.join(' | ');
    }
  }
  return undefined;
}

/** One-line description of an object for collapsed list items. */
export function summarize(
  value: unknown,
  cls: ClassSchema | undefined,
  closure: SchemaClosureDto,
): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return JSON.stringify(value) ?? '';
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const actual = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
      if (!actual) continue;
      const v = obj[actual];
      const f = cls ? resolveField(cls, actual) : undefined;
      if (f?.kind === 'enum') {
        const n = enumName(enumOf(closure, f.enumName), v);
        parts.push(`${actual}: ${n ?? String(v)}`);
      } else if (typeof v === 'string' && v) parts.push(v.length > 40 ? v.slice(0, 37) + '…' : v);
      else if (typeof v === 'number' || typeof v === 'boolean')
        parts.push(`${actual}: ${String(v)}`);
      if (parts.length >= 3) return;
    }
  };
  pick([
    'Type',
    'name',
    'PublicName',
    'LocalIndex',
    'Prefix',
    'WaveSettings',
    'Command',
    'PuzzleType',
    'Enemy',
    'ItemID',
    'Weight',
    'Delay',
  ]);
  if (parts.length === 0) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        parts.push(`${k}: ${String(v)}`);
      if (parts.length >= 2) break;
    }
  }
  return parts.join(' · ');
}
