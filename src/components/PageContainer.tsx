import type { ReactNode } from 'react';
import clsx from 'clsx';

/** The one page shell every route uses, so content aligns when navigating. */
export default function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mx-auto w-full max-w-[1680px] px-4 md:px-6 py-4 pb-8', className)}>
      {children}
    </div>
  );
}
