/**
 * Some plugin config files define IDs that datablocks reference. Known ones are
 * exposed as blocks (with `plugin` set) so references resolve and duplicates
 * are caught, without validating their contents against the datablock schema.
 */
import type { Block, FileId } from '../model/types.js';
import { arrayItems, propertyNode, type Node } from '../text/jsoncDoc.js';
import { makeBlockId } from './blockExtractor.js';

interface PluginAdapter {
  plugin: string;
  /** Matches the project-relative file id. */
  match: RegExp;
  extract(fileId: FileId, tree: Node): Block[];
}

const ADAPTERS: PluginAdapter[] = [
  {
    // Inas07 ExtraChainedPuzzleCustomization: Custom/PuzzleTypes.json
    //   { "Scans": [ { "PersistentID": 7250, "name": "Dual", ... } ], "Clusters": [ { "PersistentID": 125, ... } ] }
    // Both arrays define ChainedPuzzleType IDs usable in ChainedPuzzle.ChainedPuzzle[].PuzzleType.
    plugin: 'ExtraChainedPuzzleCustomization',
    match: /^Custom\/PuzzleTypes\.jsonc?$/i,
    extract(fileId, tree) {
      if (tree.type !== 'object') return [];
      const out: Block[] = [];
      for (const listKey of ['Scans', 'Clusters']) {
        const list = propertyNode(tree, listKey);
        if (!list || list.valueNode.type !== 'array') continue;
        arrayItems(list.valueNode).forEach((item, i) => {
          if (item.type !== 'object') return;
          const id = propertyNode(item, 'PersistentID');
          if (!id || id.valueNode.type !== 'number') return;
          const name = propertyNode(item, 'name');
          out.push({
            id: makeBlockId(fileId, [listKey, i]),
            file: fileId,
            type: 'ChainedPuzzleType',
            persistentID: id.valueNode.value as number,
            name:
              name && name.valueNode.type === 'string'
                ? String(name.valueNode.value)
                : `${listKey.slice(0, -1)} ${i + 1}`,
            path: [listKey, i],
            node: item,
            plugin: 'ExtraChainedPuzzleCustomization',
          });
        });
      }
      return out;
    },
  },
];

export function extractPluginBlocks(fileId: FileId, tree: Node | undefined): Block[] {
  if (!tree) return [];
  for (const a of ADAPTERS) if (a.match.test(fileId)) return a.extract(fileId, tree);
  return [];
}
