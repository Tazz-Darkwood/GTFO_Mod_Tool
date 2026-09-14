/**
 * Text field for a prefab path (geomorph or plug) with a filterable list of
 * known paths: the game's own from the vanilla ComplexResourceSet blocks, plus
 * every path already used in this mod. Free text is always allowed because
 * custom geomorph packs cannot be enumerated.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export function PrefabPicker({
  value,
  options,
  onCommit,
  placeholder,
}: {
  value: string;
  options: string[];
  onCommit: (path: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = q.length
      ? options.filter((o) => {
          const l = o.toLowerCase();
          return q.every((w) => l.includes(w));
        })
      : options;
    return list.slice(0, 40);
  }, [draft, options]);

  const commit = (v: string) => {
    setOpen(false);
    if (v !== value) onCommit(v);
    setDraft(v);
  };

  return (
    <div className="prefabpicker" ref={box}>
      <input
        className={`cinput wide ${draft !== value ? 'pending' : ''}`}
        value={draft}
        placeholder={placeholder ?? 'Assets/…/name.prefab (empty = unchanged)'}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Let a click on a list item win; otherwise commit typed text.
          setTimeout(() => {
            if (!box.current?.contains(document.activeElement)) commit(draft);
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setActive((a) => Math.min(a + 1, matches.length - 1));
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setActive((a) => Math.max(a - 1, 0));
            e.preventDefault();
          } else if (e.key === 'Enter') {
            commit(open && matches[active] ? matches[active]! : draft);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <div className="prefabpicker-list">
          {matches.map((m, i) => (
            <div
              key={m}
              className={`prefabpicker-item ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(m);
              }}
              title={m}
            >
              <span className="mono">{m.slice(m.lastIndexOf('/') + 1)}</span>
              <span className="muted"> {m.slice(0, m.lastIndexOf('/') + 1)}</span>
            </div>
          ))}
          {matches.length === 40 && <div className="muted prefabpicker-more">type to narrow…</div>}
        </div>
      )}
    </div>
  );
}
