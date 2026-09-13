import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, StateEffect, StateField, type Range, type Text } from '@codemirror/state';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { parseTree, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { useEffect, useRef } from 'react';
import type { Diagnostic, TextRange } from '@shared/ipc';
import { registerSourceEditor } from '../editor/editorRegistry';

// ---------------------------------------------------------------------------
// Highlight decoration (problem navigation)
// ---------------------------------------------------------------------------

const setHighlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightMark = Decoration.mark({ class: 'cm-gtfo-highlight' });
const highlightLine = Decoration.line({ class: 'cm-gtfo-highlight-line' });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let d = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (!e.value) d = Decoration.none;
        else {
          const { from, to } = e.value;
          const ranges: Range<Decoration>[] = [];
          const doc = tr.state.doc;
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(Math.max(from, to - 1)).number;
          for (let l = startLine; l <= endLine; l++)
            ranges.push(highlightLine.range(doc.line(l).from));
          // Tint every line of the range, but outline only the first line's span so a
          // block-level problem does not box each line of a long block.
          const markTo = Math.min(to, doc.lineAt(from).to);
          if (markTo > from) ranges.push(highlightMark.range(from, markTo));
          d = Decoration.set(ranges, true);
        }
      }
    }
    // Typing clears the navigation highlight so it never points at stale text.
    if (tr.docChanged) d = Decoration.none;
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '12.5px', backgroundColor: '#15171b', color: '#d6d9df' },
    '.cm-scroller': {
      fontFamily: 'Consolas, "Cascadia Mono", "JetBrains Mono", monospace',
      lineHeight: '1.45',
    },
    '.cm-gutters': {
      backgroundColor: '#15171b',
      color: '#5b6270',
      borderRight: '1px solid #262a31',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: '#1e2229' },
    '.cm-gtfo-highlight': {
      backgroundColor: 'rgba(255, 196, 0, 0.18)',
      outline: '1px solid rgba(255,196,0,0.8)',
      borderRadius: '2px',
    },
    '.cm-gtfo-highlight-line': { backgroundColor: 'rgba(255, 196, 0, 0.07)' },
    '.cm-cursor': { borderLeftColor: '#d6d9df' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#2b3a55 !important',
    },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff6b6b' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #f5b942' },
    '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted #7fb4ff' },
    '.cm-tooltip': { backgroundColor: '#22262e', border: '1px solid #2b3039', color: '#d6d9df' },
    '.cm-panels': { backgroundColor: '#1b1e24', color: '#d6d9df' },
    '.cm-panels input, .cm-panels button': {
      color: '#d6d9df',
      background: '#22262e',
      border: '1px solid #2b3039',
    },
  },
  { dark: true },
);

// ---------------------------------------------------------------------------

export interface SourceEditorProps {
  fileId: string;
  /** The committed text held by main. */
  text: string;
  /** Problems for this file, mapped to lint markers while the editor is in sync. */
  diagnostics: Diagnostic[];
  highlight: TextRange | null;
  /** Bumps on every navigation so the editor scrolls even to the same range twice. */
  nonce: number;
  /** Commit a parseable draft. Resolve true when main accepted it. */
  onCommit(fileId: string, text: string, undoGroup: string): Promise<boolean>;
  /** Draft status for the status line / Save button. */
  onDraft(fileId: string, pending: boolean, parseErrors: number): void;
}

const COMMIT_DELAY_MS = 500;
const COMMIT_DELAY_LARGE_MS = 800;
const LARGE_FILE = 300_000;

function toCmDiagnostics(diags: Diagnostic[], doc: Text): CmDiagnostic[] {
  const docLength = doc.length;
  return diags
    .filter((d) => d.range)
    .map((d) => {
      const from = Math.min(d.range!.offset, docLength);
      // A block-level problem spans many lines; underline only its first line.
      const to = Math.min(
        d.range!.offset + Math.max(d.range!.length, 1),
        docLength,
        doc.lineAt(from).to,
      );
      return {
        from,
        to: Math.max(from, to),
        severity: d.severity,
        message: `${d.code}: ${d.message}`,
        source: 'validator',
      };
    });
}

function parseErrorDiagnostics(errors: ParseError[], docLength: number): CmDiagnostic[] {
  return errors.map((e) => ({
    from: Math.min(e.offset, docLength),
    to: Math.min(e.offset + Math.max(e.length, 1), docLength),
    severity: 'error' as const,
    message: `JSON: ${printParseErrorCode(e.error)}`,
    source: 'json',
  }));
}

/**
 * Editable JSONC source view. The editor owns the draft; parseable drafts are
 * committed to main after a pause, unparseable ones are marked locally and
 * never committed.
 */
