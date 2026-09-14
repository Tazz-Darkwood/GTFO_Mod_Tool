/**
 * Reverse reference index: which blocks point at (type, persistentID)?
 * Built from `collectRefs` over every non-plugin block; gates are ignored on
 * purpose so a reference inside a disabled layer still counts for deletion
 * warnings. Plugin config files are scanned with a plain regex as "mentions".
 */
import type { BlockId, FileId, JsonPath, Project, TextRange, TypeName } from '../model/types.js';
import { lineIndexFor } from '../text/jsoncDoc.js';
import { collectRefs } from './outgoing.js';

export interface Reference {
  /** The referring block. */
  blockId: BlockId;
  file: FileId;
  type: TypeName | undefined;
  persistentID: number | undefined;
  name: string | undefined;
  /** Path of the referring field from the file root. */
  path: JsonPath;
  /** Field name (or "item of <list>"). */
  field: string;
  range: TextRange;
  via: 'ref' | 'localizedText';
}

export interface PluginMention {
  file: FileId;
  line: number;
  col: number;
  /** The line of text containing the mention, trimmed. */
  snippet: string;
}

export type ReferenceIndex = Map<string, Reference[]>;

export function refKey(type: TypeName, id: number): string {
  return `${type}:${id}`;
}

export function buildReferenceIndex(project: Project): ReferenceIndex {
  const index: ReferenceIndex = new Map();
  for (const block of project.index.byId.values()) {
    for (const hit of collectRefs(project, block)) {
      const key = refKey(hit.targetType, hit.id);
      const ref: Reference = {
        blockId: block.id,
        file: block.file,
        type: block.type,
        persistentID: block.persistentID,
        name: block.name,
        path: hit.path,
        field: hit.field,
        range: hit.range,
        via: hit.via,
      };
      const list = index.get(key);
      if (list) list.push(ref);
      else index.set(key, [ref]);
    }
  }
  return index;
}

export function findReferences(
  project: Project,
  type: TypeName,
  id: number,
  index?: ReferenceIndex,
): Reference[] {
  return (index ?? buildReferenceIndex(project)).get(refKey(type, id)) ?? [];
}

/** References from blocks in other files to any block defined in `fileId`. */
export function findReferencesToFile(
  project: Project,
  fileId: FileId,
  index?: ReferenceIndex,
): Reference[] {
  const idx = index ?? buildReferenceIndex(project);
  const out: Reference[] = [];
  for (const b of project.index.byFile.get(fileId) ?? []) {
    if (!b.type || b.persistentID === undefined) continue;
    for (const r of idx.get(refKey(b.type, b.persistentID)) ?? [])
      if (r.file !== fileId) out.push(r);
  }
  return out;
}

/**
 * Plugin config (EOS, LGTuner, ...) keys layouts and blocks by raw numbers the
 * schema walk cannot see. For custom-range ids (>= 1000) a whole-word search
 * over plugin files is a useful "possible mention" hint.
 */
export function pluginMentions(project: Project, id: number): PluginMention[] {
  if (id < 1000) return [];
  const out: PluginMention[] = [];
  const re = new RegExp(`(?<![\\d.])${id}(?![\\d.])`, 'g');
  for (const f of project.files.values()) {
    if (f.shape !== 'plugin') continue;
    const li = lineIndexFor(f, f.text);
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text))) {
      const { line, col } = li.position(m.index);
      const lineStart = li.lineStartOffset(m.index);
      let lineEnd = f.text.indexOf('\n', m.index);
      if (lineEnd < 0) lineEnd = f.text.length;
      out.push({
        file: f.id,
        line,
        col,
        snippet: f.text.slice(lineStart, lineEnd).trim().slice(0, 120),
      });
    }
  }
  return out;
}
