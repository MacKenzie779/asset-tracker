import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string; // width etc.
};

export default function Modal({ open, onClose, title, children, className = 'max-w-md' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // focus dialog
    setTimeout(() => ref.current?.focus(), 0);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;

  const node = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      {/* Panel */}
      <div
        ref={ref}
        tabIndex={-1}
        className={`relative z-10 card w-[92vw] ${className} p-4 outline-none`}
      >
        {title ? <h3 className="text-base font-semibold mb-2">{title}</h3> : null}
        {children}
      </div>
    </div>
  );
  return ReactDOM.createPortal(node, document.body);
}
