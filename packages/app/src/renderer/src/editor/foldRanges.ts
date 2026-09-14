/**
 * Fold ranges for "Collapse all" in the source view.
 *
 * CodeMirror's own `foldAll` walks the document line by line and, after folding
 * a range, skips to its end. In a JSON file the first foldable range is the root
 * object, which spans the whole document, so `foldAll` folds exactly one thing:
 * the root. Re-opening the root then leaves nothing folded, which is why the
 * button looked dead. This walks the syntax tree instead and folds every
 * multi-line object and array, optionally leaving the root open.
 */
import { ensureSyntaxTree, foldedRanges, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface DocRange {
  from: number;
  to: number;
}

/** Every multi-line object/array as a fold range (inside the brackets), outermost first. */
export function foldAllRanges(
  state: EditorState,
  keepRoot: boolean,
  parseTimeoutMs = 3000,
): DocRange[] {
  // Make sure the whole document is parsed: the incremental parser normally
  // stops a little past the viewport, and folding needs every node.
  const tree = ensureSyntaxTree(state, state.doc.length, parseTimeoutMs) ?? syntaxTree(state);
  const doc = state.doc;
  const out: DocRange[] = [];
  let depth = 0;
  tree.iterate({
    enter(n) {
      depth++;
      if (n.name !== 'Object' && n.name !== 'Array') return;
      // depth 1 is the top node (JsonText), depth 2 the root value.
      if (keepRoot && depth === 2) return;
      const from = n.from + 1;
      const to = n.to - 1;
      if (to <= from) return;
      if (doc.lineAt(from).number >= doc.lineAt(to).number) return; // single line: nothing to hide
      out.push({ from, to });
    },
    leave() {
      depth--;
    },
  });
  return out;
}

/** Ranges from `foldAllRanges` that are not folded yet. */
export function unfoldedOnly(state: EditorState, ranges: DocRange[]): DocRange[] {
  const folded = foldedRanges(state);
  return ranges.filter((r) => {
    let hit = false;
    folded.between(r.from, r.to, (f, t) => {
      if (f === r.from && t === r.to) hit = true;
    });
    return !hit;
  });
}
