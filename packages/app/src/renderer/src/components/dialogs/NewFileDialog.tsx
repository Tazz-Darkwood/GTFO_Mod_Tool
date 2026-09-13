import { useMemo, useState } from 'react';
import { useStore, type Dialog } from '../../store';
import { Modal } from './Modal';

type Init = Extract<Dialog, { kind: 'newFile' }>;

export function NewFileDialog({ init }: { init: Init }) {
  const files = useStore((s) => s.files);
  const summary = useStore((s) => s.summary)!;
  const createFile = useStore((s) => s.createFile);
  const openFile = useStore((s) => s.openFile);
  const openDialog = useStore((s) => s.openDialog);
  const close = useStore((s) => s.closeDialog);
  const [kind, setKind] = useState<'partial-array' | 'wrapper'>('partial-array');
  const [folder, setFolder] = useState(init.folder ?? 'PartialData');
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);

  const folders = useMemo(() => {
    const set = new Set<string>(['PartialData']);
    for (const f of files) {
      const i = f.id.lastIndexOf('/');
      if (i > 0 && f.id.startsWith('PartialData/')) set.add(f.id.slice(0, i));
    }
    return [...set].sort();
  }, [files]);
  const typesWithoutWrapper = useMemo(
    () => summary.types.filter((t) => t.baseline !== 'wrapper-file').map((t) => t.type),
    [summary],
  );

  const path =
    kind === 'wrapper'
      ? type
        ? `GameData_${type}DataBlock_bin.json`
        : ''
      : `${folder.replace(/\/+$/, '')}/${name.trim()}${name.trim().toLowerCase().endsWith('.json') ? '' : '.json'}`;
  const exists = files.some((f) => f.id.toLowerCase() === path.toLowerCase());
  const valid =
    kind === 'wrapper'
      ? !!type
      : !!name.trim() && /^PartialData(\/|$)/i.test(folder) && !/[<>:"|?*]/.test(name);

  const submit = async () => {
    if (!valid || exists || busy) return;
    setBusy(true);
    const file = await createFile({ path, kind });
    setBusy(false);
    if (!file) return;
    if (init.then === 'newBlock')
      openDialog({ kind: 'newBlock', targetFile: file.id, type: file.wrapperType });
    else {
      close();
      await openFile(file.id);
    }
  };

  return (
    <Modal
      title="New file"
      footer={
        <>
          <span className="muted small-text">
            {path && !exists ? path : exists ? 'That file already exists' : ''}
          </span>
          <span className="right" />
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={!valid || exists || busy}
            onClick={() => void submit()}
          >
            Create
          </button>
        </>
      }
    >
      <div className="field">
        <span>Kind</span>
        <div className="radios">
          <label>
            <input
              type="radio"
              checked={kind === 'partial-array'}
              onChange={() => setKind('partial-array')}
            />{' '}
            PartialData list (any block types, added on top of vanilla)
          </label>
          <label>
            <input type="radio" checked={kind === 'wrapper'} onChange={() => setKind('wrapper')} />{' '}
            Wrapper file for one type
          </label>
        </div>
      </div>
      {kind === 'partial-array' ? (
        <>
          <label className="field">
            <span>Folder</span>
            <input
              type="text"
              list="gtfo-folders"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="PartialData/Levels/My Level"
            />
            <datalist id="gtfo-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>File name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Waves.json"
            />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Pick a type…</option>
              {typesWithoutWrapper.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="field-note sev-warning">
            A wrapper file <b>replaces every vanilla block of that type</b>. The game will only know
            the blocks you put in it, and references from your levels to vanilla blocks of this type
            will break until you copy them in.
          </div>
        </>
      )}
    </Modal>
  );
}
