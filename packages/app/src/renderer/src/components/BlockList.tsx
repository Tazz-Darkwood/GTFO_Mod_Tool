import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useStore } from '../store';

export function BlockList() {
  const blocks = useStore((s) => s.blocks);
  const total = useStore((s) => s.blocksTotal);
  const selectedType = useStore((s) => s.selectedType);
  const selectedBlockId = useStore((s) => s.selectedBlockId);
  const selectBlock = useStore((s) => s.selectBlock);
  const openDialog = useStore((s) => s.openDialog);
  const query = useStore((s) => s.blockQuery);
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <div className="blocklist">
      <div className="blocklist-head">
        <span>{selectedType ?? (query ? 'Matches' : 'Blocks')}</span>
        <span className="hstack">
          <span className="muted">
            {blocks.length}
            {total > blocks.length ? ` of ${total}` : ''}
          </span>
          <button
            className="small"
            title={selectedType ? `New ${selectedType} block` : 'New block'}
            onClick={() => openDialog({ kind: 'newBlock', type: selectedType ?? undefined })}
          >
            + New
          </button>
        </span>
      </div>
      <div ref={parentRef} className="blocklist-scroll">
        {blocks.length === 0 && (
          <div className="empty">
            {selectedType || query ? 'No blocks.' : 'Pick a type or search.'}
          </div>
        )}
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((row) => {
            const b = blocks[row.index]!;
            return (
              <div
                key={b.blockId}
                className={`blockrow ${b.blockId === selectedBlockId ? 'selected' : ''} ${b.problems ? 'has-problems' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
                onClick={() => void selectBlock(b.blockId)}
                title={`${b.file}:${b.line}`}
              >
                <div className="blockrow-main">
                  <span className="bid">{b.persistentID ?? '—'}</span>
                  <span className="bname">{b.name || <em>(no name)</em>}</span>
                  {b.problems > 0 && <span className="bproblems">{b.problems}</span>}
                </div>
                <div className="blockrow-sub">
                  {!selectedType && b.type && <span className="btype">{b.type}</span>}
                  {b.plugin && <span className="bplugin">{b.plugin}</span>}
                  <span className="bfile">{b.file}</span>
                </div>
                {!b.plugin && (
                  <span className="blockrow-actions">
                    <button
                      className="small ghost"
                      title="Duplicate with a new ID"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog({
                          kind: 'newBlock',
                          type: b.type,
                          source: { kind: 'project', blockId: b.blockId },
                          targetFile: b.file,
                          name: `Copy of ${b.name ?? ''}`.trim(),
                        });
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      className="small ghost danger"
                      title="Delete block"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog({ kind: 'deleteBlock', blockId: b.blockId });
                      }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
