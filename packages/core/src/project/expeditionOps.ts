/**
 * Edit-op builders for the rundown navigator: expeditions inside a Rundown
 * block and zones inside a LevelLayout block. Everything is expressed as
 * EditOps against the holding block so undo/validation behave as usual.
 */
import type { BlockId, EditOp, JsonPath, Project } from '../model/types.js';
import { EditError } from '../edit/textEdits.js';
import type { EditTarget } from '../edit/editEngine.js';
import { defaultValueFor } from '../schema/defaults.js';
import { nestedClass } from '../schema/schemaBundle.js';
import { parseEnumValue } from '../schema/enumUtil.js';
import { nodeAt, valueOf } from '../text/jsoncDoc.js';
import { tierKey, type Tier } from '../index/rundownTree.js';

export interface OpsPlan {
  target: EditTarget;
  ops: EditOp[];
  /** Path (relative to the block) of the entry the plan creates, when applicable. */
  createdPath?: JsonPath;
}

function blockOf(project: Project, blockId: BlockId, type: string) {
  const b = project.index.byId.get(blockId);
  if (!b) throw new EditError('Block no longer exists');
  if (b.type !== type) throw new EditError(`Expected a ${type} block`);
  const file = project.files.get(b.file);
  if (!file) throw new EditError('File no longer exists');
  return { block: b, file };
}

function defaultObject(project: Project, className: string): Record<string, unknown> {
  const cls = nestedClass(project.schema, className);
  if (!cls) throw new EditError(`Schema has no class ${className}`);
  const out: Record<string, unknown> = {};
  for (const f of cls.fields) out[f.name] = defaultValueFor(project.schema, f, 1);
  return out;
}

/** Enum member name for a value, or the number when the enum has no such member. */
function enumValue(project: Project, enumName: string, n: number): unknown {
  const e = project.schema.enums[enumName];
  const m = e?.members.find((x) => x.value === n);
  return m ? { $enum: m.name } : n;
}

// ---------------------------------------------------------------------------
// Expeditions
// ---------------------------------------------------------------------------

export function addExpeditionOps(
  project: Project,
  rundownBlockId: BlockId,
  tier: Tier,
  info: { prefix: string; publicName: string },
): OpsPlan {
  const { block } = blockOf(project, rundownBlockId, 'Rundown');
  const value = defaultObject(project, 'ExpeditionInTierData');
  value['Enabled'] = true;
  const desc = (value['Descriptive'] ?? {}) as Record<string, unknown>;
  desc['Prefix'] = info.prefix;
  desc['PublicName'] = info.publicName;
  value['Descriptive'] = desc;
  const list = (valueOf(block.node) as Record<string, unknown>)[tierKey(tier)];
  const count = Array.isArray(list) ? list.length : 0;
  const ops: EditOp[] = Array.isArray(list)
    ? [{ op: 'insert', path: [tierKey(tier)], value }]
    : [{ op: 'setProperty', path: [], key: tierKey(tier), value: [value] }];
  return {
    target: { file: block.file, blockId: block.id },
    ops,
    createdPath: [tierKey(tier), count],
  };
}

export function duplicateExpeditionOps(
  project: Project,
  rundownBlockId: BlockId,
  tier: Tier,
  index: number,
): OpsPlan {
  const { block, file } = blockOf(project, rundownBlockId, 'Rundown');
  const node = nodeAt(block.node, [tierKey(tier), index]);
  if (!node) throw new EditError('Expedition no longer exists');
  const raw = file.text.slice(node.offset, node.offset + node.length);
  const exp = valueOf(node) as Record<string, unknown>;
  const prefix = String(((exp['Descriptive'] ?? {}) as Record<string, unknown>)['Prefix'] ?? '');
  return {
    target: { file: block.file, blockId: block.id },
    ops: [
      { op: 'insertRaw', path: [tierKey(tier)], index: index + 1, text: raw },
      {
        op: 'set',
        path: [tierKey(tier), index + 1, 'Descriptive', 'Prefix'],
        value: `${prefix}-copy`,
      },
    ],
    createdPath: [tierKey(tier), index + 1],
  };
}

export function moveExpeditionOps(
  project: Project,
  rundownBlockId: BlockId,
  from: Tier,
  index: number,
  to: Tier,
): OpsPlan {
  if (from === to) throw new EditError('Already in that tier');
  const { block, file } = blockOf(project, rundownBlockId, 'Rundown');
  const node = nodeAt(block.node, [tierKey(from), index]);
  if (!node) throw new EditError('Expedition no longer exists');
  const raw = file.text.slice(node.offset, node.offset + node.length);
  const target = (valueOf(block.node) as Record<string, unknown>)[tierKey(to)];
  const count = Array.isArray(target) ? target.length : 0;
  const insert: EditOp = Array.isArray(target)
    ? { op: 'insertRaw', path: [tierKey(to)], text: raw }
    : { op: 'setProperty', path: [], key: tierKey(to), value: [valueOf(node)] };
  return {
    target: { file: block.file, blockId: block.id },
    ops: [insert, { op: 'remove', path: [tierKey(from), index] }],
    createdPath: [tierKey(to), count],
  };
}

