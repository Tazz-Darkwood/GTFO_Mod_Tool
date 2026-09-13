/**
 * Schema-driven rules over a block's content: unknown/miscased fields (T003/T004),
 * type mismatches (T001/T002), enum values (E001/E002) and dangling references (R001).
 *
 * Findings on values a wrapper block inherited unchanged from vanilla are
 * suppressed: the game ships with some dangling references and odd enum values
 * of its own, and those are not the modder's problem.
 */
import type { Block, FieldSchema, JsonPath, Project } from '../../model/types.js';
import { lookupRef } from '../../index/typeResolution.js';
import { parseEnumValue } from '../../schema/enumUtil.js';
import { blockClass } from '../../schema/schemaBundle.js';
import { valueOf, type Node } from '../../text/jsoncDoc.js';
import { walkObject } from '../walk.js';
import type { Reporter } from '../validator.js';

const BLOCK_META_KEYS = new Set(['datablock']);
const TEXT_TYPE = 'Text';

/** Value at `path` inside a plain JSON value, or `undefined`. */
function valueAtPath(root: unknown, path: JsonPath): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg as string];
  }
  return cur;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka)
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      return false;
  return true;
}

/** The vanilla block with the same (type, id), if the host loaded full vanilla blocks. */
function vanillaTwin(project: Project, block: Block): unknown {
  if (block.type === undefined || block.persistentID === undefined) return undefined;
  return project.vanilla.blocks?.[block.type]?.[String(block.persistentID)];
}

export function checkBlockContent(project: Project, block: Block, r: Reporter): void {
  if (!block.type || block.plugin) return;
  const cls = blockClass(project.schema, block.type);
  if (!cls) return;
  const file = block.file;
  const twin =
    project.files.get(file)?.shape === 'wrapper' ? vanillaTwin(project, block) : undefined;
  const rel = (path: JsonPath) => path.slice(block.path.length);
  /** True when the value at this path is identical to vanilla (inherited, not authored). */
  const inherited = (path: JsonPath, node: Node) =>
    twin !== undefined && deepEqual(valueAtPath(twin, rel(path)), valueOf(node));

  walkObject(
    project.schema,
    cls,
    block.node,
    block.path,
    {
      onProperty(v) {
        if (v.field) {
          if (v.caseMismatch) {
            r.add({
              code: 'T004',
              file,
              node: v.prop.keyNode,
              path: v.path,
              blockId: block.id,
              message: `"${v.prop.key}" is written "${v.field.name}" in the game data.`,
            });
          }
          return;
        }
        if (v.ctx.pluginObject) return;
        if (
          v.path.length === block.path.length + 1 &&
          BLOCK_META_KEYS.has(v.prop.key.toLowerCase())
        )
          return;
        if (twin !== undefined && valueAtPath(twin, rel(v.path)) !== undefined) return; // vanilla has it too
        r.add({
          code: 'T003',
          file,
          node: v.prop.keyNode,
          path: v.path,
          blockId: block.id,
          message: `"${v.prop.key}" is not a field of ${v.cls.name}; the game will ignore it.`,
        });
      },
      onValue(v) {
        if (v.isPluginEventType) return; // plugin-defined event type; nothing to check
        if (inherited(v.path, v.node)) return;
        checkValue(project, block, v.field, v.node, v.path, r);
      },
    },
    { pluginObject: false },
    { applyGates: true },
  );
}

function typeName(node: Node): string {
  return node.type === 'null' ? 'null' : node.type;
}

