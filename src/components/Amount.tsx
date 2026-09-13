import { useMemo } from 'react';
import { formatMoneyDE } from '../lib/number';

type Props = {
  value: number;
  hidden: boolean;
  currency?: string;     // defaults to 'EUR'
  className?: string;
  blurInstead?: boolean;
  colorBySign?: boolean; // red/green by sign
};

/** The single place monetary values are rendered. */
export default function Amount({
  value,
  hidden,
  currency = 'EUR',
  className = '',
  blurInstead = true,
  colorBySign = true,
}: Props) {
  const text = useMemo(() => formatMoneyDE(value, { currency }), [value, currency]);

  if (hidden) {
    return (
      <span className={`${className} select-none tabular-nums`}>
        <span aria-hidden="true" className={blurInstead ? 'filter blur-sm' : undefined}>
          {'•'.repeat(6)}
        </span>
        <span className="sr-only">Amount hidden</span>
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
