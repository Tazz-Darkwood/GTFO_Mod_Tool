import { getNodeValue, parseTree } from 'jsonc-parser';
import { LGTUNER_DIRECTIONS, LGTUNER_ROTATIONS } from '@shared/lgtunerEnums';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EditOp, JsonPath, RefCandidateDto } from '@shared/ipc';
import { api } from '../api';
import { useStore } from '../store';
import { CommitInput } from './fields';
import { RefPicker } from './RefPicker';
import { pointerOf } from './schemaUtil';

/**
 * Schema-less form for plugin config (Custom/…) and other JSON the datablock
 * schema does not describe. Every value is editable by its JSON type; a few
 * well-known plugin keys are shown as datablock references with a picker.
 */

/** Plugin keys that hold datablock ids (EOS, LGTuner, ECPC, AWO conventions). */
const REF_KEYS: Record<string, string> = {
  MainLevelLayout: 'LevelLayout',
  LevelLayoutID: 'LevelLayout',
  LevelLayoutData: 'LevelLayout',
  LayoutID: 'LevelLayout',
  WardenObjectiveID: 'WardenObjective',
  ChainedPuzzleID: 'ChainedPuzzle',
  ChainedPuzzleToActive: 'ChainedPuzzle',
  ChainedPuzzleToEnter: 'ChainedPuzzle',
  WaveSettings: 'SurvivalWaveSettings',
  WavePopulation: 'SurvivalWavePopulation',
  SurvivalWaveSettings: 'SurvivalWaveSettings',
  SurvivalWavePopulation: 'SurvivalWavePopulation',
  EnemyID: 'Enemy',
  ItemID: 'Item',
  LightSettings: 'LightSettings',
  FogSetting: 'FogSettings',
  FogSettings: 'FogSettings',
  DimensionData: 'Dimension',
};

/** Keys whose string values come from a known set (LGTuner config). */
const ENUM_KEYS: Record<string, readonly string[]> = {
  Rotation: LGTUNER_ROTATIONS,
  Direction: LGTUNER_DIRECTIONS,
};

type Kind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : (typeof v as Kind);
}

function blank(kind: Kind): unknown {
  switch (kind) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return null;
  }
}

/** A template for a new list item: the last item with its scalars reset, or an empty value of its kind. */
function templateFrom(items: unknown[]): unknown {
  const last = items[items.length - 1];
  if (last === undefined) return {};
  const reset = (v: unknown): unknown => {
    if (Array.isArray(v)) return [];
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = reset(x);
      return o;
    }
    return blank(kindOf(v));
  };
  return reset(last);
}

export interface GenericJsonEditorProps {
  fileId: string;
  text: string;
}

export function GenericJsonEditor({ fileId, text }: GenericJsonEditorProps) {
  const applyFileOp = useStore((s) => s.applyFileOp);
  const applyFileOps = useStore((s) => s.applyFileOps);
  const parsed = useMemo(() => {
    const tree = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
    return tree ? (getNodeValue(tree) as unknown) : undefined;
  }, [text]);
  const [open, setOpen] = useState<Record<string, boolean>>({ '': true });
  useEffect(() => setOpen({ '': true }), [fileId]);

  if (parsed === undefined)
    return (
      <div className="editor-placeholder">
        This file does not parse as JSON. Fix it in the Source view first.
      </div>
    );

  const ctx: GCtx = {
    apply: (op) => applyFileOp(fileId, op),
    applyMany: (ops) => applyFileOps(fileId, ops),
    isOpen: (ptr, depth) => open[ptr] ?? depth < 2,
    toggle: (ptr, depth) => setOpen((o) => ({ ...o, [ptr]: !(o[ptr] ?? depth < 2) })),
    setAll: (v) => {
      const next: Record<string, boolean> = { '': true };
      const walk = (val: unknown, path: JsonPath) => {
        if (val && typeof val === 'object') {
          next[pointerOf(path)] = v;
          for (const [k, x] of Object.entries(val as Record<string, unknown>))
            walk(x, [...path, Array.isArray(val) ? Number(k) : k]);
        }
      };
      walk(parsed, []);
      next[''] = true;
      setOpen(next);
    },
  };

  return (
    <div className="blockeditor">
      <div className="gjson-toolbar muted">
        Plugin config: no schema, every value is editable by its JSON type. Double-click a key to
        rename it.
        <span className="right" />
        <button className="small ghost" onClick={() => ctx.setAll(false)}>
          collapse all
        </button>
        <button className="small ghost" onClick={() => ctx.setAll(true)}>
          expand all
        </button>
      </div>
      <GValue ctx={ctx} value={parsed} path={[]} depth={0} label={null} />
    </div>
  );
}

