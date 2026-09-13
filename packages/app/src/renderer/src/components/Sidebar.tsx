import { useStore } from '../store';
import { BlockList } from './BlockList';
import { FilesView } from './FilesView';
import { TypeTree } from './TypeTree';

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const summary = useStore((s) => s.summary);
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'types' ? 'on' : ''} onClick={() => setTab('types')}>
          Types
        </button>
        <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
          Files <span className="muted">{summary?.fileCount ?? ''}</span>
        </button>
      </div>
      {tab === 'types' ? (
        <div className="sidebar-types">
          <TypeTree />
          <BlockList />
        </div>
      ) : (
        <FilesView />
      )}
    </aside>
  );
}
