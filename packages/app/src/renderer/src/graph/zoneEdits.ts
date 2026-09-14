/** Pure helpers behind the graph's drag-to-reparent and drag-to-redirect edits. */
import type { ZoneNode } from '@shared/ipc';
import type { Dir } from './zoneLayout';

/** eLocalZoneIndex has named members Zone_0..Zone_20; beyond that files use plain ints. */
export const NAMED_LOCAL_INDEX_MAX = 20;

export const DIR_ENUM: Record<Exclude<Dir, '?'>, string> = {
  F: 'Towards_Forward',
  B: 'Towards_Backward',
  L: 'Towards_Left',
  R: 'Towards_Right',
};

/**
 * Value for a BuildFromLocalIndex edit. `{ $enum }` lets the edit engine keep the
 * token's existing style ("Zone_3" stays a string, 3 stays an int); above the
 * named range only an int is valid.
 */
export function localIndexEditValue(n: number): unknown {
  return n <= NAMED_LOCAL_INDEX_MAX ? { $enum: `Zone_${n}` } : n;
}

/** Dominant direction of the vector from a parent to a point, in graph space (y grows downwards). */
export function dominantDir(dx: number, dy: number): Exclude<Dir, '?'> {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'R' : 'L';
  return dy >= 0 ? 'B' : 'F';
}

/** Indexes of every zone that (transitively) builds from zone `index`. */
export function descendantsOf(zones: ZoneNode[], index: number): Set<number> {
  const out = new Set<number>();
  const byParent = new Map<number, ZoneNode[]>();
  for (const z of zones) byParent.set(z.buildFrom, [...(byParent.get(z.buildFrom) ?? []), z]);
  const start = zones[index];
  if (!start) return out;
  const stack = [start];
  while (stack.length) {
    const z = stack.pop()!;
    for (const c of byParent.get(z.localIndex) ?? []) {
      if (c.index === z.index || out.has(c.index)) continue;
      out.add(c.index);
      stack.push(c);
    }
  }
  return out;
}
