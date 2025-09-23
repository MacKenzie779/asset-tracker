import { useState } from 'react';
import Modal from './Modal';
import type { NewAccount } from '../types';

export default function CreateAccountDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: NewAccount) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onCreate({ name: n, color });
      setName('');
      setColor('#3b82f6');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create new account">
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={e=>setName(e.target.value)}
                 onKeyDown={e=>e.key==='Enter' && submit()} autoFocus />
        </label>
        <label className="flex items-center gap-3">
          <span className="label">Color</span>
          <input type="color" className="h-9 w-14 rounded bg-transparent cursor-pointer"
                 title="Account color" value={color} onChange={e=>setColor(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