export function deleteExpeditionOps(
  project: Project,
  rundownBlockId: BlockId,
  tier: Tier,
  index: number,
): OpsPlan {
  const { block } = blockOf(project, rundownBlockId, 'Rundown');
  if (!nodeAt(block.node, [tierKey(tier), index]))
    throw new EditError('Expedition no longer exists');
  return {
    target: { file: block.file, blockId: block.id },
    ops: [{ op: 'remove', path: [tierKey(tier), index] }],
  };
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

function zoneLocalIndex(project: Project, zone: unknown): number {
  const v = (
    zone && typeof zone === 'object' ? (zone as Record<string, unknown>)['LocalIndex'] : undefined
  ) as unknown;
  if (typeof v === 'number') return v;
  const e = project.schema.enums['eLocalZoneIndex'];
  if (e && typeof v === 'string') {
    const p = parseEnumValue(e, v);
    if (p.ok && p.members[0]) return p.members[0].value;
  }
  return 0;
}

/** Smallest LocalIndex not used by any zone. */
export function nextLocalIndex(project: Project, zones: unknown[]): number {
  const used = new Set(zones.map((z) => zoneLocalIndex(project, z)));
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

export function addZoneOps(project: Project, layoutBlockId: BlockId): OpsPlan {
  const { block } = blockOf(project, layoutBlockId, 'LevelLayout');
  const value = valueOf(block.node) as Record<string, unknown>;
  const zones = Array.isArray(value['Zones']) ? (value['Zones'] as unknown[]) : [];
  const zone = defaultObject(project, 'ExpeditionZoneData');
  const local = nextLocalIndex(project, zones);
  zone['LocalIndex'] = local;
  const prev = zones.length ? zoneLocalIndex(project, zones[zones.length - 1]) : 0;
  zone['BuildFromLocalIndex'] = zones.length ? prev : 0;
  if (zones.length) {
    // New zones usually continue the previous zone's complex.
    const last = zones[zones.length - 1] as Record<string, unknown>;
    if (last['SubComplex'] !== undefined) zone['SubComplex'] = last['SubComplex'];
    if (last['LightSettings'] !== undefined) zone['LightSettings'] = last['LightSettings'];
  }
  const ops: EditOp[] = Array.isArray(value['Zones'])
    ? [{ op: 'insert', path: ['Zones'], value: zone }]
    : [{ op: 'setProperty', path: [], key: 'Zones', value: [zone] }];
  return {
    target: { file: block.file, blockId: block.id },
    ops,
    createdPath: ['Zones', zones.length],
  };
}

export function duplicateZoneOps(project: Project, layoutBlockId: BlockId, index: number): OpsPlan {
  const { block, file } = blockOf(project, layoutBlockId, 'LevelLayout');
  const node = nodeAt(block.node, ['Zones', index]);
  if (!node) throw new EditError('Zone no longer exists');
  const zones = ((valueOf(block.node) as Record<string, unknown>)['Zones'] ?? []) as unknown[];
  const raw = file.text.slice(node.offset, node.offset + node.length);
  const next = nextLocalIndex(project, zones);
  return {
    target: { file: block.file, blockId: block.id },
    ops: [
      { op: 'insertRaw', path: ['Zones'], index: index + 1, text: raw },
      {
        op: 'set',
        path: ['Zones', index + 1, 'LocalIndex'],
        value: enumValue(project, 'eLocalZoneIndex', next),
      },
    ],
    createdPath: ['Zones', index + 1],
  };
}

export function deleteZoneOps(
  project: Project,
  layoutBlockId: BlockId,
  index: number,
): OpsPlan & { dependents: number[] } {
  const { block } = blockOf(project, layoutBlockId, 'LevelLayout');
  const zones = ((valueOf(block.node) as Record<string, unknown>)['Zones'] ?? []) as unknown[];
  if (!nodeAt(block.node, ['Zones', index])) throw new EditError('Zone no longer exists');
  const local = zoneLocalIndex(project, zones[index]);
  const dependents = zones
    .map((z, i) => ({ z, i }))
    .filter(
      ({ z, i }) =>
        i !== index &&
        zoneLocalIndex(project, {
          LocalIndex: (z as Record<string, unknown>)['BuildFromLocalIndex'],
        }) === local,
    )
    .map(({ i }) => i);
  return {
    target: { file: block.file, blockId: block.id },
    ops: [{ op: 'remove', path: ['Zones', index] }],
    dependents,
  };
}
