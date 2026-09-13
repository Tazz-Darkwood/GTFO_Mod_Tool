/**
 * Thin wrapper over jsonc-parser that keeps source offsets for every node.
 * All parsing in the app goes through here so comments and trailing commas
 * are handled identically everywhere.
 */
import {
  findNodeAtLocation,
  getNodePath,
  getNodeValue,
  parseTree,
  type Node,
  type ParseError,
  type ParseOptions,
} from 'jsonc-parser';
import type { JsonPath, TextRange } from '../model/types.js';

export type { Node, ParseError };

const PARSE_OPTIONS: ParseOptions = {
  allowTrailingComma: true,
  disallowComments: false,
  allowEmptyContent: false,
};

export interface ParsedDocument {
  tree: Node | undefined;
  errors: ParseError[];
}

export function parseDocument(text: string): ParsedDocument {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, PARSE_OPTIONS);
  return { tree, errors };
}

export function nodeAt(tree: Node, path: JsonPath): Node | undefined {
  return findNodeAtLocation(tree, path);
}

export function pathOf(node: Node): JsonPath {
  return getNodePath(node);
}

export function valueOf(node: Node): unknown {
  return getNodeValue(node);
}

export interface PropertyEntry {
  key: string;
  keyNode: Node;
  valueNode: Node;
  propertyNode: Node;
}

/** Iterate the properties of an object node in source order. */
export function properties(objNode: Node): PropertyEntry[] {
  if (objNode.type !== 'object' || !objNode.children) return [];
  const out: PropertyEntry[] = [];
  for (const prop of objNode.children) {
    if (prop.type !== 'property' || !prop.children || prop.children.length < 1) continue;
    const keyNode = prop.children[0];
    const valueNode = prop.children[1];
    if (!keyNode || keyNode.type !== 'string') continue;
    if (!valueNode) continue;
    out.push({ key: String(keyNode.value), keyNode, valueNode, propertyNode: prop });
  }
  return out;
}

/**
 * Find a property by key. Exact match wins; with `caseInsensitive` a
 * differently-cased key is returned as a fallback.
 */
export function propertyNode(
  objNode: Node,
  key: string,
  caseInsensitive = true,
): PropertyEntry | undefined {
  let loose: PropertyEntry | undefined;
  const lower = key.toLowerCase();
  for (const p of properties(objNode)) {
    if (p.key === key) return p;
    if (caseInsensitive && !loose && p.key.toLowerCase() === lower) loose = p;
  }
  return loose;
}

export function arrayItems(arrNode: Node): Node[] {
  if (arrNode.type !== 'array' || !arrNode.children) return [];
  return arrNode.children;
}

/** Encode a JsonPath as an RFC 6901 pointer ("" for the root). */
export function pathToPointer(path: JsonPath): string {
  return path.map((seg) => '/' + String(seg).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

export function pointerToPath(pointer: string): JsonPath {
  if (pointer === '') return [];
  return pointer
    .split('/')
    .slice(1)
    .map((seg) => {
      const s = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      return /^\d+$/.test(s) ? Number(s) : s;
    });
}

// ---------------------------------------------------------------------------
// Line / column mapping (lazy per text)
// ---------------------------------------------------------------------------

export class LineIndex {
  private readonly starts: number[] = [0];
  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) this.starts.push(i + 1);
    }
  }

  /** 1-based line and column for an offset. */
  position(offset: number): { line: number; col: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - this.starts[lo]! + 1 };
  }

  lineStartOffset(offset: number): number {
    const { line } = this.position(offset);
    return this.starts[line - 1]!;
  }

  get lineCount(): number {
    return this.starts.length;
  }
}

const lineIndexCache = new WeakMap<object, LineIndex>();

/** Cache LineIndex per SourceFile-like holder so repeated lookups are cheap. */
export function lineIndexFor(holder: object, text: string): LineIndex {
  let li = lineIndexCache.get(holder);
  if (!li || (li as unknown as { text: string }).text !== text) {
    li = new LineIndex(text);
    lineIndexCache.set(holder, li);
  }
  return li;
}

export function rangeOf(node: Node, li: LineIndex): TextRange {
  const { line, col } = li.position(node.offset);
  return { offset: node.offset, length: node.length, line, col };
}
