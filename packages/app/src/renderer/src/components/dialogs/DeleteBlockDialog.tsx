import { useEffect, useState } from 'react';
import type { BlockDetailDto, ReferencesDto } from '@shared/ipc';
import { api } from '../../api';
import { useStore } from '../../store';
import { Modal } from './Modal';

export function DeleteBlockDialog({ blockId }: { blockId: string }) {
  const close = useStore((s) => s.closeDialog);
  const deleteBlock = useStore((s) => s.deleteBlock);
  const deleteFile = useStore((s) => s.deleteFile);
  const selectBlock = useStore((s) => s.selectBlock);
  const openFile = useStore((s) => s.openFile);
  const [block, setBlock] = useState<BlockDetailDto | null>(null);
  const [refs, setRefs] = useState<ReferencesDto | null>(null);

  useEffect(() => {
    let alive = true;
    void api.invoke('blocks:get', blockId).then(async (b) => {
      if (!alive) return;
      setBlock(b);
      if (b?.type && b.persistentID !== undefined)
        setRefs(await api.invoke('blocks:references', { type: b.type, id: b.persistentID }));
      else setRefs({ refs: [], mentions: [] });
    });
    return () => {
      alive = false;
    };
  }, [blockId]);

  const single = block?.fileShape === 'partial-single';
  const total = refs ? refs.refs.length + refs.mentions.length : 0;

  return (
    <Modal
      title={single ? 'Delete file' : 'Delete block'}
      footer={
        <>
          <span className="muted small-text">
            Ctrl+Z undoes a block deletion. Deleting a file cannot be undone.
          </span>
          <span className="right" />
          <button onClick={close}>Cancel</button>
          <button
            className="primary danger"
            disabled={!block}
            onClick={() => void (single ? deleteFile(block!.file) : deleteBlock(blockId))}
          >
            {total ? 'Delete anyway' : 'Delete'}
          </button>
        </>
      }
    >
      {!block && <p className="muted">Loading…</p>}
      {block && (
        <>
          <p>
            <b>{block.type}</b> #{block.persistentID} {block.name ? <>"{block.name}"</> : ''} in{' '}
            <code>{block.file}</code>
          </p>
          {single && (
            <p className="sev-warning">
              This file holds only this block, so the whole file will be deleted from disk.
            </p>
          )}
          {refs === null && <p className="muted">Checking who uses it…</p>}
          {refs && total === 0 && (
            <p className="muted">Nothing in the project references this block.</p>
          )}
          {refs && refs.refs.length > 0 && (
            <>
              <p className="sev-warning">
                {refs.refs.length} field{refs.refs.length === 1 ? '' : 's'} point
                {refs.refs.length === 1 ? 's' : ''} at it and will become dangling references:
              </p>
              <ul className="reflist">
                {refs.refs.map((r, i) => (
                  <li key={i}>
                    <button
                      className="link"
                      onClick={() => {
                        close();
                        void selectBlock(r.blockId);
                      }}
                    >
                      {r.type} #{r.persistentID} {r.name ? `"${r.name}"` : ''}
                    </button>
                    <span className="muted"> · {r.field}</span>
                    <span className="muted small-text"> · {r.file}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {refs && refs.mentions.length > 0 && (
            <>
              <p className="muted">
                The number {block.persistentID} also appears in plugin config (may or may not refer
                to this block):
              </p>
              <ul className="reflist">
                {refs.mentions.map((m, i) => (
                  <li key={i}>
                    <button
                      className="link"
                      onClick={() => {
                        close();
                        void openFile(m.file);
                      }}
                    >
                      {m.file}:{m.line}
                    </button>
                    <code className="small-text">{m.snippet}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
