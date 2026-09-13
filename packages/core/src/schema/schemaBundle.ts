import type { ClassSchema, SchemaBundle, TypeName, VanillaIndex } from '../model/types.js';

/** Light structural check so a broken generated bundle fails loudly at startup. */
export function assertSchemaBundle(x: unknown): SchemaBundle {
  const b = x as Partial<SchemaBundle> | null;
  if (!b || typeof b !== 'object') throw new Error('schema bundle: not an object');
  for (const k of ['blockTypes', 'classes', 'enums'] as const) {
    if (!b[k] || typeof b[k] !== 'object') throw new Error(`schema bundle: missing "${k}"`);
  }
  if (!b.meta || typeof b.meta.commit !== 'string')
    throw new Error('schema bundle: missing meta.commit');
  return b as SchemaBundle;
}

export function assertVanillaIndex(x: unknown): VanillaIndex {
  const v = x as Partial<VanillaIndex> | null;
  if (!v || typeof v !== 'object' || !v.types || !Array.isArray(v.fullBlockTypes)) {
    throw new Error('vanilla index: malformed');
  }
  return v as VanillaIndex;
}

/** Root class for a datablock type, or undefined. */
export function blockClass(bundle: SchemaBundle, type: TypeName): ClassSchema | undefined {
  return bundle.blockTypes[type];
}

/** Nested class by name. */
export function nestedClass(bundle: SchemaBundle, className: string): ClassSchema | undefined {
  return bundle.classes[className];
}

/** All known datablock type names, sorted. */
export function knownTypes(bundle: SchemaBundle): TypeName[] {
  return Object.keys(bundle.blockTypes).sort();
}

/** Empty schema/vanilla for tests. */
export function emptySchema(): SchemaBundle {
  return {
    meta: { repo: '', commit: 'test', builtAt: '' },
    blockTypes: {},
    classes: {},
    enums: {},
  };
}
export function emptyVanilla(): VanillaIndex {
  return { types: {}, fullBlockTypes: [] };
}