function checkValue(
  project: Project,
  block: Block,
  field: FieldSchema,
  node: Node,
  path: JsonPath,
  r: Reporter,
): void {
  const file = block.file;
  const label = field.name || `item of ${String(path[path.length - 2] ?? '')}`;
  const mismatch = (expected: string) =>
    r.add({
      code: 'T001',
      file,
      node,
      path,
      blockId: block.id,
      message: `${label} should be ${expected}, but is ${typeName(node)}.`,
    });

  switch (field.kind) {
    case 'scalar': {
      if (field.scalar === 'Boolean') {
        if (node.type !== 'boolean') mismatch('true or false');
      } else if (field.scalar === 'String') {
        if (node.type !== 'string' && node.type !== 'null') mismatch('a string');
      } else {
        if (node.type === 'string' && /^-?\d+(\.\d+)?$/.test(String(node.value).trim())) {
          r.add({
            code: 'T002',
            file,
            node,
            path,
            blockId: block.id,
            message: `${label} is the number ${String(node.value)} written as a string.`,
            fix: {
              title: 'Remove the quotes',
              edits: [
                {
                  file,
                  blockId: block.id,
                  op: { op: 'set', path: path.slice(block.path.length), value: Number(node.value) },
                },
              ],
            },
          });
        } else if (node.type !== 'number') mismatch('a number');
      }
      return;
    }
    case 'enum': {
      const e = project.schema.enums[field.enumName];
      if (!e) return;
      if (node.type !== 'number' && node.type !== 'string') {
        mismatch(`a ${field.enumName} value`);
        return;
      }
      const parsed = parseEnumValue(e, node.value);
      if (!parsed.ok && node.type === 'number' && e.open && Number.isInteger(node.value)) return;
      if (!parsed.ok) {
        const sample =
          e.members
            .slice(0, 6)
            .map((m) => m.name)
            .join(', ') + (e.members.length > 6 ? ', ...' : '');
        // Unknown numbers are a warning: the game reads the raw int and modders use values beyond the named ones.
        const severity = node.type === 'number' ? 'warning' : 'error';
        r.add({
          code: 'E001',
          severity,
          file,
          node,
          path,
          blockId: block.id,
          message: `${JSON.stringify(node.value)} is not a named ${field.enumName} value (${sample}).`,
        });
      } else if (parsed.caseMismatch) {
        r.add({
          code: 'E002',
          file,
          node,
          path,
          blockId: block.id,
          message: `${JSON.stringify(node.value)} should be written "${parsed.canonical}".`,
          fix: {
            title: `Change to "${parsed.canonical}"`,
            edits: [
              {
                file,
                blockId: block.id,
                op: { op: 'set', path: path.slice(block.path.length), value: parsed.canonical },
              },
            ],
          },
        });
      }
      return;
    }
    case 'ref': {
      if (node.type === 'string') return; // string GUID (PartialData) — not checked in v1
      if (node.type !== 'number') {
        mismatch(`a ${field.refType} ID`);
        return;
      }
      const id = node.value as number;
      if (id === 0 || id === -1) return;
      if (!lookupRef(project, field.refType, id)) {
        const hint = otherTypeHint(project, field.refType, id);
        r.add({
          code: 'R001',
          file,
          node,
          path,
          blockId: block.id,
          message: `${label} points to ${field.refType} #${id}, which does not exist.${hint}`,
        });
      }
      return;
    }
    case 'localizedText': {
      if (node.type === 'number') {
        const id = node.value as number;
        if (id !== 0 && !lookupRef(project, TEXT_TYPE, id)) {
          r.add({
            code: 'R001',
            file,
            node,
            path,
            blockId: block.id,
            message: `${label} points to Text #${id}, which does not exist.`,
          });
        }
      } else if (node.type !== 'string' && node.type !== 'object' && node.type !== 'null') {
        mismatch('a Text ID or a string');
      }
      return;
    }
    case 'object':
    case 'builtin':
      if (node.type !== 'object' && node.type !== 'null') mismatch('an object');
      return;
    case 'list':
      if (node.type !== 'array' && node.type !== 'null') mismatch('a list');
      return;
    case 'unknown':
      return;
  }
}

/**
 * If a custom-range ID exists under a different type in the project, say so
 * (catches swapped fields). Small IDs collide across vanilla types constantly, so skip them.
 */
function otherTypeHint(project: Project, refType: string, id: number): string {
  if (id < 1000) return '';
  const hits: string[] = [];
  for (const [type, ids] of project.index.byType) {
    if (type === refType) continue;
    const b = ids.get(id)?.[0];
    if (b) hits.push(`${type} "${b.name ?? ''}"`);
  }
  return hits.length
    ? ` (an ID ${id} exists as ${hits.slice(0, 2).join(' and ')}; swapped fields?)`
    : '';
}
