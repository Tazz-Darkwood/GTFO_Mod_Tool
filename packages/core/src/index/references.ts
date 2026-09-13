/**
 * Reverse reference index: which blocks point at (type, persistentID)?
 * Built by a schema walk over every non-plugin block; gates are ignored on
 * purpose so a reference inside a disabled layer still counts for deletion
 * warnings. Plugin config files are scanned with a plain regex as "mentions".
 */
import type { BlockId, FileId, JsonPath, Project, TextRange, TypeName } from '../model/types.js';
import { blockClass } from '../schema/schemaBundle.js';
import { lineIndexFor, rangeOf } from '../text/jsoncDoc.js';
import { walkObject } from '../validate/walk.js';

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

const TEXT_TYPE = 'Text';

export function refKey(type: TypeName, id: number): string {
  return `${type}:${id}`;
}

export function buildReferenceIndex(project: Project): ReferenceIndex {
  const index: ReferenceIndex = new Map();
  const add = (key: string, ref: Reference) => {
    const list = index.get(key);
    if (list) list.push(ref);
    else index.set(key, [ref]);
  };
  for (const block of project.index.byId.values()) {
    if (block.plugin || !block.type) continue;
    const cls = blockClass(project.schema, block.type);
    if (!cls) continue;
    const file = project.files.get(block.file);
    if (!file) continue;
    const li = lineIndexFor(file, file.text);
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
          let target: TypeName | undefined;
          let via: Reference['via'] = 'ref';
          if (v.field.kind === 'ref') target = v.field.refType;
          else if (v.field.kind === 'localizedText') {
            target = TEXT_TYPE;
            via = 'localizedText';
          }
          if (!target) return;
          const last = v.path[v.path.length - 1];
          const field =
            typeof last === 'number'
              ? `item of ${String(v.path[v.path.length - 2] ?? '')}`
              : String(last ?? '');
          add(refKey(target, id), {
            blockId: block.id,
            file: block.file,
            type: block.type,
            persistentID: block.persistentID,
            name: block.name,
            path: v.path,
            field,
            range: rangeOf(v.node, li),
            via,
          });
        },
      },
      { pluginObject: false },
      { applyGates: false },
    );
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
