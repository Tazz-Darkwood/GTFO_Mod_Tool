/**
 * Trailing commas (`[1, 2,]`, `{"a": 1,}`) are legal JSONC and jsonc-parser
 * accepts them, but the game's reader (System.Text.Json, as used by MTFO and
 * PartialData) rejects them and drops the whole block. We therefore parse
 * leniently everywhere and detect them separately so they can be reported and
 * removed.
 */
import { createScanner, type Node } from 'jsonc-parser';

// jsonc-parser's SyntaxKind is a const enum (not usable under isolatedModules).
const COMMA_TOKEN = 5;
const EOF_TOKEN = 17;

export interface TrailingComma {
  /** Offset of the comma character. */
  offset: number;
  /** The array/object node that ends with the comma. */
  container: Node;
}

/** Every trailing comma in the document, in source order. */
export function findTrailingCommas(text: string, tree: Node | undefined): TrailingComma[] {
  const out: TrailingComma[] = [];
  if (!tree) return out;
  const visit = (node: Node): void => {
    if ((node.type === 'object' || node.type === 'array') && node.children?.length) {
      const last = node.children[node.children.length - 1]!;
      const from = last.offset + last.length;
      const to = node.offset + node.length - 1; // the closing bracket
      if (to > from) {
        const comma = commaIn(text, from, to);
        if (comma !== undefined) out.push({ offset: comma, container: node });
      }
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(tree);
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

/** Offset of a comma token between `from` and `to` (comments/whitespace skipped), if any. */
function commaIn(text: string, from: number, to: number): number | undefined {
  const scanner = createScanner(text.slice(from, to), true);
  for (;;) {
    const kind = scanner.scan();
    if (kind === EOF_TOKEN) return undefined;
    if (kind === COMMA_TOKEN) return from + scanner.getTokenOffset();
  }
}

/** Text with every trailing comma removed (nothing else changes). */
export function stripTrailingCommas(text: string, tree: Node | undefined): string {
  const commas = findTrailingCommas(text, tree);
  if (!commas.length) return text;
  let out = '';
  let pos = 0;
  for (const c of commas) {
    out += text.slice(pos, c.offset);
    pos = c.offset + 1;
  }
  return out + text.slice(pos);
}
