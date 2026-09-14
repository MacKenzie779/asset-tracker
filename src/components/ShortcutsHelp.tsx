import Modal from './Modal';
import { useI18n } from '../hooks/useI18n';
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
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('help.title')}
      size="md"
      initialFocus="panel"
      footer={
        <button type="button" className="t-btn t-btn--primary" onClick={onClose}>
          {t('help.close')}
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
          <span>{t('help.inlineEdit')}</span>
          <span className="keys"><kbd className="t-key">Enter</kbd><kbd className="t-key">Esc</kbd></span>
        </div>
        <div className="t-help-row">
          <span>{t('help.completion')}</span>
          <span className="keys"><kbd className="t-key">Tab</kbd></span>
        </div>
      </div>
    </Modal>
  );
}
