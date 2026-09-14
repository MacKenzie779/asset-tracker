import clsx from 'clsx';
import { t } from '../../lib/i18n';
import { formatAbs, formatSigned, MASK } from '../../lib/number';

type Props = {
  value: number;
  hidden: boolean;
  /** 'always': +/-; 'neg': only '-'; 'none': magnitude only. */
  sign?: 'always' | 'neg' | 'none';
  /** 'sign': colour by sign; 'pos'/'neg': forced; 'none': inherit. */
  tone?: 'sign' | 'pos' | 'neg' | 'none';
  decimals?: number;
  className?: string;
  title?: string;
};

/** The one place a monetary number is rendered in the terminal (German format, tabular, maskable). */
export default function Money({ value, hidden, sign = 'always', tone = 'sign', decimals = 2, className, title }: Props) {
  const toneClass =
    tone === 'sign' ? (value > 0.005 ? 'pos' : value < -0.005 ? 'neg' : '') : tone === 'none' ? '' : tone;
  if (hidden) {
    return (
      <span className={clsx('num masked', toneClass, className)} title={title}>
        <span aria-hidden="true">{MASK}</span>
        <span className="t-sr">{t('money.hidden')}</span>
      </span>
    );
  }
  const text =
    sign === 'none' ? formatAbs(value, decimals) : formatSigned(value, { fractionDigits: decimals, plus: sign === 'always' });
  return (
    <span className={clsx('num', toneClass, className)} title={title}>
      {text}
    </span>
  );
}
