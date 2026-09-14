/**
 * Tiles mode for a LevelLayout: the level as a top-down tile grid. X grows east
 * (right), Z grows north (up), (0,0) is the starting tile. Ground layer: the
 * tiles the game generated in the last level load, read from LGTuner's lines in
 * BepInEx/LogOutput.log. Override layer: this layout's LGTuner TileOverrides.
 * Credit: LGTuner by hirnukuono, based on Flowaria's LGTuner.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import type { LayoutTile, LgTileOverride, ZoneNode } from '@shared/ipc';
import { LGTUNER_CREDIT_LINE } from '@shared/credits';
import { useStore } from '../store';
import { TileInspector } from './TileInspector';

export const TILE_PX = 104;
const MIN_K = 0.25;
const MAX_K = 3;

interface Cam {
  x: number;
  y: number;
  k: number;
}

export interface CellKey {
  x: number;
  z: number;
}
export const cellKey = (x: number, z: number) => `${x},${z}`;

/** Screen-space (before camera) origin of a cell: east right, north up. */
export const cellOrigin = (x: number, z: number) => ({ sx: x * TILE_PX, sy: -z * TILE_PX });

const ZONE_COLOURS = [
  '#2f5d8a',
  '#6b4c8a',
  '#3f7a5a',
  '#8a5a2f',
  '#8a2f4c',
  '#2f8a80',
  '#7a7a2f',
  '#4c6b8a',
  '#8a6b4c',
  '#5a3f7a',
];
export function zoneColour(localIndex: number): string {
  return ZONE_COLOURS[Math.abs(localIndex) % ZONE_COLOURS.length]!;
}

/** "geo_64x64_service_floodways_I_HA_02" → "floodways I HA 02". */
export function shortPrefab(name: string): string {
  let s = name.replace(/\.prefab$/i, '');
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/^geo_(\d+x\d+_)?/i, '').replace(/^(mining|tech|service)_/i, '');
  return s.replace(/_/g, ' ');
}

export function rotationGlyph(rotation: string): string {
  switch (rotation) {
    case 'Towards_Forward':
      return '↑';
    case 'Towards_Backward':
      return '↓';
    case 'Towards_Left':
      return '←';
    case 'Towards_Right':
      return '→';
    case 'Towards_Random':
      return '?';
    case 'Flip':
      return '⇅';
    case 'MoveTo_Left':
      return '↶';
    case 'MoveTo_Right':
      return '↷';
    default:
      return '';
  }
}

function tileTitle(
  x: number,
  z: number,
  gen: LayoutTile | undefined,
  ov: LgTileOverride | undefined,
  zone: ZoneNode | undefined,
): string {
  const lines = [`Tile (${x}, ${z})${x === 0 && z === 0 ? ' — starting tile' : ''}`];
  if (gen) {
    lines.push(
      `generated: ${gen.prefab}`,
      zone ? `zone Z${zone.alias} (LocalIndex ${gen.localIndex})` : `LocalIndex ${gen.localIndex}`,
    );
    if (gen.ambiguous)
      lines.push('LocalIndex shared with another layer: zone assignment uncertain');
  }
  if (ov) {
    lines.push(`LGTuner override #${ov.index + 1}:`);
    if (ov.geomorph) lines.push(`  geomorph ${ov.geomorph}`);
    if (ov.rotation && ov.rotation !== 'None') lines.push(`  rotation ${ov.rotation}`);
    if (ov.overrideAltitude) lines.push(`  altitude ${ov.altitude}`);
    for (const [side, p] of Object.entries(ov.plugs)) if (p) lines.push(`  ${side} plug ${p}`);
    if (ov.overridePlugWithNoGateChance) lines.push(`  no-gate chance ${ov.plugWithNoGateChance}`);
  }
  return lines.join('\n');
}

