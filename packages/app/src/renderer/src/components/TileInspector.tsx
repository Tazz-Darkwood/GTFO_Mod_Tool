/**
 * Right-hand panel of Tiles mode. Selected cell: what the game generated there
 * and the LGTuner TileOverride for it, editable (add / change / remove). Below:
 * the LGTuner file's ZoneOverrides, editable too. All edits go through the
 * edit engine on the LGTuner file, so undo works and comments survive.
 * Credit: LGTuner by hirnukuono, based on Flowaria's LGTuner.
 */
import { useEffect, useState } from 'react';
import type { EditOp, LgTileOverride, LgZoneOverride } from '@shared/ipc';
import { LGTUNER_DIRECTIONS, LGTUNER_ROTATIONS } from '@shared/lgtunerEnums';
import { CommitInput } from '../editor/fields';
import { PrefabPicker } from '../editor/PrefabPicker';
import { useStore } from '../store';
import { cellKey } from './TileGrid';

/** A fresh TileOverride entry, shaped like LGTuner's own example files. */
export function newTileOverride(x: number, z: number): Record<string, unknown> {
  return {
    X: x,
    Z: z,
    Rotation: 'None',
    Geomorph: '',
    OverrideAltitude: false,
    Altitude: 0,
    ForwardPlug: '',
    BackwardPlug: '',
    LeftPlug: '',
    RightPlug: '',
    OverridePlugWithNoGateChance: false,
    PlugWithNoGateChance: 1.0,
  };
}

export function newZoneOverride(localIndex: number): Record<string, unknown> {
  return {
    LocalIndex: localIndex,
    OverrideGeomorphs: false,
    Geomorphs: [],
    OverrideAltitudes: false,
    Altitudes: [],
    OverridePlugs: false,
    Plugs: [],
  };
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="ti-row" title={hint}>
      <div className="ti-label">{label}</div>
      <div className="ti-value">{children}</div>
    </div>
  );
}

