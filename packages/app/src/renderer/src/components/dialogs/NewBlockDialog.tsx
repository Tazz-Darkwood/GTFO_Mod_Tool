import { useEffect, useMemo, useState } from 'react';
import type { BlockSourceDto, RefCandidateDto, TargetFileDto } from '@shared/ipc';
import { api } from '../../api';
import { useStore, type Dialog } from '../../store';
import { Modal } from './Modal';

type Init = Extract<Dialog, { kind: 'newBlock' }>;
type SourceKind = BlockSourceDto['kind'];

export function NewBlockDialog({ init }: { init: Init }) {
  const summary = useStore((s) => s.summary)!;
  const files = useStore((s) => s.files);
  const createBlock = useStore((s) => s.createBlock);
  const openDialog = useStore((s) => s.openDialog);
  const close = useStore((s) => s.closeDialog);

  const typeNames = useMemo(() => summary.types.map((t) => t.type), [summary]);
  const [type, setType] = useState(
    init.type ??
      typeNames.find((t) => summary.types.find((x) => x.type === t)!.count > 0) ??
      typeNames[0] ??
      '',
  );
  const [sourceKind, setSourceKind] = useState<SourceKind>(init.source?.kind ?? 'blank');
  const [pick, setPick] = useState<RefCandidateDto | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [candidates, setCandidates] = useState<RefCandidateDto[]>([]);
  const [clip, setClip] = useState('');
  const [name, setName] = useState(init.name ?? '');
  const [id, setId] = useState<number>(0);
  const [idBasis, setIdBasis] = useState('');
  const [idWarning, setIdWarning] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetFileDto[]>([]);
  const [target, setTarget] = useState<string>(init.targetFile ?? '');
  const [busy, setBusy] = useState(false);

  const typeInfo = summary.types.find((t) => t.type === type);
  const initProjectSource = init.source?.kind === 'project' ? init.source : null;

  // Targets for the type.
  useEffect(() => {
    let alive = true;
    void api.invoke('project:targetFiles', type).then((t) => {
      if (!alive) return;
      setTargets(t);
      setTarget((cur) => (cur && t.some((x) => x.fileId === cur) ? cur : (t[0]?.fileId ?? '')));
    });
    return () => {
      alive = false;
    };
  }, [type, files]);

  // Suggested id whenever type/target changes.
  useEffect(() => {
    let alive = true;
    void api.invoke('project:nextId', type, target || undefined).then((r) => {
      if (!alive) return;
      setId(r.id);
      setIdBasis(r.basis);
    });
    return () => {
      alive = false;
    };
  }, [type, target]);

  // Live id warning.
  useEffect(() => {
    let alive = true;
    if (!Number.isInteger(id) || id <= 0) {
      setIdWarning('ID must be a positive whole number');
      return;
    }
    void api.invoke('blocks:resolveRef', { refType: type, id }).then((r) => {
      if (!alive) return;
      if (!r) setIdWarning(null);
      else if (r.source === 'project')
        setIdWarning(`${type} #${id} already exists in the project ("${r.name}")`);
      else
        setIdWarning(
          `Replaces vanilla ${type} #${id} "${r.name}" (allowed, but is that what you want?)`,
        );
    });
    return () => {
      alive = false;
    };
  }, [type, id]);

  // Candidate search for vanilla / project sources.
  useEffect(() => {
    if (sourceKind !== 'vanilla' && sourceKind !== 'project') return;
    let alive = true;
    void api
      .invoke('blocks:searchRefs', {
        refType: type,
        query: pickQuery,
        limit: 40,
        source: sourceKind,
      })
      .then((r) => alive && setCandidates(r));
    return () => {
      alive = false;
    };
  }, [sourceKind, type, pickQuery]);

  useEffect(() => {
    if (sourceKind === 'text' && !clip)
      void navigator.clipboard
        .readText()
        .then(setClip)
        .catch(() => undefined);
  }, [sourceKind, clip]);

  const source: BlockSourceDto | null =
    sourceKind === 'blank'
      ? { kind: 'blank' }
      : sourceKind === 'vanilla'
        ? pick
          ? { kind: 'vanilla', id: pick.id }
          : null
        : sourceKind === 'project'
          ? initProjectSource && !pick
            ? initProjectSource
            : pick?.blockId
              ? { kind: 'project', blockId: pick.blockId }
              : null
          : clip.trim()
            ? { kind: 'text', text: clip }
            : null;

  const canSubmit =
    !!type &&
    !!target &&
    !!source &&
    Number.isInteger(id) &&
    id > 0 &&
    !idWarning?.startsWith(type + ' #') &&
    !busy;

  const submit = async () => {
    if (!canSubmit || !source) return;
    setBusy(true);
    const ok = await createBlock({ type, targetFile: target, persistentID: id, name, source });
    setBusy(false);
    if (!ok) return;
  };

  const groups = useMemo(() => {
    const g = {
      holding: [] as TargetFileDto[],
      wrapper: [] as TargetFileDto[],
      other: [] as TargetFileDto[],
    };
    for (const t of targets)
      (t.shape === 'wrapper' ? g.wrapper : t.containsType ? g.holding : g.other).push(t);
    return g;
  }, [targets]);

  return (
    <Modal
      title="New block"
      width={640}
      footer={
        <>
          <span className="muted small-text">
            {idBasis === 'project'
              ? 'ID = highest in your project + 1'
              : idBasis === 'vanilla'
                ? 'ID = highest vanilla + 1'
                : idBasis === 'wrapper'
                  ? 'ID = LastPersistentID + 1'
                  : ''}
          </span>
          <span className="right" />
          <button onClick={close}>Cancel</button>
          <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>
            Create
          </button>
        </>
      }
    >
      <label className="field">
        <span>Type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={!!initProjectSource}
        >
          {typeNames.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Start from</span>
        <div className="radios">
          <label>
            <input
              type="radio"
              checked={sourceKind === 'blank'}
              onChange={() => setSourceKind('blank')}
            />{' '}
            Blank (schema defaults)
          </label>
          <label
            title={
              typeInfo?.hasFullVanilla
                ? ''
                : `Full vanilla data is not shipped for ${type} (only names)`
            }
          >
            <input
              type="radio"
              disabled={!typeInfo?.hasFullVanilla}
              checked={sourceKind === 'vanilla'}
              onChange={() => setSourceKind('vanilla')}
            />{' '}
            Copy of a vanilla block
          </label>
          <label>
            <input
              type="radio"
              checked={sourceKind === 'project'}
              onChange={() => setSourceKind('project')}
            />{' '}
            Copy of one of my blocks
          </label>
          <label>
            <input
              type="radio"
              checked={sourceKind === 'text'}
              onChange={() => setSourceKind('text')}
            />{' '}
            From clipboard JSON
          </label>
        </div>
      </div>

      {(sourceKind === 'vanilla' || sourceKind === 'project') && (
        <div className="field">
          <span>{sourceKind === 'vanilla' ? 'Vanilla block' : 'My block'}</span>
          <div className="picklist">
            {initProjectSource && !pick && (
              <div className="muted small-text">
                Copying the block you had selected. Search below to pick a different one.
              </div>
            )}
            <input
              type="search"
              placeholder={`Search ${type} by ID or name…`}
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
            />
            <div className="picklist-items">
              {candidates.map((c) => (
                <div
                  key={`${c.source}-${c.id}`}
                  className={`refitem ${pick?.id === c.id ? 'current' : ''}`}
                  onClick={() => setPick(c)}
                >
                  <span className="rid">{c.id}</span>
                  <span className="rname">{c.name || <em>(no name)</em>}</span>
                  <span className={`rsrc rsrc-${c.source}`}>{c.source}</span>
                </div>
              ))}
              {candidates.length === 0 && <div className="empty">No matches.</div>}
            </div>
          </div>
        </div>
      )}

      {sourceKind === 'text' && (
        <label className="field">
          <span>JSON</span>
          <textarea
            className="rawjson"
            rows={6}
            value={clip}
            onChange={(e) => setClip(e.target.value)}
            placeholder="Paste one block object here"
            spellCheck={false}
          />
        </label>
      )}

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shown in lists; the game does not use it"
        />
      </label>

      <label className="field">
        <span>persistentID</span>
        <input
          type="number"
          value={Number.isFinite(id) ? id : ''}
          onChange={(e) => setId(Number(e.target.value))}
          className={idWarning?.startsWith(type + ' #') ? 'invalid' : ''}
        />
      </label>
      {idWarning && (
        <div
          className={`field-note ${idWarning.startsWith(type + ' #') ? 'sev-error' : 'sev-warning'}`}
        >
          {idWarning}
        </div>
      )}

      <label className="field">
        <span>Into file</span>
        <select
          value={target}
          onChange={(e) =>
            e.target.value === '__new__'
              ? openDialog({ kind: 'newFile', then: 'newBlock' })
              : setTarget(e.target.value)
          }
        >
          {groups.wrapper.length > 0 && (
            <optgroup label={`Wrapper file (replaces vanilla ${type})`}>
              {groups.wrapper.map((t) => (
                <option key={t.fileId} value={t.fileId}>
                  {t.fileId} ({t.blockCount})
                </option>
              ))}
            </optgroup>
          )}
          {groups.holding.length > 0 && (
            <optgroup label={`Files already holding ${type}`}>
              {groups.holding.map((t) => (
                <option key={t.fileId} value={t.fileId}>
                  {t.fileId} ({t.blockCount})
                </option>
              ))}
            </optgroup>
          )}
          {groups.other.length > 0 && (
            <optgroup label="Other PartialData lists">
              {groups.other.map((t) => (
                <option key={t.fileId} value={t.fileId}>
                  {t.fileId} ({t.blockCount})
                </option>
              ))}
            </optgroup>
          )}
          <option value="__new__">New file…</option>
        </select>
      </label>
      {targets.length === 0 && (
        <div className="field-note sev-warning">
          No file can hold this type yet: create a PartialData list file first.
        </div>
      )}
    </Modal>
  );
}
