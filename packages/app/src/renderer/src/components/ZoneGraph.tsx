/**
 * Graph mode for a LevelLayout block: zones as boxes hanging off the zone they
 * build from, in their StartExpansion direction. SVG, pan by dragging the
 * background, zoom with the wheel. Click a zone to select it (the inspector on
 * the right edits it; the Form tab lands on the same zone). Drag a zone onto
 * another to change BuildFromLocalIndex; drop it on empty space to change the
 * direction it expands from its parent. Schematic only: the game's generator
 * places the real tiles.
 */
import { useEffect, useMemo, useRef, useState, type WheelEvent, type MouseEvent } from 'react';
import type { ZoneNode } from '@shared/ipc';
import { useStore } from '../store';
import {
  zoneGraphLayout,
  type GraphEdge,
  type GraphNode,
  type ZoneGraph as Graph,
} from '../graph/zoneLayout';
import { DIR_ENUM, descendantsOf, dominantDir, localIndexEditValue } from '../graph/zoneEdits';
import { ZoneInspector } from './ZoneInspector';

interface Cam {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.2;
const MAX_K = 2.5;

function fitCam(g: Graph, cw: number, ch: number): Cam {
  if (cw <= 0 || ch <= 0) return { x: 0, y: 0, k: 1 };
  const k = Math.min(1, Math.max(MIN_K, Math.min(cw / g.width, ch / g.height)));
  return { x: (cw - g.width * k) / 2, y: (ch - g.height * k) / 2, k };
}

/** Point on the border of `r` along the ray from its centre towards (tx, ty). */
function clipToRect(r: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

const DIR_WORD: Record<GraphEdge['dir'], string> = {
  F: 'forward',
  B: 'backward',
  L: 'left',
  R: 'right',
  '?': 'random',
};
function zoneTitle(z: ZoneNode): string {
  const lines = [
    `Zone ${z.alias} (LocalIndex ${z.localIndex}, #${z.index} in the list)`,
    `builds from LocalIndex ${z.buildFrom} · ${z.startPosition || '—'} · ${z.startExpansion || '—'}`,
    `${z.subComplex || 'no subcomplex'} · expansion ${z.zoneExpansion || '—'} · coverage ${z.coverage.min}–${z.coverage.max}`,
  ];
  if (z.alarm) {
    lines.push(
      z.alarm.resolution === 'missing'
        ? `alarm #${z.alarm.id} MISSING`
        : z.alarm.resolution === 'none'
          ? 'no alarm'
          : `alarm ${z.alarm.name ?? ''} #${z.alarm.id}`,
    );
  }
  lines.push(`${z.enemyGroups} enemy group(s) · ${z.eventCount} event(s)`);
  if (z.geomorph) lines.push('custom geomorph');
  if (z.altitude) lines.push(`altitude ${z.altitude}`);
  if (z.problems) lines.push(`${z.problems} problem(s)`);
  lines.push('Click to edit · drag onto another zone to build from it');
  return lines.join('\n');
}

interface NodeDrag {
  index: number;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  moved: boolean;
  over: number | null;
}

export function ZoneGraph() {
  const block = useStore((s) => s.block);
  const detail = useStore((s) => s.layoutDetail);
  const focus = useStore((s) => s.focusPointer);
  const selectZone = useStore((s) => s.selectZone);
  const applyMany = useStore((s) => s.applyMany);
  const showToast = useStore((s) => s.showToast);

  const graph = useMemo(() => (detail ? zoneGraphLayout(detail.zones) : null), [detail]);
  const host = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
  const [nodeDrag, setNodeDrag] = useState<NodeDrag | null>(null);
  const dragRef = useRef<NodeDrag | null>(null);
  const setDrag = (d: NodeDrag | null) => {
    dragRef.current = d;
    setNodeDrag(d);
  };

  const fit = () => {
    if (!graph || !host.current) return;
    setCam(fitCam(graph, host.current.clientWidth, host.current.clientHeight));
  };
  // Fit once per layout block (not on every edit, which would yank the view around).
  const blockId = block?.blockId;
  const sizeKey = graph ? `${graph.width}x${graph.height}` : '';
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);
  useEffect(() => {
    // The canvas grew or shrank (zone added/removed): keep the view but make sure it is visible.
    if (!graph || !host.current) return;
    setCam((c) => {
      const cw = host.current!.clientWidth;
      const ch = host.current!.clientHeight;
      const visible =
        c.x < cw && c.y < ch && c.x + graph.width * c.k > 0 && c.y + graph.height * c.k > 0;
      return visible ? c : fitCam(graph, cw, ch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKey]);

  if (!block || !detail || !graph) {
    return <div className="main-empty muted">No zone data for this block.</div>;
  }

  const selectedIndex = focus?.startsWith('/Zones/') ? Number(focus.split('/')[2] ?? NaN) : NaN;
  const byIndex = new Map(graph.nodes.map((n) => [n.index, n]));
  const zones = detail.zones;

  /** Mouse position in graph space. */
  const toGraph = (clientX: number, clientY: number) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - cam.x) / cam.k, y: (clientY - rect.top - cam.y) / cam.k };
  };
  const nodeAtPoint = (x: number, y: number, except: number): GraphNode | undefined =>
    graph.nodes.find(
      (n) => n.index !== except && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h,
    );

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (!host.current) return;
    const rect = host.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCam((c) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * factor));
      const r = k / c.k;
      return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
    });
  };
  const onBackgroundDown = (e: MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    pan.current = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  };
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d) {
      const dx = (e.clientX - d.sx) / cam.k;
      const dy = (e.clientY - d.sy) / cam.k;
      const moved = d.moved || Math.abs(dx) + Math.abs(dy) > 4;
      const p = toGraph(e.clientX, e.clientY);
      const over = moved ? (nodeAtPoint(p.x, p.y, d.index)?.index ?? null) : null;
      setDrag({ ...d, dx, dy, moved, over });
      return;
    }
    const pn = pan.current;
    if (!pn) return;
    const dx = e.clientX - pn.sx;
    const dy = e.clientY - pn.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) pn.moved = true;
    if (pn.moved) setCam((c) => ({ ...c, x: pn.cx + dx, y: pn.cy + dy }));
  };
  const finishDrag = (e: MouseEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    pan.current = null;
    if (!d) return;
    setDrag(null);
    if (!d.moved) return;
    const zone = zones[d.index];
    if (!zone) return;
    const p = toGraph(e.clientX, e.clientY);
    const target = nodeAtPoint(p.x, p.y, d.index);
    if (target) {
      const tz = zones[target.index]!;
      if (descendantsOf(zones, d.index).has(target.index)) {
        showToast('error', `Z${tz.alias} builds from Z${zone.alias}; that would make a loop.`);
        return;
      }
      if (tz.localIndex === zone.buildFrom) return; // already its parent
      void applyMany([
        {
          op: 'set',
          path: ['Zones', d.index, 'BuildFromLocalIndex'],
          value: localIndexEditValue(tz.localIndex),
        },
      ]);
      return;
    }
    // Empty space: set the expansion direction relative to the current parent.
    const parent = zones.find((z) => z.localIndex === zone.buildFrom && z.index !== zone.index);
    const pn = parent ? byIndex.get(parent.index) : undefined;
    if (!pn) return;
    const dir = dominantDir(p.x - (pn.x + pn.w / 2), p.y - (pn.y + pn.h / 2));
    if (DIR_ENUM[dir] === zone.startExpansion) return;
    void applyMany([
      { op: 'set', path: ['Zones', d.index, 'StartExpansion'], value: { $enum: DIR_ENUM[dir] } },
    ]);
  };
  const cancelDrag = () => {
    pan.current = null;
    if (dragRef.current) setDrag(null);
  };
  const zoomBy = (f: number) =>
    setCam((c) => {
      if (!host.current) return c;
      const cw = host.current.clientWidth / 2;
      const ch = host.current.clientHeight / 2;
      const k = Math.min(MAX_K, Math.max(MIN_K, c.k * f));
      const r = k / c.k;
      return { k, x: cw - (cw - c.x) * r, y: ch - (ch - c.y) * r };
    });

  const nodeRect = (n: GraphNode) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
  const dragging = nodeDrag?.moved ? nodeDrag : null;

  return (
    <div className="zonegraph-split">
      <div className="zonegraph" ref={host}>
        <svg
          onWheel={onWheel}
          onMouseDown={onBackgroundDown}
          onMouseMove={onMove}
          onMouseUp={finishDrag}
          onMouseLeave={cancelDrag}
          className={pan.current?.moved ? 'dragging' : dragging ? 'node-dragging' : ''}
        >
          <defs>
            <marker
              id="zg-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-muted)" />
            </marker>
            <marker
              id="zg-arrow-bad"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--error)" />
            </marker>
          </defs>
          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
            <g className="zg-edges">
              {graph.edges.map((e, i) => {
                const to = byIndex.get(e.to);
                const from =
                  e.from >= 0
                    ? byIndex.get(e.from)
                    : graph.ghosts.find((g) => g.localIndex === e.ghost);
                if (!to || !from) return null;
                const a = clipToRect(from, to.x + to.w / 2, to.y + to.h / 2);
                const b = clipToRect(nodeRect(to), from.x + from.w / 2, from.y + from.h / 2);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const bad = e.cycle || e.from < 0;
                const dim = dragging && (dragging.index === e.to || dragging.index === e.from);
                return (
                  <g key={i} className={`zg-edge ${bad ? 'bad' : ''} ${dim ? 'dim' : ''}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      markerEnd={`url(#${bad ? 'zg-arrow-bad' : 'zg-arrow'})`}
                    />
                    <circle cx={mx} cy={my} r={9} />
                    <text x={mx} y={my + 3.5} textAnchor="middle">
                      {e.dir}
                    </text>
                    <title>
                      {e.cycle
                        ? 'Build chain loops here (zone builds from a descendant)'
                        : `expands ${DIR_WORD[e.dir]} from its parent`}
                    </title>
                  </g>
                );
              })}
            </g>
            <g className="zg-ghosts">
              {graph.ghosts.map((g) => (
                <g key={g.localIndex} className="zg-ghost" transform={`translate(${g.x} ${g.y})`}>
                  <rect width={g.w} height={g.h} rx={8} />
                  <text x={g.w / 2} y={g.h / 2 - 4} textAnchor="middle" className="zg-title">
                    Zone_{g.localIndex}
                  </text>
                  <text x={g.w / 2} y={g.h / 2 + 14} textAnchor="middle" className="zg-sub">
                    missing
                  </text>
                  <title>Zones build from LocalIndex {g.localIndex}, but no zone has it.</title>
                </g>
              ))}
            </g>
            <g className="zg-nodes">
              {graph.nodes.map((n) => {
                const z = zones[n.index];
                if (!z) return null;
                const selected = n.index === selectedIndex;
                const alarm = z.alarm && z.alarm.resolution !== 'none' ? z.alarm : null;
                const alarmMissing = alarm?.resolution === 'missing';
                const isDragged = dragging?.index === n.index;
                const isTarget = dragging?.over === n.index;
                const cls = [
                  'zg-node',
                  selected ? 'selected' : '',
                  z.problems ? 'has-problems' : '',
                  graph.cycles.includes(n.index) ? 'in-cycle' : '',
                  isDragged ? 'dragged' : '',
                  isTarget ? 'drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const small = n.w < 110;
                const tx = n.x + (isDragged ? dragging!.dx : 0);
                const ty = n.y + (isDragged ? dragging!.dy : 0);
                return (
                  <g
                    key={n.index}
                    className={cls}
                    transform={`translate(${tx} ${ty})`}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      setDrag({
                        index: n.index,
                        sx: e.clientX,
                        sy: e.clientY,
                        dx: 0,
                        dy: 0,
                        moved: false,
                        over: null,
                      });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (nodeDrag?.moved) return;
                      selectZone(n.index);
                    }}
                  >
                    <rect width={n.w} height={n.h} rx={8} />
                    <text x={10} y={19} className="zg-title">
                      Z{z.alias}
                    </text>
                    <text x={n.w - 10} y={19} textAnchor="end" className="zg-sub">
                      {z.geomorph ? '▣ ' : ''}
                      {z.subComplex.length > 12 && small
                        ? z.subComplex.slice(0, 11) + '…'
                        : z.subComplex}
                    </text>
                    <text x={10} y={38} className={`zg-line ${alarmMissing ? 'bad' : ''}`}>
                      {alarm
                        ? `🔔 ${alarmMissing ? `#${alarm.id} missing` : (alarm.name ?? `#${alarm.id}`)}`
                        : ''}
                    </text>
                    <text x={10} y={n.h - 12} className="zg-line">
                      {z.enemyGroups ? `⚔ ${z.enemyGroups}` : ''}
                      {z.enemyGroups && z.eventCount ? '   ' : ''}
                      {z.eventCount ? `⚡ ${z.eventCount}` : ''}
                    </text>
                    {z.problems > 0 && (
                      <g className="zg-problems" transform={`translate(${n.w - 4} ${-6})`}>
                        <circle r={9} />
                        <text y={3.5} textAnchor="middle">
                          {z.problems}
                        </text>
                      </g>
                    )}
                    <title>{zoneTitle(z)}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        <div className="zg-toolbar">
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
            −
          </button>
          <button onClick={fit} title="Fit the whole layout in view">
            fit
          </button>
          <button onClick={() => zoomBy(1.25)} title="Zoom in">
            +
          </button>
          <span className="muted">
            {zones.length} zone{zones.length === 1 ? '' : 's'}
            {graph.ghosts.length ? ` · ${graph.ghosts.length} missing parent` : ''}
            {graph.cycles.length ? ` · ${graph.cycles.length} loop` : ''}
          </span>
        </div>
        <div className="zg-note muted">
          {dragging
            ? dragging.over !== null
              ? `Drop to make Z${zones[dragging.index]!.alias} build from Z${zones[dragging.over]!.alias}`
              : 'Drop on a zone to build from it, or on empty space to set its direction from its parent'
            : 'Schematic of the build order: each zone hangs off the zone it builds from, in its StartExpansion direction (F forward, B backward, L left, R right, ? random); box size follows coverage. The game places the actual rooms when the level generates.'}
        </div>
      </div>
      <ZoneInspector />
    </div>
  );
}