export function TileGrid() {
  const block = useStore((s) => s.block);
  const detail = useStore((s) => s.layoutDetail);
  const generated = useStore((s) => s.layoutGenerated);
  const lgtuner = useStore((s) => s.lgtuner);
  const selected = useStore((s) => s.selectedTile);
  const selectTile = useStore((s) => s.selectTile);
  const reload = useStore((s) => s.loadLayoutDetail);

  const host = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );

  const zonesByLocal = useMemo(() => {
    const m = new Map<number, ZoneNode>();
    for (const z of detail?.zones ?? []) if (!m.has(z.localIndex)) m.set(z.localIndex, z);
    return m;
  }, [detail]);
  const genByCell = useMemo(() => {
    const m = new Map<string, LayoutTile>();
    for (const t of generated?.tiles ?? []) m.set(cellKey(t.x, t.z), t);
    return m;
  }, [generated]);
  const ovByCell = useMemo(() => {
    const m = new Map<string, LgTileOverride>();
    for (const t of lgtuner?.tileOverrides ?? [])
      if (!m.has(cellKey(t.x, t.z))) m.set(cellKey(t.x, t.z), t);
    return m;
  }, [lgtuner]);

  // Bounds: every known cell plus one ring, at least 3 cells around the start.
  const bounds = useMemo(() => {
    let minX = -3;
    let maxX = 3;
    let minZ = -3;
    let maxZ = 3;
    const grow = (x: number, z: number) => {
      minX = Math.min(minX, x - 1);
      maxX = Math.max(maxX, x + 1);
      minZ = Math.min(minZ, z - 1);
      maxZ = Math.max(maxZ, z + 1);
    };
    for (const t of generated?.tiles ?? []) grow(t.x, t.z);
    for (const t of lgtuner?.tileOverrides ?? []) grow(t.x, t.z);
    return { minX, maxX, minZ, maxZ };
  }, [generated, lgtuner]);

  const world = {
    left: bounds.minX * TILE_PX,
    top: -(bounds.maxZ + 1) * TILE_PX,
    width: (bounds.maxX - bounds.minX + 1) * TILE_PX,
    height: (bounds.maxZ - bounds.minZ + 1) * TILE_PX,
  };

  const fit = () => {
    const el = host.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const k = Math.min(
      1.2,
      Math.max(MIN_K, Math.min(cw / (world.width + 40), ch / (world.height + 40))),
    );
    setCam({
      x: (cw - world.width * k) / 2 - world.left * k,
      y: (ch - world.height * k) / 2 - world.top * k,
      k,
    });
  };
  const blockId = block?.blockId;
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, generated?.source.file]);

  if (!block || !detail) return <div className="main-empty muted">No layout data.</div>;

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const rect = host.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCam((c) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * f));
      const r = k / c.k;
      return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
    });
  };
  const onDown = (e: MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    pan.current = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  };
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (p.moved) setCam((c) => ({ ...c, x: p.cx + dx, y: p.cy + dy }));
  };
  const onUp = () => {
    pan.current = null;
  };
  const clickCell = (x: number, z: number) => {
    if (pan.current?.moved) return;
    selectTile(selected && selected.x === x && selected.z === z ? null : { x, z });
  };
  const zoomBy = (f: number) =>
    setCam((c) => {
      const el = host.current!;
      const cw = el.clientWidth / 2;
      const ch = el.clientHeight / 2;
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * f));
      const r = k / c.k;
      return { k, x: cw - (cw - c.x) * r, y: ch - (ch - c.y) * r };
    });

  const cells: CellKey[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x++)
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) cells.push({ x, z });

  const src = generated?.source;
  const when = src ? new Date(src.mtimeMs).toLocaleString() : '';

  return (
    <div className="tilegrid-split">
      <div className="tilegrid" ref={host}>
        <svg
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        >
          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
            <g className="tg-cells">
              {cells.map(({ x, z }) => {
                const { sx, sy } = cellOrigin(x, z);
                const gen = genByCell.get(cellKey(x, z));
                const ov = ovByCell.get(cellKey(x, z));
                const zone = gen ? zonesByLocal.get(gen.localIndex) : undefined;
                const isStart = x === 0 && z === 0;
                const isSel = !!selected && selected.x === x && selected.z === z;
                const cls = [
                  'tg-cell',
                  gen ? 'gen' : '',
                  ov ? 'ov' : '',
                  isStart ? 'start' : '',
                  isSel ? 'selected' : '',
                  gen?.ambiguous ? 'ambiguous' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <g
                    key={cellKey(x, z)}
                    className={cls}
                    transform={`translate(${sx} ${sy - TILE_PX})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      clickCell(x, z);
                    }}
                  >
                    <rect
                      className="tg-ground"
                      width={TILE_PX}
                      height={TILE_PX}
                      style={gen ? { fill: zoneColour(gen.localIndex) } : undefined}
                    />
                    {gen && (
                      <>
                        <text x={6} y={16} className="tg-zone">
                          {zone ? `Z${zone.alias}` : `LI ${gen.localIndex}`}
                        </text>
                        <text x={6} y={TILE_PX - 8} className="tg-prefab">
                          {shortPrefab(gen.prefab).slice(0, 22)}
                        </text>
                      </>
                    )}
                    {isStart && (
                      <text x={TILE_PX - 6} y={16} textAnchor="end" className="tg-start">
                        start
                      </text>
                    )}
                    {ov && (
                      <>
                        <rect
                          className="tg-override"
                          x={3}
                          y={3}
                          width={TILE_PX - 6}
                          height={TILE_PX - 6}
                          rx={6}
                        />
                        {ov.rotation !== 'None' && (
                          <text
                            x={TILE_PX / 2}
                            y={TILE_PX / 2 + 10}
                            textAnchor="middle"
                            className="tg-rot"
                          >
                            {rotationGlyph(ov.rotation)}
                          </text>
                        )}
                        {ov.geomorph && (
                          <text x={6} y={gen ? 32 : 16} className="tg-ovgeo">
                            ▣ {shortPrefab(ov.geomorph).slice(0, 20)}
                          </text>
                        )}
                        {ov.overrideAltitude && (
                          <text x={TILE_PX - 6} y={TILE_PX - 8} textAnchor="end" className="tg-alt">
                            {ov.altitude > 0
                              ? `▲${ov.altitude}`
                              : ov.altitude < 0
                                ? `▼${-ov.altitude}`
                                : '±0'}
                          </text>
                        )}
                        {ov.plugs.forward && (
                          <rect
                            className="tg-plug"
                            x={TILE_PX / 2 - 10}
                            y={TILE_PX - 5}
                            width={20}
                            height={4}
                          />
                        )}
                        {ov.plugs.backward && (
                          <rect
                            className="tg-plug"
                            x={TILE_PX / 2 - 10}
                            y={1}
                            width={20}
                            height={4}
                          />
                        )}
                        {ov.plugs.left && (
                          <rect
                            className="tg-plug"
                            x={1}
                            y={TILE_PX / 2 - 10}
                            width={4}
                            height={20}
                          />
                        )}
                        {ov.plugs.right && (
                          <rect
                            className="tg-plug"
                            x={TILE_PX - 5}
                            y={TILE_PX / 2 - 10}
                            width={4}
                            height={20}
                          />
                        )}
                      </>
                    )}
                    <title>{tileTitle(x, z, gen, ov, zone)}</title>
                  </g>
                );
              })}
            </g>
            {/* axes labels along the bottom and left edges */}
            <g className="tg-axes">
              {Array.from({ length: bounds.maxX - bounds.minX + 1 }, (_, i) => bounds.minX + i).map(
                (x) => (
                  <text
                    key={`x${x}`}
                    x={x * TILE_PX + TILE_PX / 2}
                    y={-bounds.minZ * TILE_PX + 16}
                    textAnchor="middle"
                  >
                    {x}
                  </text>
                ),
              )}
              {Array.from({ length: bounds.maxZ - bounds.minZ + 1 }, (_, i) => bounds.minZ + i).map(
                (z) => (
                  <text
                    key={`z${z}`}
                    x={bounds.minX * TILE_PX - 8}
                    y={-z * TILE_PX - TILE_PX / 2 + 4}
                    textAnchor="end"
                  >
                    {z}
                  </text>
                ),
              )}
            </g>
          </g>
        </svg>
        <div className="zg-toolbar">
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
            −
          </button>
          <button onClick={fit} title="Fit everything">
            fit
          </button>
          <button onClick={() => zoomBy(1.25)} title="Zoom in">
            +
          </button>
          <button onClick={() => void reload()} title="Read BepInEx/LogOutput.log again">
            ⟳ log
          </button>
          <span className="muted">
            {generated
              ? `${generated.tiles.length} generated tile${generated.tiles.length === 1 ? '' : 's'}`
              : 'no generated tiles'}
            {lgtuner
              ? ` · ${lgtuner.tileOverrides.length} override${lgtuner.tileOverrides.length === 1 ? '' : 's'}`
              : ' · no LGTuner file'}
          </span>
        </div>
        <div className="zg-note muted">
          {src ? (
            <>
              Ground: the level as the game generated it, from{' '}
              {src.file.slice(src.file.lastIndexOf('\\') + 1)} ({when}, load {src.loadIndex + 1} of{' '}
              {src.loadCount}
              {src.expedition
                ? `, matched ${src.expedition.prefix} ${src.expedition.publicName}`
                : ''}
              {src.hint ? `, log says "${src.hint}"` : ''}). East is right, north is up, (0,0) is
              the start.{' '}
            </>
          ) : (
            <>
              No generated tiles for this layout in BepInEx/LogOutput.log. Load the level once with
              LGTuner installed, then press ⟳ log. East is right, north is up, (0,0) is the
              start.{' '}
            </>
          )}
          {LGTUNER_CREDIT_LINE}
        </div>
      </div>
      <TileInspector />
    </div>
  );
}
