import type {
  BlockIndex,
  Project,
  RefLookupResult,
  SchemaBundle,
  SourceFile,
  TypeName,
  TypeResolution,
  VanillaIndex,
} from '../model/types.js';

/**
 * Decide, per type, what the game will use as the baseline set of blocks.
 * A wrapper file (`GameData_<T>DataBlock_bin.json`) replaces vanilla wholesale;
 * without one, vanilla is the baseline and partial blocks are added on top.
 */
export function computeResolutions(
  files: Iterable<SourceFile>,
  vanilla: VanillaIndex,
  schema: SchemaBundle,
): Map<TypeName, TypeResolution> {
  const out = new Map<TypeName, TypeResolution>();
  const allTypes = new Set<TypeName>([
    ...Object.keys(schema.blockTypes),
    ...Object.keys(vanilla.types),
  ]);
  for (const f of files) {
    if (f.shape === 'wrapper' && f.wrapperType) {
      allTypes.add(f.wrapperType);
      out.set(f.wrapperType, { type: f.wrapperType, baseline: 'wrapper-file', wrapperFile: f.id });
    }
  }
  for (const t of allTypes) {
    if (out.has(t)) continue;
    out.set(t, { type: t, baseline: vanilla.types[t] ? 'vanilla' : 'none' });
  }
  return out;
}

/**
 * Resolve a reference (type, id). Project blocks win; vanilla is consulted only
 * when the type's baseline is vanilla (no wrapper file present).
 */
export function lookupRef(
  project: Pick<Project, 'index' | 'resolutions' | 'vanilla'>,
  type: TypeName,
  id: number,
): RefLookupResult | undefined {
  const inProject = project.index.byType.get(type)?.get(id);
  if (inProject && inProject.length) {
    const b = inProject[0]!;
    return { source: 'project', name: b.name ?? '', block: b };
  }
  const res = project.resolutions.get(type);
  if (!res || res.baseline === 'vanilla') {
    const name = project.vanilla.types[type]?.[String(id)];
    if (name !== undefined) return { source: 'vanilla', name };
  }
  return undefined;
}

/** Does any block of this type with this id exist in the *project* (not vanilla)? */
export function existsInProject(index: BlockIndex, type: TypeName, id: number): boolean {
  return (index.byType.get(type)?.get(id)?.length ?? 0) > 0;
}
