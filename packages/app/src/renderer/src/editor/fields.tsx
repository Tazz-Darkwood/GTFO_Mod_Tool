import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ClassSchema, EnumSchema, FieldSchema, JsonPath, RefCandidateDto } from '@shared/ipc';
import { api } from '../api';
import { useEditor } from './EditorContext';
import { FieldRow } from './FieldRow';
import { RefPicker } from './RefPicker';
import {
  classOf,
  defaultValue,
  enumName,
  enumOf,
  pointerOf,
  resolveField,
  summarize,
} from './schemaUtil';
import { confirmPaste, copyText, readClipboardJson } from './clipboard';
import { useStore } from '../store';

/** Copy the source text of an object/array (or the JSON of a scalar) at a block-relative path. */
function useCopyValue() {
  const { rawSlice } = useEditor();
  const toast = useStore((s) => s.showToast);
  return async (path: JsonPath, value: unknown) => {
    const text = rawSlice(pointerOf(path)) ?? JSON.stringify(value, null, 2);
    const ok = await copyText(text);
    toast(ok ? 'info' : 'error', ok ? 'Copied to clipboard' : 'Clipboard unavailable');
  };
}

interface FieldProps {
  field: FieldSchema;
  value: unknown;
  path: JsonPath;
  /** Label override (list items use their index). */
  label?: ReactNode;
  onRemove?: () => void;
}

const TEXT_TYPE = 'Text';

/** Dispatch on field kind. */
export function Field(props: FieldProps) {
  const { field, value } = props;
  if (value === null && field.kind !== 'scalar' && field.kind !== 'unknown')
    return <NullField {...props} />;
  switch (field.kind) {
    case 'scalar':
      return <ScalarField {...props} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'ref':
      return <RefField {...props} refType={field.refType} />;
    case 'localizedText':
      return <LocalizedTextField {...props} />;
    case 'object':
      return <ObjectField {...props} />;
    case 'builtin':
      return <BuiltinField {...props} />;
    case 'list':
      return <ListField {...props} />;
    case 'unknown':
      return <UnknownField {...props} />;
  }
}

function useTokenStyle(path: JsonPath): string | undefined {
  const { block } = useEditor();
  return block.tokenStyles[pointerOf(path)];
}

function labelOf(props: FieldProps): ReactNode {
  return props.label ?? props.field.name;
}

function RemoveButton({ onRemove }: { onRemove?: () => void }) {
  if (!onRemove) return null;
  return (
    <button className="small ghost danger" onClick={onRemove} title="Remove">
      ✕
    </button>
  );
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

function ScalarField(props: FieldProps) {
  const { field, value, path } = props;
  const { apply } = useEditor();
  const style = useTokenStyle(path);
  if (field.kind !== 'scalar') return null;
  const pointer = pointerOf(path);

  if (field.scalar === 'Boolean') {
    return (
      <FieldRow
        pointer={pointer}
        label={labelOf(props)}
        actions={<RemoveButton onRemove={props.onRemove} />}
      >
        <label className="switch">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => void apply({ op: 'set', path, value: e.target.checked })}
          />
          <span>{value === true ? 'true' : value === false ? 'false' : String(value)}</span>
        </label>
      </FieldRow>
    );
  }
  const numeric = field.scalar !== 'String';
  return (
    <FieldRow
      pointer={pointer}
      label={labelOf(props)}
      badge={field.display === 'soundId' ? 'sound' : style === 'float' ? '1.0' : undefined}
      actions={<RemoveButton onRemove={props.onRemove} />}
    >
      <CommitInput
        kind={numeric ? 'number' : 'text'}
        value={value === null || value === undefined ? '' : String(value)}
        onCommit={(text) => {
          if (numeric) {
            if (text.trim() === '') return;
            const n = Number(text);
            if (!Number.isFinite(n)) return;
            void apply({ op: 'set', path, value: n });
          } else void apply({ op: 'set', path, value: text });
        }}
      />
    </FieldRow>
  );
}

