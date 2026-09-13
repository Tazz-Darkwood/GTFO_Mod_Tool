import { create } from 'zustand';
import type {
  BlockDetailDto,
  BlockSummaryDto,
  CreateBlockRequestDto,
  Diagnostic,
  DiagnosticFix,
  EditOp,
  FileDto,
  ProjectSummaryDto,
  ReferencesDto,
  TextRange,
} from '@shared/ipc';
import { api } from './api';
import { sourceEditor } from './editor/editorRegistry';

export type Severity = 'error' | 'warning' | 'info';
export type MainView = 'welcome' | 'block' | 'file';
export type SidebarTab = 'types' | 'files';

export interface RawTarget {
  fileId: string;
  text: string;
  highlight: TextRange | null;
  /** Bumps on every navigation so the source view scrolls even to the same range twice. */
  nonce: number;
}

/** Identity of the selected block that survives path-based id changes. */
export interface SelectedKey {
  file: string;
  type?: string;
  persistentID?: number;
}

export type Dialog =
  | {
      kind: 'newBlock';
      type?: string;
      source?: CreateBlockRequestDto['source'];
      targetFile?: string;
      name?: string;
    }
  | { kind: 'deleteBlock'; blockId: string }
  | { kind: 'newFile'; folder?: string; then?: 'newBlock' }
  | { kind: 'deleteFile'; fileId: string };

interface State {
  summary: ProjectSummaryDto | null;
  files: FileDto[];
  loading: string | null;
  toast: { kind: 'info' | 'error'; text: string } | null;

  sidebarTab: SidebarTab;
  fileFilter: string;

  selectedType: string | null;
  showAllTypes: boolean;
  blockQuery: string;
  blocks: BlockSummaryDto[];
  blocksTotal: number;

  selectedBlockId: string | null;
  selectedKey: SelectedKey | null;
  block: BlockDetailDto | null;
  raw: RawTarget | null;
  view: MainView;
  blockMode: 'form' | 'raw';
  focusPointer: string | null;
  /** Draft state of the source editor: unsaved-to-main text and local JSON errors. */
  sourceDraft: { fileId: string; pending: boolean; parseErrors: number } | null;
  references: ReferencesDto | null;
  dialog: Dialog | null;

  diagnostics: Diagnostic[];
  severityFilter: Record<Severity, boolean>;
  codeFilter: string | null;
  problemsOpen: boolean;

