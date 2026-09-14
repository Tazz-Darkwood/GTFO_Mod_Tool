import { useMemo } from 'react';
import { expeditionKey, expeditionLabel, placeOfBlock } from '../rundownLookup';
import { useStore } from '../store';
import { BlockEditor } from './BlockEditor';
import { ErrorBoundary } from './ErrorBoundary';
import { SourceEditor } from './SourceEditor';
import { ZoneGraph } from './ZoneGraph';
import { TileGrid } from './TileGrid';
import { GenericJsonEditor } from '../editor/GenericJsonEditor';
import { sourceEditor } from '../editor/editorRegistry';

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
  const tree = useStore((s) => s.rundownTree);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const expandMany = useStore((s) => s.expandMany);
  const canBack = useStore((s) => s.navBack.length > 0);
  const canForward = useStore((s) => s.navForward.length > 0);
  const goBack = useStore((s) => s.goBack);
  const goForward = useStore((s) => s.goForward);

  const fileDiags = useMemo(
    () => (raw ? diagnostics.filter((d) => d.file === raw.fileId) : []),
    [diagnostics, raw],
  );
  const place = useMemo(() => (block ? placeOfBlock(tree, block.blockId) : null), [tree, block]);

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
  // Plugin config and other schema-less JSON get a generic form when opened as a file.
  const canGeneric =
    view === 'file' &&
    !!file &&
    file.parseErrors === 0 &&
    (file.shape === 'plugin' || file.shape === 'meta' || file.shape === 'unknown');
  const canGraph = canForm && block!.type === 'LevelLayout';
  const showGraph = canGraph && mode === 'graph';
  const showTiles = canGraph && mode === 'tiles';
  const showForm =
    canForm && (mode === 'form' || ((mode === 'graph' || mode === 'tiles') && !canGraph));
  const showGeneric = canGeneric && mode === 'form';
  const showingSource = !showForm && !showGeneric && !showGraph && !showTiles;
  const drafting = draft && draft.fileId === raw.fileId;
  const canSave = !!file?.dirty || !!(drafting && draft.pending);
  const refCount = references ? references.refs.length + references.mentions.length : null;

  return (
    <div className="mainpane">
      <div className="mainpane-head">
        <div className="navbtns">
          <button
            onClick={() => void goBack()}
            disabled={!canBack}
            title="Back to where you were (Alt+←, mouse back button)"
          >
            ◀
          </button>
          <button onClick={() => void goForward()} disabled={!canForward} title="Forward (Alt+→)">
            ▶
          </button>
        </div>
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
              {place && (
                <button
                  className="chip place"
                  title="Show this block in the Rundown tree"
                  onClick={() => {
                    expandMany([
                      `rd:${place.rundownId}`,
                      `tier:${place.rundownId}:${place.expedition.tier}`,
                      expeditionKey(place.rundownId, place.expedition),
                    ]);
                    setSidebarTab('rundown');
                  }}
                >
                  in {expeditionLabel(place.expedition)} · {place.role}
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
          {(canForm || canGeneric) && (
            <div className="seg">
              <button className={showForm ? 'on' : ''} onClick={() => void setMode('form')}>
                Form
              </button>
              {canGraph && (
                <button
                  className={showGraph ? 'on' : ''}
                  onClick={() => void setMode('graph')}
                  title="Zones as a graph: what builds from what, in which direction"
                >
                  Graph
                </button>
              )}
              {canGraph && (
                <button
                  className={showTiles ? 'on' : ''}
                  onClick={() => void setMode('tiles')}
                  title="Top-down tile grid: what the game generated (from the BepInEx log) and LGTuner overrides"
                >
                  Tiles
                </button>
              )}
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
          {showingSource && (
            <div className="seg">
              <button
                onClick={() => sourceEditor()?.foldAll(true)}
                title="Collapse every object and list (top level stays open)"
              >
                Collapse all
              </button>
              <button onClick={() => sourceEditor()?.unfoldAll()} title="Expand everything">
                Expand all
              </button>
            </div>
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
        {showingSource && fileDiags.length > 0 && ` · ${fileDiags.length} problem(s) in this file`}
      </div>
      <div className="mainpane-body">
        <ErrorBoundary
          resetKey={`${block?.blockId ?? raw.fileId}:${showTiles ? 'tiles' : showGraph ? 'graph' : showForm ? 'form' : showGeneric ? 'generic' : 'raw'}`}
        >
          {showTiles ? (
            <TileGrid />
          ) : showGraph ? (
            <ZoneGraph />
          ) : showForm ? (
            <BlockEditor />
          ) : showGeneric ? (
            <GenericJsonEditor fileId={raw.fileId} text={raw.text} />
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
