import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Modal from './Modal';

export type ConfirmVariant = 'default' | 'danger' | 'alert';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** `danger`: destructive confirm. `alert`: single OK button (acknowledgement). */
  variant?: ConfirmVariant;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  /** Escape / backdrop / Cancel. Optional for `alert`, where it falls back to onConfirm. */
  onCancel?: () => void;
};

/**
 * Confirmation dialog built on Modal.
 * Initial focus is on the confirm button, so Enter confirms and Escape cancels natively.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  variant = 'default',
  confirmText,
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const cancel = () => {
    if (busy) return;
    if (onCancel) onCancel();
    else void onConfirm();
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const isAlert = variant === 'alert';

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={title}
      description={description}
      size="md"
      role={variant === 'default' ? 'dialog' : 'alertdialog'}
      initialFocus={confirmRef}
      footer={
        <>
          {!isAlert ? (
            <button type="button" className="btn" onClick={cancel} disabled={busy}>
              {cancelText}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            className={clsx('btn', variant === 'danger' ? 'btn-danger' : 'btn-primary')}
            onClick={confirm}
            disabled={busy}
          >
            {confirmText ?? (isAlert ? 'OK' : 'Confirm')}
          </button>
        </>
      }
    />
  );
}