export function SourceEditor(p: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Mutable editor bookkeeping (not React state: it must not cause renders).
  const st = useRef({
    fileId: p.fileId,
    docVersion: 0,
    committedVersion: 0,
    parseErrors: 0,
    applyingExternal: false,
    committing: false,
    undoGroup: newGroup(),
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    lastCommittedText: p.text,
  });
  const propsRef = useRef(p);
  propsRef.current = p;

  const pending = () => st.current.docVersion !== st.current.committedVersion;

  const notifyDraft = () =>
    propsRef.current.onDraft(st.current.fileId, pending(), st.current.parseErrors);

  const commit = async (): Promise<void> => {
    const v = view.current;
    const s = st.current;
    if (!v || s.committing || !pending() || s.parseErrors > 0) return;
    const text = v.state.doc.toString();
    const version = s.docVersion;
    s.committing = true;
    try {
      const ok = await propsRef.current.onCommit(s.fileId, text, s.undoGroup);
      if (ok) {
        s.lastCommittedText = text;
        if (s.docVersion === version) s.committedVersion = version;
        else s.committedVersion = version; // newer edits exist; they stay pending
      }
    } finally {
      s.committing = false;
      notifyDraft();
      if (pending() && s.parseErrors === 0) schedule();
    }
  };

  const schedule = () => {
    const s = st.current;
    if (s.timer) clearTimeout(s.timer);
    const len = view.current?.state.doc.length ?? 0;
    s.timer = setTimeout(
      () => void commit(),
      len > LARGE_FILE ? COMMIT_DELAY_LARGE_MS : COMMIT_DELAY_MS,
    );
  };

  // Mount once.
  useEffect(() => {
    if (!host.current) return;
    const listener = EditorView.updateListener.of((u) => {
      if (!u.docChanged || st.current.applyingExternal) return;
      const s = st.current;
      s.docVersion++;
      const errors: ParseError[] = [];
      parseTree(u.state.doc.toString(), errors, {
        allowTrailingComma: true,
        disallowComments: false,
      });
      s.parseErrors = errors.length;
      if (errors.length) {
        if (s.timer) clearTimeout(s.timer);
        u.view.dispatch(setDiagnostics(u.state, parseErrorDiagnostics(errors, u.state.doc.length)));
      } else schedule();
      notifyDraft();
    });
    const state = EditorState.create({
      doc: p.text,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        json(),
        syntaxHighlighting(oneDarkHighlightStyle),
        lintGutter(),
        highlightField,
        theme,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        listener,
        EditorView.domEventHandlers({ blur: () => void commit() }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    v.dispatch(setDiagnostics(v.state, toCmDiagnostics(p.diagnostics, v.state.doc)));
    const unregister = registerSourceEditor({
      get fileId() {
        return st.current.fileId;
      },
      flush: async () => {
        if (st.current.timer) clearTimeout(st.current.timer);
        await commit();
      },
      undo: () => undo(v),
      redo: () => redo(v),
      hasFocus: () => v.hasFocus,
      pending,
      parseErrors: () => st.current.parseErrors,
      debugReplace: (find, replace) => {
        const i = v.state.doc.toString().indexOf(find);
        if (i < 0) return false;
        v.dispatch({
          changes: { from: i, to: i + find.length, insert: replace },
          userEvent: 'input',
        });
        return true;
      },
    });
    return () => {
      unregister();
      if (st.current.timer) clearTimeout(st.current.timer);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // File switch or committed text changed elsewhere (form edit, undo, reload): replace the doc when in sync.
  useEffect(() => {
    const v = view.current;
    const s = st.current;
    if (!v) return;
    const switched = p.fileId !== s.fileId;
    if (!switched && (pending() || p.text === v.state.doc.toString())) {
      s.lastCommittedText = p.text;
      return;
    }
    s.applyingExternal = true;
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: p.text } });
    } finally {
      s.applyingExternal = false;
    }
    s.fileId = p.fileId;
    s.lastCommittedText = p.text;
    s.parseErrors = 0;
    s.committedVersion = s.docVersion; // in sync again
    s.undoGroup = newGroup();
    v.dispatch(setDiagnostics(v.state, toCmDiagnostics(p.diagnostics, v.state.doc)));
    notifyDraft();
  }, [p.fileId, p.text]);

  // Fresh validator results: show them when the doc is what main validated.
  useEffect(() => {
    const v = view.current;
    if (!v || pending()) return;
    v.dispatch(setDiagnostics(v.state, toCmDiagnostics(p.diagnostics, v.state.doc)));
  }, [p.diagnostics]);

  // Navigation: highlight + scroll.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (!p.highlight) {
      v.dispatch({ effects: setHighlight.of(null) });
      return;
    }
    const from = Math.min(p.highlight.offset, v.state.doc.length);
    const to = Math.min(p.highlight.offset + p.highlight.length, v.state.doc.length);
    v.dispatch({
      effects: [
        setHighlight.of({ from, to }),
        EditorView.scrollIntoView(from, { y: 'start', yMargin: 48 }),
      ],
    });
  }, [p.nonce]);

  return <div className="rawview" ref={host} />;
}

function newGroup(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
