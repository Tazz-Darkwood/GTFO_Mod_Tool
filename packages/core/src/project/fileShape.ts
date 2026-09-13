import type { FileId, FileShape } from '../model/types.js';
import { propertyNode, type Node } from '../text/jsoncDoc.js';
import { wrapperFileType } from './typeNames.js';

function baseName(fileId: FileId): string {
  const i = fileId.lastIndexOf('/');
  return i >= 0 ? fileId.slice(i + 1) : fileId;
}

function looksLikeBlock(node: Node): boolean {
  if (node.type !== 'object') return false;
  return !!propertyNode(node, 'persistentID') || !!propertyNode(node, 'datablock');
}

/**
 * Classify a file by its location and parsed tree.
 * Location rules first (Custom/ is always plugin config, PartialData/_*.json is meta),
 * then structural rules on the tree.
 */
export function detectShape(fileId: FileId, tree: Node | undefined): FileShape {
  const base = baseName(fileId);
  if (/^Custom\//i.test(fileId)) return 'plugin';
  if (/^PartialData\//i.test(fileId) && base.startsWith('_')) return 'meta';
  if (!tree) return 'unknown';

  if (tree.type === 'object') {
    const blocks = propertyNode(tree, 'Blocks', false);
    if (blocks && blocks.valueNode.type === 'array') return 'wrapper';
    if (wrapperFileType(base)) return 'wrapper'; // wrapper-named file with odd contents
    if (looksLikeBlock(tree)) return 'partial-single';
    return 'unknown';
  }
  if (tree.type === 'array') {
    const items = tree.children ?? [];
    if (items.length === 0) return 'partial-array';
    if (items.some(looksLikeBlock)) return 'partial-array';
    return 'unknown';
  }
  return 'unknown';
}
