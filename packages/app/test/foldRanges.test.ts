import { json } from '@codemirror/lang-json';
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { foldAllRanges, unfoldedOnly } from '../src/renderer/src/editor/foldRanges';

const DOC = `{
  "ZoneAliasStart": 502,
  "Zones": [
    {
      "LocalIndex": 0,
      "CoverageMinMax": { "x": 10.0, "y": 10.0 },
      "EventsOnEnter": [],
      "AltitudeData": {
        "AllowedZoneAltitude": 5
      }
    },
    {
      "LocalIndex": 1
    }
  ]
}`;

function state(doc: string) {
  return EditorState.create({ doc, extensions: [json(), codeFolding()] });
}

describe('foldAllRanges', () => {
  it('folds every multi-line object and list, keeping the root open when asked', () => {
    const s = state(DOC);
    const ranges = foldAllRanges(s, true);
    const texts = ranges.map((r) => s.doc.lineAt(r.from - 1).text.trim());
    // Zones list, zone 0, AltitudeData, zone 1 — not the root, not the one-line
    // CoverageMinMax object, not the empty EventsOnEnter list.
    expect(texts).toEqual(['"Zones": [', '{', '"AltitudeData": {', '{']);
    expect(foldAllRanges(s, false)).toHaveLength(5); // + the root
    // Every range sits just inside a bracket pair.
    for (const r of ranges) {
      expect('{['.includes(s.doc.sliceString(r.from - 1, r.from))).toBe(true);
      expect('}]'.includes(s.doc.sliceString(r.to, r.to + 1))).toBe(true);
    }
  });

  it('parses the whole document even when it is large', () => {
    const zones = Array.from({ length: 3000 }, (_, i) => `    {\n      "LocalIndex": ${i}\n    }`);
    const big = `{\n  "Zones": [\n${zones.join(',\n')}\n  ]\n}`;
    const s = state(big);
    expect(foldAllRanges(s, true)).toHaveLength(3001);
  });

  it('unfoldedOnly skips ranges that are already folded', () => {
    const s0 = state(DOC);
    const all = foldAllRanges(s0, true);
    const s1 = s0.update({ effects: foldEffect.of(all[0]!) }).state;
    let count = 0;
    foldedRanges(s1).between(0, s1.doc.length, () => {
      count++;
    });
    expect(count).toBe(1);
    expect(unfoldedOnly(s1, all)).toEqual(all.slice(1));
  });
});
