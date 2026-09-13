import type { TextStyle } from '../model/types.js';

const BOM = '﻿';

/** Split a raw file string into (text-without-BOM, style). */
export function splitBom(raw: string): { text: string; bom: boolean } {
  if (raw.startsWith(BOM)) return { text: raw.slice(1), bom: true };
  return { text: raw, bom: false };
}

export function detectStyle(text: string, bom = false): TextStyle {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  const eol: TextStyle['eol'] = crlf > lf ? '\r\n' : '\n';
  return { eol, bom, indentUnit: detectIndentUnit(text) };
}

/**
 * Dominant indentation unit. Tabs win if any indented line uses them more
 * often than spaces; otherwise the most common *smallest* space indent
 * (typically 2 or 4). Returns null for single-line / unindented text.
 */
export function detectIndentUnit(text: string): string | null {
  let tabLines = 0;
  const spaceCounts = new Map<number, number>();
  let prevIndent = 0;
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;
    const m = /^[ \t]*/.exec(line);
    const ws = m ? m[0] : '';
    if (ws.includes('\t')) {
      tabLines++;
      continue;
    }
    const n = ws.length;
    const delta = n - prevIndent;
    if (delta > 0) spaceCounts.set(delta, (spaceCounts.get(delta) ?? 0) + 1);
    prevIndent = n;
  }
  let spaceLines = 0;
  for (const c of spaceCounts.values()) spaceLines += c;
  if (tabLines === 0 && spaceLines === 0) return null;
  if (tabLines > spaceLines) return '\t';
  let best = 0;
  let bestCount = -1;
  for (const [delta, count] of spaceCounts) {
    if (count > bestCount || (count === bestCount && delta < best)) {
      best = delta;
      bestCount = count;
    }
  }
  return best > 0 ? ' '.repeat(best) : null;
}

/** Leading whitespace of the line that contains `offset`. */
export function lineIndentAt(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && text.charCodeAt(start - 1) !== 10) start--;
  let end = start;
  while (end < text.length) {
    const c = text.charCodeAt(end);
    if (c !== 32 && c !== 9) break;
    end++;
  }
  return text.slice(start, end);
}

/** Convert LF text to the file's EOL and re-add its BOM for writing. */
export function applyStyleForWrite(text: string, style: TextStyle): string {
  let out = text;
  if (style.eol === '\r\n') out = out.replace(/\r?\n/g, '\r\n');
  if (style.bom) out = BOM + out;
  return out;
}
