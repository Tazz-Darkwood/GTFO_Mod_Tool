/**
 * The rundown navigator's data: Rundown → tiers → expeditions → layers,
 * objectives, dimensions → zones, with problem counts rolled up per node.
 * Pure data (IPC-safe), built from the block index and current diagnostics.
 */
import type { Block, BlockId, Diagnostic, JsonPath, Project, TypeName } from '../model/types.js';
import { parseEnumValue } from '../schema/enumUtil.js';
import { valueOf } from '../text/jsoncDoc.js';
import { lookupRef } from './typeResolution.js';

export type Tier = 'A' | 'B' | 'C' | 'D' | 'E';
export const TIERS: Tier[] = ['A', 'B', 'C', 'D', 'E'];
export const tierKey = (t: Tier) => `Tier${t}` as const;

export type LinkResolution = 'project' | 'vanilla' | 'missing' | 'none';

export interface LinkNode {
  targetType: TypeName;
  id: number;
  resolution: LinkResolution;
  blockId?: BlockId;
  name?: string;
  /** Path of the referring field, relative to the block that holds it. */
  refPath: JsonPath;
  /** Block that holds the reference (a Rundown, Dimension or LevelLayout block). */
  refBlockId: BlockId;
  problems: number;
  detail?: LayoutDetail | ObjectiveDetail;
}

export interface ZoneNode {
  index: number;
  localIndex: number;
  alias: number;
  buildFrom: number;
  subComplex: string;
  alarm: LinkNode | null;
  enemyGroups: number;
  eventCount: number;
  problems: number;
}

export interface LayoutDetail {
  kind: 'layout';
  zoneAliasStart: number;
  zones: ZoneNode[];
}

export interface WaveNode {
  on: string;
  index: number;
  settings: LinkNode | null;
  population: LinkNode | null;
}

export interface ObjectiveDetail {
  kind: 'objective';
  type: string;
  alarms: LinkNode[];
  waves: WaveNode[];
}

export interface LayerNode {
  layer: 'main' | 'secondary' | 'third';
  enabled: boolean;
  layout: LinkNode | null;
  objectives: LinkNode[];
}

export interface DimensionNode {
  index: number;
  dimensionIndex: number;
  enabled: boolean;
  dimension: LinkNode | null;
  layout: LinkNode | null;
}

export interface ExpeditionNode {
  /** Path relative to the Rundown block, e.g. ['TierA', 0]. */
  path: JsonPath;
  tier: Tier;
  index: number;
  enabled: boolean;
  prefix: string;
  publicName: string;
  layers: LayerNode[];
  dimensions: DimensionNode[];
  problems: number;
}

export interface TierNode {
  tier: Tier;
  expeditions: ExpeditionNode[];
}

export interface RundownNode {
  blockId: BlockId;
  id: number;
  name: string;
  loaded: boolean;
  tiers: TierNode[];
  problems: number;
}

export interface RundownTree {
  rundowns: RundownNode[];
  loadedRundownIds: number[];
}

// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function startsWith(path: JsonPath | undefined, prefix: JsonPath): boolean {
  if (!path || path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}

class Ctx {
  readonly byBlock = new Map<BlockId, Diagnostic[]>();
  constructor(readonly project: Project) {
    for (const d of project.diagnostics) {
      if (!d.blockId) continue;
      const list = this.byBlock.get(d.blockId);
      if (list) list.push(d);
      else this.byBlock.set(d.blockId, [d]);
    }
  }
  problemsOf(blockId: BlockId | undefined): number {
    return blockId ? (this.byBlock.get(blockId)?.length ?? 0) : 0;
  }
  /** Diagnostics of `block` whose path starts with block.path + rel. */
  problemsUnder(block: Block, rel: JsonPath): number {
    const prefix = [...block.path, ...rel];
    return (this.byBlock.get(block.id) ?? []).filter((d) => startsWith(d.jsonPath, prefix)).length;
  }
  enumInt(enumName: string, v: unknown): number {
    if (typeof v === 'number') return v;
    const e = this.project.schema.enums[enumName];
    if (e && typeof v === 'string') {
      const p = parseEnumValue(e, v);
      if (p.ok && p.members[0]) return p.members[0].value;
    }
    return 0;
  }
  enumName(enumName: string, v: unknown): string {
    const e = this.project.schema.enums[enumName];
    if (e) {
      const p = parseEnumValue(e, v);
      if (p.ok && p.canonical) return p.canonical;
    }
    return v === undefined ? '' : String(v);
  }
  link(refBlock: Block, refPath: JsonPath, targetType: TypeName, v: unknown): LinkNode | null {
    if (v === undefined || v === null) return null;
    const id = num(v, -1);
    if (id === 0 || id === -1) {
      return { targetType, id, resolution: 'none', refPath, refBlockId: refBlock.id, problems: 0 };
    }
    const r = lookupRef(this.project, targetType, id);
    return {
      targetType,
      id,
      resolution: r ? r.source : 'missing',
      blockId: r?.block?.id,
      name: r?.name,
      refPath,
      refBlockId: refBlock.id,
      problems: this.problemsOf(r?.block?.id),
    };
  }
}

