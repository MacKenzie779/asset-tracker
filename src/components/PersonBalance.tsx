import clsx from 'clsx';
import Amount from './Amount';
import { personBalanceState } from '../lib/people';

type Props = {
  balance: number;
  hidden: boolean;
  /** Prefix the phrase with the person's name ("Anna owes you …"). */
  name?: string;
  size?: 'sm' | 'lg';
  className?: string;
};

/** "owes you 30,00 €" · "you owe 50,00 €" · "settled up" */
export default function PersonBalance({ balance, hidden, name, size = 'sm', className }: Props) {
  const state = personBalanceState(balance);
  const label =
    state === 'owes_you' ? (name ? `${name} owes you` : 'owes you') :
    state === 'you_owe' ? (name ? `you owe ${name}` : 'you owe') :
    'settled up';
  const tone =
    state === 'owes_you' ? 'text-emerald-600 dark:text-emerald-400' :
    state === 'you_owe' ? 'text-rose-600 dark:text-rose-400' :
    'text-neutral-500 dark:text-neutral-400';

  return (
    <span
      className={clsx('inline-flex flex-wrap items-baseline gap-x-1.5', tone, className)}
      title={state === 'settled' ? 'Nothing open' : undefined}
    >
      <span className={clsx(size === 'lg' ? 'text-sm font-medium' : 'text-xs')}>{label}</span>
      {state !== 'settled' && (
        <Amount value={Math.abs(balance)} hidden={hidden} colorBySign={false} className={clsx(size === 'lg' ? 'text-2xl font-semibold' : 'font-medium')} />
      )}
    </span>
  );
}
