import { useEffect, useState } from 'react';
import type { ReferenceDto } from '@shared/ipc';
import { api } from '../../api';
import { useStore } from '../../store';
import { Modal } from './Modal';

export function DeleteFileDialog({ fileId }: { fileId: string }) {
  const close = useStore((s) => s.closeDialog);
  const deleteFile = useStore((s) => s.deleteFile);
  const selectBlock = useStore((s) => s.selectBlock);
  const file = useStore((s) => s.files.find((f) => f.id === fileId));
  const [refs, setRefs] = useState<ReferenceDto[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api.invoke('files:references', fileId).then((r) => alive && setRefs(r));
    return () => {
      alive = false;
    };
  }, [fileId]);

  return (
    <Modal
      title="Delete file"
      footer={
        <>
          <span className="muted small-text">
            This removes the file from disk and cannot be undone.
          </span>
          <span className="right" />
          <button onClick={close}>Cancel</button>
          <button className="primary danger" onClick={() => void deleteFile(fileId)}>
            {refs && refs.length ? 'Delete anyway' : 'Delete'}
          </button>
        </>
      }
    >
      <p>
        <code>{fileId}</code>
        {file && (
          <span className="muted">
            {' '}
            · {file.blockCount} block{file.blockCount === 1 ? '' : 's'}
            {file.dirty ? ' · has unsaved changes' : ''}
          </span>
        )}
      </p>
      {refs === null && <p className="muted">Checking references…</p>}
      {refs && refs.length === 0 && (
        <p className="muted">No block in other files references anything defined here.</p>
      )}
      {refs && refs.length > 0 && (
        <>
          <p className="sev-warning">
            {refs.length} field(s) in other files point at blocks defined in this file:
          </p>
          <ul className="reflist">
            {refs.slice(0, 40).map((r, i) => (
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
              </li>
            ))}
            {refs.length > 40 && <li className="muted">…and {refs.length - 40} more</li>}
          </ul>
        </>
      )}
    </Modal>
  );
}