/** Text/number input that commits on blur or Enter and resets on Escape. */
export function CommitInput({
  kind,
  value,
  onCommit,
  placeholder,
  wide,
}: {
  kind: 'number' | 'text';
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className={`cinput ${wide ? 'wide' : ''} ${draft !== value ? 'pending' : ''}`}
      type={kind === 'number' ? 'text' : 'text'}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

function EnumField(props: FieldProps) {
  const { field, value, path } = props;
  const { apply, closure } = useEditor();
  const style = useTokenStyle(path);
  const [rawMode, setRawMode] = useState(false);
  if (field.kind !== 'enum') return null;
  const e: EnumSchema | undefined = enumOf(closure, field.enumName);
  const pointer = pointerOf(path);
  const current = enumName(e, value);
  const isMember =
    current !== undefined &&
    !(e?.isFlags && typeof value === 'number' && !e.members.some((m) => m.value === value));
  const asString = style === 'string';

  if (
    !e ||
    rawMode ||
    (e.isFlags && typeof value === 'number' && !e.members.some((m) => m.value === value)) ||
    (e.open && !isMember)
  ) {
    return (
      <FieldRow
        pointer={pointer}
        label={labelOf(props)}
        hint={field.enumName}
        badge={asString ? 'str' : 'int'}
        actions={<RemoveButton onRemove={props.onRemove} />}
      >
        <div className="hstack">
          <CommitInput
            kind={typeof value === 'number' ? 'number' : 'text'}
            value={String(value ?? '')}
            onCommit={(t) => {
              const n = Number(t);
              void apply({
                op: 'set',
                path,
                value: typeof value === 'number' && Number.isFinite(n) && t.trim() !== '' ? n : t,
              });
            }}
          />
          {e && (
            <>
              <span className="muted small-text">
                {current ?? (e.isFlags ? 'flags' : `not a named ${field.enumName} value`)}
              </span>
              <button
                className="small ghost"
                onClick={() => setRawMode(false)}
                title="Pick from the list"
              >
                list
              </button>
            </>
          )}
        </div>
      </FieldRow>
    );
  }

  return (
    <FieldRow
      pointer={pointer}
      label={labelOf(props)}
      hint={field.enumName}
      badge={asString ? 'str' : 'int'}
      actions={<RemoveButton onRemove={props.onRemove} />}
    >
      <div className="hstack">
        <select
          value={isMember ? current : '__other__'}
          onChange={(ev) => {
            const name = ev.target.value;
            if (name === '__other__') return;
            void apply({ op: 'set', path, value: { $enum: name } });
          }}
        >
          {!isMember && (
            <option value="__other__">
              {typeof value === 'number' || typeof value === 'string'
                ? `(current: ${String(value)})`
                : '(unset)'}
            </option>
          )}
          {e.members.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} {asString ? '' : `(${m.value})`}
            </option>
          ))}
        </select>
        <button className="small ghost" onClick={() => setRawMode(true)} title="Type a raw value">
          raw
        </button>
      </div>
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

function useResolvedRef(refType: string, id: unknown): RefCandidateDto | null | 'loading' {
  const [state, setState] = useState<RefCandidateDto | null | 'loading'>('loading');
  useEffect(() => {
    if (typeof id !== 'number' || id === 0 || id === -1) {
      setState(null);
      return;
    }
    let alive = true;
    setState('loading');
    void api.invoke('blocks:resolveRef', { refType, id }).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [refType, id]);
  return state;
}

function RefField(props: FieldProps & { refType: string; extraActions?: ReactNode }) {
  const { value, path, refType } = props;
  const { apply, goToBlock } = useEditor();
  const [open, setOpen] = useState(false);
  const resolved = useResolvedRef(refType, value);
  const pointer = pointerOf(path);
  const id = typeof value === 'number' ? value : NaN;
  const missing = typeof value === 'number' && value !== 0 && value !== -1 && resolved === null;

  return (
    <FieldRow
      pointer={pointer}
      label={labelOf(props)}
      hint={`reference to ${refType}`}
      badge={refType}
      actions={
        <>
          {props.extraActions}
          <RemoveButton onRemove={props.onRemove} />
        </>
      }
    >
      <div className="refctl">
        <button
          className={`refbtn ${missing ? 'missing' : ''}`}
          onClick={() => setOpen(true)}
          title="Pick a block"
        >
          <span className="rid">{typeof value === 'number' ? value : String(value)}</span>
          <span className="rname">
            {typeof value === 'string' ? (
              <em>string ID (not checked)</em>
            ) : id === 0 || id === -1 ? (
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
            onClick={() => goToBlock(resolved.blockId!)}
            title="Open the referenced block"
          >
            →
          </button>
        )}
        {open && (
          <RefPicker
            refType={refType}
            value={id}
            onPick={(picked) => {
              setOpen(false);
              void apply({ op: 'set', path, value: picked });
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// LocalizedText: a Text ID or a literal string
// ---------------------------------------------------------------------------

function LocalizedTextField(props: FieldProps) {
  const { value, path } = props;
  const { apply } = useEditor();
  const pointer = pointerOf(path);
  if (typeof value === 'number') {
    return (
      <RefField
        {...props}
        refType={TEXT_TYPE}
        label={labelOf(props)}
        extraActions={
          <button
            className="small ghost"
            onClick={() => void apply({ op: 'set', path, value: '' })}
            title="Replace the Text ID with a literal string"
          >
            use text
          </button>
        }
      />
    );
  }
  if (typeof value === 'string') {
    return (
      <FieldRow
        pointer={pointer}
        label={labelOf(props)}
        badge="text"
        actions={<RemoveButton onRemove={props.onRemove} />}
      >
        <div className="hstack">
          <CommitInput
            kind="text"
            value={value}
            wide
            onCommit={(t) => void apply({ op: 'set', path, value: t })}
          />
          <button
            className="small ghost"
            onClick={() => void apply({ op: 'set', path, value: 0 })}
            title="Use a Text datablock ID instead"
          >
            use ID
          </button>
        </div>
      </FieldRow>
    );
  }
  return <UnknownField {...props} />;
}

// ---------------------------------------------------------------------------
// Objects, builtins, lists
// ---------------------------------------------------------------------------

function useCollapsed(path: JsonPath, defaultCollapsed: boolean) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Expand automatically when a problem inside is being focused.
  const { focusPointer } = useEditor();
  const pointer = pointerOf(path);
  useEffect(() => {
    if (focusPointer && focusPointer.startsWith(pointer + '/')) setCollapsed(false);
  }, [focusPointer, pointer]);
  return [collapsed, setCollapsed] as const;
}

export function ObjectFields({
  cls,
  value,
  path,
}: {
  cls: ClassSchema | undefined;
  value: Record<string, unknown>;
  path: JsonPath;
}) {
  const { closure, apply } = useEditor();
  const keys = Object.keys(value);
  const known: { key: string; field: FieldSchema }[] = [];
  const unknown: string[] = [];
  for (const k of keys) {
    const f = cls ? resolveField(cls, k) : undefined;
    if (f) known.push({ key: k, field: f });
    else unknown.push(k);
  }
  // Schema order for known fields, file order for unknown ones.
  if (cls)
    known.sort(
      (a, b) =>
        cls.fieldsByLowerName[a.field.name.toLowerCase()]! -
        cls.fieldsByLowerName[b.field.name.toLowerCase()]!,
    );
  const missing = cls
    ? cls.fields.filter(
        (f) =>
          !keys.some((k) => k.toLowerCase() === f.name.toLowerCase()) &&
          !['datablock'].includes(f.name),
      )
    : [];
  const [adding, setAdding] = useState('');

  return (
    <div className="ofields">
      {known.map(({ key, field }) => (
        <Field
          key={key}
          field={field}
          value={value[key]}
          path={[...path, key]}
          label={key !== field.name ? `${key} (${field.name})` : undefined}
        />
      ))}
      {unknown.length > 0 && (
        <div className="unknown-fields">
          <div className="unknown-head muted">Fields not in the schema (kept as-is)</div>
          {unknown.map((k) => (
            <UnknownField
              key={k}
              field={{ kind: 'unknown', name: k, declared: 'json' }}
              value={value[k]}
              path={[...path, k]}
              onRemove={() => void apply({ op: 'remove', path: [...path, k] })}
            />
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="addfield">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add missing field…</option>
            {missing.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} (
                {f.kind === 'scalar'
                  ? f.scalar
                  : f.kind === 'enum'
                    ? f.enumName
                    : f.kind === 'ref'
                      ? `→ ${f.refType}`
                      : f.kind}
                )
              </option>
            ))}
          </select>
          <button
            className="small"
            disabled={!adding}
            onClick={() => {
              const f = missing.find((x) => x.name === adding);
              if (!f) return;
              void apply({ op: 'setProperty', path, key: f.name, value: defaultValue(f, closure) });
              setAdding('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function ObjectField(props: FieldProps) {
  const { field, value, path } = props;
  const { closure, apply } = useEditor();
  const copy = useCopyValue();
  const toast = useStore((s) => s.showToast);
  const [collapsed, setCollapsed] = useCollapsed(path, path.length >= 2);
  if (field.kind !== 'object') return null;
  const cls = classOf(closure, field.className);
  const obj = (value ?? {}) as Record<string, unknown>;
  const count = Object.keys(obj).length;
  const paste = async () => {
    const clip = await readClipboardJson();
    if (!clip || clip.kind !== 'object') {
      toast('error', 'Clipboard does not hold a JSON object');
      return;
    }
    if (!confirmPaste(clip.value, cls)) return;
    void apply({ op: 'setRaw', path, text: clip.text });
  };
  return (
    <FieldRow
      pointer={pointerOf(path)}
      label={
        <button className="disclosure" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} {labelOf(props)}
        </button>
      }
      hint={field.className}
      badge={collapsed ? `${count} field${count === 1 ? '' : 's'}` : undefined}
      block
      actions={
        <>
          <button
            className="small ghost"
            onClick={() => void copy(path, obj)}
            title="Copy this object as JSON"
          >
            copy
          </button>
          <button
            className="small ghost"
            onClick={() => void paste()}
            title="Replace this object with the clipboard JSON"
          >
            paste
          </button>
          <RemoveButton onRemove={props.onRemove} />
        </>
      }
    >
      {collapsed ? (
        <div className="muted collapsed-summary">
          {summarize(obj, cls, closure) || (count === 0 ? '(empty)' : '')}
        </div>
      ) : (
        <ObjectFields cls={cls} value={obj} path={path} />
      )}
    </FieldRow>
  );
}

function BuiltinField(props: FieldProps) {
  const { field, value, path } = props;
  const { apply } = useEditor();
  if (field.kind !== 'builtin') return null;
  const obj = (value ?? {}) as Record<string, unknown>;
  const keys =
    field.builtin === 'Color'
      ? ['r', 'g', 'b', 'a']
      : field.builtin === 'Vector2'
        ? ['x', 'y']
        : ['x', 'y', 'z'];
  const color =
    field.builtin === 'Color'
      ? `rgba(${Math.round(((obj['r'] as number) ?? 0) * 255)},${Math.round(((obj['g'] as number) ?? 0) * 255)},${Math.round(((obj['b'] as number) ?? 0) * 255)},${(obj['a'] as number) ?? 1})`
      : undefined;
  return (
    <FieldRow
      pointer={pointerOf(path)}
      label={labelOf(props)}
      hint={field.builtin}
      badge={field.builtin}
      actions={<RemoveButton onRemove={props.onRemove} />}
    >
      <div className="hstack">
        {color && <span className="swatch" style={{ background: color }} title={color} />}
        {keys.map((k) => (
          <label key={k} className="vec">
            <span>{k}</span>
            <CommitInput
              kind="number"
              value={obj[k] === undefined ? '' : String(obj[k])}
              onCommit={(t) => {
                const n = Number(t);
                if (Number.isFinite(n))
                  void apply(
                    obj[k] === undefined
                      ? { op: 'setProperty', path, key: k, value: n }
                      : { op: 'set', path: [...path, k], value: n },
                  );
              }}
            />
          </label>
        ))}
      </div>
    </FieldRow>
  );
}

function ListField(props: FieldProps) {
  const { field, value, path } = props;
  const { apply, applyMany, closure, focusPointer, rawSlice } = useEditor();
  const copy = useCopyValue();
  const toast = useStore((s) => s.showToast);
  const items = Array.isArray(value) ? value : [];
  const [collapsed, setCollapsed] = useCollapsed(path, items.length > 6 || path.length >= 2);
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const pointer = pointerOf(path);
  // A problem inside item #i opens that item.
  useEffect(() => {
    if (!focusPointer || !focusPointer.startsWith(pointer + '/')) return;
    const idx = Number(focusPointer.slice(pointer.length + 1).split('/')[0]);
    if (Number.isInteger(idx)) setOpenItems((s) => (s.has(idx) ? s : new Set([...s, idx])));
  }, [focusPointer, pointer]);
  if (field.kind !== 'list') return null;
  const itemCls = field.item.kind === 'object' ? classOf(closure, field.item.className) : undefined;
  const itemIsObject =
    field.item.kind === 'object' || field.item.kind === 'list' || field.item.kind === 'builtin';

  /** Copy of item i inserted right after it, source text and comments included. */
  const duplicateItem = (i: number) => {
    const raw = rawSlice(pointerOf([...path, i]));
    void apply(
      raw !== undefined
        ? { op: 'insertRaw', path, index: i + 1, text: raw }
        : { op: 'insert', path, index: i + 1, value: items[i] },
    );
  };
  const pasteItems = async () => {
    const clip = await readClipboardJson();
    if (!clip || clip.kind === 'scalar') {
      toast('error', 'Clipboard does not hold a JSON object or array');
      return;
    }
    if (clip.kind === 'object') {
      if (!confirmPaste(clip.value, itemCls)) return;
      void apply({ op: 'insertRaw', path, text: clip.text });
      return;
    }
    const arr = clip.value as unknown[];
    if (arr.length === 0) return;
    if (arr.some((x) => !confirmPaste(x, itemCls))) return;
    void applyMany(arr.map((x) => ({ op: 'insert' as const, path, value: x })));
  };

  return (
    <FieldRow
      pointer={pointerOf(path)}
      label={
        <button className="disclosure" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} {labelOf(props)}
        </button>
      }
      hint={`list of ${field.item.kind === 'object' ? field.item.className : field.item.kind === 'enum' ? field.item.enumName : field.item.kind === 'ref' ? field.item.refType : field.item.kind}`}
      badge={`${items.length} item${items.length === 1 ? '' : 's'}`}
      block
      actions={
        <>
          <button
            className="small"
            onClick={() =>
              void apply({ op: 'insert', path, value: defaultValue(field.item, closure) })
            }
            title="Append an item"
          >
            + add
          </button>
          <button
            className="small ghost"
            onClick={() => void pasteItems()}
            title="Append the clipboard JSON (one object or an array of them)"
          >
            paste
          </button>
          {items.length > 0 && (
            <button
              className="small ghost"
              onClick={() => void copy(path, items)}
              title="Copy the whole list as JSON"
            >
              copy
            </button>
          )}
          <RemoveButton onRemove={props.onRemove} />
        </>
      }
    >
      {!collapsed && (
        <div className="list-items">
          {items.map((item, i) =>
            itemIsObject ? (
              <div key={i} className="list-item">
                <div className="list-item-head">
                  <button className="disclosure" onClick={() => setOpenItems((s) => toggle(s, i))}>
                    {openItems.has(i) ? '▾' : '▸'} #{i}
                  </button>
                  <span className="muted collapsed-summary">
                    {!openItems.has(i) && summarize(item, itemCls, closure)}
                  </span>
                  <span className="right hstack">
                    <button
                      className="small ghost"
                      onClick={() => duplicateItem(i)}
                      title="Duplicate this item"
                    >
                      ⧉
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => void copy([...path, i], item)}
                      title="Copy this item as JSON"
                    >
                      copy
                    </button>
                    <button
                      className="small ghost danger"
                      onClick={() => void apply({ op: 'remove', path: [...path, i] })}
                      title="Remove item"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {openItems.has(i) &&
                  (field.item.kind === 'object' ? (
                    <ObjectFields
                      cls={itemCls}
                      value={(item ?? {}) as Record<string, unknown>}
                      path={[...path, i]}
                    />
                  ) : (
                    <Field field={field.item} value={item} path={[...path, i]} label={`#${i}`} />
                  ))}
              </div>
            ) : (
              <Field
                key={i}
                field={field.item}
                value={item}
                path={[...path, i]}
                label={`#${i}`}
                onRemove={() => void apply({ op: 'remove', path: [...path, i] })}
              />
            ),
          )}
          {items.length === 0 && <div className="muted collapsed-summary">(empty)</div>}
        </div>
      )}
    </FieldRow>
  );
}

function toggle(s: Set<number>, i: number): Set<number> {
  const n = new Set(s);
  if (n.has(i)) n.delete(i);
  else n.add(i);
  return n;
}

// ---------------------------------------------------------------------------
// Null / unknown
// ---------------------------------------------------------------------------

function NullField(props: FieldProps) {
  const { field, path } = props;
  const { apply, closure } = useEditor();
  return (
    <FieldRow
      pointer={pointerOf(path)}
      label={labelOf(props)}
      badge="null"
      actions={<RemoveButton onRemove={props.onRemove} />}
    >
      <div className="hstack">
        <em>null</em>
        <button
          className="small ghost"
          onClick={() => void apply({ op: 'set', path, value: defaultValue(field, closure) })}
        >
          create
        </button>
      </div>
    </FieldRow>
  );
}

/** Raw JSON editor for values the schema does not describe. */
function UnknownField(props: FieldProps) {
  const { field, value, path } = props;
  const { apply } = useEditor();
  const text = useMemo(() => JSON.stringify(value, null, 2) ?? 'null', [value]);
  const [draft, setDraft] = useState(text);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setDraft(text);
    setErr(null);
  }, [text]);
  const multiline = text.includes('\n');
  return (
    <FieldRow
      pointer={pointerOf(path)}
      label={labelOf(props)}
      hint={field.kind === 'unknown' ? field.declared : undefined}
      badge="json"
      block={multiline}
      actions={<RemoveButton onRemove={props.onRemove} />}
    >
      <div className="vstack">
        <textarea
          className={`rawjson ${draft !== text ? 'pending' : ''}`}
          rows={multiline ? Math.min(12, text.split('\n').length) : 1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
        {draft !== text && (
          <div className="hstack">
            <button
              className="small primary"
              onClick={() => {
                try {
                  const v = JSON.parse(draft) as unknown;
                  setErr(null);
                  void apply({ op: 'set', path, value: v });
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              Apply
            </button>
            <button className="small ghost" onClick={() => setDraft(text)}>
              Cancel
            </button>
            {err && <span className="sev-error small-text">{err}</span>}
          </div>
        )}
      </div>
    </FieldRow>
  );
}
