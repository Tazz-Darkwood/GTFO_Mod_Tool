import { useEffect, useMemo, useState } from 'react';
import type { Diagnostic, SchemaClosureDto } from '@shared/ipc';
import { api } from '../api';
import { EditorContext, type EditorCtx } from '../editor/EditorContext';
import { ObjectFields } from '../editor/fields';
import { pointerOf } from '../editor/schemaUtil';
import { useStore } from '../store';

const closureCache = new Map<string, Promise<SchemaClosureDto | null>>();
function getClosure(type: string): Promise<SchemaClosureDto | null> {
  let p = closureCache.get(type);
  if (!p) {
    p = api.invoke('schema:closure', type);
    closureCache.set(type, p);
  }
  return p;
}

/** Schema-driven form for the selected block. */
export function BlockEditor() {
  const block = useStore((s) => s.block);
  const diagnostics = useStore((s) => s.diagnostics);
  const applyEdit = useStore((s) => s.applyEdit);
  const applyMany = useStore((s) => s.applyMany);
  const selectBlock = useStore((s) => s.selectBlock);
  const focusPointer = useStore((s) => s.focusPointer);
  const rawText = useStore((s) =>
    s.raw && s.block && s.raw.fileId === s.block.file ? s.raw.text : null,
  );
  const [closure, setClosure] = useState<SchemaClosureDto | null>(null);

  useEffect(() => {
    if (!block?.type) return;
    let alive = true;
    void getClosure(block.type).then((c) => alive && setClosure(c));
    return () => {
      alive = false;
    };
  }, [block?.type]);

  const problems = useMemo(() => {
    const m = new Map<string, Diagnostic[]>();
    if (!block) return m;
    for (const d of diagnostics) {
      if (d.blockId !== block.blockId || !d.jsonPath) continue;
      const rel = d.jsonPath.slice(block.path.length);
      const ptr = pointerOf(rel);
      m.set(ptr, [...(m.get(ptr) ?? []), d]);
    }
    return m;
  }, [diagnostics, block]);

  if (!block) return null;
  if (!block.type)
    return (
      <div className="editor-placeholder">
        This block has no type, so there is no form for it. Use the source view.
      </div>
    );
  if (!closure) return <div className="editor-placeholder muted">Loading schema…</div>;

  const ctx: EditorCtx = {
    block,
    closure,
    problems,
    focusPointer,
    apply: applyEdit,
    applyMany,
    goToBlock: (id) => void selectBlock(id),
    rawSlice: (pointer) => {
      const r = block.tokenRanges[pointer];
      if (!r || rawText === null) return undefined;
      return rawText.slice(r.offset, r.offset + r.length);
    },
  };
  const value = (block.value ?? {}) as Record<string, unknown>;

  return (
    <EditorContext.Provider value={ctx}>
      <div className="blockeditor">
        <ObjectFields cls={closure.root} value={value} path={[]} />
      </div>
    </EditorContext.Provider>
  );
}
