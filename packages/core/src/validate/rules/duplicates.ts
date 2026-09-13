/**
 * D-rules: duplicate persistentIDs within the project, and partial blocks that
 * shadow a vanilla block of the same ID.
 */
import type { Project } from '../../model/types.js';
import type { Reporter } from '../validator.js';
import { describe } from './blockShape.js';

export function checkDuplicates(project: Project, r: Reporter): void {
  for (const [type, ids] of project.index.byType) {
    const res = project.resolutions.get(type);
    for (const [id, blocks] of ids) {
      if (blocks.length > 1) {
        const first = blocks[0]!;
        const firstFile = project.files.get(first.file)!;
        for (const dup of blocks.slice(1)) {
          r.add({
            code: 'D001',
            file: dup.file,
            node: dup.node,
            path: dup.path,
            blockId: dup.id,
            message: `${type} #${id} is defined more than once: ${describe(dup)} here and ${describe(first)} in ${first.file}. Only one will be loaded.`,
            related: [
              {
                file: first.file,
                range: r.range(firstFile, first.node),
                message: `First definition: ${describe(first)}`,
              },
            ],
          });
        }
      }
      if (res?.baseline === 'vanilla') {
        const vanillaName = project.vanilla.types[type]?.[String(id)];
        if (vanillaName !== undefined) {
          const b = blocks[0]!;
          r.add({
            code: 'D002',
            file: b.file,
            node: b.node,
            path: b.path,
            blockId: b.id,
            message: `${describe(b)} replaces the vanilla ${type} #${id} "${vanillaName}".`,
          });
        }
      }
    }
  }
}
