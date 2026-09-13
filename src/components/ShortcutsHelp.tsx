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
      title="KEYBOARD"
      size="md"
      initialFocus="panel"
      footer={
        <button type="button" className="t-btn t-btn--primary" onClick={onClose}>
          CLOSE · ESC
        </button>
      }
    >
      <div>
        {shortcuts.map((s) => (
          <div key={s.id} className="t-help-row">
            <span>{s.description}</span>
            <span className="keys">
              {formatKeys(s.keys).map((k, i) => (
                <kbd key={i} className="t-key">{k}</kbd>
              ))}
            </span>
          </div>
        ))}
        <div className="t-help-row">
          <span>Save / cancel an inline edit</span>
          <span className="keys"><kbd className="t-key">Enter</kbd><kbd className="t-key">Esc</kbd></span>
        </div>
        <div className="t-help-row">
          <span>Accept a completion in quick entry or the palette</span>
          <span className="keys"><kbd className="t-key">Tab</kbd></span>
        </div>
      </div>
    </Modal>
  );
}
