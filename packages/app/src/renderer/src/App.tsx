import { useEffect } from 'react';
import { Dialogs } from './components/Dialogs';
import { MainPane } from './components/MainPane';
import { ProblemsPanel } from './components/ProblemsPanel';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { useStore } from './store';

export function App() {
  const summary = useStore((s) => s.summary);
  const toast = useStore((s) => s.toast);
  const loading = useStore((s) => s.loading);
  const problemsOpen = useStore((s) => s.problemsOpen);

  useEffect(() => {
    const dirty = summary?.dirtyFiles.length ?? 0;
    const name = summary ? summary.root.split(/[\\/]/).filter(Boolean).pop() : null;
    document.title = `${dirty ? '● ' : ''}${name ? name + ' — ' : ''}GTFO Datablock Studio`;
  }, [summary]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.summary) return;
      if (e.key === 'Escape' && st.dialog) {
        st.closeDialog();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) void st.saveAll();
        else void st.save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) void st.redo();
        else void st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault();
        void st.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!summary) {
    return (
      <div className="app app-welcome">
        <TopBar />
        <Welcome />
        {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
        {loading && <div className="loading">{loading}</div>}
      </div>
    );
  }

  return (
    <div className={`app ${problemsOpen ? 'problems-open' : ''}`}>
      <TopBar />
      <Sidebar />
      <main className="main">
        <MainPane />
      </main>
      <section className="problems">
        <ProblemsPanel />
      </section>
      <StatusBar />
      <Dialogs />
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
      {loading && <div className="loading">{loading}</div>}
    </div>
  );
}

/** CodeMirror's content is contentEditable, so its own undo/redo keymap wins there. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
