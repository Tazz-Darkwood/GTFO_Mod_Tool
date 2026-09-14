import { useStore } from '../store';
import { AddExpeditionDialog } from './dialogs/AddExpeditionDialog';
import { DeleteBlockDialog } from './dialogs/DeleteBlockDialog';
import { DeleteFileDialog } from './dialogs/DeleteFileDialog';
import { NewBlockDialog } from './dialogs/NewBlockDialog';
import { NewFileDialog } from './dialogs/NewFileDialog';

/** Renders whichever modal the store asked for. */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'newBlock':
      return <NewBlockDialog init={dialog} />;
    case 'addExpedition':
      return <AddExpeditionDialog rundownBlockId={dialog.rundownBlockId} tier={dialog.tier} />;
    case 'deleteBlock':
      return <DeleteBlockDialog blockId={dialog.blockId} />;
    case 'newFile':
      return <NewFileDialog init={dialog} />;
    case 'deleteFile':
      return <DeleteFileDialog fileId={dialog.fileId} />;
  }
}
