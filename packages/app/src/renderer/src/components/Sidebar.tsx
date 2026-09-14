import { useStore } from '../store';
import { BlockList } from './BlockList';
import { FilesView } from './FilesView';
import { RundownView } from './RundownView';
import { TypeTree } from './TypeTree';

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const summary = useStore((s) => s.summary);
  const tree = useStore((s) => s.rundownTree);
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button
          className={tab === 'rundown' ? 'on' : ''}
          onClick={() => setTab('rundown')}
          title={tree ? 'Levels, layouts, zones' : 'No Rundown block in this project'}
        >
          Rundown
        </button>
        <button className={tab === 'types' ? 'on' : ''} onClick={() => setTab('types')}>
          Types
        </button>
        <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
          Files <span className="muted">{summary?.fileCount ?? ''}</span>
        </button>
      </div>
      {tab === 'rundown' ? (
        <RundownView />
      ) : tab === 'types' ? (
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
