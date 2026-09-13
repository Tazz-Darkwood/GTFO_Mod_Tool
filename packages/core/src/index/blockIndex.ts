import type { Block, BlockIndex, FileId, SourceFile } from '../model/types.js';

export function emptyIndex(): BlockIndex {
  return { byType: new Map(), byId: new Map(), untyped: [], byFile: new Map() };
}

export function indexAddBlocks(index: BlockIndex, fileId: FileId, blocks: Block[]): void {
  index.byFile.set(fileId, blocks);
  for (const b of blocks) {
    index.byId.set(b.id, b);
    if (b.type === undefined || b.persistentID === undefined) {
      index.untyped.push(b);
      continue;
    }
    let ids = index.byType.get(b.type);
    if (!ids) {
      ids = new Map();
      index.byType.set(b.type, ids);
    }
    const list = ids.get(b.persistentID);
    if (list) list.push(b);
    else ids.set(b.persistentID, [b]);
  }
}

export function indexRemoveFile(index: BlockIndex, fileId: FileId): void {
  const blocks = index.byFile.get(fileId);
  if (!blocks) return;
  index.byFile.delete(fileId);
  for (const b of blocks) {
    index.byId.delete(b.id);
    if (b.type !== undefined && b.persistentID !== undefined) {
      const ids = index.byType.get(b.type);
      const list = ids?.get(b.persistentID);
      if (list) {
        const next = list.filter((x) => x.id !== b.id);
        if (next.length) ids!.set(b.persistentID, next);
        else ids!.delete(b.persistentID);
        if (ids!.size === 0) index.byType.delete(b.type);
      }
    }
  }
  index.untyped = index.untyped.filter((b) => b.file !== fileId);
}

export function buildIndex(
  files: Iterable<SourceFile>,
  blocksOf: (f: SourceFile) => Block[],
): BlockIndex {
  const index = emptyIndex();
  for (const f of files) indexAddBlocks(index, f.id, blocksOf(f));
  return index;
}

/** All blocks of a type in the project (not vanilla), in file order. */
export function blocksOfType(index: BlockIndex, type: string): Block[] {
  const ids = index.byType.get(type);
  if (!ids) return [];
  const out: Block[] = [];
  for (const list of ids.values()) out.push(...list);
  return out;
}
