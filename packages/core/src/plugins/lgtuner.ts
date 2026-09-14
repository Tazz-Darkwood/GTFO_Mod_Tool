/**
 * LGTuner (hirnukuono; based on Flowaria's LGTuner) config files:
 * `Custom/LGTuner/*.json(c)`, one per LevelLayout. The game's generator still
 * decides which grid cell each zone's tiles land on; LGTuner swaps the prefab,
 * rotation, altitude and plugs of the tile placed at (X, Z) — X east, Z north,
 * (0,0) the starting tile — or cycles a per-zone list over a zone's tiles.
 * Field names and semantics follow LGTuner's C# config classes.
 */
import type { BlockId, FileId, JsonPath, Project, SourceFile } from '../model/types.js';
import { parseEnumValue } from '../schema/enumUtil.js';
import { valueOf } from '../text/jsoncDoc.js';
import { lookupRef } from '../index/typeResolution.js';

export const LGTUNER_FILE = /^Custom\/LGTuner\/.*\.jsonc?$/i;
export const LGTUNER_CREDIT =
  'LGTuner by hirnukuono, based on Flowaria’s LGTuner (override format and tile log).';

export const LGTUNER_ROTATIONS = [
  'None',
  'Flip',
  'MoveTo_Left',
  'MoveTo_Right',
  'Towards_Random',
  'Towards_Forward',
  'Towards_Backward',
  'Towards_Left',
  'Towards_Right',
] as const;
export const LGTUNER_DIRECTIONS = [
  'Unchanged',
  'Random',
  'Forward',
  'Backward',
  'Left',
  'Right',
] as const;
export const LGTUNER_COMPLEXES = ['Mining', 'Tech', 'Service'] as const;

export interface LgTileOverride {
  /** Position in the TileOverrides list. */
  index: number;
  path: JsonPath;
  x: number;
  z: number;
  rotation: string;
  geomorph: string;
  overrideAltitude: boolean;
  altitude: number;
  plugs: { forward: string; backward: string; left: string; right: string };
  overridePlugWithNoGateChance: boolean;
  plugWithNoGateChance: number;
}

export interface LgZoneOverride {
  index: number;
  path: JsonPath;
  /** Normalised LocalIndex (number); NaN when unreadable. */
  localIndex: number;
  overrideGeomorphs: boolean;
  geomorphs: { geomorph: string; direction: string }[];
  overrideAltitudes: boolean;
  altitudes: number[];
  overridePlugs: boolean;
  plugs: string[];
}

export interface LgTunerConfig {
  fileId: FileId;
  layoutId: number;
  extraComplexes: string[];
  zoneOverrides: LgZoneOverride[];
  tileOverrides: LgTileOverride[];
  /** Layout block in the project (undefined when vanilla or missing). */
  layoutBlockId?: BlockId;
  layoutName?: string;
  layoutResolution: 'project' | 'vanilla' | 'missing';
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : String(v));
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;