// ---------------------------------------------------------------------------
// Detail builders
// ---------------------------------------------------------------------------

export function layoutDetail(ctx: Ctx, layout: Block): LayoutDetail {
  const value = obj(valueOf(layout.node));
  const zoneAliasStart = num(value['ZoneAliasStart']);
  const zones = arr(value['Zones']).map((z, i): ZoneNode => {
    const zone = obj(z);
    const localIndex = ctx.enumInt('eLocalZoneIndex', zone['LocalIndex']);
    const aliasOverride = num(zone['AliasOverride'], -1);
    let events = 0;
    for (const [k, v] of Object.entries(zone))
      if (k.startsWith('EventsOn')) events += arr(v).length;
    return {
      index: i,
      localIndex,
      alias: aliasOverride >= 0 ? aliasOverride : zoneAliasStart + localIndex,
      buildFrom: ctx.enumInt('eLocalZoneIndex', zone['BuildFromLocalIndex']),
      subComplex: ctx.enumName('SubComplex', zone['SubComplex']),
      alarm: ctx.link(
        layout,
        ['Zones', i, 'ChainedPuzzleToEnter'],
        'ChainedPuzzle',
        zone['ChainedPuzzleToEnter'],
      ),
      enemyGroups: arr(zone['EnemySpawningInZone']).length,
      eventCount: events,
      problems: ctx.problemsUnder(layout, ['Zones', i]),
    };
  });
  return { kind: 'layout', zoneAliasStart, zones };
}

const WAVE_LISTS = ['WavesOnElevatorLand', 'WavesOnActivate', 'WavesOnGotoWin'];
const ALARM_FIELDS = ['ChainedPuzzleToActive', 'ChainedPuzzleMidObjective', 'ChainedPuzzleAtExit'];

export function objectiveDetail(ctx: Ctx, objective: Block): ObjectiveDetail {
  const value = obj(valueOf(objective.node));
  const alarms: LinkNode[] = [];
  for (const f of ALARM_FIELDS) {
    const l = ctx.link(objective, [f], 'ChainedPuzzle', value[f]);
    if (l && l.resolution !== 'none') alarms.push(l);
  }
  const waves: WaveNode[] = [];
  for (const f of WAVE_LISTS) {
    arr(value[f]).forEach((w, i) => {
      const wave = obj(w);
      waves.push({
        on: f.replace(/^WavesOn/, ''),
        index: i,
        settings: ctx.link(
          objective,
          [f, i, 'WaveSettings'],
          'SurvivalWaveSettings',
          wave['WaveSettings'],
        ),
        population: ctx.link(
          objective,
          [f, i, 'WavePopulation'],
          'SurvivalWavePopulation',
          wave['WavePopulation'],
        ),
      });
    });
  }
  return {
    kind: 'objective',
    type: ctx.enumName('eWardenObjectiveType', value['Type']),
    alarms,
    waves,
  };
}

