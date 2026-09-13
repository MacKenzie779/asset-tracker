import type { ComponentType, ReactNode } from 'react';
import clsx from 'clsx';
import type { IconProps } from './icons';

export type EmptyStateProps = {
  icon?: ComponentType<IconProps>;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** Tighter vertical padding for use inside table cells. */
  compact?: boolean;
  className?: string;
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center px-4',
        compact ? 'py-8' : 'py-14',
        className
      )}
    >
      {Icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      ) : null}
      {action ? (
        <button type="button" className="btn btn-primary mt-4" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
