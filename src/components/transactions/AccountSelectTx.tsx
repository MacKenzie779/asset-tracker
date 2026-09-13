import { useMemo } from 'react';
import type { Account } from '../../types';
import BasicSelect, { type Option } from '../BasicSelect';

type Props = {
  options: Account[];
  value?: number | null; // null = All accounts
  onChange: (v: number | null) => void;
  className?: string;
};

const ALL = 'all';

/** Account filter: "All accounts" plus every account with its colour dot. */
export default function AccountSelectTx({ options, value = null, onChange, className }: Props) {
  const opts = useMemo<Option[]>(
    () => [
      { value: ALL, label: 'All accounts', color: null },
      ...options.map((a) => ({ value: String(a.id), label: a.name, color: a.color || '#6b7280' })),
    ],
    [options]
  );

  return (
    <BasicSelect
      options={opts}
      value={value === null ? ALL : String(value)}
      onChange={(v) => onChange(v === ALL ? null : Number(v))}
      className={className}
      ariaLabel="Account"
    />
  );
}
