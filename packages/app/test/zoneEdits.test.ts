import { describe, expect, it } from 'vitest';
import type { ZoneNode } from '@shared/ipc';
import { descendantsOf, dominantDir, localIndexEditValue } from '../src/renderer/src/graph/zoneEdits';

function zone(index: number, buildFrom: number): ZoneNode {
  return {
    index,
    localIndex: index,
    alias: 500 + index,
    buildFrom,
    subComplex: 'All',
    startPosition: '',
    startExpansion: '',
    zoneExpansion: '',
    coverage: { min: 0, max: 0 },
    geomorph: false,
    alarm: null,
    enemyGroups: 0,
    eventCount: 0,
    problems: 0,
  };
}

describe('zone graph edit helpers', () => {
  it('BuildFromLocalIndex edits use $enum inside the named range and ints beyond it', () => {
    expect(localIndexEditValue(0)).toEqual({ $enum: 'Zone_0' });
    expect(localIndexEditValue(20)).toEqual({ $enum: 'Zone_20' });
    expect(localIndexEditValue(21)).toBe(21);
  });

  it('picks the dominant axis for a drop direction (screen y grows downwards)', () => {
    expect(dominantDir(50, 10)).toBe('R');
    expect(dominantDir(-50, 10)).toBe('L');
    expect(dominantDir(10, -50)).toBe('F');
    expect(dominantDir(10, 50)).toBe('B');
  });

  it('finds every descendant so a drop onto one is refused (it would loop)', () => {
    const zones = [zone(0, 0), zone(1, 0), zone(2, 1), zone(3, 2), zone(4, 0), zone(5, 9)];
    expect([...descendantsOf(zones, 1)].sort()).toEqual([2, 3]);
    expect([...descendantsOf(zones, 0)].sort()).toEqual([1, 2, 3, 4]);
    expect(descendantsOf(zones, 3).size).toBe(0);
    expect(descendantsOf(zones, 5).size).toBe(0);
    // Self-loop of the root must not recurse forever.
    expect(descendantsOf([zone(0, 0)], 0).size).toBe(0);
  });
});
