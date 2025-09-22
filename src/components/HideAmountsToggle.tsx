type Props = {
  hidden: boolean;
  onToggle: () => void;
  className?: string;
};

export default function HideAmountsToggle({ hidden, onToggle, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`btn ${className}`}
      title={hidden ? 'Show amounts' : 'Hide amounts'}
      aria-pressed={hidden}
    >
      {/* Inline SVG avoids adding icon deps */}
      {hidden ? (
        // eye-off
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.66-1.53 1.7-2.94 2.99-4.11" />
          <path d="M10.58 10.58a2 2 0 1 0 2.83 2.83" />
          <path d="M6.1 6.1 17.9 17.9" />
          <path d="M22.94 12c-.94 2.23-2.54 4.2-4.62 5.64" />
          <path d="M9.88 4.26A10.94 10.94 0 0 1 12 4c5 0 9.27 3.89 11 8" />
        </svg>
      ) : (
        // eye
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
