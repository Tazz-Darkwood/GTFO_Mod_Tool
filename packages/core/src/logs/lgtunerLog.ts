/**
 * The generated level, read from LGTuner's log lines. For every tile the game
 * places, LGTuner (hirnukuono / Flowaria) writes
 *   `[Message:   LGTuner] tile info: <x> <z> <prefab> for <Zone_N | N> : <Reality | Dimension_N>`
 * to BepInEx/LogOutput.log. A run of such lines is one level load. The file
 * holds only the latest game session.
 */
import type { BlockId, Project } from '../model/types.js';
import type { FileSystem } from '../io/fileSystem.js';
import type { ExpeditionNode, RundownTree } from '../index/rundownTree.js';
import { layoutLocalIndexes } from '../plugins/lgtuner.js';

export interface GeneratedTile {
  x: number;
  z: number;
  prefab: string;
  localIndex: number;
  /** "Reality" for the main dimension, else "Dimension_N". */
  dimension: string;
}

export interface GeneratedLoad {
  index: number;
  tiles: GeneratedTile[];
  /** 1-based line numbers in the log. */
  lineStart: number;
  lineEnd: number;
  /** "X4 : Slot Machine 2.0" when a CheatConsole line names the expedition around this load. */
  expeditionHint?: string;
}

const TILE_RE = /\bLGTuner\]\s*tile info:\s*(-?\d+)\s+(-?\d+)\s+(\S+)\s+for\s+(\S+)\s*:\s*(\S+)/;
const HINT_RE = /Update Current Expedition to (.+?)\.{3}\s*$/;

function localIndexFrom(token: string): number {
  const m = /^Zone_(\d+)$/i.exec(token);
  if (m) return Number(m[1]);
  const n = Number(token);
  return Number.isInteger(n) ? n : NaN;
}

/** Split a BepInEx log into level loads (runs of tile lines, at most 40 non-tile lines apart). */
export function parseTileLog(text: string): GeneratedLoad[] {
  const lines = text.split(/\r?\n/);
  const loads: GeneratedLoad[] = [];
  let cur: GeneratedLoad | null = null;
  let gap = 0;
  let pendingHint: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = TILE_RE.exec(line);
    if (m) {
      if (!cur || gap > 40) {
        cur = { index: loads.length, tiles: [], lineStart: i + 1, lineEnd: i + 1 };
        if (pendingHint) cur.expeditionHint = pendingHint;
        loads.push(cur);
      }
      cur.tiles.push({
        x: Number(m[1]),
        z: Number(m[2]),
        prefab: m[3]!,
        localIndex: localIndexFrom(m[4]!),
        dimension: m[5]!,
      });
      cur.lineEnd = i + 1;
      gap = 0;
      continue;
    }
    const h = HINT_RE.exec(line);
    if (h) {
      pendingHint = h[1]!.trim();
      // A hint shortly after a load names that load (the plugin logs it on level start).
      if (cur && gap <= 200) cur.expeditionHint = pendingHint;
    }
    if (cur) gap++;
  }
  return loads;
}

/** Path of BepInEx/LogOutput.log for a rundown folder (any ancestor holding one), or null. */
export async function findBepInExLog(
  fs: FileSystem,
  rootPath: string,
  sep: string,
): Promise<string | null> {
  const parts = rootPath.split(sep).filter((p, i) => p.length > 0 || i === 0);
  for (let n = parts.length; n >= 1; n--) {
    const dir = parts.slice(0, n).join(sep) || sep;
    const candidate = `${dir}${sep}LogOutput.log`;
    if (await fs.stat(candidate)) return candidate;
  }
  return null;
}

export interface ExpeditionMatch {
  rundownId: number;
  tier: string;
  index: number;
  prefix: string;
  publicName: string;
  /** Tiles explained by this expedition's layouts, out of the load's tile count. */
  score: number;
}

/** Layout block for each dimension label of an expedition ("Reality" → main/secondary/third layers). */
function layoutsByDimension(exp: ExpeditionNode): Map<string, BlockId[]> {
  const out = new Map<string, BlockId[]>();
  out.set(
    'Reality',
    exp.layers.flatMap((l) => (l.enabled && l.layout?.blockId ? [l.layout.blockId] : [])),
  );
  for (const d of exp.dimensions)
    if (d.enabled && d.layout?.blockId)
      out.set(`Dimension_${d.dimensionIndex}`, [
        ...(out.get(`Dimension_${d.dimensionIndex}`) ?? []),
        d.layout.blockId,
      ]);
  return out;
}

/** Rank expeditions by how many of the load's tiles their layouts explain. */
export function matchLoad(
  project: Project,
  tree: RundownTree,
  load: GeneratedLoad,
): ExpeditionMatch[] {
  const cache = new Map<BlockId, Set<number>>();
  const locals = (id: BlockId) => {
    let s = cache.get(id);
    if (!s) {
      s = new Set(layoutLocalIndexes(project, id));
      cache.set(id, s);
    }
    return s;
  };
  const out: ExpeditionMatch[] = [];
  for (const rd of tree.rundowns)
    for (const t of rd.tiers)
      for (const e of t.expeditions) {
        const byDim = layoutsByDimension(e);
        let score = 0;
        for (const tile of load.tiles) {
          const layouts = byDim.get(tile.dimension) ?? [];
          if (layouts.some((id) => locals(id).has(tile.localIndex))) score++;
        }
        if (score > 0)
          out.push({
            rundownId: rd.id,
            tier: t.tier,
            index: e.index,
            prefix: e.prefix,
            publicName: e.publicName,
            score,
          });
      }
  out.sort((a, b) => b.score - a.score);
  // A CheatConsole hint ("X4 : Slot Machine 2.0") settles ties.
  if (load.expeditionHint) {
    const hinted = out.find((m) => load.expeditionHint!.startsWith(`${m.prefix} `));
    if (hinted && out[0] && hinted.score === out[0].score) {
      out.splice(out.indexOf(hinted), 1);
      out.unshift(hinted);
    }
  }
  return out;
}

export interface LayoutTile extends GeneratedTile {
  /** Another layer of the same expedition also has this LocalIndex in this dimension. */
  ambiguous: boolean;
}

/** The tiles of one layout in a load, given the expedition the load came from. */
export function tilesForLayout(
  project: Project,
  exp: ExpeditionNode,
  load: GeneratedLoad,
  layoutBlockId: BlockId,
): LayoutTile[] {
  const byDim = layoutsByDimension(exp);
  const mine = new Set(layoutLocalIndexes(project, layoutBlockId));
  const out: LayoutTile[] = [];
  for (const [dim, layouts] of byDim) {
    if (!layouts.includes(layoutBlockId)) continue;
    const others = layouts.filter((id) => id !== layoutBlockId);
    for (const tile of load.tiles) {
      if (tile.dimension !== dim || !mine.has(tile.localIndex)) continue;
      const ambiguous = others.some((id) =>
        new Set(layoutLocalIndexes(project, id)).has(tile.localIndex),
      );
      out.push({ ...tile, ambiguous });
    }
  }
  return out;
}