interface GCtx {
  apply(op: EditOp): Promise<boolean>;
  applyMany(ops: EditOp[]): Promise<boolean>;
  isOpen(ptr: string, depth: number): boolean;
  toggle(ptr: string, depth: number): void;
  setAll(open: boolean): void;
}

function GRow({
  label,
  badge,
  block,
  actions,
  children,
}: {
  label: ReactNode;
  badge?: string;
  block?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`frow ${block ? 'frow-block' : ''}`}>
      <div className="frow-label">
        <span>{label}</span>
        {badge && <span className="fbadge">{badge}</span>}
        {actions && <span className="frow-actions">{actions}</span>}
      </div>
      <div className="frow-control">{children}</div>
    </div>
  );
}

function GValue({
  ctx,
  value,
  path,
  depth,
  label,
  keyName,
  onRemove,
}: {
  ctx: GCtx;
  value: unknown;
  path: JsonPath;
  depth: number;
  label: ReactNode;
  keyName?: string;
  onRemove?: () => void;
}) {
  const kind = kindOf(value);
  const ptr = pointerOf(path);
  const remove = onRemove ? (
    <button className="small ghost danger" title="Remove" onClick={onRemove}>
      ✕
    </button>
  ) : null;

  if (kind === 'object' || kind === 'array') {
    const isArr = kind === 'array';
    const entries = isArr
      ? (value as unknown[]).map((v, i) => [i, v] as const)
      : Object.entries(value as Record<string, unknown>);
    const isOpen = path.length === 0 ? true : ctx.isOpen(ptr, depth);
    return (
      <GRow
        label={
          path.length === 0 ? (
            <span className="muted">{isArr ? 'list' : 'object'} root</span>
          ) : (
            <button className="disclosure" onClick={() => ctx.toggle(ptr, depth)}>
              {isOpen ? '▾' : '▸'} {label}
            </button>
          )
        }
        badge={`${entries.length} ${isArr ? 'item' : 'field'}${entries.length === 1 ? '' : 's'}`}
        block
        actions={
          <>
            {isArr ? (
              <button
                className="small"
                title="Append an item shaped like the last one"
                onClick={() =>
                  void ctx.apply({ op: 'insert', path, value: templateFrom(value as unknown[]) })
                }
              >
                + add
              </button>
            ) : (
              <AddField
                onAdd={(k, v) => void ctx.apply({ op: 'setProperty', path, key: k, value: v })}
              />
            )}
            {remove}
          </>
        }
      >
        {isOpen && (
          <div className="ofields">
            {entries.map(([k, v]) => (
              <GValue
                key={String(k)}
                ctx={ctx}
                value={v}
                path={[...path, k]}
                depth={depth + 1}
                label={
                  isArr ? (
                    `#${k}`
                  ) : (
                    <KeyLabel
                      name={String(k)}
                      onRename={(nk) =>
                        void ctx.applyMany([
                          { op: 'setProperty', path, key: nk, value: v },
                          { op: 'remove', path: [...path, k] },
                        ])
                      }
                    />
                  )
                }
                keyName={isArr ? undefined : String(k)}
                onRemove={() => void ctx.apply({ op: 'remove', path: [...path, k] })}
              />
            ))}
            {entries.length === 0 && <div className="muted collapsed-summary">(empty)</div>}
          </div>
        )}
        {!isOpen && (
          <div className="muted collapsed-summary">
            {entries
              .slice(0, 4)
              .map(
                ([k, v]) =>
                  `${k}: ${typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : JSON.stringify(v)}`,
              )
              .join(' · ')}
            {entries.length > 4 ? ' · …' : ''}
          </div>
        )}
      </GRow>
    );
  }

  const refType = keyName ? REF_KEYS[keyName] : undefined;
  if (kind === 'number' && refType) {
    return (
      <GRow label={label} badge={refType} actions={remove}>
        <div className="hstack">
          <CommitInput
            kind="number"
            value={String(value)}
            onCommit={(t) => {
              const n = Number(t);
              if (t.trim() !== '' && Number.isFinite(n))
                void ctx.apply({ op: 'set', path, value: n });
            }}
          />
          <GenericRef
            refType={refType}
            value={value as number}
            onPick={(id) => void ctx.apply({ op: 'set', path, value: id })}
          />
        </div>
      </GRow>
    );
  }
  if (kind === 'boolean') {
    return (
      <GRow label={label} actions={remove}>
        <label className="switch">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => void ctx.apply({ op: 'set', path, value: e.target.checked })}
          />
          <span>{String(value)}</span>
        </label>
      </GRow>
    );
  }
  if (kind === 'null') {
    return (
      <GRow label={label} badge="null" actions={remove}>
        <div className="hstack">
          <em>null</em>
          {(['string', 'number', 'object', 'array'] as Kind[]).map((k) => (
            <button
              key={k}
              className="small ghost"
              onClick={() => void ctx.apply({ op: 'set', path, value: blank(k) })}
            >
              make {k}
            </button>
          ))}
        </div>
      </GRow>
    );
  }
  const enumOptions = kind === 'string' && keyName ? ENUM_KEYS[keyName] : undefined;
  if (enumOptions) {
    const cur = String(value);
    const opts = enumOptions.includes(cur) ? enumOptions : [cur, ...enumOptions];
    return (
      <GRow label={label} badge="enum" actions={remove}>
        <select value={cur} onChange={(e) => void ctx.apply({ op: 'set', path, value: e.target.value })}>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </GRow>
    );
  }
  const isNum = kind === 'number';
  return (
    <GRow label={label} badge={isNum ? undefined : 'str'} actions={remove}>
      <CommitInput
        kind={isNum ? 'number' : 'text'}
        value={String(value)}
        wide={!isNum && String(value).length > 24}
        onCommit={(t) => {
          if (isNum) {
            const n = Number(t);
            if (t.trim() !== '' && Number.isFinite(n))
              void ctx.apply({ op: 'set', path, value: n });
          } else void ctx.apply({ op: 'set', path, value: t });
        }}
      />
    </GRow>
  );
}

