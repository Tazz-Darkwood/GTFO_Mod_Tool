import type { Block, BlockId, FileId, FileShape, JsonPath, TypeName } from '../model/types.js';
import { arrayItems, pathToPointer, propertyNode, type Node } from '../text/jsoncDoc.js';
import { canonicalType } from './typeNames.js';
import { extractPluginBlocks } from './pluginBlocks.js';

export interface ExtractSource {
  id: FileId;
  tree: Node | undefined;
  shape: FileShape;
  wrapperType?: TypeName;
}

export function makeBlockId(fileId: FileId, path: JsonPath): BlockId {
  return `${fileId}#${pathToPointer(path)}`;
}

export function splitBlockId(blockId: BlockId): { fileId: FileId; pointer: string } {
  const i = blockId.lastIndexOf('#');
  return { fileId: blockId.slice(0, i), pointer: blockId.slice(i + 1) };
}

function readBlock(
  fileId: FileId,
  node: Node,
  path: JsonPath,
  fallbackType: TypeName | undefined,
): Block {
  const idProp = propertyNode(node, 'persistentID');
  const nameProp = propertyNode(node, 'name');
  const typeProp = propertyNode(node, 'datablock');

  let persistentID: number | undefined;
  if (idProp && idProp.valueNode.type === 'number' && typeof idProp.valueNode.value === 'number') {
    persistentID = idProp.valueNode.value;
  }
  const name =
    nameProp && nameProp.valueNode.type === 'string' ? String(nameProp.valueNode.value) : undefined;
  const declaredTypeRaw =
    typeProp && typeProp.valueNode.type === 'string' ? String(typeProp.valueNode.value) : undefined;

  // A wrapper file's type wins; partial blocks are typed by their `datablock` field.
  const type = fallbackType ?? (declaredTypeRaw ? canonicalType(declaredTypeRaw) : undefined);

  return {
    id: makeBlockId(fileId, path),
    file: fileId,
    type: type && type.length > 0 ? type : undefined,
    persistentID,
    name,
    path,
    node,
    declaredTypeRaw,
  };
}

/** Pull every block out of a parsed file according to its shape. */
export function extractBlocks(src: ExtractSource): Block[] {
  const { tree } = src;
  if (!tree) return [];
  switch (src.shape) {
    case 'wrapper': {
      const blocks = propertyNode(tree, 'Blocks', false);
      if (!blocks || blocks.valueNode.type !== 'array') return [];
      return arrayItems(blocks.valueNode)
        .map((item, i) =>
          item.type === 'object'
            ? readBlock(src.id, item, ['Blocks', i], src.wrapperType)
            : undefined,
        )
        .filter((b): b is Block => !!b);
    }
    case 'partial-array':
      return arrayItems(tree)
        .map((item, i) =>
          item.type === 'object' ? readBlock(src.id, item, [i], undefined) : undefined,
        )
        .filter((b): b is Block => !!b);
    case 'partial-single':
      return tree.type === 'object' ? [readBlock(src.id, tree, [], undefined)] : [];
    case 'plugin':
      return extractPluginBlocks(src.id, tree);
    default:
      return [];
  }
}
