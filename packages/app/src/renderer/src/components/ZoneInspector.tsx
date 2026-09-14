/**
 * Right-hand panel of graph mode: the selected zone as a real schema form
 * (same fields, pickers and problem markers as the Form tab, scoped to
 * Zones[i]) plus the zone's create/duplicate/delete/alarm actions.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Diagnostic, SchemaClosureDto, ZoneNode } from '@shared/ipc';
import { EditorContext, type EditorCtx } from '../editor/EditorContext';
import { ObjectFields } from '../editor/fields';
import { RefPicker } from '../editor/RefPicker';
import { pointerOf } from '../editor/schemaUtil';
import { useStore } from '../store';
import { getClosure } from './BlockEditor';

export const DIRECTIONS: { key: string; label: string; title: string }[] = [
  { key: 'Forward', label: '↑ F', title: 'Towards_Forward' },
  { key: 'Right', label: '→ R', title: 'Towards_Right' },
  { key: 'Left', label: '← L', title: 'Towards_Left' },
  { key: 'Backward', label: '↓ B', title: 'Towards_Backward' },
  { key: 'Random', label: '? Rnd', title: 'Towards_Random' },
];

/** Direction chooser used by "+ zone from here". */
export function DirectionMenu({
  onPick,
  onClose,
}: {
  onPick: (direction: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="zg-dirmenu" onMouseLeave={onClose}>
      <span className="muted">new zone expands…</span>
      {DIRECTIONS.map((d) => (
        <button key={d.key} title={d.title} onClick={() => onPick(d.key)}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

export function ZoneInspector() {
  const block = useStore((s) => s.block);
  const detail = useStore((s) => s.layoutDetail);
  const focus = useStore((s) => s.focusPointer);
  const diagnostics = useStore((s) => s.diagnostics);
  const applyEdit = useStore((s) => s.applyEdit);
  const applyMany = useStore((s) => s.applyMany);
  const selectBlock = useStore((s) => s.selectBlock);
  const selectZone = useStore((s) => s.selectZone);
  const rundownOp = useStore((s) => s.rundownOp);
  const setField = useStore((s) => s.setField);
  const openDialog = useStore((s) => s.openDialog);
  const rawText = useStore((s) =>
    s.raw && s.block && s.raw.fileId === s.block.file ? s.raw.text : null,
  );
  const [closure, setClosure] = useState<SchemaClosureDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!block?.type) return;
    let alive = true;
    void getClosure(block.type).then((c) => alive && setClosure(c));
    return () => {
      alive = false;
    };
  }, [block?.type]);

  const problems = useMemo(() => {
    const m = new Map<string, Diagnostic[]>();
    if (!block) return m;
    for (const d of diagnostics) {
      if (d.blockId !== block.blockId || !d.jsonPath) continue;
      const ptr = pointerOf(d.jsonPath.slice(block.path.length));
      m.set(ptr, [...(m.get(ptr) ?? []), d]);
    }
    return m;
  }, [diagnostics, block]);

  if (!block || !detail) return null;
  const index = focus?.startsWith('/Zones/') ? Number(focus.split('/')[2]) : NaN;
  const zone: ZoneNode | undefined = Number.isInteger(index) ? detail.zones[index] : undefined;
  const value = (block.value ?? {}) as Record<string, unknown>;
  const zonesValue = Array.isArray(value['Zones']) ? (value['Zones'] as unknown[]) : [];
  const zoneValue = zone
    ? (zonesValue[zone.index] as Record<string, unknown> | undefined)
    : undefined;

  const addZone = (direction?: string) => {
    setAdding(false);
    const next = detail.zones.length;
    void rundownOp({
      kind: 'addZone',
      layoutBlockId: block.blockId,
      ...(zone ? { buildFrom: zone.localIndex } : {}),
      ...(direction ? { direction } : {}),
    }).then((ok) => ok && selectZone(next));
  };

  if (!zone || !zoneValue) {
    return (
      <div className="zoneinspector">
        <div className="zi-head">
          <strong>{block.name || 'Layout'}</strong>
          <span className="muted">
            {' '}
            · alias start {detail.zoneAliasStart} · {detail.zones.length} zone
            {detail.zones.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="zi-actions">
          <button onClick={() => addZone()} title="Append a zone building from the last one">
            + zone
          </button>
        </div>
        <p className="muted zi-hint">
          Click a zone in the graph to edit it here. Drag a zone onto another to make it build from
          that zone; drop it on empty space to set the direction it expands from its parent. Layout
          fields such as ZoneAliasStart are on the Form tab.
        </p>
      </div>
    );
  }

  const dependents = detail.zones.filter(
    (z) => z.index !== zone.index && z.buildFrom === zone.localIndex,
  );
  const parent = detail.zones.find((z) => z.localIndex === zone.buildFrom);
  const alarmPath = ['Zones', zone.index, 'ChainedPuzzleToEnter'];
  const del = () => {
    const warn = dependents.length
      ? `\n\n${dependents.length} zone(s) build from it and will point at a missing zone: ${dependents
          .map((d) => `Z${d.alias}`)
          .join(', ')}.`
      : '';
    if (
      confirm(
        `Delete zone Z${zone.alias} (LocalIndex ${zone.localIndex})?${warn}\n\nCtrl+Z undoes.`,
      )
    )
      void rundownOp({ kind: 'deleteZone', layoutBlockId: block.blockId, index: zone.index }).then(
        (ok) => ok && selectZone(Math.max(0, Math.min(zone.index, detail.zones.length - 2))),
      );
  };

  const zoneClass = (() => {
    if (!closure) return undefined;
    const f = closure.root.fields.find((x) => x.name === 'Zones');
    const cn =
      f?.kind === 'list' && f.item.kind === 'object' ? f.item.className : 'ExpeditionZoneData';
    return closure.classes[cn];
  })();

  const ctx: EditorCtx | null = closure
    ? {
        block,
        closure,
        problems,
        focusPointer: focus,
        apply: applyEdit,
        applyMany,
        goToBlock: (id) => void selectBlock(id),
        rawSlice: (pointer) => {
          const r = block.tokenRanges[pointer];
          if (!r || rawText === null) return undefined;
          return rawText.slice(r.offset, r.offset + r.length);
        },
      }
    : null;

  return (
    <div className="zoneinspector">
      <div className="zi-head">
        <strong>Z{zone.alias}</strong>
        <span className="muted">
          {' '}
          · LocalIndex {zone.localIndex} · #{zone.index} in list
          {parent && parent.index !== zone.index
            ? ` · builds from Z${parent.alias}`
            : zone.buildFrom === zone.localIndex
              ? ' · start zone'
              : ` · builds from missing Zone_${zone.buildFrom}`}
        </span>
        {zone.problems > 0 && <span className="tproblems">{zone.problems}</span>}
      </div>
      <div className="zi-actions">
        <button
          onClick={() => setAdding((v) => !v)}
          title="Create a zone that builds from this one"
        >
          + zone from here
        </button>
        <button
          onClick={() => setPicking(true)}
          title="Pick the alarm (ChainedPuzzle) on the door into this zone"
        >
          🔔 alarm
        </button>
        <button
          onClick={() =>
            void rundownOp({
              kind: 'duplicateZone',
              layoutBlockId: block.blockId,
              index: zone.index,
            })
          }
          title="Duplicate this zone (next free LocalIndex)"
        >
          ⧉ duplicate
        </button>
        <button
          className="danger-soft"
          onClick={del}
          title={
            dependents.length
              ? `Delete; ${dependents.length} zone(s) build from this one`
              : 'Delete this zone'
          }
        >
          ✕ delete
        </button>
      </div>
      {adding && <DirectionMenu onPick={addZone} onClose={() => setAdding(false)} />}
      {picking && (
        <div className="zi-picker">
          <RefPicker
            refType="ChainedPuzzle"
            value={zone.alarm?.id ?? 0}
            onPick={(id) => {
              setPicking(false);
              void setField(block.blockId, alarmPath, id);
            }}
            onClose={() => setPicking(false)}
          />
          <button
            className="small ghost"
            onClick={() => {
              setPicking(false);
              openDialog({
                kind: 'newBlock',
                type: 'ChainedPuzzle',
                name: `Zone ${zone.alias} alarm`,
                then: { blockId: block.blockId, path: alarmPath },
              });
            }}
          >
            + new alarm instead
          </button>
        </div>
      )}
      {dependents.length > 0 && (
        <div className="zi-deps muted">
          {dependents.length} zone{dependents.length === 1 ? '' : 's'} build from this one:{' '}
          {dependents.map((d, i) => (
            <span key={d.index}>
              {i > 0 && ', '}
              <button className="linkish" onClick={() => selectZone(d.index)}>
                Z{d.alias}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="zi-form">
        {ctx ? (
          <EditorContext.Provider value={ctx}>
            <div className="blockeditor">
              <ObjectFields cls={zoneClass} value={zoneValue} path={['Zones', zone.index]} />
            </div>
          </EditorContext.Provider>
        ) : (
          <div className="editor-placeholder muted">Loading schema…</div>
        )}
      </div>
    </div>
  );
}
