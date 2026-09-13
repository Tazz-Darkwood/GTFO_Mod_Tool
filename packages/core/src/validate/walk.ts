/**
 * Schema-guided traversal of a block's JSON tree. Shared by validation rules
 * and (later) the form builder.
 */
import type { ClassSchema, FieldSchema, JsonPath, SchemaBundle } from '../model/types.js';
import { nestedClass } from '../schema/schemaBundle.js';
import { resolveField } from '../schema/fieldLookup.js';
import { parseEnumValue } from '../schema/enumUtil.js';
import { properties, type Node, type PropertyEntry } from '../text/jsoncDoc.js';
import { isGatedOff } from './gates.js';

export interface WalkContext {
  /** Object is an event whose `Type` is not a vanilla enum member: a plugin (AWO/EOS) event with its own fields. */
  pluginObject: boolean;
}

export interface FieldVisit {
  cls: ClassSchema;
  prop: PropertyEntry;
  path: JsonPath;
  field: FieldSchema | undefined;
  caseMismatch: boolean;
  ctx: WalkContext;
}

export interface ValueVisit {
  field: FieldSchema;
  node: Node;
  path: JsonPath;
  ctx: WalkContext;
  /** True when this value is the `Type` discriminator of a plugin event. */
  isPluginEventType?: boolean;
}

export interface WalkVisitor {
  /** Every property of every object that has a class schema. */
  onProperty?(v: FieldVisit): void;
  /** Every value that has a field schema (including list items, where field is the item schema). */
  onValue?(v: ValueVisit): void;
}

export interface WalkOptions {
  /** Honour the sibling-boolean gates (validation wants this; form rendering does not). */
  applyGates?: boolean;
}

/** Event classes are recognised by an enum-typed `Type` field of this enum. */
const EVENT_TYPE_ENUM = 'eWardenObjectiveEventType';

function pluginEventTypeNode(bundle: SchemaBundle, cls: ClassSchema, node: Node): Node | undefined {
  const typeField = cls.fields.find(
    (f) => f.name === 'Type' && f.kind === 'enum' && f.enumName === EVENT_TYPE_ENUM,
  );
  if (!typeField || typeField.kind !== 'enum') return undefined;
  const e = bundle.enums[typeField.enumName];
  for (const p of properties(node)) {
    if (p.key.toLowerCase() !== 'type') continue;
    const v = p.valueNode;
    if (v.type !== 'number') return undefined;
    if (e && parseEnumValue(e, v.value).ok) return undefined;
    return v;
  }
  return undefined;
}

export function walkObject(
  bundle: SchemaBundle,
  cls: ClassSchema,
  node: Node,
  path: JsonPath,
  visitor: WalkVisitor,
  ctx: WalkContext = { pluginObject: false },
  opts: WalkOptions = {},
): void {
  if (node.type !== 'object') return;
  const pluginTypeNode = pluginEventTypeNode(bundle, cls, node);
  const localCtx: WalkContext = ctx.pluginObject || pluginTypeNode ? { pluginObject: true } : ctx;
  for (const prop of properties(node)) {
    if (opts.applyGates && isGatedOff(cls.name, node, prop.key)) continue;
    const m = resolveField(cls, prop.key);
    const childPath = [...path, prop.key];
    visitor.onProperty?.({
      cls,
      prop,
      path: childPath,
      field: m?.field,
      caseMismatch: m?.caseMismatch ?? false,
      ctx: localCtx,
    });
    if (m)
      walkValue(
        bundle,
        m.field,
        prop.valueNode,
        childPath,
        visitor,
        localCtx,
        opts,
        prop.valueNode === pluginTypeNode,
      );
  }
}

export function walkValue(
  bundle: SchemaBundle,
  field: FieldSchema,
  node: Node,
  path: JsonPath,
  visitor: WalkVisitor,
  ctx: WalkContext,
  opts: WalkOptions = {},
  isPluginEventType = false,
): void {
  visitor.onValue?.({ field, node, path, ctx, isPluginEventType });
  switch (field.kind) {
    case 'object': {
      const cls = nestedClass(bundle, field.className);
      if (cls && node.type === 'object') walkObject(bundle, cls, node, path, visitor, ctx, opts);
      return;
    }
    case 'list': {
      if (node.type !== 'array' || !node.children) return;
      node.children.forEach((item, i) =>
        walkValue(bundle, field.item, item, [...path, i], visitor, ctx, opts),
      );
      return;
    }
    default:
      return;
  }
}
