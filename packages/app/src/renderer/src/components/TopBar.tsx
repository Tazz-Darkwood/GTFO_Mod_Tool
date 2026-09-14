import { useStore } from '../store';

export function TopBar() {
  const summary = useStore((s) => s.summary);
  const openFolder = useStore((s) => s.openFolder);
  const refreshProject = useStore((s) => s.refreshProject);
  const closeProject = useStore((s) => s.closeProject);
  const saveAll = useStore((s) => s.saveAll);
  const update = useStore((s) => s.update);
  const updating = useStore((s) => s.updating);
  const progress = useStore((s) => s.updateProgress);
  const installUpdate = useStore((s) => s.installUpdate);
  const dirty = summary?.dirtyFiles.length ?? 0;

  const updateButton = update && (
    <button
      className="update"
      disabled={updating}
      onClick={() => void installUpdate()}
      title={
        update.canInstall
          ? `Download ${update.latest} next to this exe and restart into it`
          : `Open the ${update.latest} release page`
      }
    >
      {updating && progress
        ? progress.total
          ? `Downloading… ${Math.round((progress.received / progress.total) * 100)}%`
          : `Downloading… ${(progress.received / 1048576).toFixed(0)} MB`
        : `⬆ Update to ${update.latest}`}
    </button>
  );

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
            {updateButton}
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
          {updateButton}
          <button onClick={() => void openFolder()} className="primary">
            Open rundown folder…
          </button>
        </div>
      )}
    </header>
  );
}
