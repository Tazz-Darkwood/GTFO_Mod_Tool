/**
 * Pure text-level edit builders. Given the current text + parsed tree, produce
 * minimal `{offset, length, content}` edits for one EditOp so everything the
 * user did not touch (comments, blank lines, key order, odd indentation) survives.
 */
import { applyEdits, type Edit } from 'jsonc-parser';
import type { EditOp, JsonPath, TextStyle } from '../model/types.js';
import { nodeAt, properties, type Node } from '../text/jsoncDoc.js';
import {
  formatScalar,
  formatValueBlock,
  isScalarLike,
  type ScalarFormatContext,
} from '../text/scalarFormat.js';
import { lineIndentAt } from '../text/textStyle.js';

export type TextEdit = Edit;

export interface BuildEditContext extends ScalarFormatContext {
  style: TextStyle;
}

export class EditError extends Error {}

/** Whitespace unit between a container and its children, inferred locally, else from file style. */
function childIndentUnit(text: string, container: Node, style: TextStyle): string {
  const first = container.children?.[0];
  const parentIndent = lineIndentAt(text, container.offset);
  if (first) {
    const childIndent = lineIndentAt(text, first.offset);
    if (childIndent.length > parentIndent.length && childIndent.startsWith(parentIndent))
      return childIndent.slice(parentIndent.length);
  }
  return style.indentUnit ?? '  ';
}

function isOnOwnLine(text: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
  return i < 0 || text[i] === '\n';
}

/** Offset just after the comma that follows `node`, or undefined if no comma follows (skipping whitespace/comments is not attempted). */
function commaAfter(text: string, node: Node): number | undefined {
  let i = node.offset + node.length;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text[i] === ',' ? i + 1 : undefined;
}

/**
 * Insert a new entry (property or array item) into a container node, keeping
 * one entry per line and matching the neighbours' indentation.
 * `entryText` is the full text of the entry (e.g. `"key": 1` or `{ ... }`), single- or multi-line.
 */
function insertEntry(
  text: string,
  container: Node,
  index: number | undefined,
  entryText: string,
): TextEdit[] {
  const children = container.children ?? [];
  const closeOffset = container.offset + container.length - 1; // the } or ]
  const parentIndent = lineIndentAt(text, container.offset);

  if (children.length === 0) {
    const unit = childIndentUnit(text, container, { eol: '\n', bom: false, indentUnit: null });
    const inner = `\n${parentIndent}${unit}${entryText}\n${parentIndent}`;
    return [
      { offset: container.offset + 1, length: closeOffset - container.offset - 1, content: inner },
    ];
  }

  const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
  const indent = lineIndentAt(text, children[Math.min(at, children.length - 1)]!.offset);
  const multiLine = isOnOwnLine(text, children[0]!.offset);

  if (at < children.length) {
    const target = children[at]!;
    const sep = multiLine ? `,\n${indent}` : ', ';
    return [{ offset: target.offset, length: 0, content: `${entryText}${sep}` }];
  }

  // Append after the last entry.
  const last = children[children.length - 1]!;
  const edits: TextEdit[] = [];
  const comma = commaAfter(text, last);
  if (comma === undefined)
    edits.push({ offset: last.offset + last.length, length: 0, content: ',' });
  if (multiLine && isOnOwnLine(text, closeOffset)) {
    // Put the new entry on its own line right before the closing bracket's line.
    let lineStart = closeOffset;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    edits.push({ offset: lineStart, length: 0, content: `${indent}${entryText}\n` });
  } else {
    const anchor = comma ?? last.offset + last.length + (comma === undefined ? 0 : 0);
    const insertAt = comma ?? last.offset + last.length;
    edits.push({
      offset: insertAt,
      length: 0,
      content: multiLine ? `\n${indent}${entryText}` : ` ${entryText}`,
    });
    void anchor;
  }
  return edits;
}

function propertyEntryText(
  text: string,
  container: Node,
  key: string,
  value: unknown,
  ctx: BuildEditContext,
): string {
  const unit = childIndentUnit(text, container, ctx.style);
  const indent = lineIndentAt(text, (container.children?.[0] ?? container).offset);
  const valueText = isScalarLike(value)
    ? formatScalar(value, undefined, ctx)
    : formatValueBlock(value, unit, indent);
  return `${JSON.stringify(key)}: ${valueText}`;
}

/**
 * Build the text edits for `op` applied at `basePath` (path of the block or file root).
 * Throws EditError when the target does not exist or has the wrong shape.
 */
