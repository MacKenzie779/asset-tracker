import { useMemo } from 'react';

type Props = {
  value: number;
  hidden: boolean;
  currency?: string; // default 'EUR'
  className?: string;
  blurInstead?: boolean; // optional: blur rather than mask
};

export default function Amount({
  value,
  hidden,
  currency = 'EUR',
  className = '',
  blurInstead = false,
}: Props) {
  const text = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    } catch {
      // fallback if locale/currency is odd
      return `${value.toFixed(2)} ${currency}`;
    }
  }, [value, currency]);

  if (hidden) {
    return (
      <span
        className={
          className +
          ' select-none tabular-nums ' +
          (blurInstead ? ' filter blur-sm' : '')
        }
        aria-hidden="true"
      >
        {/* Keep spacing consistent with currency lengths */}
        {'•'.repeat(Math.max(text.length, 6))}
      </span>
    );
  }

  return <span className={`tabular-nums ${className}`}>{text}</span>;
}
