import { useMemo } from 'react';

type Props = {
  value: number;
  hidden: boolean;
  currency?: string;     // defaults to 'EUR'
  className?: string;
  blurInstead?: boolean;
  colorBySign?: boolean; // red/green by sign
};

export default function Amount({
  value,
  hidden,
  currency = 'EUR',
  className = '',
  blurInstead = true,
  colorBySign = true,
}: Props) {
  const formatter = useMemo(() => {
    try {
      return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        currencyDisplay: 'symbol',
        useGrouping: true,
      });
    } catch {
      return null;
    }
  }, [currency]);

  const text = useMemo(() => {
    if (formatter) {
      // Replace NBSP with normal space so it shows as "... €"
      return formatter.format(value).replace(/\u00A0/g, ' ');
    }
    // Fallback manual "1.500,23 €" if Intl not available
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const fixed = abs.toFixed(2);
    const [int, dec] = fixed.split('.');
    const intWithDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}${intWithDots},${dec} €`;
  }, [formatter, value]);

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
