import clsx from 'clsx';

/** Loading placeholder block. Size it with className (e.g. `h-4 w-32`). */
export default function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800', className)}
    />
  );
}
