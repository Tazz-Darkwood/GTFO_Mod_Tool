import { useMemo } from 'react';
import type { Diagnostic } from '@shared/ipc';
import { useStore, type Severity } from '../store';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const ICON: Record<Severity, string> = { error: '●', warning: '▲', info: 'ℹ' };

export function ProblemsPanel() {
  const diagnostics = useStore((s) => s.diagnostics);
  const filter = useStore((s) => s.severityFilter);
  const toggle = useStore((s) => s.toggleSeverity);
  const codeFilter = useStore((s) => s.codeFilter);
  const setCodeFilter = useStore((s) => s.setCodeFilter);
  const open = useStore((s) => s.problemsOpen);
  const setOpen = useStore((s) => s.setProblemsOpen);
  const navigate = useStore((s) => s.navigateDiagnostic);
  const applyFix = useStore((s) => s.applyFix);
  const selectedBlockId = useStore((s) => s.selectedBlockId);
  const summary = useStore((s) => s.summary);

  const counts = summary?.diagnostics ?? { error: 0, warning: 0, info: 0 };
  const codes = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of diagnostics) m.set(d.code, (m.get(d.code) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [diagnostics]);

  const rows = useMemo(
    () =>
      diagnostics
        .filter((d) => filter[d.severity] && (!codeFilter || d.code === codeFilter))
        .sort(
          (a, b) =>
            ORDER[a.severity] - ORDER[b.severity] ||
            a.file.localeCompare(b.file) ||
            (a.range?.offset ?? 0) - (b.range?.offset ?? 0),
        ),
    [diagnostics, filter, codeFilter],
  );

  return (
    <div className="problems-panel">
      <div className="problems-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span>Problems</span>
        {(['error', 'warning', 'info'] as Severity[]).map((s) => (
          <button
            key={s}
            className={`chip chip-${s} ${filter[s] ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(s);
            }}
            title={`Show ${s}s`}
          >
            {ICON[s]} {counts[s]}
          </button>
        ))}
        <select
          className="code-filter"
          value={codeFilter ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setCodeFilter(e.target.value || null)}
          title="Filter by rule"
        >
          <option value="">all rules</option>
          {codes.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
        <span className="muted right">{rows.length} shown</span>
      </div>
      {open && (
        <div className="problems-list">
          {rows.length === 0 && <div className="empty">No problems match the filter.</div>}
          {rows.map((d, i) => (
            <ProblemRow
              key={i}
              d={d}
              selected={!!d.blockId && d.blockId === selectedBlockId}
              onClick={() => void navigate(d)}
              onFix={d.fix ? () => void applyFix(d.fix!) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProblemRow({
  d,
  selected,
  onClick,
  onFix,
}: {
  d: Diagnostic;
  selected: boolean;
  onClick: () => void;
  onFix?: () => void;
}) {
  return (
    <div className={`problem sev-${d.severity} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="picon">{ICON[d.severity]}</span>
      <span className="pcode" title={d.code}>
        {d.code}
      </span>
      <span className="pmsg">{d.message}</span>
      <span className="ploc" title={d.file}>
        {shortFile(d.file)}
        {d.range ? `:${d.range.line}` : ''}
      </span>
      {onFix && (
        <button
          className="small"
          onClick={(e) => {
            e.stopPropagation();
            onFix();
          }}
          title={d.fix!.title}
        >
          Fix
        </button>
      )}
    </div>
  );
}

function shortFile(f: string): string {
  const parts = f.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : f;
}
