import { IconEye, IconEyeOff } from './icons';

type Props = {
  hidden: boolean;
  onToggle: () => void;
  className?: string;
};

export default function HideAmountsToggle({ hidden, onToggle, className = '' }: Props) {
  const label = hidden ? 'Show amounts' : 'Hide amounts';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`btn ${className}`}
      title={`${label} (H)`}
      aria-label={label}
      aria-pressed={hidden}
    >
      {hidden ? <IconEyeOff /> : <IconEye />}
    </button>
  );
}
