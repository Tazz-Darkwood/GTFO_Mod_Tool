import { useState } from 'react';
import type { Tier } from '@shared/ipc';
import { useStore } from '../../store';
import { Modal } from './Modal';

export function AddExpeditionDialog({
  rundownBlockId,
  tier,
}: {
  rundownBlockId: string;
  tier: Tier;
}) {
  const close = useStore((s) => s.closeDialog);
  const rundownOp = useStore((s) => s.rundownOp);
  const tree = useStore((s) => s.rundownTree);
  const count =
    tree?.rundowns.find((r) => r.blockId === rundownBlockId)?.tiers.find((t) => t.tier === tier)
      ?.expeditions.length ?? 0;
  const [prefix, setPrefix] = useState(`${tier}${count + 1}`);
  const [publicName, setPublicName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await rundownOp({
      kind: 'addExpedition',
      rundownBlockId,
      tier,
      prefix: prefix.trim(),
      publicName: publicName.trim(),
    });
    setBusy(false);
  };
  return (
    <Modal
      title={`New expedition in tier ${tier}`}
      width={460}
      footer={
        <>
          <span className="muted small-text">
            Layouts and objectives are linked afterwards from the tree (pick / new).
          </span>
          <span className="right" />
          <button onClick={close}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => void submit()}>
            Add
          </button>
        </>
      }
    >
      <label className="field">
        <span>Prefix</span>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="A4"
        />
      </label>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={publicName}
          onChange={(e) => setPublicName(e.target.value)}
          placeholder="Shown on the rundown screen"
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
    </Modal>
  );
}
