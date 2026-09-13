import Modal from './Modal';
import { formatKeys, type Shortcut } from '../lib/shortcuts';

export default function ShortcutsHelp({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="md"
      initialFocus="panel"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
        {shortcuts.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-neutral-700 dark:text-neutral-300">{s.description}</span>
            <span className="flex shrink-0 items-center gap-1">
              {formatKeys(s.keys).map((k, i) => (
                <kbd key={i} className="kbd">
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="text-neutral-700 dark:text-neutral-300">Save / cancel an inline edit</span>
          <span className="flex shrink-0 items-center gap-1">
            <kbd className="kbd">Enter</kbd>
            <span className="text-neutral-400">/</span>
            <kbd className="kbd">Esc</kbd>
          </span>
        </li>
      </ul>
    </Modal>
  );
}
