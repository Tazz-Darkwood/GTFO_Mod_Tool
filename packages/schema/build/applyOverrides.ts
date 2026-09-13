/**
 * Curated corrections layered over the mechanically parsed TypeList.
 * Files live in packages/schema/overrides/.
 */
import type { ClassSchema, FieldSchema, SchemaBundle } from '@gtfo/core';

export interface Overrides {
  /** "ClassName.Field" -> target datablock type. Marks an unannotated UInt32 as a reference. Keys starting with "_" are ignored. */
  refTargets: Record<string, string>;
  /** Field names (any class) that hold WWise sound event IDs, never block references. */
  soundFields: string[];
  /** Regexes (source strings) matched against field names; matches are sound IDs. */
  soundFieldPatterns: string[];
  /** Classes whose every UInt32 field is a sound ID. */
  soundClasses: string[];
  /** Enum names to force isFlags = true. */
  enumFlags: string[];
  /** Enum names whose numeric values are unconstrained (e.g. zone indices). */
  enumOpen: string[];
  /** Type -> property to use as the display name (default "name"). */
  displayName: Record<string, string>;
}

export const EMPTY_OVERRIDES: Overrides = {
  refTargets: {},
  soundFields: [],
  soundFieldPatterns: [],
  soundClasses: [],
  enumFlags: [],
  enumOpen: [],
  displayName: {},
};

function mapFields(
  cls: ClassSchema,
  fn: (f: FieldSchema, cls: ClassSchema) => FieldSchema,
): ClassSchema {
  return { ...cls, fields: cls.fields.map((f) => fn(f, cls)) };
}

export function applyOverrides(
  bundle: SchemaBundle,
  ov: Overrides,
): { bundle: SchemaBundle; unusedRefTargets: string[] } {
  const used = new Set<string>();
  const sound = new Set(ov.soundFields);
  const soundPatterns = ov.soundFieldPatterns.map((s) => new RegExp(s));
  const soundClasses = new Set(ov.soundClasses);
  const refTargets = Object.fromEntries(
    Object.entries(ov.refTargets).filter(([k]) => !k.startsWith('_')),
  );

  const isSound = (cls: ClassSchema, name: string) =>
    sound.has(name) || soundClasses.has(cls.name) || soundPatterns.some((re) => re.test(name));

  const fix = (f: FieldSchema, cls: ClassSchema): FieldSchema => {
    const key = `${cls.name}.${f.name}`;
    const target = refTargets[key];
    if (target && f.kind === 'scalar' && f.scalar === 'UInt32') {
      used.add(key);
      return { kind: 'ref', name: f.name, refType: target };
    }
    if (
      f.kind === 'scalar' &&
      f.scalar === 'UInt32' &&
      f.name !== 'persistentID' &&
      isSound(cls, f.name)
    ) {
      return { ...f, display: 'soundId' };
    }
    if (f.kind === 'list' && f.item.kind === 'scalar' && f.item.scalar === 'UInt32') {
      const listTarget = refTargets[key];
      if (listTarget) {
        used.add(key);
        return { kind: 'list', name: f.name, item: { kind: 'ref', name: '', refType: listTarget } };
      }
    }
    return f;
  };

  const blockTypes: Record<string, ClassSchema> = {};
  for (const [k, cls] of Object.entries(bundle.blockTypes)) blockTypes[k] = mapFields(cls, fix);
  const classes: Record<string, ClassSchema> = {};
  for (const [k, cls] of Object.entries(bundle.classes)) classes[k] = mapFields(cls, fix);
  const enums = { ...bundle.enums };
  for (const e of ov.enumFlags) if (enums[e]) enums[e] = { ...enums[e]!, isFlags: true };
  for (const e of ov.enumOpen) if (enums[e]) enums[e] = { ...enums[e]!, open: true };

  const unusedRefTargets = Object.keys(refTargets).filter((k) => !used.has(k));
  return { bundle: { ...bundle, blockTypes, classes, enums }, unusedRefTargets };
}

/** Every UInt32 scalar field (not sound, not ref, not persistentID) — candidates for refTargets curation. */
export function unannotatedUInt32Fields(bundle: SchemaBundle): string[] {
  const out: string[] = [];
  const scan = (cls: ClassSchema) => {
    for (const f of cls.fields) {
      if (f.name === 'persistentID') continue;
      if (f.kind === 'scalar' && f.scalar === 'UInt32' && !f.display)
        out.push(`${cls.name}.${f.name}`);
      if (f.kind === 'list' && f.item.kind === 'scalar' && f.item.scalar === 'UInt32')
        out.push(`${cls.name}.${f.name}[]`);
    }
  };
  for (const cls of Object.values(bundle.blockTypes)) scan(cls);
  for (const cls of Object.values(bundle.classes)) scan(cls);
  return out.sort();
}
