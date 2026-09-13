/**
 * B-rules: the three mandatory block fields and the `datablock` type tag.
 */
import type { Block, Project, TypeName } from '../../model/types.js';
import { properties, propertyNode } from '../../text/jsoncDoc.js';
import { matchKnownType } from '../../project/typeNames.js';
import type { Reporter } from '../validator.js';

export function checkBlockShape(project: Project, block: Block, r: Reporter): void {
  const file = project.files.get(block.file)!;
  const isPartial = file.shape === 'partial-array' || file.shape === 'partial-single';
  const known = Object.keys(project.schema.blockTypes);

  // --- datablock type -------------------------------------------------------
  if (isPartial) {
    const typeProp = propertyNode(block.node, 'datablock');
    if (!typeProp) {
      const inferred = inferBlockType(project, block);
      r.add({
        code: 'B001',
        file: block.file,
        node: block.node,
        path: block.path,
        blockId: block.id,
        message:
          `Block ${describe(block)} has no "datablock" field, so MTFO cannot load it` +
          (inferred ? ` (looks like ${inferred.type}, ${inferred.reason}).` : '.'),
        fix: inferred
          ? {
              title: `Add "datablock": "${inferred.type}"`,
              edits: [
                {
                  file: block.file,
                  blockId: block.id,
                  op: { op: 'setProperty', path: [], key: 'datablock', value: inferred.type },
                },
              ],
            }
          : undefined,
      });
    } else if (block.declaredTypeRaw !== undefined) {
      const m = matchKnownType(block.declaredTypeRaw, known);
      if (!m) {
        r.add({
          code: 'B006',
          file: block.file,
          node: typeProp.valueNode,
          path: [...block.path, 'datablock'],
          blockId: block.id,
          message: `"${block.declaredTypeRaw}" is not a known datablock type.`,
        });
      } else if (!m.exact || block.type !== m.type) {
        r.add({
          code: 'B006',
          severity: 'warning',
          file: block.file,
          node: typeProp.valueNode,
          path: [...block.path, 'datablock'],
          blockId: block.id,
          message: `"${block.declaredTypeRaw}" should be written "${m.type}".`,
          fix: {
            title: `Change to "${m.type}"`,
            edits: [
              {
                file: block.file,
                blockId: block.id,
                op: { op: 'set', path: ['datablock'], value: m.type },
              },
            ],
          },
        });
      }
    } else {
      r.add({
        code: 'B006',
        file: block.file,
        node: typeProp.valueNode,
        path: [...block.path, 'datablock'],
        blockId: block.id,
        message: `"datablock" must be a string type name.`,
      });
    }
  } else if (block.type && !project.schema.blockTypes[block.type]) {
    r.add({
      code: 'B006',
      file: block.file,
      node: block.node,
      path: block.path,
      blockId: block.id,
      message: `File type "${block.type}" is not a known datablock type.`,
    });
  }

  // --- persistentID ---------------------------------------------------------
  const idProp = propertyNode(block.node, 'persistentID');
  if (!idProp) {
    r.add({
      code: 'B002',
      file: block.file,
      node: block.node,
      path: block.path,
      blockId: block.id,
      message: `Block ${describe(block)} has no "persistentID".`,
    });
  } else if (idProp.valueNode.type === 'string') {
    r.add({
      code: 'B003',
      file: block.file,
      node: idProp.valueNode,
      path: [...block.path, 'persistentID'],
      blockId: block.id,
      message: `persistentID "${String(idProp.valueNode.value)}" is a string; the tool cannot check references to it yet.`,
    });
  } else if (idProp.valueNode.type !== 'number') {
    r.add({
      code: 'B002',
      file: block.file,
      node: idProp.valueNode,
      path: [...block.path, 'persistentID'],
      blockId: block.id,
      message: `persistentID must be a number.`,
    });
  }

  // --- name -----------------------------------------------------------------
  const nameProp = propertyNode(block.node, 'name');
  if (!nameProp) {
    r.add({
      code: 'B004',
      file: block.file,
      node: block.node,
      path: block.path,
      blockId: block.id,
      message: `Block ${describe(block)} has no "name".`,
    });
  } else if (
    nameProp.valueNode.type === 'string' &&
    String(nameProp.valueNode.value).trim() === ''
  ) {
    r.add({
      code: 'B005',
      file: block.file,
      node: nameProp.valueNode,
      path: [...block.path, 'name'],
      blockId: block.id,
      message: `Block ${describe(block)} has an empty name.`,
    });
  }
}

export function describe(block: Block): string {
  const parts: string[] = [];
  if (block.type) parts.push(block.type);
  if (block.persistentID !== undefined) parts.push(`#${block.persistentID}`);
  if (block.name) parts.push(`"${block.name}"`);
  return parts.length ? parts.join(' ') : `at ${block.path.length ? block.path.join('.') : 'root'}`;
}

/**
 * Guess the type of an untagged partial block:
 * 1. unanimous `datablock` among sibling blocks in the same array;
 * 2. otherwise the schema whose field names best cover the block's keys.
 */
export function inferBlockType(
  project: Project,
  block: Block,
): { type: TypeName; reason: string } | undefined {
  const siblings = (project.index.byFile.get(block.file) ?? []).filter(
    (b) => b.id !== block.id && b.type,
  );
  const types = new Set(siblings.map((b) => b.type!));
  if (types.size === 1)
    return { type: [...types][0]!, reason: 'same as the other blocks in this file' };

  const keys = properties(block.node)
    .map((p) => p.key.toLowerCase())
    .filter((k) => !['name', 'internalenabled', 'persistentid', 'datablock'].includes(k));
  if (keys.length === 0) return undefined;
  let best: { type: string; score: number } | undefined;
  let second = 0;
  for (const [type, cls] of Object.entries(project.schema.blockTypes)) {
    const hit = keys.filter((k) => cls.fieldsByLowerName[k] !== undefined).length;
    const score = hit / keys.length;
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { type, score };
    } else if (score > second) second = score;
  }
  if (best && best.score >= 0.8 && best.score > second)
    return { type: best.type, reason: `${Math.round(best.score * 100)}% of its fields match` };
  return undefined;
}
