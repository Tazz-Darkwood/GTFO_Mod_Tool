import { useStore } from '../store';

export function TopBar() {
  const summary = useStore((s) => s.summary);
  const openFolder = useStore((s) => s.openFolder);
  const refreshProject = useStore((s) => s.refreshProject);
  const closeProject = useStore((s) => s.closeProject);
  const saveAll = useStore((s) => s.saveAll);
  const dirty = summary?.dirtyFiles.length ?? 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▣</span> GTFO Datablock Studio
      </div>
      {summary ? (
        <>
          <div className="topbar-path" title={summary.root}>
            {summary.root}
          </div>
          <div className="topbar-actions">
            <button
              onClick={() => void saveAll()}
              disabled={dirty === 0}
              className={dirty ? 'primary' : ''}
              title="Ctrl+Shift+S"
            >
              Save all{dirty ? ` (${dirty})` : ''}
            </button>
            <button onClick={() => void refreshProject()} title="Re-read every file from disk">
              Reload
            </button>
            <button onClick={() => void openFolder()}>Open…</button>
            <button onClick={() => void closeProject()} className="ghost">
              Close
            </button>
          </div>
        </>
      ) : (
        <div className="topbar-actions">
          <button onClick={() => void openFolder()} className="primary">
            Open rundown folder…
          </button>
        </div>
      )}
    </header>
  );
}
