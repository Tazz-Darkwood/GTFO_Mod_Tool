import { useMemo } from 'react';
import { useStore } from '../store';
import { BlockEditor } from './BlockEditor';
import { ErrorBoundary } from './ErrorBoundary';
import { SourceEditor } from './SourceEditor';

const SHAPE_LABEL: Record<string, string> = {
  wrapper: 'wrapper file',
  'partial-array': 'PartialData list',
  'partial-single': 'PartialData single block',
  plugin: 'plugin config',
  meta: 'PartialData bookkeeping',
  unknown: 'unrecognised',
};

export function MainPane() {
  const view = useStore((s) => s.view);
  const block = useStore((s) => s.block);
  const raw = useStore((s) => s.raw);
  const mode = useStore((s) => s.blockMode);
  const setMode = useStore((s) => s.setBlockMode);
  const files = useStore((s) => s.files);
  const diagnostics = useStore((s) => s.diagnostics);
  const draft = useStore((s) => s.sourceDraft);
  const references = useStore((s) => s.references);
  const save = useStore((s) => s.save);
  const revert = useStore((s) => s.revert);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openExternal = useStore((s) => s.openExternal);
  const commitSourceText = useStore((s) => s.commitSourceText);
  const setSourceDraft = useStore((s) => s.setSourceDraft);
  const openDialog = useStore((s) => s.openDialog);
  const selectBlock = useStore((s) => s.selectBlock);

  const fileDiags = useMemo(
    () => (raw ? diagnostics.filter((d) => d.file === raw.fileId) : []),
    [diagnostics, raw],
  );

  if (view === 'welcome' || !raw) {
    return (
      <div className="main-empty">
        <p>
          Select a type on the left, then a block. Or open a file from the Files tab, or click a
          problem below.
        </p>
      </div>
    );
  }
  const file = files.find((f) => f.id === raw.fileId);
  const canForm =
    view === 'block' && !!block && !block.plugin && block.fileShape !== 'plugin' && !!block.type;
  const showForm = canForm && mode === 'form';
  const drafting = draft && draft.fileId === raw.fileId;
  const canSave = !!file?.dirty || !!(drafting && draft.pending);
  const refCount = references ? references.refs.length + references.mentions.length : null;

  return (
    <div className="mainpane">
      <div className="mainpane-head">
        <div className="crumbs">
          {block ? (
            <>
              <span className="crumb-type">{block.type ?? 'untyped'}</span>
              <span className="crumb-sep">›</span>
              <span className="crumb-id">#{block.persistentID ?? '—'}</span>
              <span className="crumb-name">{block.name || <em>(no name)</em>}</span>
              {refCount !== null && (
                <button
                  className={`chip usedby ${refCount ? 'on' : ''}`}
                  title={
                    refCount
                      ? 'Show blocks that reference this one'
                      : 'Nothing references this block'
                  }
                  onClick={() => openDialog({ kind: 'deleteBlock', blockId: block.blockId })}
                  disabled={refCount === 0}
                >
                  used by {refCount}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="crumb-name">
                {raw.fileId.slice(raw.fileId.lastIndexOf('/') + 1)}
              </span>
              {file && <span className="tbadge">{SHAPE_LABEL[file.shape] ?? file.shape}</span>}
            </>
          )}
        </div>
        <div className="mainpane-actions">
          {canForm && (
            <div className="seg">
              <button className={mode === 'form' ? 'on' : ''} onClick={() => void setMode('form')}>
                Form
              </button>
              <button className={mode === 'raw' ? 'on' : ''} onClick={() => void setMode('raw')}>
                Source
              </button>
            </div>
          )}
          {block && !block.plugin && (
            <>
              <button
                onClick={() =>
                  openDialog({
                    kind: 'newBlock',
                    type: block.type,
                    source: { kind: 'project', blockId: block.blockId },
                    targetFile: block.fileShape === 'partial-single' ? undefined : block.file,
                    name: `Copy of ${block.name ?? ''}`.trim(),
                  })
                }
                title="Duplicate this block into a file with a new ID"
              >
                Duplicate
              </button>
              <button
                onClick={() => openDialog({ kind: 'deleteBlock', blockId: block.blockId })}
                title="Delete this block"
                className="danger-soft"
              >
                Delete
              </button>
            </>
          )}
          {view === 'file' && file?.canHoldBlocks && (
            <button
              onClick={() =>
                openDialog({
                  kind: 'newBlock',
                  targetFile: file.id,
                  type: file.wrapperType ?? file.types[0],
                })
              }
            >
              + New block here
            </button>
          )}
          <button onClick={() => void undo()} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button onClick={() => void redo()} title="Redo (Ctrl+Y)">
            ↷
          </button>
          <button
            onClick={() => void save(raw.fileId)}
            disabled={!canSave}
            className={canSave ? 'primary' : ''}
            title="Save this file (Ctrl+S)"
          >
            Save
          </button>
          <button
            onClick={() => void revert(raw.fileId)}
            disabled={!file?.dirty}
            title="Discard unsaved changes to this file"
          >
            Revert
          </button>
          <button
            onClick={() =>
              void openExternal(raw.fileId, raw.highlight ? raw.highlight.line : undefined)
            }
            title="Open in VS Code / default editor"
          >
            Open in editor
          </button>
        </div>
      </div>
      <div className="mainpane-sub muted">
        {raw.fileId}
        {drafting && draft.parseErrors > 0 ? (
          <span className="sev-error">
            {' '}
            · {draft.parseErrors} JSON syntax error(s): fix before saving
          </span>
        ) : drafting && draft.pending ? (
          ' · editing…'
        ) : file?.dirty ? (
          ' · unsaved changes'
        ) : (
          ''
        )}
        {file?.externallyModified ? <span className="sev-warning"> · CHANGED ON DISK</span> : ''}
        {!showForm && fileDiags.length > 0 && ` · ${fileDiags.length} problem(s) in this file`}
      </div>
      <div className="mainpane-body">
        <ErrorBoundary resetKey={`${block?.blockId ?? raw.fileId}:${showForm ? 'form' : 'raw'}`}>
          {showForm ? (
            <BlockEditor />
          ) : (
            <SourceEditor
              fileId={raw.fileId}
              text={raw.text}
              diagnostics={fileDiags}
              highlight={raw.highlight}
              nonce={raw.nonce}
              onCommit={commitSourceText}
              onDraft={setSourceDraft}
            />
          )}
        </ErrorBoundary>
      </div>
      {block && references && references.refs.length > 0 && (
        <div className="usedby-strip muted">
          Used by:{' '}
          {references.refs.slice(0, 6).map((r, i) => (
            <button
              key={i}
              className="link"
              onClick={() => void selectBlock(r.blockId)}
              title={`${r.file} · ${r.field}`}
            >
              {r.type} #{r.persistentID} {r.name ? `"${r.name}"` : ''}
            </button>
          ))}
          {references.refs.length > 6 && <span> and {references.refs.length - 6} more</span>}
          {references.mentions.length > 0 && (
            <span> · mentioned in {references.mentions.length} plugin file line(s)</span>
          )}
        </div>
      )}
    </div>
  );
}
