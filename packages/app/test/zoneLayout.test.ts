import { describe, expect, it } from 'vitest';
import type { ZoneNode } from '@shared/ipc';
import { dirOf, zoneGraphLayout } from '../src/renderer/src/graph/zoneLayout';

function zone(
  index: number,
  buildFrom: number,
  startExpansion: string,
  extra: Partial<ZoneNode> = {},
): ZoneNode {
  return {
    index,
    localIndex: index,
    alias: 500 + index,
    buildFrom,
    subComplex: 'All',
    startPosition: 'From_Start',
    startExpansion,
    zoneExpansion: 'Collapsed',
    coverage: { min: 20, max: 40 },
    geomorph: false,
    alarm: null,
    enemyGroups: 0,
    eventCount: 0,
    problems: 0,
    ...extra,
  };
}

/** A1 Compromise's build order (14 zones). */
const A1: [number, number, string][] = [
  [0, 0, 'Towards_Forward'],
  [1, 0, 'Towards_Forward'],
  [2, 1, 'Towards_Forward'],
  [3, 2, 'Towards_Right'],
  [4, 3, 'Towards_Right'],
  [5, 3, 'Towards_Backward'],
  [6, 3, 'Towards_Forward'],
  [7, 2, 'Towards_Left'],
  [8, 7, 'Towards_Left'],
  [9, 2, 'Towards_Forward'],
  [10, 9, 'Towards_Forward'],
  [11, 1, 'Towards_Right'],
  [12, 11, 'Towards_Right'],
  [13, 12, 'Towards_Right'],
];

describe('zoneGraphLayout', () => {
  it('lays A1 out as a tree following build directions, one zone per cell', () => {
    const g = zoneGraphLayout(A1.map(([i, b, d]) => zone(i, b, d)));
    expect(g.nodes).toHaveLength(14);
    expect(g.edges.filter((e) => !e.cycle)).toHaveLength(13);
    expect(g.ghosts).toEqual([]);
    expect(g.cycles).toEqual([]);
    const at = (i: number) => g.nodes.find((n) => n.index === i)!;
    const cells = new Set(g.nodes.map((n) => `${n.gx},${n.gy}`));
    expect(cells.size).toBe(14);
    expect(at(1).gy).toBe(at(0).gy - 1); // forward = up
    expect(at(4).gx).toBe(at(3).gx + 1); // right
    // Backward = down; zone 11 (right of zone 1) already sits directly below zone 3,
    // so zone 5 lands further down on the same side.
    expect(at(5).gy).toBeGreaterThan(at(3).gy);
    expect(at(11).gx).toBe(at(1).gx + 1);
    expect(at(11).gy).toBe(at(1).gy);
    expect(at(6).gy).toBe(at(3).gy - 1); // forward
    expect(at(7).gx).toBe(at(2).gx - 1); // left
    expect(g.edges.find((e) => e.to === 3)).toMatchObject({ from: 2, dir: 'R' });
    // Every node lies inside the canvas.
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(g.width);
      expect(n.y + n.h).toBeLessThanOrEqual(g.height);
    }
  });

  it('resolves collisions and Random directions to free cells', () => {
    // Four children all "forward" of the same parent: only one can take the cell above.
    const g = zoneGraphLayout([
      zone(0, 0, 'Towards_Forward'),
      zone(1, 0, 'Towards_Forward'),
      zone(2, 0, 'Towards_Forward'),
      zone(3, 0, 'Towards_Forward'),
      zone(4, 0, 'Towards_Random'),
    ]);
    const cells = new Set(g.nodes.map((n) => `${n.gx},${n.gy}`));
    expect(cells.size).toBe(5);
    const root = g.nodes.find((n) => n.index === 0)!;
    // Forward children stay on the far (upper) side of the parent.
    for (const i of [1, 2, 3]) expect(g.nodes.find((n) => n.index === i)!.gy).toBeLessThan(root.gy);
    expect(g.edges.find((e) => e.to === 4)!.dir).toBe('?');
  });

  it('draws orphans off a ghost parent and breaks cycles without crashing', () => {
    const g = zoneGraphLayout([
      zone(0, 0, 'Towards_Forward'),
      zone(1, 9, 'Towards_Forward'), // builds from a zone that does not exist
      zone(2, 3, 'Towards_Right'), // 2 ↔ 3 loop
      zone(3, 2, 'Towards_Left'),
    ]);
    expect(g.nodes).toHaveLength(4);
    expect(g.ghosts).toHaveLength(1);
    expect(g.ghosts[0]!.localIndex).toBe(9);
    expect(g.edges.find((e) => e.to === 1)).toMatchObject({ from: -1, ghost: 9 });
    expect(g.cycles).toEqual([2]);
    expect(g.edges.some((e) => e.cycle && e.to === 2)).toBe(true);
    expect(new Set(g.nodes.map((n) => `${n.gx},${n.gy}`)).size).toBe(4);
  });

  it('reads directions from enum names, however they are cased', () => {
    expect(dirOf('Towards_Forward')).toBe('F');
    expect(dirOf('towards_backward')).toBe('B');
    expect(dirOf('Towards_Right')).toBe('R');
    expect(dirOf('Towards_left')).toBe('L');
    expect(dirOf('Towards_Random')).toBe('?');
    expect(dirOf('')).toBe('?');
  });
});