export function TileInspector() {
  const block = useStore((s) => s.block);
  const detail = useStore((s) => s.layoutDetail);
  const generated = useStore((s) => s.layoutGenerated);
  const lgtuner = useStore((s) => s.lgtuner);
  const prefabs = useStore((s) => s.lgtunerPrefabs);
  const loadPrefabs = useStore((s) => s.loadLgTunerPrefabs);
  const selected = useStore((s) => s.selectedTile);
  const openFile = useStore((s) => s.openFile);
  const selectZone = useStore((s) => s.selectZone);
  const setBlockMode = useStore((s) => s.setBlockMode);
  const applyFileOp = useStore((s) => s.applyFileOp);
  const createLgTuner = useStore((s) => s.createLgTuner);
  const [addingZone, setAddingZone] = useState(false);

  useEffect(() => {
    if (block?.type === 'LevelLayout' && !prefabs) void loadPrefabs();
  }, [block?.blockId, block?.type, prefabs, loadPrefabs]);

  if (!block || !detail) return null;
  const gen = selected
    ? generated?.tiles.find((t) => cellKey(t.x, t.z) === cellKey(selected.x, selected.z))
    : undefined;
  const ov = selected
    ? lgtuner?.tileOverrides.find((t) => cellKey(t.x, t.z) === cellKey(selected.x, selected.z))
    : undefined;
  const zone = gen ? detail.zones.find((z) => z.localIndex === gen.localIndex) : undefined;
  const geomorphs = prefabs?.geomorphs ?? [];
  const plugs = prefabs?.plugs ?? [];

  const edit = (op: EditOp) => {
    if (lgtuner) void applyFileOp(lgtuner.fileId, op);
  };
  const setOv = (o: LgTileOverride, key: string, value: unknown) =>
    edit({ op: 'set', path: [...o.path, key], value });
  const setZo = (z: LgZoneOverride, key: string, value: unknown) =>
    edit({ op: 'set', path: [...z.path, key], value });
  const numList = (text: string): number[] =>
    text
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));

  const zonesWithout = detail.zones.filter(
    (z) => !lgtuner?.zoneOverrides.some((o) => o.localIndex === z.localIndex),
  );

  return (
    <div className="zoneinspector tileinspector">
      <div className="zi-head">
        <strong>{selected ? `Tile (${selected.x}, ${selected.z})` : block.name || 'Layout'}</strong>
        {selected && selected.x === 0 && selected.z === 0 && (
          <span className="muted"> · starting tile</span>
        )}
      </div>

      {!lgtuner && (
        <div className="ti-section">
          <div className="muted">No LGTuner file targets this layout yet.</div>
          <button className="small" onClick={() => void createLgTuner()} title="Create Custom/LGTuner/<layout>.json">
            + LGTuner file for this layout
          </button>
        </div>
      )}

      {!selected && (
        <p className="muted zi-hint">
          Click a cell to see what the game generated there and to add or edit its LGTuner override.
          {lgtuner ? ` Config: ${lgtuner.fileId}.` : ''}
        </p>
      )}

      {selected && (
        <>
          <div className="ti-section">
            <div className="ti-title">Generated (last load)</div>
            {gen ? (
              <>
                <div>
                  {zone ? (
                    <button className="linkish" onClick={() => selectZone(zone.index)} title="Select this zone (Graph/Form)">
                      Z{zone.alias}
                    </button>
                  ) : (
                    `LocalIndex ${gen.localIndex}`
                  )}
                  <span className="muted"> · {gen.dimension}</span>
                  {gen.ambiguous && <span className="sev-warning"> · layer uncertain</span>}
                </div>
                <div className="mono ti-prefab">{gen.prefab}</div>
              </>
            ) : (
              <div className="muted">nothing placed here in the last load</div>
            )}
          </div>

          <div className="ti-section">
            <div className="ti-title">
              LGTuner override
              {ov && (
                <button
                  className="small danger-soft ti-right"
                  onClick={() => edit({ op: 'remove', path: ov.path })}
                  title="Remove this tile override"
                >
                  ✕ remove
                </button>
              )}
            </div>
            {!lgtuner ? (
              <div className="muted">create the LGTuner file first</div>
            ) : !ov ? (
              <button
                className="small"
                onClick={() =>
                  edit({ op: 'insert', path: ['TileOverrides'], value: newTileOverride(selected.x, selected.z) })
                }
              >
                + override this tile
              </button>
            ) : (
              <div className="ti-form">
                <Row label="Geomorph" hint="Prefab to build here instead of the generated one; empty keeps it">
                  <PrefabPicker
                    value={ov.geomorph}
                    options={geomorphs}
                    onCommit={(v) => setOv(ov, 'Geomorph', v)}
                  />
                </Row>
                <Row label="Rotation" hint="How the tile is turned; Towards_* points its entrance that way">
                  <select value={ov.rotation} onChange={(e) => setOv(ov, 'Rotation', e.target.value)}>
                    {(LGTUNER_ROTATIONS.includes(ov.rotation) ? LGTUNER_ROTATIONS : [ov.rotation, ...LGTUNER_ROTATIONS]).map(
                      (r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ),
                    )}
                  </select>
                </Row>
                <Row label="Altitude" hint="-1 low, 0 mid, 1 high (times the complex's altitude step)">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={ov.overrideAltitude}
                      onChange={(e) => setOv(ov, 'OverrideAltitude', e.target.checked)}
                    />
                    <span>override</span>
                  </label>
                  <CommitInput
                    kind="number"
                    value={String(ov.altitude)}
                    onCommit={(t) => Number.isFinite(Number(t)) && setOv(ov, 'Altitude', Number(t))}
                  />
                </Row>
                {(
                  [
                    ['ForwardPlug', 'forward', 'Forward plug (south side)'],
                    ['BackwardPlug', 'backward', 'Backward plug (north side)'],
                    ['LeftPlug', 'left', 'Left plug (west side)'],
                    ['RightPlug', 'right', 'Right plug (east side)'],
                  ] as const
                ).map(([key, side, label]) => (
                  <Row key={key} label={label}>
                    <PrefabPicker
                      value={ov.plugs[side]}
                      options={plugs}
                      onCommit={(v) => setOv(ov, key, v)}
                      placeholder="plug prefab (empty = unchanged)"
                    />
                  </Row>
                ))}
                <Row label="No-gate chance" hint="Chance that a plug out of this tile has no gate">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={ov.overridePlugWithNoGateChance}
                      onChange={(e) => setOv(ov, 'OverridePlugWithNoGateChance', e.target.checked)}
                    />
                    <span>override</span>
                  </label>
                  <CommitInput
                    kind="number"
                    value={String(ov.plugWithNoGateChance)}
                    onCommit={(t) =>
                      Number.isFinite(Number(t)) && setOv(ov, 'PlugWithNoGateChance', Number(t))
                    }
                  />
                </Row>
                <div className="muted ti-small">
                  entry #{ov.index + 1} in{' '}
                  <button className="linkish" onClick={() => void openFile(lgtuner.fileId)}>
                    {lgtuner.fileId.slice(lgtuner.fileId.lastIndexOf('/') + 1)}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {lgtuner && (
        <div className="ti-section">
          <div className="ti-title">
            Zone overrides ({lgtuner.zoneOverrides.length})
            {zonesWithout.length > 0 && (
              <button className="small ti-right" onClick={() => setAddingZone((v) => !v)}>
                + zone
              </button>
            )}
          </div>
          {addingZone && (
            <div className="zg-dirmenu">
              <span className="muted">override zone…</span>
              {zonesWithout.map((z) => (
                <button
                  key={z.index}
                  onClick={() => {
                    setAddingZone(false);
                    edit({ op: 'insert', path: ['ZoneOverrides'], value: newZoneOverride(z.localIndex) });
                  }}
                >
                  Z{z.alias}
                </button>
              ))}
            </div>
          )}
          {lgtuner.zoneOverrides.map((z) => {
            const zn = detail.zones.find((q) => q.localIndex === z.localIndex);
            return (
              <div key={z.index} className="ti-zone">
                <div className="ti-zonehead">
                  <strong>{zn ? `Z${zn.alias}` : `LocalIndex ${z.localIndex}`}</strong>
                  {!zn && <span className="sev-warning"> not in this layout</span>}
                  <button
                    className="small danger-soft ti-right"
                    onClick={() => edit({ op: 'remove', path: z.path })}
                    title="Remove this zone override"
                  >
                    ✕
                  </button>
                </div>
                <Row label="Geomorphs" hint="Cycled over the zone's tiles in order">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={z.overrideGeomorphs}
                      onChange={(e) => setZo(z, 'OverrideGeomorphs', e.target.checked)}
                    />
                    <span>override</span>
                  </label>
                </Row>
                {z.geomorphs.map((g, i) => (
                  <div key={i} className="ti-geo">
                    <PrefabPicker
                      value={g.geomorph}
                      options={geomorphs}
                      onCommit={(v) => edit({ op: 'set', path: [...z.path, 'Geomorphs', i, 'Geomorph'], value: v })}
                    />
                    <select
                      value={g.direction}
                      onChange={(e) =>
                        edit({ op: 'set', path: [...z.path, 'Geomorphs', i, 'Direction'], value: e.target.value })
                      }
                      title="Which way the geomorph's entrance points"
                    >
                      {(LGTUNER_DIRECTIONS.includes(g.direction) ? LGTUNER_DIRECTIONS : [g.direction, ...LGTUNER_DIRECTIONS]).map(
                        (d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      className="small ghost"
                      onClick={() => edit({ op: 'remove', path: [...z.path, 'Geomorphs', i] })}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="small ghost"
                  onClick={() =>
                    edit({ op: 'insert', path: [...z.path, 'Geomorphs'], value: { Geomorph: '', Direction: 'Unchanged' } })
                  }
                >
                  + geomorph
                </button>
                <Row label="Altitudes" hint="Cycled per tile: -1 low, 0 mid, 1 high; e.g. 0, 1, -1">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={z.overrideAltitudes}
                      onChange={(e) => setZo(z, 'OverrideAltitudes', e.target.checked)}
                    />
                    <span>override</span>
                  </label>
                  <CommitInput
                    kind="text"
                    value={z.altitudes.join(', ')}
                    onCommit={(t) => setZo(z, 'Altitudes', numList(t))}
                    placeholder="0, 1, -1"
                  />
                </Row>
                <Row label="Plugs" hint="Cycled per plug; one prefab path per line">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={z.overridePlugs}
                      onChange={(e) => setZo(z, 'OverridePlugs', e.target.checked)}
                    />
                    <span>override</span>
                  </label>
                </Row>
                {z.plugs.map((pl, i) => (
                  <div key={i} className="ti-geo">
                    <PrefabPicker
                      value={pl}
                      options={plugs}
                      onCommit={(v) => edit({ op: 'set', path: [...z.path, 'Plugs', i], value: v })}
                      placeholder="plug prefab"
                    />
                    <button
                      className="small ghost"
                      onClick={() => edit({ op: 'remove', path: [...z.path, 'Plugs', i] })}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="small ghost"
                  onClick={() => edit({ op: 'insert', path: [...z.path, 'Plugs'], value: '' })}
                >
                  + plug
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="ti-foot muted">
        <button className="linkish" onClick={() => void setBlockMode('graph')}>
          Graph
        </button>{' '}
        shows how the zones build from each other.
      </div>
    </div>
  );
}
