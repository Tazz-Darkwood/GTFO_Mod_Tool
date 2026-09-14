import type { ExpeditionNode, LinkNode, RundownTree } from '@shared/ipc';

export interface TreePlace {
  rundownId: number;
  expedition: ExpeditionNode;
  /** Human role: "main layout", "secondary objective", "dimension 1 layout", … */
  role: string;
}

export function expeditionLabel(e: ExpeditionNode): string {
  return (
    `${e.prefix}${e.prefix && e.publicName ? ' ' : ''}${e.publicName}`.trim() ||
    `expedition ${e.index + 1}`
  );
}

export function expeditionKey(rundownId: number, e: ExpeditionNode): string {
  return `exp:${rundownId}:${e.tier}:${e.index}`;
}

/** Where does a block appear in the navigator? First match wins. */
export function placeOfBlock(tree: RundownTree | null, blockId: string): TreePlace | null {
  if (!tree) return null;
  const hit = (l: LinkNode | null) => !!l && l.blockId === blockId;
  for (const rd of tree.rundowns) {
    if (rd.blockId === blockId) return null;
    for (const t of rd.tiers)
      for (const e of t.expeditions) {
        for (const l of e.layers) {
          if (hit(l.layout)) return { rundownId: rd.id, expedition: e, role: `${l.layer} layout` };
          const oi = l.objectives.findIndex(hit);
          if (oi >= 0)
            return {
              rundownId: rd.id,
              expedition: e,
              role: `${l.layer} objective${oi ? ` ${oi + 1}` : ''}`,
            };
          for (const o of l.objectives) {
            const d = o.detail;
            if (d?.kind === 'objective') {
              if (d.alarms.some(hit))
                return { rundownId: rd.id, expedition: e, role: `${l.layer} objective alarm` };
              if (d.waves.some((w) => hit(w.settings) || hit(w.population)))
                return { rundownId: rd.id, expedition: e, role: `${l.layer} objective wave` };
            }
          }
          const ld = l.layout?.detail;
          if (ld?.kind === 'layout') {
            const z = ld.zones.find((zone) => hit(zone.alarm));
            if (z)
              return {
                rundownId: rd.id,
                expedition: e,
                role: `${l.layer} layout · zone ${z.alias} alarm`,
              };
          }
        }
        for (const d of e.dimensions) {
          if (hit(d.dimension))
            return { rundownId: rd.id, expedition: e, role: `dimension ${d.dimensionIndex}` };
          if (hit(d.layout))
            return {
              rundownId: rd.id,
              expedition: e,
              role: `dimension ${d.dimensionIndex} layout`,
            };
        }
      }
  }
  return null;
}
