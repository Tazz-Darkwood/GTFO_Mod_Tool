import { useEffect, useRef, useState } from 'react';
import type { RefCandidateDto } from '@shared/ipc';
import { api } from '../api';

export interface RefPickerProps {
  refType: string;
  value: number;
  onPick(id: number): void;
  onClose(): void;
}

/** Searchable popover listing project + vanilla blocks of a type as "id — name". */
export function RefPicker({ refType, value, onPick, onClose }: RefPickerProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<RefCandidateDto[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    void api.invoke('blocks:searchRefs', { refType, query, limit: 60 }).then((r) => {
      if (!alive) return;
      setItems(r);
      setActive(0);
    });
    return () => {
      alive = false;
    };
  }, [refType, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Enter') {
      const raw = Number(query.trim());
      if (items[active]) onPick(items[active]!.id);
      else if (Number.isInteger(raw)) onPick(raw);
    }
  };

  return (
    <div className="refpicker" ref={box}>
      <input
        ref={input}
        type="search"
        placeholder={`Search ${refType} by ID or name…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="refpicker-list">
        <div className={`refitem ${value === 0 ? 'current' : ''}`} onClick={() => onPick(0)}>
          <span className="rid">0</span>
          <span className="rname muted">(none)</span>
        </div>
        {items.map((it, i) => (
          <div
            key={`${it.source}-${it.id}`}
            className={`refitem ${i === active ? 'active' : ''} ${it.id === value ? 'current' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(it.id)}
          >
            <span className="rid">{it.id}</span>
            <span className="rname">{it.name || <em>(no name)</em>}</span>
            <span className={`rsrc rsrc-${it.source}`}>{it.source}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="empty">
            No matches{/^\d+$/.test(query.trim()) ? ' — press Enter to use this number anyway' : ''}
            .
          </div>
        )}
      </div>
    </div>
  );
}