export function buildEdits(
  text: string,
  tree: Node,
  basePath: JsonPath,
  op: EditOp,
  ctx: BuildEditContext,
): TextEdit[] {
  const full = [...basePath, ...op.path];
  switch (op.op) {
    case 'set': {
      const node = nodeAt(tree, full);
      if (!node) {
        // Missing leaf: create it on the parent.
        const key = full[full.length - 1];
        const parent = nodeAt(tree, full.slice(0, -1));
        if (!parent) throw new EditError(`Path ${full.join('.')} does not exist`);
        if (parent.type === 'object' && typeof key === 'string') {
          return insertEntry(
            text,
            parent,
            undefined,
            propertyEntryText(text, parent, key, op.value, ctx),
          );
        }
        if (parent.type === 'array' && typeof key === 'number') {
          return buildEdits(
            text,
            tree,
            [],
            { op: 'insert', path: full.slice(0, -1), index: key, value: op.value },
            ctx,
          );
        }
        throw new EditError(`Cannot set ${full.join('.')}`);
      }
      const original = text.slice(node.offset, node.offset + node.length);
      if (isScalarLike(op.value) && node.type !== 'object' && node.type !== 'array') {
        return [
          {
            offset: node.offset,
            length: node.length,
            content: formatScalar(op.value, original, ctx),
          },
        ];
      }
      if (isScalarLike(op.value)) {
        return [
          {
            offset: node.offset,
            length: node.length,
            content: formatScalar(op.value, undefined, ctx),
          },
        ];
      }
      const parent = nodeAt(tree, full.slice(0, -1)) ?? tree;
      const unit = childIndentUnit(text, node.children?.length ? node : parent, ctx.style);
      return [
        {
          offset: node.offset,
          length: node.length,
          content: formatValueBlock(op.value, unit, lineIndentAt(text, node.offset)),
        },
      ];
    }
    case 'setProperty': {
      const obj = nodeAt(tree, full);
      if (!obj || obj.type !== 'object')
        throw new EditError(`${full.join('.') || 'root'} is not an object`);
      const existing = properties(obj).find((p) => p.key === op.key);
      if (existing)
        return buildEdits(
          text,
          tree,
          [],
          { op: 'set', path: [...full, op.key], value: op.value },
          ctx,
        );
      return insertEntry(text, obj, undefined, propertyEntryText(text, obj, op.key, op.value, ctx));
    }
    case 'insert': {
      const arr = nodeAt(tree, full);
      if (!arr || arr.type !== 'array')
        throw new EditError(`${full.join('.') || 'root'} is not an array`);
      const unit = childIndentUnit(text, arr, ctx.style);
      const indent =
        lineIndentAt(text, (arr.children?.[0] ?? arr).offset) ||
        lineIndentAt(text, arr.offset) + unit;
      const valueText = isScalarLike(op.value)
        ? formatScalar(op.value, undefined, ctx)
        : formatValueBlock(op.value, unit, indent);
      return insertEntry(text, arr, op.index, valueText);
    }
    case 'insertRaw': {
      const arr = nodeAt(tree, full);
      if (!arr || arr.type !== 'array')
        throw new EditError(`${full.join('.') || 'root'} is not an array`);
      const unit = childIndentUnit(text, arr, ctx.style);
      const indent = arr.children?.[0]
        ? lineIndentAt(text, arr.children[0].offset)
        : lineIndentAt(text, arr.offset) + unit;
      return insertEntry(text, arr, op.index, reindentSnippet(op.text, indent));
    }
    case 'setRaw': {
      const node = nodeAt(tree, full);
      if (!node) throw new EditError(`Path ${full.join('.')} does not exist`);
      return [
        {
          offset: node.offset,
          length: node.length,
          content: reindentSnippet(op.text, lineIndentAt(text, node.offset)),
        },
      ];
    }
    case 'remove': {
      const valueNode = nodeAt(tree, full);
      if (!valueNode) throw new EditError(`Path ${full.join('.')} does not exist`);
      // For object members remove the whole property (key + value), not just the value.
      const node = valueNode.parent?.type === 'property' ? valueNode.parent : valueNode;
      const container = node.parent;
      if (!container || !container.children) throw new EditError('Cannot remove the document root');
      return removeEntry(text, container, node);
    }
  }
}

/** Remove one entry from its container, tidying the comma but leaving neighbours' comments alone. */
function removeEntry(text: string, container: Node, node: Node): TextEdit[] {
  const children = container.children!;
  const idx = children.indexOf(node);
  const start = node.offset;
  const end = node.offset + node.length;
  if (children.length === 1) {
    const closeOffset = container.offset + container.length - 1;
    return [
      { offset: container.offset + 1, length: closeOffset - container.offset - 1, content: '' },
    ];
  }
  if (idx < children.length - 1) {
    // Middle entry: delete up to the start of the next entry (takes the comma and whitespace with it).
    const next = children[idx + 1]!;
    return [{ offset: start, length: next.offset - start, content: '' }];
  }
  // Last entry: drop the comma after the previous entry, then the entry's own line(s).
  const prev = children[idx - 1]!;
  const edits: TextEdit[] = [];
  const comma = commaAfter(text, prev);
  if (comma !== undefined) edits.push({ offset: comma - 1, length: 1, content: '' });
  let from = start;
  let to = end;
  if (isOnOwnLine(text, start)) {
    while (from > 0 && text[from - 1] !== '\n') from--; // include the indentation
    let j = to;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
    if (text[j] === ',') j++;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
    if (text[j] === '\n')
      to = j + 1; // the whole line is gone, including its newline
    else if (j > to && text[j - 1] === ',') to = j; // inline trailing comma
  } else {
    // Shares a line with the previous entry: remove from the comma to the entry end.
    from = comma !== undefined ? comma - 1 : prev.offset + prev.length;
    edits.length = 0;
  }
  edits.push({ offset: from, length: to - from, content: '' });
  return edits;
}

export function applyTextEdits(text: string, edits: TextEdit[]): string {
  return applyEdits(text, edits);
}

/**
 * Re-indent a multi-line JSONC snippet so that its first line starts at the
 * insertion point (no indent) and every following line is offset by
 * `targetIndent` relative to the snippet's own base indentation.
 */
export function reindentSnippet(snippet: string, targetIndent: string): string {
  const lines = snippet.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length === 1) return lines[0]!;
  // Base indent = smallest leading whitespace among non-empty continuation lines.
  let base: string | undefined;
  for (const l of lines.slice(1)) {
    if (l.trim() === '') continue;
    const ws = /^[ \t]*/.exec(l)![0];
    if (base === undefined || ws.length < base.length) base = ws;
  }
  // The closing bracket line is typically indented one level less than the body; it defines the base.
  const b = base ?? '';
  return lines
    .map((l, i) => {
      if (i === 0) return l.trimStart();
      if (l.trim() === '') return '';
      return targetIndent + (l.startsWith(b) ? l.slice(b.length) : l.trimStart());
    })
    .join('\n');
}
