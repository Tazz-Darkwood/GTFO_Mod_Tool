/**
 * Schematic layout of a LevelLayout's zones: each zone hangs off the zone it
 * builds from, in the direction its StartExpansion names, on a unit grid.
 * Pure function, no DOM, unit-tested. This is a sketch of the build order and
 * directions, not the map the game generates (that depends on seeds and tiles).
 */
import type { ZoneNode } from '@shared/ipc';

export type Dir = 'F' | 'B' | 'L' | 'R' | '?';

export interface GraphNode {
  index: number;
  gx: number;
  gy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphEdge {
  /** Zone index of the parent, or -1 when the parent is a ghost. */
  from: number;
  to: number;
  dir: Dir;
  /** The parent chain loops back; drawn dashed. */
  cycle: boolean;
  /** Set when `from` is a ghost (missing zone) — the ghost's LocalIndex. */
  ghost?: number;
}

export interface GhostNode {
  /** The LocalIndex zones build from but no zone has. */
  localIndex: number;
  gx: number;
  gy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoneGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ghosts: GhostNode[];
  /** Zone indexes whose build chain loops. */
  cycles: number[];
  width: number;
  height: number;
  cell: number;
}

export const CELL = 170;
export const PAD = 40;
export const NODE_W = 120;
export const NODE_H = 72;

const VEC: Record<Exclude<Dir, '?'>, [number, number]> = {
  F: [0, -1],
  B: [0, 1],
  R: [1, 0],
  L: [-1, 0],
};
const RANDOM_ORDER: Exclude<Dir, '?'>[] = ['F', 'R', 'L', 'B'];

export function dirOf(startExpansion: string): Dir {
  const s = startExpansion.toLowerCase();
  if (s.endsWith('forward')) return 'F';
  if (s.endsWith('backward')) return 'B';
  if (s.endsWith('right')) return 'R';
  if (s.endsWith('left')) return 'L';
  return '?';
}

/** Node size grows a little with the zone's maximum coverage. */
export function nodeScale(coverageMax: number): number {
  return Math.min(1.3, Math.max(0.85, 0.85 + coverageMax / 150));
}

const key = (x: number, y: number) => `${x},${y}`;

/** Nearest free cell to (px,py); with a direction, cells on that side of the parent come first. */
function nearestFree(
  taken: Set<string>,
  px: number,
  py: number,
  dir: Dir,
  parent: [number, number],
): [number, number] {
  if (!taken.has(key(px, py))) return [px, py];
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  for (let r = 1; r <= 12 && !best; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx;
        const y = py + dy;
        if (taken.has(key(x, y))) continue;
        let score = Math.abs(dx) + Math.abs(dy);
        if (dir !== '?') {
          const [vx, vy] = VEC[dir];
          // Prefer staying on the parent's far side in the build direction.
          const along = (x - parent[0]) * vx + (y - parent[1]) * vy;
          if (along <= 0) score += 100;
        }
        if (score < bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
  }
  return best ?? [px, py + 20];
}

export function zoneGraphLayout(zones: ZoneNode[]): ZoneGraph {
  const byLocal = new Map<number, ZoneNode>();
  for (const z of zones) if (!byLocal.has(z.localIndex)) byLocal.set(z.localIndex, z);

  // Parent of each zone: another zone, a ghost (missing LocalIndex), or none (root).
  const parentOf = new Map<number, ZoneNode | null>();
  const ghostFor = new Map<number, number>(); // zone index -> missing LocalIndex
  for (const z of zones) {
    if (z.buildFrom === z.localIndex) {
      parentOf.set(z.index, null);
      continue;
    }
    const p = byLocal.get(z.buildFrom);
    if (p) parentOf.set(z.index, p);
    else {
      parentOf.set(z.index, null);
      ghostFor.set(z.index, z.buildFrom);
    }
  }

  // Break cycles: walk up from every zone; a zone whose chain revisits itself becomes a root.
  const cycles = new Set<number>();
  for (const z of zones) {
    const seen = new Set<number>();
    let cur: ZoneNode | null | undefined = z;
    while (cur) {
      if (seen.has(cur.index)) {
        // Cut at the smallest index on the loop so the break is deterministic.
        let cut = cur;
        for (const i of seen) {
          const m = zones[i];
          if (
            m &&
            parentOf.get(m.index) &&
            seen.has(parentOf.get(m.index)!.index) &&
            m.index < cut.index
          )
            cut = m;
        }
        if (parentOf.get(cut.index)) {
          cycles.add(cut.index);
          parentOf.set(cut.index, null);
        }
        break;
      }
      seen.add(cur.index);
      cur = parentOf.get(cur.index);
    }
  }

  const children = new Map<number, ZoneNode[]>(); // parent index -> children (by index)
  const ghostChildren = new Map<number, ZoneNode[]>(); // missing LocalIndex -> children
  const roots: ZoneNode[] = [];
  for (const z of zones) {
    const g = ghostFor.get(z.index);
    if (g !== undefined) {
      ghostChildren.set(g, [...(ghostChildren.get(g) ?? []), z]);
      continue;
    }
    const p = parentOf.get(z.index);
    if (!p) roots.push(z);
    else children.set(p.index, [...(children.get(p.index) ?? []), z]);
  }

  const taken = new Set<string>();
  const cellOf = new Map<number, [number, number]>();
  const ghostCell = new Map<number, [number, number]>();
  const edges: GraphEdge[] = [];
  let maxX = -1;

  const place = (z: ZoneNode, at: [number, number]) => {
    taken.add(key(at[0], at[1]));
    cellOf.set(z.index, at);
    maxX = Math.max(maxX, at[0]);
  };

  const placeChildren = (
    parentCell: [number, number],
    kids: ZoneNode[],
    from: number,
    ghost?: number,
  ) => {
    const queue: { z: ZoneNode; parentCell: [number, number] }[] = [];
    for (const k of kids) {
      const dir = dirOf(k.startExpansion);
      let cell: [number, number] | null = null;
      if (dir === '?') {
        for (const d of RANDOM_ORDER) {
          const c: [number, number] = [parentCell[0] + VEC[d][0], parentCell[1] + VEC[d][1]];
          if (!taken.has(key(c[0], c[1]))) {
            cell = c;
            break;
          }
        }
        if (!cell) cell = nearestFree(taken, parentCell[0], parentCell[1] + 1, '?', parentCell);
      } else {
        const want: [number, number] = [parentCell[0] + VEC[dir][0], parentCell[1] + VEC[dir][1]];
        cell = nearestFree(taken, want[0], want[1], dir, parentCell);
      }
      place(k, cell);
      edges.push({
        from,
        to: k.index,
        dir,
        cycle: false,
        ...(ghost !== undefined ? { ghost } : {}),
      });
      queue.push({ z: k, parentCell: cell });
    }
    for (const q of queue) placeChildren(q.parentCell, children.get(q.z.index) ?? [], q.z.index);
  };

  // Roots (and ghosts) go left to right, each tree in its own column band.
  const nextRootCell = (): [number, number] => [maxX < 0 ? 0 : maxX + 2, 0];
  for (const r of roots) {
    const at = nearestFree(taken, ...nextRootCell(), '?', [0, 0]);
    place(r, at);
    placeChildren(at, children.get(r.index) ?? [], r.index);
  }
  for (const [missing, kids] of ghostChildren) {
    const at = nearestFree(taken, ...nextRootCell(), '?', [0, 0]);
    taken.add(key(at[0], at[1]));
    ghostCell.set(missing, at);
    maxX = Math.max(maxX, at[0]);
    placeChildren(at, kids, -1, missing);
  }
  // Cycle members were turned into roots above; add their dashed back-edge for the eye.
  for (const i of cycles) {
    const z = zones[i]!;
    const p = byLocal.get(z.buildFrom);
    if (p && cellOf.has(p.index))
      edges.push({ from: p.index, to: z.index, dir: dirOf(z.startExpansion), cycle: true });
  }

  // Normalise to positive pixel coordinates.
  const all = [...cellOf.values(), ...ghostCell.values()];
  const minX = Math.min(0, ...all.map((c) => c[0]));
  const minY = Math.min(0, ...all.map((c) => c[1]));
  const maxGX = Math.max(0, ...all.map((c) => c[0]));
  const maxGY = Math.max(0, ...all.map((c) => c[1]));
  const px = (gx: number, w: number) => PAD + (gx - minX) * CELL + (CELL - w) / 2;
  const py = (gy: number, h: number) => PAD + (gy - minY) * CELL + (CELL - h) / 2;

  const nodes: GraphNode[] = zones.map((z) => {
    const [gx, gy] = cellOf.get(z.index) ?? [0, 0];
    const s = nodeScale(z.coverage.max);
    const w = Math.round(NODE_W * s);
    const h = Math.round(NODE_H * Math.min(s, 1.15));
    return { index: z.index, gx, gy, x: px(gx, w), y: py(gy, h), w, h };
  });
  const ghosts: GhostNode[] = [...ghostCell].map(([localIndex, [gx, gy]]) => ({
    localIndex,
    gx,
    gy,
    x: px(gx, NODE_W),
    y: py(gy, NODE_H),
    w: NODE_W,
    h: NODE_H,
  }));

  return {
    nodes,
    edges,
    ghosts,
    cycles: [...cycles].sort((a, b) => a - b),
    width: PAD * 2 + (maxGX - minX + 1) * CELL,
    height: PAD * 2 + (maxGY - minY + 1) * CELL,
    cell: CELL,
  };
}
