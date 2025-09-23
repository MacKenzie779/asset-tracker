import { useState } from 'react';
import type { NewAccount } from '../types';

export default function CreateAccountCard({
  onCreate,
}: {
  onCreate: (input: NewAccount) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onCreate({ name: n, color });
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="text-sm font-semibold mb-2">Create new account</div>
      <div className="grid grid-cols-12 gap-2">
        <input
          className="input col-span-8"
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? void submit() : undefined)}
        />
        <div className="col-span-2 flex items-center gap-2">
          <span className="label">Color</span>
          <input
            type="color"
            title="Account color"
            className="h-9 w-14 rounded bg-transparent cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn btn-primary col-span-2" onClick={submit} disabled={busy}>
          {busy ? 'Add…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