/** eLocalZoneIndex value from a number or "Zone_N" string; NaN when neither. */
export function localIndexOf(project: Project, v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string') {
    const e = project.schema.enums['eLocalZoneIndex'];
    if (e) {
      const p = parseEnumValue(e, v);
      if (p.ok && p.members[0]) return p.members[0].value;
    }
    const m = /^Zone_(\d+)$/i.exec(v.trim());
    if (m) return Number(m[1]);
    if (/^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return NaN;
}

export function isLgTunerFile(fileId: FileId): boolean {
  return LGTUNER_FILE.test(fileId);
}

/** Parse one LGTuner file; null when it is not an object with a LevelLayoutID. */
export function parseLgTuner(project: Project, file: SourceFile): LgTunerConfig | null {
  if (!file.tree || file.tree.type !== 'object') return null;
  const v = obj(valueOf(file.tree));
  if (typeof v['LevelLayoutID'] !== 'number') return null;
  const layoutId = v['LevelLayoutID'];
  const ref = lookupRef(project, 'LevelLayout', layoutId);
  const tileOverrides = arr(v['TileOverrides']).map((t, i): LgTileOverride => {
    const o = obj(t);
    return {
      index: i,
      path: ['TileOverrides', i],
      x: num(o['X']),
      z: num(o['Z']),
      rotation: str(o['Rotation'] ?? 'None'),
      geomorph: str(o['Geomorph']),
      overrideAltitude: bool(o['OverrideAltitude']),
      altitude: num(o['Altitude']),
      plugs: {
        forward: str(o['ForwardPlug']),
        backward: str(o['BackwardPlug']),
        left: str(o['LeftPlug']),
        right: str(o['RightPlug']),
      },
      overridePlugWithNoGateChance: bool(o['OverridePlugWithNoGateChance']),
      plugWithNoGateChance: num(o['PlugWithNoGateChance'], 0.5),
    };
  });
  const zoneOverrides = arr(v['ZoneOverrides']).map((z, i): LgZoneOverride => {
    const o = obj(z);
    return {
      index: i,
      path: ['ZoneOverrides', i],
      localIndex: localIndexOf(project, o['LocalIndex'] ?? 0),
      overrideGeomorphs: bool(o['OverrideGeomorphs']),
      geomorphs: arr(o['Geomorphs']).map((g) => ({
        geomorph: str(obj(g)['Geomorph']),
        direction: str(obj(g)['Direction'] ?? 'Unchanged'),
      })),
      overrideAltitudes: bool(o['OverrideAltitudes']),
      altitudes: arr(o['Altitudes']).map((a) => num(a)),
      overridePlugs: bool(o['OverridePlugs']),
      plugs: arr(o['Plugs']).map(str),
    };
  });
  return {
    fileId: file.id,
    layoutId,
    extraComplexes: arr(v['ExtraComplexResourceToLoad']).map(str),
    zoneOverrides,
    tileOverrides,
    layoutBlockId: ref?.block?.id,
    layoutName: ref?.name,
    layoutResolution: ref ? ref.source : 'missing',
  };
}

/** Every LGTuner config in the project, in file order. */
export function lgtunerConfigs(project: Project): LgTunerConfig[] {
  const out: LgTunerConfig[] = [];
  for (const file of project.files.values()) {
    if (!isLgTunerFile(file.id)) continue;
    const c = parseLgTuner(project, file);
    if (c) out.push(c);
  }
  return out.sort((a, b) => (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0));
}

/** The LGTuner config(s) targeting a layout block (LGTuner itself uses only one). */
export function lgtunerFor(project: Project, layoutBlockId: BlockId): LgTunerConfig[] {
  const block = project.index.byId.get(layoutBlockId);
  if (!block || block.persistentID === undefined) return [];
  return lgtunerConfigs(project).filter((c) => c.layoutId === block.persistentID);
}

/** Normalised LocalIndex values of a layout block's zones. */
export function layoutLocalIndexes(project: Project, layoutBlockId: BlockId): number[] {
  const block = project.index.byId.get(layoutBlockId);
  if (!block) return [];
  const zones = arr(obj(valueOf(block.node))['Zones']);
  return zones.map((z) => localIndexOf(project, obj(z)['LocalIndex'] ?? 0));
}

export interface LgTunerPrefabs {
  geomorphs: string[];
  plugs: string[];
}

const GEO_LISTS = [
  'GeomorphTiles_1x1',
  'GeomorphTiles_2x1',
  'GeomorphTiles_2x2',
  'CustomGeomorphs_Exit_1x1',
  'CustomGeomorphs_Objective_1x1',
  'CustomGeomorphs_Challenge_1x1',
];
const PLUG_LISTS = [
  'StraightPlugsNoGates',
  'StraightPlugsWithGates',
  'SingleDropPlugsNoGates',
  'SingleDropPlugsWithGates',
  'DoubleDropPlugsNoGates',
  'DoubleDropPlugsWithGates',
];

/**
 * Prefab paths worth offering in a picker: the game's own (vanilla
 * ComplexResourceSet blocks) plus every path this mod already uses in LGTuner
 * files or as a zone's CustomGeomorph. Custom geo packs cannot be enumerated.
 */
export function lgtunerPrefabs(project: Project): LgTunerPrefabs {
  const geo = new Set<string>();
  const plug = new Set<string>();
  const vanillaSets = project.vanilla.blocks?.['ComplexResourceSet'];
  const blocks: unknown[] = Array.isArray(vanillaSets)
    ? vanillaSets
    : vanillaSets && typeof vanillaSets === 'object'
      ? Object.values(vanillaSets)
      : [];
  for (const b of blocks) {
    const o = obj(b);
    for (const k of GEO_LISTS) for (const e of arr(o[k])) if (str(obj(e)['Prefab'])) geo.add(str(obj(e)['Prefab']));
    for (const k of PLUG_LISTS) for (const e of arr(o[k])) if (str(obj(e)['Prefab'])) plug.add(str(obj(e)['Prefab']));
  }
  for (const c of lgtunerConfigs(project)) {
    for (const t of c.tileOverrides) {
      if (t.geomorph) geo.add(t.geomorph);
      for (const p of Object.values(t.plugs)) if (p) plug.add(p);
    }
    for (const z of c.zoneOverrides) {
      for (const g of z.geomorphs) if (g.geomorph) geo.add(g.geomorph);
      for (const p of z.plugs) if (p) plug.add(p);
    }
  }
  for (const [type, ids] of project.index.byType) {
    if (type !== 'LevelLayout') continue;
    for (const list of ids.values())
      for (const b of list)
        for (const z of arr(obj(valueOf(b.node))['Zones'])) {
          const g = str(obj(z)['CustomGeomorph']);
          if (g) geo.add(g);
        }
  }
  const sort = (xs: Set<string>) => [...xs].sort((a, b) => a.localeCompare(b));
  return { geomorphs: sort(geo), plugs: sort(plug) };
}

/** A new LGTuner file for a layout, shaped like LGTuner's example (one commented (0,0) entry). */
export function lgtunerSkeleton(layoutId: number, indent = '  '): string {
  const i1 = indent;
  const i2 = indent + indent;
  const i3 = i2 + indent;
  return `{
${i1}"LevelLayoutID": ${layoutId},
${i1}"ExtraComplexResourceToLoad": [],
${i1}"ZoneOverrides": [],
${i1}"TileOverrides": [
${i2}{
${i3}"X": 0, // grid X, east-west ((0,0) is the starting tile)
${i3}"Z": 0, // grid Z, north-south
${i3}"Rotation": "None", // None, Flip, MoveTo_Left, MoveTo_Right, Towards_Random/Forward/Backward/Left/Right
${i3}"Geomorph": "", // prefab to build here (empty = keep the generated one)
${i3}"OverrideAltitude": false,
${i3}"Altitude": 0, // -1 low, 0 mid, 1 high
${i3}"ForwardPlug": "", // south side
${i3}"BackwardPlug": "", // north side
${i3}"LeftPlug": "", // west side
${i3}"RightPlug": "", // east side
${i3}"OverridePlugWithNoGateChance": false,
${i3}"PlugWithNoGateChance": 1.0
${i2}}
${i1}]
}
`;
}

/** Project-relative path for a layout's new LGTuner file. */
export function lgtunerFileIdFor(project: Project, layoutBlockId: BlockId): FileId {
  const block = project.index.byId.get(layoutBlockId);
  const base = (block?.name || `layout-${block?.persistentID ?? 'new'}`)
    .replace(/[<>:"|?*\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  let id = `Custom/LGTuner/${base}.json`;
  let n = 2;
  while (project.files.has(id)) id = `Custom/LGTuner/${base} (${n++}).json`;
  return id;
}
