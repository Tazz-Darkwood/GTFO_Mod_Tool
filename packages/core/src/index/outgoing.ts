/**
 * Outgoing references of one block: every `ref` / `localizedText` field with a
 * non-zero numeric value, resolved against the project and vanilla.
 * Shared by the reverse reference index and the rundown navigator.
 */
import type { Block, JsonPath, Project, TextRange, TypeName } from '../model/types.js';
import { blockClass } from '../schema/schemaBundle.js';
import { lineIndexFor, rangeOf } from '../text/jsoncDoc.js';
import { walkObject } from '../validate/walk.js';
import { lookupRef } from './typeResolution.js';

export type RefResolution = 'project' | 'vanilla' | 'missing';

export interface RefHit {
  /** Field name, or "item of <list>" for list entries. */
  field: string;
  /** Path of the referring value from the file root. */
  path: JsonPath;
  targetType: TypeName;
  id: number;
  resolution: RefResolution;
  targetBlockId?: string;
  targetName?: string;
  range: TextRange;
  via: 'ref' | 'localizedText';
}

const TEXT_TYPE = 'Text';

/** All references leaving `block`. Gates are ignored so disabled layers still count. */
export function collectRefs(project: Project, block: Block): RefHit[] {
  if (block.plugin || !block.type) return [];
  const cls = blockClass(project.schema, block.type);
  const file = project.files.get(block.file);
  if (!cls || !file) return [];
  const li = lineIndexFor(file, file.text);
  const out: RefHit[] = [];
  walkObject(
    project.schema,
    cls,
    block.node,
    block.path,
    {
      onValue(v) {
        if (v.node.type !== 'number') return;
        const id = v.node.value as number;
        if (id === 0 || id === -1) return;
        let targetType: TypeName | undefined;
        let via: RefHit['via'] = 'ref';
        if (v.field.kind === 'ref') targetType = v.field.refType;
        else if (v.field.kind === 'localizedText') {
          targetType = TEXT_TYPE;
          via = 'localizedText';
        }
        if (!targetType) return;
        const last = v.path[v.path.length - 1];
        const field =
          typeof last === 'number'
            ? `item of ${String(v.path[v.path.length - 2] ?? '')}`
            : String(last ?? '');
        const r = lookupRef(project, targetType, id);
        out.push({
          field,
          path: v.path,
          targetType,
          id,
          resolution: r ? r.source : 'missing',
          targetBlockId: r?.block?.id,
          targetName: r?.name,
          range: rangeOf(v.node, li),
          via,
        });
      },
    },
    { pluginObject: false },
    { applyGates: false },
  );
  return out;
}
