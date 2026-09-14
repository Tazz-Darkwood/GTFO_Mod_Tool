import { useState, type ReactNode } from 'react';
import type {
  DimensionNode,
  ExpeditionNode,
  LayerNode,
  LinkNode,
  RundownNode,
  Tier,
  ZoneNode,
} from '@shared/ipc';
import { RefPicker } from '../editor/RefPicker';
import { expeditionKey, expeditionLabel } from '../rundownLookup';
import { useStore } from '../store';

const TIERS: Tier[] = ['A', 'B', 'C', 'D', 'E'];

/** Rundown → tiers → expeditions → layers/zones. Every node navigates; most can be edited in place. */
export function RundownView() {
  const tree = useStore((s) => s.rundownTree);
  const filter = useStore((s) => s.rundownFilter);
  const setFilter = useStore((s) => s.setRundownFilter);
  const expanded = useStore((s) => s.expanded);
  const toggle = useStore((s) => s.toggleExpanded);

  if (!tree) {
    return (
      <div className="filesview">
        <div className="empty">
          This project defines no Rundown block, so there is nothing to navigate. Use the Types or
          Files tab.
        </div>
      </div>
    );
  }
  const q = filter.trim().toLowerCase();

  return (
    <div className="filesview">
      <div className="search">
        <input
          type="search"
          placeholder="Filter expeditions…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="typetree-head">
        <span>Rundown</span>
        <span className="muted">
          {tree.rundowns.reduce(
            (n, r) => n + r.tiers.reduce((m, t) => m + t.expeditions.length, 0),
            0,
          )}{' '}
          expeditions
        </span>
      </div>
      <div className="filesview-scroll rtree">
        {tree.rundowns.map((rd) => (
          <RundownRow key={rd.blockId} rd={rd} q={q} expanded={expanded} toggle={toggle} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Row({
  depth,
  caret,
  onClick,
  className,
  title,
  children,
  actions,
  problems,
  selected,
}: {
  depth: number;
  caret?: boolean | null;
  onClick?: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  problems?: number;
  selected?: boolean;
}) {
  return (
    <div
      className={`frow-file rtree-row ${className ?? ''} ${selected ? 'selected' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
      title={title}
    >
      {caret !== undefined && (
        <span className="caret">{caret === null ? '' : caret ? '▾' : '▸'}</span>
      )}
      <span className="fname rtree-label">{children}</span>
      {!!problems && <span className="tproblems">{problems}</span>}
      {actions && <span className="frow-file-actions">{actions}</span>}
    </div>
  );
}

function Act({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      className={`small ghost ${danger ? 'danger' : ''}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function RundownRow({
  rd,
  q,
  expanded,
  toggle,
}: {
  rd: RundownNode;
  q: string;
  expanded: Record<string, boolean>;
  toggle: (k: string, f?: boolean) => void;
}) {
  const selectBlock = useStore((s) => s.selectBlock);
  const openDialog = useStore((s) => s.openDialog);
  const key = `rd:${rd.id}`;
  const open = expanded[key] !== false && (expanded[key] ?? true);
  return (
    <div>
      <Row
        depth={0}
        caret={open}
        className="rtree-rundown"
        onClick={() => toggle(key)}
        problems={rd.problems}
        title={`Rundown #${rd.id}${rd.loaded ? ' (loaded by GameSetup)' : ' (not in GameSetup.RundownIdsToLoad)'}`}
        actions={
          <Act title="Open the Rundown block" onClick={() => void selectBlock(rd.blockId)}>
            form
          </Act>
        }
      >
        <b>{rd.name || `Rundown #${rd.id}`}</b>
        <span className={`tbadge ${rd.loaded ? 'tbadge-wrapper-file' : ''}`}>
          {rd.loaded ? 'loaded' : 'not loaded'}
        </span>
      </Row>
      {open &&
        TIERS.map((tier) => {
          const t = rd.tiers.find((x) => x.tier === tier)!;
          const tkey = `tier:${rd.id}:${tier}`;
          const list = q
            ? t.expeditions.filter((e) => expeditionLabel(e).toLowerCase().includes(q))
            : t.expeditions;
          if (q && list.length === 0) return null;
          const topen = q ? true : (expanded[tkey] ?? t.expeditions.length > 0);
          return (
            <div key={tier}>
              <Row
                depth={1}
                caret={topen}
                className="rtree-tier"
                onClick={() => toggle(tkey)}
                problems={t.expeditions.reduce((n, e) => n + e.problems, 0)}
                actions={
                  <Act
                    title={`Add an expedition to tier ${tier}`}
                    onClick={() =>
                      openDialog({ kind: 'addExpedition', rundownBlockId: rd.blockId, tier })
                    }
                  >
                    +
                  </Act>
                }
              >
                Tier {tier} <span className="muted">{t.expeditions.length}</span>
              </Row>
              {topen &&
                list.map((e) => (
                  <ExpeditionRow
                    key={e.index}
                    rd={rd}
                    e={e}
                    expanded={expanded}
                    toggle={toggle}
                    forceOpen={!!q}
                  />
                ))}
            </div>
          );
        })}
    </div>
  );
}

function ExpeditionRow({
  rd,
  e,
  expanded,
  toggle,
  forceOpen,
}: {
  rd: RundownNode;
  e: ExpeditionNode;
  expanded: Record<string, boolean>;
  toggle: (k: string, f?: boolean) => void;
  forceOpen: boolean;
}) {
  const rundownOp = useStore((s) => s.rundownOp);
  const setField = useStore((s) => s.setField);
  const selectBlock = useStore((s) => s.selectBlock);
  const [moving, setMoving] = useState(false);
  const key = expeditionKey(rd.id, e);
  const open = forceOpen || !!expanded[key];

  const del = () => {
    if (
      confirm(
        `Delete expedition ${expeditionLabel(e)} from tier ${e.tier}?\n\nOnly the entry in the Rundown block is removed; its layouts and objectives stay (Ctrl+Z undoes).`,
      )
    )
      void rundownOp({
        kind: 'deleteExpedition',
        rundownBlockId: rd.blockId,
        tier: e.tier,
        index: e.index,
      });
  };

  return (
    <div>
      <Row
        depth={2}
        caret={open}
        className={`rtree-exp ${e.enabled ? '' : 'rtree-disabled'}`}
        onClick={() => toggle(key)}
        problems={e.problems}
        title={`${expeditionLabel(e)} · Tier${e.tier}[${e.index}]${e.enabled ? '' : ' · disabled'}`}
        actions={
          <>
            <label
              className="rtree-toggle"
              title={e.enabled ? 'Disable (hidden in game)' : 'Enable'}
              onClick={(ev) => ev.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={e.enabled}
                onChange={(ev) =>
                  void setField(rd.blockId, [...e.path, 'Enabled'], ev.target.checked)
                }
              />
            </label>
            <Act
              title="Open the expedition's fields in the Rundown form"
              onClick={() =>
                void (async () => {
                  await selectBlock(rd.blockId);
                  useStore.setState({ focusPointer: '/' + e.path.join('/'), blockMode: 'form' });
                })()
              }
            >
              form
            </Act>
            <Act
              title="Duplicate expedition"
              onClick={() =>
                void rundownOp({
                  kind: 'duplicateExpedition',
                  rundownBlockId: rd.blockId,
                  tier: e.tier,
                  index: e.index,
                })
              }
            >
              ⧉
            </Act>
            {moving ? (
              <select
                autoFocus
                className="small"
                defaultValue=""
                onClick={(ev) => ev.stopPropagation()}
                onBlur={() => setMoving(false)}
                onChange={(ev) => {
                  const to = ev.target.value as Tier;
                  setMoving(false);
                  if (to && to !== e.tier)
                    void rundownOp({
                      kind: 'moveExpedition',
                      rundownBlockId: rd.blockId,
                      from: e.tier,
                      index: e.index,
                      to,
                    });
                }}
              >
                <option value="">move to…</option>
                {TIERS.filter((t) => t !== e.tier).map((t) => (
                  <option key={t} value={t}>
                    Tier {t}
                  </option>
                ))}
              </select>
            ) : (
              <Act title="Move to another tier" onClick={() => setMoving(true)}>
                ⇄
              </Act>
            )}
            <Act title="Delete expedition" onClick={del} danger>
              ✕
            </Act>
          </>
        }
      >
        <span className="rid">{e.prefix || `#${e.index + 1}`}</span>{' '}
        {e.publicName || <em>(no name)</em>}
      </Row>
      {open && (
        <>
          {e.layers.map((l) => (
            <LayerRows key={l.layer} rd={rd} e={e} l={l} expanded={expanded} toggle={toggle} />
          ))}
          <DimensionRows rd={rd} e={e} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A reference shown as a row: resolved → name; missing → red; unset → "none" with pick/new. */
function LinkRow({
  depth,
  label,
  link,
  targetType,
  newName,
  caret,
  onToggle,
  extraActions,
  children,
}: {
  depth: number;
  label: string;
  link: LinkNode | null;
  targetType: string;
  newName: string;
  caret?: boolean;
  onToggle?: () => void;
  extraActions?: ReactNode;
  children?: ReactNode;
}) {
  const goToLink = useStore((s) => s.goToLink);
  const setField = useStore((s) => s.setField);
  const openDialog = useStore((s) => s.openDialog);
  const selectedBlockId = useStore((s) => s.selectedBlockId);
  const [picking, setPicking] = useState(false);
  if (!link) return null;
  const unset = link.resolution === 'none';
  const missing = link.resolution === 'missing';
  const text = unset ? (
    <em>none</em>
  ) : missing ? (
    <span className="sev-error">#{link.id} missing</span>
  ) : (
    <>
      {link.name || <em>(no name)</em>}
      <span className="muted"> #{link.id}</span>
      {link.resolution === 'vanilla' && <span className="tbadge">vanilla</span>}
    </>
  );
  return (
    <div className="rtree-linkwrap">
      <Row
        depth={depth}
        caret={caret}
        className={`rtree-link ${missing ? 'rtree-missing' : ''}`}
        selected={!!link.blockId && link.blockId === selectedBlockId}
        onClick={() => (onToggle && !unset && !missing ? onToggle() : void goToLink(link))}
        problems={link.problems}
        title={`${label}: ${targetType} #${link.id} · click to ${onToggle && link.blockId ? 'expand' : 'open'}`}
        actions={
          <>
            {link.blockId && (
              <Act title="Open in the form" onClick={() => void goToLink(link, 'form')}>
                form
              </Act>
            )}
            <Act title={`Pick an existing ${targetType}`} onClick={() => setPicking(true)}>
              pick
            </Act>
            <Act
              title={`Create a new ${targetType} and link it here`}
              onClick={() =>
                openDialog({
                  kind: 'newBlock',
                  type: targetType,
                  name: newName,
                  then: { blockId: link.refBlockId, path: link.refPath },
                })
              }
            >
              new
            </Act>
            {!unset && (
              <Act
                title="Unlink (set to 0)"
                onClick={() => void setField(link.refBlockId, link.refPath, 0)}
                danger
              >
                ✕
              </Act>
            )}
            {extraActions}
          </>
        }
      >
        <span className="muted">{label}</span> {text}
        {children}
      </Row>
      {picking && (
        <div className="rtree-picker" style={{ marginLeft: 8 + depth * 14 }}>
          <RefPicker
            refType={targetType}
            value={link.id}
            onPick={(id) => {
              setPicking(false);
              void setField(link.refBlockId, link.refPath, id);
            }}
            onClose={() => setPicking(false)}
          />
        </div>
      )}
    </div>
  );
}

function LayerRows({
  rd,
  e,
  l,
  expanded,
  toggle,
}: {
  rd: RundownNode;
  e: ExpeditionNode;
  l: LayerNode;
  expanded: Record<string, boolean>;
  toggle: (k: string, f?: boolean) => void;
}) {
  const setField = useStore((s) => s.setField);
  const rundownOp = useStore((s) => s.rundownOp);
  const goToZone = useStore((s) => s.goToZone);
  const goToLink = useStore((s) => s.goToLink);
  const name = l.layer === 'main' ? 'Main' : l.layer === 'secondary' ? 'Secondary' : 'Third';
  const enabledField =
    l.layer === 'secondary'
      ? 'SecondaryLayerEnabled'
      : l.layer === 'third'
        ? 'ThirdLayerEnabled'
        : null;
  const layoutField =
    l.layer === 'main'
      ? 'LevelLayoutData'
      : l.layer === 'secondary'
        ? 'SecondaryLayout'
        : 'ThirdLayout';
  const dataField =
    l.layer === 'main'
      ? 'MainLayerData'
      : l.layer === 'secondary'
        ? 'SecondaryLayerData'
        : 'ThirdLayerData';

  // A disabled optional layer with nothing linked is just a one-line offer to enable it.
  if (!l.enabled && (!l.layout || l.layout.resolution === 'none') && l.objectives.length === 0) {
    return (
      <Row
        depth={3}
        caret={null}
        className="rtree-disabled"
        actions={
          enabledField ? (
            <Act
              title={`Enable the ${name.toLowerCase()} layer`}
              onClick={() => void setField(rd.blockId, [...e.path, enabledField], true)}
            >
              enable
            </Act>
          ) : undefined
        }
      >
        <span className="muted">{name} layer</span> <em>off</em>
      </Row>
    );
  }

  const layout: LinkNode = l.layout ?? {
    targetType: 'LevelLayout',
    id: 0,
    resolution: 'none',
    refPath: [...e.path, layoutField],
    refBlockId: rd.blockId,
    problems: 0,
  };
  const zkey = layout.blockId ? `zones:${layout.blockId}` : '';
  const zonesOpen = !!zkey && !!expanded[zkey];
  const detail = layout.detail?.kind === 'layout' ? layout.detail : null;
  const mainObjective: LinkNode = l.objectives[0] ?? {
    targetType: 'WardenObjective',
    id: 0,
    resolution: 'none',
    refPath: [...e.path, dataField, 'ObjectiveData', 'DataBlockId'],
    refBlockId: rd.blockId,
    problems: 0,
  };

  return (
    <div className={l.enabled ? '' : 'rtree-disabled'}>
      <LinkRow
        depth={3}
        label={`${name} layout${l.enabled ? '' : ' (layer off)'}`}
        link={layout}
        targetType="LevelLayout"
        newName={`${e.prefix} ${name.toLowerCase()} layout`.trim()}
        caret={layout.blockId ? zonesOpen : undefined}
        onToggle={zkey ? () => toggle(zkey) : undefined}
        extraActions={
          <>
            {enabledField && (
              <Act
                title={l.enabled ? 'Disable this layer' : 'Enable this layer'}
                onClick={() => void setField(rd.blockId, [...e.path, enabledField], !l.enabled)}
              >
                {l.enabled ? 'off' : 'on'}
              </Act>
            )}
            {layout.blockId && (
              <>
                <Act title="Show the zone graph" onClick={() => void goToLink(layout, 'graph')}>
                  graph
                </Act>
                <Act
                  title="Add a zone"
                  onClick={() =>
                    void rundownOp({ kind: 'addZone', layoutBlockId: layout.blockId! })
                  }
                >
                  + zone
                </Act>
              </>
            )}
          </>
        }
      >
        {detail && (
          <span className="muted">
            {' '}
            · {detail.zones.length} zone{detail.zones.length === 1 ? '' : 's'}
          </span>
        )}
      </LinkRow>
      {zonesOpen && detail && layout.blockId && (
        <>
          {detail.zones.map((z) => (
            <ZoneRow
              key={z.index}
              z={z}
              layoutBlockId={layout.blockId!}
              onOpen={() => void goToZone(layout.blockId!, z.index)}
            />
          ))}
          {detail.zones.length === 0 && (
            <Row depth={4} caret={null}>
              <em>no zones yet</em>
            </Row>
          )}
        </>
      )}
      <LinkRow
        depth={3}
        label={`${name} objective`}
        link={mainObjective}
        targetType="WardenObjective"
        newName={`${e.prefix} ${name.toLowerCase()} objective`.trim()}
      >
        {mainObjective.detail?.kind === 'objective' && (
          <span className="muted"> · {mainObjective.detail.type}</span>
        )}
      </LinkRow>
      {l.objectives.slice(1).map((o, i) => (
        <LinkRow
          key={i}
          depth={3}
          label={`Chained objective ${i + 1}`}
          link={o}
          targetType="WardenObjective"
          newName={`${e.prefix} chained objective`.trim()}
        >
          {o.detail?.kind === 'objective' && <span className="muted"> · {o.detail.type}</span>}
        </LinkRow>
      ))}
      {mainObjective.detail?.kind === 'objective' && (
        <>
          {mainObjective.detail.alarms.map((a, i) => (
            <LinkRow
              key={`a${i}`}
              depth={4}
              label="Alarm"
              link={a}
              targetType="ChainedPuzzle"
              newName={`${e.prefix} objective alarm`.trim()}
            />
          ))}
          {mainObjective.detail.waves.map((w, i) => (
            <LinkRow
              key={`w${i}`}
              depth={4}
              label={`Wave on ${w.on}`}
              link={w.settings}
              targetType="SurvivalWaveSettings"
              newName={`${e.prefix} ${w.on} wave`.trim()}
            >
              {w.population && w.population.resolution !== 'none' && (
                <span className={w.population.resolution === 'missing' ? 'sev-error' : 'muted'}>
                  {' '}
                  · pop {w.population.name ?? `#${w.population.id}`}
                  {w.population.resolution === 'missing' ? ' missing' : ''}
                </span>
              )}
            </LinkRow>
          ))}
        </>
      )}
    </div>
  );
}

function ZoneRow({
  z,
  layoutBlockId,
  onOpen,
}: {
  z: ZoneNode;
  layoutBlockId: string;
  onOpen: () => void;
}) {
  const rundownOp = useStore((s) => s.rundownOp);
  const setField = useStore((s) => s.setField);
  const openDialog = useStore((s) => s.openDialog);
  const focus = useStore((s) => s.focusPointer);
  const block = useStore((s) => s.block);
  const [picking, setPicking] = useState(false);
  const selected = block?.blockId === layoutBlockId && focus === `/Zones/${z.index}`;
  const alarmPath = ['Zones', z.index, 'ChainedPuzzleToEnter'];
  const del = () => {
    if (
      confirm(
        `Delete zone ${z.alias} (LocalIndex ${z.localIndex})?\nZones that build from it will need a new BuildFromLocalIndex. Ctrl+Z undoes.`,
      )
    )
      void rundownOp({ kind: 'deleteZone', layoutBlockId, index: z.index });
  };
  return (
    <div className="rtree-linkwrap">
      <Row
        depth={4}
        caret={null}
        className="rtree-zone"
        selected={selected}
        onClick={onOpen}
        problems={z.problems}
        title={`Zone index ${z.index} · LocalIndex ${z.localIndex} · builds from ${z.buildFrom} · ${z.eventCount} event(s)`}
        actions={
          <>
            <Act
              title="Pick an alarm (ChainedPuzzle) for the door into this zone"
              onClick={() => setPicking(true)}
            >
              alarm
            </Act>
            <Act
              title="Duplicate zone"
              onClick={() =>
                void rundownOp({ kind: 'duplicateZone', layoutBlockId, index: z.index })
              }
            >
              ⧉
            </Act>
            <Act title="Delete zone" onClick={del} danger>
              ✕
            </Act>
          </>
        }
      >
        <span className="rid">Z{z.alias}</span>
        <span className="muted"> {z.subComplex}</span>
        {z.alarm && z.alarm.resolution !== 'none' && (
          <span className={z.alarm.resolution === 'missing' ? 'sev-error' : 'rtree-alarm'}>
            {' '}
            🔔{' '}
            {z.alarm.resolution === 'missing'
              ? `#${z.alarm.id} missing`
              : z.alarm.name || `#${z.alarm.id}`}
          </span>
        )}
        {z.enemyGroups > 0 && (
          <span className="muted">
            {' '}
            · {z.enemyGroups} enemy group{z.enemyGroups === 1 ? '' : 's'}
          </span>
        )}
      </Row>
      {picking && (
        <div className="rtree-picker" style={{ marginLeft: 8 + 4 * 14 }}>
          <RefPicker
            refType="ChainedPuzzle"
            value={z.alarm?.id ?? 0}
            onPick={(id) => {
              setPicking(false);
              void setField(layoutBlockId, alarmPath, id);
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
                name: `Zone ${z.alias} alarm`,
                then: { blockId: layoutBlockId, path: alarmPath },
              });
            }}
          >
            + new alarm instead
          </button>
        </div>
      )}
    </div>
  );
}

function DimensionRows({ rd, e }: { rd: RundownNode; e: ExpeditionNode }) {
  const applyOnBlock = useStore((s) => s.applyOnBlock);
  const goToLink = useStore((s) => s.goToLink);
  const dims: DimensionNode[] = e.dimensions;
  // Insert a default entry; the user then picks the Dimension block on the new row.
  const addDimension = () =>
    void applyOnBlock(rd.blockId, [
      {
        op: 'insert',
        path: [...e.path, 'DimensionDatas'],
        value: { DimensionIndex: dims.length + 1, DimensionData: 0, Enabled: true },
      },
    ]);
  return (
    <>
      {dims.map((d) => (
        <div key={d.index}>
          <LinkRow
            depth={3}
            label={`Dimension ${d.dimensionIndex}${d.enabled ? '' : ' (off)'}`}
            link={
              d.dimension ?? {
                targetType: 'Dimension',
                id: 0,
                resolution: 'none',
                refPath: [...e.path, 'DimensionDatas', d.index, 'DimensionData'],
                refBlockId: rd.blockId,
                problems: 0,
              }
            }
            targetType="Dimension"
            newName={`${e.prefix} dimension ${d.dimensionIndex}`.trim()}
            extraActions={
              <Act
                title="Remove this dimension entry"
                onClick={() =>
                  void applyOnBlock(rd.blockId, [
                    { op: 'remove', path: [...e.path, 'DimensionDatas', d.index] },
                  ])
                }
                danger
              >
                remove
              </Act>
            }
          >
            {d.layout && d.layout.resolution !== 'none' && (
              <button
                className="link rtree-inline"
                onClick={(ev) => {
                  ev.stopPropagation();
                  void goToLink(d.layout!);
                }}
                title="Open the dimension's layout"
              >
                layout: {d.layout.name || `#${d.layout.id}`}
                {d.layout.detail?.kind === 'layout'
                  ? ` (${d.layout.detail.zones.length} zones)`
                  : ''}
              </button>
            )}
          </LinkRow>
        </div>
      ))}
      <Row
        depth={3}
        caret={null}
        className="rtree-add"
        onClick={addDimension}
        title="Add a dimension entry to this expedition"
      >
        <span className="muted">+ dimension</span>
      </Row>
    </>
  );
}
