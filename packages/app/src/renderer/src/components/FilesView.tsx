import { useMemo, useState } from 'react';
import type { FileDto } from '@shared/ipc';
import { useStore } from '../store';

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: FileDto[];
}

const SHAPE_LABEL: Record<FileDto['shape'], string> = {
  wrapper: 'wrapper',
  'partial-array': 'list',
  'partial-single': 'single',
  plugin: 'plugin',
  meta: 'meta',
  unknown: '?',
};

function buildTree(files: FileDto[]): Folder {
  const root: Folder = { name: '', path: '', folders: new Map(), files: [] };
  for (const f of files) {
    const parts = f.id.split('/');
    let cur = root;
    for (const p of parts.slice(0, -1)) {
      let next = cur.folders.get(p);
      if (!next) {
        next = { name: p, path: cur.path ? `${cur.path}/${p}` : p, folders: new Map(), files: [] };
        cur.folders.set(p, next);
      }
      cur = next;
    }
    cur.files.push(f);
  }
  return root;
}

/** Every project file, including plugin config under Custom/, as a folder tree. */
export function FilesView() {
  const files = useStore((s) => s.files);
  const filter = useStore((s) => s.fileFilter);
  const setFilter = useStore((s) => s.setFileFilter);
  const openFile = useStore((s) => s.openFile);
  const openDialog = useStore((s) => s.openDialog);
  const openExternal = useStore((s) => s.openExternal);
  const raw = useStore((s) => s.raw);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.id.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const tree = useMemo(() => buildTree(visible), [visible]);
  const searching = filter.trim().length > 0;

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const renderFolder = (folder: Folder, depth: number) => {
    const isCollapsed = !searching && collapsed.has(folder.path);
    const kids = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
    const fileRows = [...folder.files].sort((a, b) => a.id.localeCompare(b.id));
    return (
      <div key={folder.path || '<root>'}>
        {folder.path && (
          <div
            className="frow-folder"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => toggle(folder.path)}
          >
            <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
            <span className="fname">{folder.name}</span>
            <span className="muted">{countFiles(folder)}</span>
          </div>
        )}
        {!isCollapsed && (
          <>
            {kids.map((k) => renderFolder(k, folder.path ? depth + 1 : depth))}
            {fileRows.map((f) => (
              <div
                key={f.id}
                className={`frow-file ${raw?.fileId === f.id ? 'selected' : ''} ${f.problems ? 'has-problems' : ''}`}
                style={{ paddingLeft: 8 + (folder.path ? depth + 1 : depth) * 14 }}
                onClick={() => void openFile(f.id)}
                title={`${f.id}\n${f.shape}${f.wrapperType ? ' of ' + f.wrapperType : ''} · ${f.blockCount} block(s) · ${(f.size / 1024).toFixed(0)} KB`}
              >
                {f.dirty && <span className="dirty">●</span>}
                <span className="fname">{f.id.slice(f.id.lastIndexOf('/') + 1)}</span>
                <span className={`tbadge shape-${f.shape}`}>
                  {f.shape === 'wrapper' && f.wrapperType ? f.wrapperType : SHAPE_LABEL[f.shape]}
                </span>
                {f.blockCount > 0 && <span className="muted fcount">{f.blockCount}</span>}
                {f.problems > 0 && <span className="tproblems">{f.problems}</span>}
                {f.externallyModified && (
                  <span className="fext" title="Changed on disk">
                    disk
                  </span>
                )}
                <span className="frow-file-actions">
                  {f.canHoldBlocks && (
                    <button
                      className="small ghost"
                      title="New block in this file"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog({
                          kind: 'newBlock',
                          targetFile: f.id,
                          type: f.wrapperType ?? f.types[0],
                        });
                      }}
                    >
                      +
                    </button>
                  )}
                  <button
                    className="small ghost"
                    title="Open in VS Code / default editor"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openExternal(f.id);
                    }}
                  >
                    ↗
                  </button>
                  <button
                    className="small ghost danger"
                    title="Delete file"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ kind: 'deleteFile', fileId: f.id });
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="filesview">
      <div className="search">
        <input
          type="search"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="small" title="New file" onClick={() => openDialog({ kind: 'newFile' })}>
          + file
        </button>
      </div>
      <div className="typetree-head">
        <span>Files</span>
        <span className="muted">{visible.length}</span>
      </div>
      <div className="filesview-scroll">{renderFolder(tree, 0)}</div>
    </div>
  );
}

function countFiles(f: Folder): number {
  let n = f.files.length;
  for (const k of f.folders.values()) n += countFiles(k);
  return n;
}
