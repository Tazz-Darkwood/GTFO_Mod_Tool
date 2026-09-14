/**
 * L-rules: LGTuner config files (Custom/LGTuner). LGTuner is silent about most
 * mistakes in game, so the checks mirror what its loader would do or ignore.
 */
import type { Project } from '../../model/types.js';
import { nodeAt } from '../../text/jsoncDoc.js';
import {
  LGTUNER_COMPLEXES,
  LGTUNER_DIRECTIONS,
  LGTUNER_ROTATIONS,
  layoutLocalIndexes,
  lgtunerConfigs,
} from '../../plugins/lgtuner.js';
import type { Reporter } from '../validator.js';

export function checkLgTuner(project: Project, r: Reporter): void {
  const configs = lgtunerConfigs(project);
  const byLayout = new Map<number, typeof configs>();
  for (const c of configs) byLayout.set(c.layoutId, [...(byLayout.get(c.layoutId) ?? []), c]);

  for (const c of configs) {
    const file = project.files.get(c.fileId)!;
    const tree = file.tree!;
    const at = (path: (string | number)[]) => nodeAt(tree, path) ?? tree;

    // L002: the layout must exist.
    if (c.layoutResolution === 'missing') {
      r.add({
        code: 'L002',
        file: c.fileId,
        node: at(['LevelLayoutID']),
        path: ['LevelLayoutID'],
        message: `LevelLayoutID ${c.layoutId} is not a LevelLayout in the project or vanilla data; LGTuner will never apply this file.`,
      });
    }

    // L004: LGTuner picks one file per layout.
    const siblings = byLayout.get(c.layoutId) ?? [];
    if (siblings.length > 1 && siblings[0] !== c) {
      r.add({
        code: 'L004',
        file: c.fileId,
        node: at(['LevelLayoutID']),
        path: ['LevelLayoutID'],
        message: `LevelLayoutID ${c.layoutId} is also targeted by ${siblings[0]!.fileId}; LGTuner uses only one of them.`,
      });
    }

    // L001: duplicate (X, Z) — LGTuner logs an error and keeps the first.
    const seen = new Map<string, number>();
    for (const t of c.tileOverrides) {
      const key = `${t.x},${t.z}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, t.index);
        continue;
      }
      r.add({
        code: 'L001',
        file: c.fileId,
        node: at(t.path),
        path: t.path,
        message: `Tile (${t.x}, ${t.z}) is overridden twice (entries ${first + 1} and ${t.index + 1}); LGTuner keeps the first and drops this one.`,
        fix: {
          title: `Remove duplicate tile override ${t.index + 1}`,
          edits: [{ file: c.fileId, op: { op: 'remove', path: t.path } }],
        },
      });
    }

    // L003: zone overrides for zones the layout does not have.
    if (c.layoutBlockId) {
      const locals = new Set(layoutLocalIndexes(project, c.layoutBlockId));
      for (const z of c.zoneOverrides) {
        if (Number.isNaN(z.localIndex) || !locals.has(z.localIndex)) {
          r.add({
            code: 'L003',
            file: c.fileId,
            node: at([...z.path, 'LocalIndex']),
            path: [...z.path, 'LocalIndex'],
            message: Number.isNaN(z.localIndex)
              ? `ZoneOverrides[${z.index}].LocalIndex is not a zone index.`
              : `ZoneOverrides[${z.index}] targets LocalIndex ${z.localIndex}, but layout ${c.layoutName ?? c.layoutId} has no such zone.`,
          });
        }
      }
    }

    // L005: enum spellings LGTuner's JSON reader would reject.
    const enumCheck = (path: (string | number)[], value: string, allowed: readonly string[]) => {
      if (allowed.includes(value)) return;
      const ci = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
      r.add({
        code: 'L005',
        file: c.fileId,
        node: at(path),
        path,
        message: `"${value}" is not one of ${allowed.join(', ')}.`,
        ...(ci
          ? {
              fix: {
                title: `Change to ${ci}`,
                edits: [{ file: c.fileId, op: { op: 'set', path, value: ci } }],
              },
            }
          : {}),
      });
    };
    for (const t of c.tileOverrides) {
      if (nodeAt(tree, [...t.path, 'Rotation']))
        enumCheck([...t.path, 'Rotation'], t.rotation, LGTUNER_ROTATIONS);
    }
    for (const z of c.zoneOverrides) {
      z.geomorphs.forEach((g, i) => {
        if (nodeAt(tree, [...z.path, 'Geomorphs', i, 'Direction']))
          enumCheck([...z.path, 'Geomorphs', i, 'Direction'], g.direction, LGTUNER_DIRECTIONS);
      });
    }
    c.extraComplexes.forEach((x, i) =>
      enumCheck(['ExtraComplexResourceToLoad', i], x, LGTUNER_COMPLEXES),
    );
  }
}
