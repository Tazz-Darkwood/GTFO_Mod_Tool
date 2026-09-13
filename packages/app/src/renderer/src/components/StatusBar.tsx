import { KOFI_URL, openUrl } from '../links';
import { useStore } from '../store';

export function StatusBar() {
  const summary = useStore((s) => s.summary);
  const block = useStore((s) => s.block);
  const raw = useStore((s) => s.raw);
  if (!summary) return null;
  const shapes = Object.entries(summary.shapes)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
  return (
    <footer className="statusbar">
      <span>
        {summary.fileCount} files ({shapes}) · {summary.blockCount} blocks
      </span>
      <span className="muted">{raw ? raw.fileId : ''}</span>
      <span className="right">
        {block?.dirty && <span className="dirty">● unsaved</span>}
        <span className="muted">schema {summary.schemaCommit}</span>
        <button
          className="kofi"
          onClick={() => openUrl(KOFI_URL)}
          title="Buy the developer a coffee on Ko-fi"
        >
          ☕ support
        </button>
      </span>
    </footer>
  );
}
