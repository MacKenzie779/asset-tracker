import { useMemo } from 'react';

type Props = {
  value: number;
  hidden: boolean;
  currency?: string; // default 'EUR'
  className?: string;
  blurInstead?: boolean; // optional: blur rather than mask
  colorBySign?: boolean; // NEW: color red/green by sign
};

export default function Amount({
  value,
  hidden,
  currency = 'EUR',
  className = '',
  blurInstead = true,
  colorBySign = true,
}: Props) {
  const text = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }, [value, currency]);

  if (hidden) {
    // When hidden, we don't leak sign via color
    return (
      <span
        className={
          className +
          ' select-none tabular-nums ' +
          (blurInstead ? ' filter blur-sm' : '')
        }
        aria-hidden="true"
      >
        {'•'.repeat(6)}
      </span>
    );
  }

  const signClass =
    colorBySign
      ? value > 0
        ? ' text-emerald-600 dark:text-emerald-400'
        : value < 0
          ? ' text-rose-600 dark:text-rose-400'
          : ''
      : '';

  return <span className={`tabular-nums${signClass} ${className}`}>{text}</span>;
}
