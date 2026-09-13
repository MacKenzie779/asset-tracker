import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name; also used as the tooltip. */
  label: string;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
};

/** Square icon-only button. Uses the `.icon-btn` class from index.css. */
export default function IconButton({
  label,
  tone = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'icon-btn',
        size === 'sm' && 'h-7 w-7',
        tone === 'danger' && 'hover:text-rose-600 dark:hover:text-rose-400',
        className
      )}
      {...rest}
    />
  );
}