/** Object key; double-click to rename (new key is appended, old one removed — one undo step). */
function KeyLabel({ name, onRename }: { name: string; onRename: (newName: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing)
    return (
      <span
        title="Double-click to rename this key"
        onDoubleClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </span>
    );
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      style={{ width: Math.max(80, draft.length * 8) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const nk = draft.trim();
          setEditing(false);
          if (nk && nk !== name) onRename(nk);
        } else if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function AddField({ onAdd }: { onAdd: (key: string, value: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<Kind>('string');
  if (!editing)
    return (
      <button className="small" onClick={() => setEditing(true)} title="Add a field">
        + field
      </button>
    );
  return (
    <span className="hstack gjson-add">
      <input
        autoFocus
        type="text"
        placeholder="key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={{ width: 140 }}
      />
      <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {(['string', 'number', 'boolean', 'object', 'array', 'null'] as Kind[]).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <button
        className="small primary"
        disabled={!key.trim()}
        onClick={() => {
          onAdd(key.trim(), blank(kind));
          setKey('');
          setEditing(false);
        }}
      >
        add
      </button>
      <button className="small ghost" onClick={() => setEditing(false)}>
        cancel
      </button>
    </span>
  );
}

function GenericRef({
  refType,
  value,
  onPick,
}: {
  refType: string;
  value: number;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<RefCandidateDto | null | 'loading'>('loading');
  const selectBlock = useStore((s) => s.selectBlock);
  useEffect(() => {
    let alive = true;
    if (!value) {
      setResolved(null);
      return;
    }
    setResolved('loading');
    void api
      .invoke('blocks:resolveRef', { refType, id: value })
      .then((r) => alive && setResolved(r));
    return () => {
      alive = false;
    };
  }, [refType, value]);
  const missing = !!value && resolved === null;
  return (
    <div className="refctl">
      <button
        className={`refbtn ${missing ? 'missing' : ''}`}
        onClick={() => setOpen(true)}
        title={`Pick a ${refType}`}
      >
        <span className="rid">{value}</span>
        <span className="rname">
          {!value ? (
            <em>(none)</em>
          ) : resolved === 'loading' ? (
            '…'
          ) : resolved ? (
            resolved.name || <em>(no name)</em>
          ) : (
            <em>does not exist</em>
          )}
        </span>
        {resolved && resolved !== 'loading' && (
          <span className={`rsrc rsrc-${resolved.source}`}>{resolved.source}</span>
        )}
      </button>
      {resolved && resolved !== 'loading' && resolved.blockId && (
        <button
          className="small ghost"
          onClick={() => void selectBlock(resolved.blockId!)}
          title="Open the referenced block"
        >
          →
        </button>
      )}
      {open && (
        <RefPicker
          refType={refType}
          value={value}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
