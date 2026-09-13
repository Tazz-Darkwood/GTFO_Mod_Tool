import { describe, expect, it } from 'vitest';
import type { Block, BlockIndex } from '../src/index.js';

describe('model types', () => {
  it('index shape compiles and behaves like a map of maps', () => {
    const index: BlockIndex = {
      byType: new Map(),
      byId: new Map(),
      untyped: [],
      byFile: new Map(),
    };
    const block = {
      id: 'a.json#/0',
      file: 'a.json',
      type: 'FogSettings',
      persistentID: 1,
      name: 'x',
      path: [0],
      node: { type: 'object', offset: 0, length: 2 },
    } as Block;
    index.byType.set('FogSettings', new Map([[1, [block]]]));
    expect(index.byType.get('FogSettings')?.get(1)?.[0].name).toBe('x');
  });
});