  // --- project
  openFolder(): Promise<void>;
  openPath(root: string): Promise<void>;
  closeProject(): Promise<void>;
  refreshProject(): Promise<void>;
  reloadLists(): Promise<void>;
  // --- navigation
  setSidebarTab(t: SidebarTab): void;
  setFileFilter(q: string): void;
  selectType(type: string | null): Promise<void>;
  setShowAllTypes(v: boolean): void;
  setBlockQuery(q: string): Promise<void>;
  selectBlock(blockId: string | null): Promise<void>;
  openFile(fileId: string, highlight?: TextRange): Promise<void>;
  navigateDiagnostic(d: Diagnostic): Promise<void>;
  setBlockMode(m: 'form' | 'raw'): Promise<void>;
  toggleSeverity(s: Severity): void;
  setCodeFilter(code: string | null): void;
  setProblemsOpen(v: boolean): void;
  // --- editing
  flushSource(): Promise<void>;
  commitSourceText(fileId: string, text: string, undoGroup: string): Promise<boolean>;
  setSourceDraft(fileId: string, pending: boolean, parseErrors: number): void;
  applyEdit(op: EditOp): Promise<boolean>;
  applyMany(ops: EditOp[]): Promise<boolean>;
  applyFix(fix: DiagnosticFix): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  save(fileId?: string): Promise<void>;
  saveAll(): Promise<void>;
  revert(fileId: string): Promise<void>;
  openExternal(fileId: string, line?: number): Promise<void>;
  // --- CRUD
  openDialog(d: Dialog): void;
  closeDialog(): void;
  createBlock(req: CreateBlockRequestDto): Promise<boolean>;
  deleteBlock(blockId: string): Promise<boolean>;
  loadReferences(): Promise<void>;
  createFile(req: { path: string; kind: 'partial-array' | 'wrapper' }): Promise<FileDto | null>;
  deleteFile(fileId: string): Promise<boolean>;
  showToast(kind: 'info' | 'error', text: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function keyOf(b: BlockDetailDto | BlockSummaryDto): SelectedKey {
  return { file: b.file, type: b.type, persistentID: b.persistentID };
}

export const useStore = create<State>((set, get) => ({
  summary: null,
  files: [],
  loading: null,
  toast: null,
  sidebarTab: 'types',
  fileFilter: '',
  selectedType: null,
  showAllTypes: false,
  blockQuery: '',
  blocks: [],
  blocksTotal: 0,
  selectedBlockId: null,
  selectedKey: null,
  block: null,
  raw: null,
  view: 'welcome',
  blockMode: 'form',
  focusPointer: null,
  sourceDraft: null,
  references: null,
  dialog: null,
  diagnostics: [],
  severityFilter: { error: true, warning: true, info: false },
  codeFilter: null,
  problemsOpen: true,

  showToast(kind, text) {
    set({ toast: { kind, text } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 8000 : 3500);
  },

  // ---------------------------------------------------------------------------
  // Project
  // ---------------------------------------------------------------------------

  async openFolder() {
    const root = await api.invoke('dialog:pickFolder');
    if (root) await get().openPath(root);
  },

  async openPath(root) {
    await get().flushSource();
    set({ loading: `Opening ${root}…` });
    try {
      const summary = await api.invoke('project:open', root);
      set({
        summary,
        view: 'welcome',
        selectedType: null,
        selectedBlockId: null,
        selectedKey: null,
        block: null,
        raw: null,
        blockQuery: '',
        sourceDraft: null,
        references: null,
        dialog: null,
      });
      await get().reloadLists();
      const first =
        summary.types.find((t) => t.problems > 0) ?? summary.types.find((t) => t.count > 0);
      if (first) await get().selectType(first.type);
      else set({ sidebarTab: 'files' });
      get().showToast('info', `Opened ${summary.blockCount} blocks in ${summary.fileCount} files`);
    } catch (e) {
      get().showToast('error', (e as Error).message);
    } finally {
      set({ loading: null });
    }
  },

  async closeProject() {
    await get().flushSource();
    await api.invoke('project:close');
    set({
      summary: null,
      files: [],
      blocks: [],
      blocksTotal: 0,
      selectedType: null,
      selectedBlockId: null,
      selectedKey: null,
      block: null,
      raw: null,
      diagnostics: [],
      view: 'welcome',
      sourceDraft: null,
      references: null,
      dialog: null,
    });
  },

  async refreshProject() {
    const s = get().summary;
    if (!s) return;
    await get().flushSource();
    const dirty = get().summary?.dirtyFiles.length ?? 0;
    if (dirty && !confirm(`Reload from disk and discard unsaved changes in ${dirty} file(s)?`))
      return;
    await get().openPath(s.root);
  },

  async reloadLists() {
    const [files, diagnostics] = await Promise.all([
      api.invoke('files:list'),
      api.invoke('diagnostics:list'),
    ]);
    set({ files, diagnostics });
    const { selectedType, blockQuery } = get();
    if (selectedType || blockQuery) {
      const page = await api.invoke('blocks:list', {
        type: selectedType ?? undefined,
        query: blockQuery,
        limit: 2000,
      });
      set({ blocks: page.items, blocksTotal: page.total });
    }
    // Re-locate the selected block: its path-based id may have shifted after a structural change.
    const key = get().selectedKey;
    if (key && get().view === 'block') {
      let block = get().selectedBlockId
        ? await api.invoke('blocks:get', get().selectedBlockId!)
        : null;
      if (
        !block ||
        block.file !== key.file ||
        block.persistentID !== key.persistentID ||
        block.type !== key.type
      ) {
        const located =
          key.persistentID !== undefined
            ? await api.invoke('blocks:locate', {
                file: key.file,
                type: key.type,
                persistentID: key.persistentID,
              })
            : null;
        block = located ? await api.invoke('blocks:get', located.blockId) : null;
        if (!block) {
          set({ selectedBlockId: null, block: null, view: get().raw ? 'file' : 'welcome' });
          get().showToast(
            'info',
            `Block ${key.type ?? ''} #${key.persistentID ?? ''} is no longer in ${key.file}`,
          );
        } else set({ selectedBlockId: block.blockId });
      }
      if (block) set({ block });
    }
    const raw = get().raw;
    if (raw && get().files.some((f) => f.id === raw.fileId)) {
      const draft = get().sourceDraft;
      const drafting = draft && draft.fileId === raw.fileId && draft.pending;
      if (!drafting) {
        const text = await api.invoke('file:getText', raw.fileId);
        if (text !== raw.text)
          set({
            raw: {
              ...raw,
              text,
              highlight:
                get().block && get().block!.file === raw.fileId
                  ? get().block!.range
                  : raw.highlight,
            },
          });
      }
    } else if (raw) {
      // The file is gone (deleted); leave the editor.
      set({ raw: null, view: 'welcome', selectedBlockId: null, block: null, selectedKey: null });
    }
  },

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  setSidebarTab(t) {
    set({ sidebarTab: t });
  },
  setFileFilter(q) {
    set({ fileFilter: q });
  },

  async selectType(type) {
    set({ selectedType: type, sidebarTab: 'types' });
    const page = await api.invoke('blocks:list', {
      type: type ?? undefined,
      query: get().blockQuery,
      limit: 2000,
    });
    set({ blocks: page.items, blocksTotal: page.total });
  },

  setShowAllTypes(v) {
    set({ showAllTypes: v });
  },

  async setBlockQuery(q) {
    set({ blockQuery: q });
    const page = await api.invoke('blocks:list', {
      type: get().selectedType ?? undefined,
      query: q,
      limit: 2000,
    });
    set({ blocks: page.items, blocksTotal: page.total });
  },

  async selectBlock(blockId) {
    await get().flushSource();
    if (!blockId) {
      set({ selectedBlockId: null, selectedKey: null, block: null, references: null });
      return;
    }
    const block = await api.invoke('blocks:get', blockId);
    if (!block) return;
    const text = await api.invoke('file:getText', block.file);
    const nonce = (get().raw?.nonce ?? 0) + 1;
    set({
      selectedBlockId: blockId,
      selectedKey: keyOf(block),
      block,
      view: 'block',
      focusPointer: blockId === get().selectedBlockId ? get().focusPointer : null,
      raw: { fileId: block.file, text, highlight: block.range, nonce },
      // Plugin/meta content has no schema form.
      blockMode:
        block.plugin || block.fileShape === 'plugin' || !block.type ? 'raw' : get().blockMode,
      references: null,
    });
    void get().loadReferences();
    if (block.type && block.type !== get().selectedType) await get().selectType(block.type);
  },

  async openFile(fileId, highlight) {
    await get().flushSource();
    const text = await api.invoke('file:getText', fileId);
    const nonce = (get().raw?.nonce ?? 0) + 1;
    set({
      view: 'file',
      selectedBlockId: null,
      selectedKey: null,
      block: null,
      references: null,
      raw: { fileId, text, highlight: highlight ?? null, nonce },
    });
  },

  async navigateDiagnostic(d) {
    if (d.blockId) {
      await get().selectBlock(d.blockId);
      const raw = get().raw;
      const block = get().block;
      const rel = block && d.jsonPath ? d.jsonPath.slice(block.path.length) : null;
      const focusPointer = rel
        ? rel.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('')
        : null;
      set({
        raw: raw && d.range ? { ...raw, highlight: d.range, nonce: raw.nonce + 1 } : raw,
        focusPointer,
        blockMode: !block?.type || !rel || rel.length === 0 ? 'raw' : get().blockMode,
      });
      return;
    }
    await get().openFile(d.file, d.range);
  },

  async setBlockMode(m) {
    await get().flushSource();
    set({ blockMode: m });
  },
  toggleSeverity(s) {
    set((st) => ({ severityFilter: { ...st.severityFilter, [s]: !st.severityFilter[s] } }));
  },
  setCodeFilter(code) {
    set({ codeFilter: code });
  },
  setProblemsOpen(v) {
    set({ problemsOpen: v });
  },

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  async flushSource() {
    const ed = sourceEditor();
    if (ed) await ed.flush();
  },

  setSourceDraft(fileId, pending, parseErrors) {
    const cur = get().sourceDraft;
    if (cur && cur.fileId === fileId && cur.pending === pending && cur.parseErrors === parseErrors)
      return;
    set({ sourceDraft: pending || parseErrors ? { fileId, pending, parseErrors } : null });
  },

  async commitSourceText(fileId, text, undoGroup) {
    const r = await api.invoke('file:setText', fileId, text, { undoGroup });
    if (!r.ok) {
      if (!r.parseErrors) get().showToast('error', r.error);
      return false;
    }
    const raw = get().raw;
    set({ summary: r.summary, raw: raw && raw.fileId === fileId ? { ...raw, text } : raw });
    await get().reloadLists();
    return true;
  },

  async applyEdit(op) {
    await get().flushSource();
    const { block } = get();
    if (!block) return false;
    const r = await api.invoke('edit:apply', { file: block.file, blockId: block.blockId }, op);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    set({ summary: r.summary });
    await get().reloadLists();
    return true;
  },

  async applyMany(ops) {
    await get().flushSource();
    const { block } = get();
    if (!block) return false;
    const r = await api.invoke('edit:applyMany', { file: block.file, blockId: block.blockId }, ops);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    set({ summary: r.summary });
    await get().reloadLists();
    return true;
  },

  async applyFix(fix) {
    await get().flushSource();
    const r = await api.invoke('edit:applyFix', fix);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    set({ summary: r.summary });
    await get().reloadLists();
    get().showToast('info', `Applied: ${fix.title}`);
    return true;
  },

  async undo() {
    const ed = sourceEditor();
    const inSource = ed && (get().view === 'file' || get().blockMode === 'raw');
    if (inSource && ed.undo()) return;
    if (inSource) await ed.flush();
    const fileId = get().block?.file ?? get().raw?.fileId;
    if (!fileId) return;
    const r = await api.invoke('edit:undo', fileId);
    if (r && r.ok) {
      set({ summary: r.summary });
      await get().reloadLists();
    }
  },

  async redo() {
    const ed = sourceEditor();
    const inSource = ed && (get().view === 'file' || get().blockMode === 'raw');
    if (inSource && ed.redo()) return;
    const fileId = get().block?.file ?? get().raw?.fileId;
    if (!fileId) return;
    const r = await api.invoke('edit:redo', fileId);
    if (r && r.ok) {
      set({ summary: r.summary });
      await get().reloadLists();
    }
  },

  async save(fileId) {
    const id = fileId ?? get().block?.file ?? get().raw?.fileId;
    if (!id) return;
    const draft = get().sourceDraft;
    if (draft && draft.fileId === id && draft.parseErrors > 0) {
      get().showToast('error', `Fix the JSON first: ${draft.parseErrors} syntax error(s) in ${id}`);
      return;
    }
    await get().flushSource();
    let r = await api.invoke('file:save', id);
    if (!r.ok && r.reason === 'conflict') {
      const overwrite = confirm(
        `${id} was changed on disk by another program since you opened it.\n\nOK = overwrite the disk copy with your version\nCancel = keep the disk copy (your edits stay unsaved)`,
      );
      if (overwrite) r = await api.invoke('file:save', id, true);
      else return;
    }
    if (r.ok) get().showToast('info', `Saved ${id}`);
    else
      get().showToast(
        'error',
        `Could not save ${id}: ${r.reason}${r.message ? ' — ' + r.message : ''}`,
      );
    const summary = await api.invoke('project:summary');
    if (summary) set({ summary });
    await get().reloadLists();
  },

  async saveAll() {
    const draft = get().sourceDraft;
    if (draft && draft.parseErrors > 0) {
      get().showToast(
        'error',
        `Fix the JSON first: ${draft.parseErrors} syntax error(s) in ${draft.fileId}`,
      );
      return;
    }
    await get().flushSource();
    const r = await api.invoke('file:saveAll');
    if (r.conflicts.length)
      get().showToast(
        'error',
        `Saved ${r.saved.length}; ${r.conflicts.length} file(s) changed on disk and were skipped: ${r.conflicts.join(', ')}`,
      );
    else get().showToast('info', `Saved ${r.saved.length} file(s)`);
    const summary = await api.invoke('project:summary');
    if (summary) set({ summary });
    await get().reloadLists();
  },

  async revert(fileId) {
    if (!confirm(`Discard your unsaved changes to ${fileId}?`)) return;
    // Drop the draft too: a revert means "back to disk".
    set({ sourceDraft: null });
    await api.invoke('file:revert', fileId);
    const summary = await api.invoke('project:summary');
    if (summary) set({ summary });
    await get().reloadLists();
  },

  async openExternal(fileId, line) {
    await get().flushSource();
    await api.invoke('file:openExternal', fileId, line);
  },

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  openDialog(d) {
    set({ dialog: d });
  },
  closeDialog() {
    set({ dialog: null });
  },

  async createBlock(req) {
    await get().flushSource();
    const r = await api.invoke('blocks:create', req);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    set({ summary: r.summary, dialog: null });
    await get().reloadLists();
    if (get().selectedType !== req.type) await get().selectType(req.type);
    await get().selectBlock(r.blockId);
    set({ blockMode: 'form' });
    get().showToast('info', `Created ${req.type} #${req.persistentID}`);
    return true;
  },

  async deleteBlock(blockId) {
    await get().flushSource();
    const wasSelected = get().selectedBlockId === blockId;
    const list = get().blocks;
    const idx = list.findIndex((b) => b.blockId === blockId);
    const r = await api.invoke('blocks:delete', blockId);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    set({ summary: r.summary, dialog: null });
    if (wasSelected)
      set({ selectedBlockId: null, selectedKey: null, block: null, references: null });
    await get().reloadLists();
    if (wasSelected) {
      const next = get().blocks[Math.min(idx, get().blocks.length - 1)];
      if (next) await get().selectBlock(next.blockId);
      else set({ view: get().raw ? 'file' : 'welcome' });
    }
    get().showToast('info', 'Block deleted (Ctrl+Z to undo)');
    return true;
  },

  async loadReferences() {
    const b = get().block;
    if (!b?.type || b.persistentID === undefined) {
      set({ references: null });
      return;
    }
    const refs = await api.invoke('blocks:references', { type: b.type, id: b.persistentID });
    if (get().block?.blockId === b.blockId) set({ references: refs });
  },

  async createFile(req) {
    await get().flushSource();
    const r = await api.invoke('files:create', req);
    if (!r.ok) {
      get().showToast('error', r.error);
      return null;
    }
    set({ summary: r.summary });
    await get().reloadLists();
    get().showToast('info', `Created ${r.file.id}`);
    return r.file;
  },

  async deleteFile(fileId) {
    await get().flushSource();
    const r = await api.invoke('files:delete', fileId);
    if (!r.ok) {
      get().showToast('error', r.error);
      return false;
    }
    if (get().raw?.fileId === fileId)
      set({
        raw: null,
        view: 'welcome',
        selectedBlockId: null,
        selectedKey: null,
        block: null,
        references: null,
        sourceDraft: null,
      });
    set({ summary: r.summary, dialog: null });
    await get().reloadLists();
    get().showToast('info', `Deleted ${fileId}`);
    return true;
  },
}));

/** Subscribe to main-process pushes once. */
export function wireEvents(): void {
  api.on('project:changed', (summary) => {
    useStore.setState({ summary });
    void useStore.getState().reloadLists();
  });
  api.on('file:externalChange', ({ fileId, wasDirty }) => {
    const st = useStore.getState();
    const draft = st.sourceDraft;
    if (draft && draft.fileId === fileId && draft.pending) {
      st.showToast(
        'error',
        `${fileId} changed on disk while you were editing it. Your draft is kept; Save will ask before overwriting, Reload discards it.`,
      );
      return;
    }
    st.showToast(
      wasDirty ? 'error' : 'info',
      wasDirty
        ? `${fileId} changed on disk while you have unsaved edits. Save (overwrite) or revert.`
        : `${fileId} changed on disk and was reloaded.`,
    );
  });
  api.on('project:error', ({ message }) => useStore.getState().showToast('error', message));
  // Unattended-check hooks set by the main process (GTFO_OPEN, GTFO_NAV_CODE, GTFO_AUTO_FIX).
  const w = window as unknown as {
    __gtfoAutoOpen?: string;
    __gtfoAutoNav?: string | null;
    __gtfoAutoFix?: string | null;
    /** "find=>replace" typed into the source editor after navigation (GTFO_AUTO_EDIT). */
    __gtfoAutoEdit?: string | null;
  };
  const tryAuto = () => {
    if (!w.__gtfoAutoOpen) return;
    const root = w.__gtfoAutoOpen;
    w.__gtfoAutoOpen = undefined;
    void useStore
      .getState()
      .openPath(root)
      .then(async () => {
        const fixCode = w.__gtfoAutoFix;
        if (fixCode) {
          const d = useStore.getState().diagnostics.find((x) => x.code === fixCode && x.fix);
          if (d) await useStore.getState().applyFix(d.fix!);
        }
        const code = w.__gtfoAutoNav;
        if (code) {
          if (code.startsWith('file:')) {
            await useStore.getState().openFile(code.slice(5));
            useStore.getState().setSidebarTab('files');
          } else {
            const d = useStore.getState().diagnostics.find((x) => x.code === code);
            if (d) await useStore.getState().navigateDiagnostic(d);
            await useStore.getState().setBlockMode('raw');
          }
        }
        const edit = w.__gtfoAutoEdit;
        if (edit) {
          const [find, replace] = edit.split('=>');
          // Give the editor a moment to mount, then type.
          setTimeout(() => {
            const ok = sourceEditor()?.debugReplace(find ?? '', replace ?? '');
            console.log(`[auto-edit] ${ok ? 'applied' : 'text not found'}: ${edit}`);
          }, 800);
        }
      });
  };
  window.addEventListener('gtfo-auto-open', tryAuto);
  tryAuto();
}