function withDetail(ctx: Ctx, link: LinkNode | null): LinkNode | null {
  if (!link || link.resolution !== 'project' || !link.blockId) return link;
  const b = ctx.project.index.byId.get(link.blockId);
  if (!b) return link;
  if (link.targetType === 'LevelLayout') return { ...link, detail: layoutDetail(ctx, b) };
  if (link.targetType === 'WardenObjective') return { ...link, detail: objectiveDetail(ctx, b) };
  return link;
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function layerNode(
  ctx: Ctx,
  rundown: Block,
  expPath: JsonPath,
  exp: Obj,
  layer: LayerNode['layer'],
): LayerNode {
  const layoutField =
    layer === 'main'
      ? 'LevelLayoutData'
      : layer === 'secondary'
        ? 'SecondaryLayout'
        : 'ThirdLayout';
  const dataField =
    layer === 'main'
      ? 'MainLayerData'
      : layer === 'secondary'
        ? 'SecondaryLayerData'
        : 'ThirdLayerData';
  const enabled =
    layer === 'main'
      ? true
      : exp[`${layer === 'secondary' ? 'Secondary' : 'Third'}LayerEnabled`] === true;
  const layout = withDetail(
    ctx,
    ctx.link(rundown, [...expPath, layoutField], 'LevelLayout', exp[layoutField]),
  );
  const data = obj(exp[dataField]);
  const objectives: LinkNode[] = [];
  const main = ctx.link(
    rundown,
    [...expPath, dataField, 'ObjectiveData', 'DataBlockId'],
    'WardenObjective',
    obj(data['ObjectiveData'])['DataBlockId'],
  );
  if (main && main.resolution !== 'none') objectives.push(withDetail(ctx, main)!);
  arr(data['ChainedObjectiveData']).forEach((c, i) => {
    const l = ctx.link(
      rundown,
      [...expPath, dataField, 'ChainedObjectiveData', i, 'DataBlockId'],
      'WardenObjective',
      obj(c)['DataBlockId'],
    );
    if (l && l.resolution !== 'none') objectives.push(withDetail(ctx, l)!);
  });
  return { layer, enabled, layout, objectives };
}

function dimensionNodes(ctx: Ctx, rundown: Block, expPath: JsonPath, exp: Obj): DimensionNode[] {
  return arr(exp['DimensionDatas']).map((d, i): DimensionNode => {
    const dd = obj(d);
    const dimension = ctx.link(
      rundown,
      [...expPath, 'DimensionDatas', i, 'DimensionData'],
      'Dimension',
      dd['DimensionData'],
    );
    let layout: LinkNode | null = null;
    if (dimension?.blockId) {
      const dimBlock = ctx.project.index.byId.get(dimension.blockId);
      if (dimBlock) {
        const dv = obj(obj(valueOf(dimBlock.node))['DimensionData']);
        layout = withDetail(
          ctx,
          ctx.link(
            dimBlock,
            ['DimensionData', 'LevelLayoutData'],
            'LevelLayout',
            dv['LevelLayoutData'],
          ),
        );
      }
    }
    return {
      index: i,
      dimensionIndex: ctx.enumInt('eDimensionIndex', dd['DimensionIndex']),
      enabled: dd['Enabled'] !== false,
      dimension,
      layout,
    };
  });
}

/** Distinct blocks an expedition links to (layouts, objectives, dimensions and their layouts). */
function linkedBlocks(layers: LayerNode[], dims: DimensionNode[]): Set<BlockId> {
  const seen = new Set<BlockId>();
  const add = (l: LinkNode | null) => {
    if (l?.blockId) seen.add(l.blockId);
  };
  for (const l of layers) {
    add(l.layout);
    l.objectives.forEach(add);
  }
  for (const d of dims) {
    add(d.dimension);
    add(d.layout);
  }
  return seen;
}

function sumLinkedProblems(
  ctx: Ctx,
  rundown: Block,
  expPath: JsonPath,
  layers: LayerNode[],
  dims: DimensionNode[],
): number {
  let n = ctx.problemsUnder(rundown, expPath);
  for (const id of linkedBlocks(layers, dims)) n += ctx.problemsOf(id);
  return n;
}

export function expeditionNode(
  ctx: Ctx,
  rundown: Block,
  tier: Tier,
  index: number,
  exp: Obj,
): ExpeditionNode {
  const path: JsonPath = [tierKey(tier), index];
  const desc = obj(exp['Descriptive']);
  const layers = (['main', 'secondary', 'third'] as const).map((l) =>
    layerNode(ctx, rundown, path, exp, l),
  );
  const dimensions = dimensionNodes(ctx, rundown, path, exp);
  return {
    path,
    tier,
    index,
    enabled: exp['Enabled'] !== false,
    prefix: str(desc['Prefix']),
    publicName: str(desc['PublicName']),
    layers,
    dimensions,
    problems: sumLinkedProblems(ctx, rundown, path, layers, dimensions),
  };
}

function loadedRundownIds(project: Project): number[] {
  const ids = new Set<number>();
  const collect = (v: unknown) => {
    for (const x of arr(obj(v)['RundownIdsToLoad'])) if (typeof x === 'number') ids.add(x);
  };
  const projectSetups = project.index.byType.get('GameSetup');
  if (projectSetups && projectSetups.size) {
    for (const list of projectSetups.values()) for (const b of list) collect(valueOf(b.node));
  } else {
    for (const v of Object.values(project.vanilla.blocks?.['GameSetup'] ?? {})) collect(v);
  }
  return [...ids].sort((a, b) => a - b);
}

export function buildRundownTree(project: Project): RundownTree {
  const ctx = new Ctx(project);
  const loaded = loadedRundownIds(project);
  const rundowns: RundownNode[] = [];
  const blocks = project.index.byType.get('Rundown');
  if (blocks) {
    for (const list of blocks.values()) {
      for (const b of list) {
        const value = obj(valueOf(b.node));
        const tiers: TierNode[] = TIERS.map((t) => ({
          tier: t,
          expeditions: arr(value[tierKey(t)]).map((e, i) => expeditionNode(ctx, b, t, i, obj(e))),
        }));
        // Rundown total = its own diagnostics + each linked block once (a layout shared by two
        // expeditions must not count twice).
        const all = new Set<BlockId>();
        for (const t of tiers)
          for (const e of t.expeditions)
            for (const id of linkedBlocks(e.layers, e.dimensions)) all.add(id);
        let problems = ctx.problemsOf(b.id);
        for (const id of all) problems += ctx.problemsOf(id);
        rundowns.push({
          blockId: b.id,
          id: b.persistentID ?? -1,
          name: b.name ?? '',
          loaded: b.persistentID !== undefined && loaded.includes(b.persistentID),
          tiers,
          problems,
        });
      }
    }
  }
  rundowns.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.id - b.id);
  return { rundowns, loadedRundownIds: loaded };
}
