// src/lib/number.ts
// Shared EU-style number parsing and formatting. The app is de-DE / EUR throughout.

/** Parse EU/US decimals like "5,23", "5.23", "1.234,56", "1,234.56".
 *  Returns null for empty or "in-progress" inputs ("", "-", "5," / "5.") and for anything non-numeric. */
export function parseDecimal(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s/g, '');
  if (s === '') return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.'); // "1.234,56" -> "1234.56"
    } else {
      s = s.replace(/,/g, ''); // "1,234.56" -> "1234.56"
    }
  } else if (hasComma) {
    s = s.replace(',', '.'); // "5,23" -> "5.23"
  }

  // Only a sign, or a number that still ends with the decimal separator: keep editing.
  if (s === '-' || s === '+' || /^[-+]?\d+[.]$/.test(s)) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "1234.5" -> "1234,50" (grouping off, for edit inputs) or "1.234,50" (grouping on). */
export function formatDecimalDE(
  n: number,
  opts: { fractionDigits?: number; grouping?: boolean } = {}
): string {
  const { fractionDigits = 2, grouping = false } = opts;
  try {
    return n
      .toLocaleString('de-DE', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        useGrouping: grouping,
      })
      .replace(/−/g, '-');
  } catch {
    return n.toFixed(fractionDigits).replace('.', ',');
  }
}

const moneyFormatters = new Map<string, Intl.NumberFormat | null>();

/** "1234.5" -> "1.234,50 €" (de-DE currency formatting with a normal space before the symbol). */
export function formatMoneyDE(
  n: number,
  opts: { currency?: string; minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
): string {
  const currency = opts.currency ?? 'EUR';
  const maximumFractionDigits = opts.maximumFractionDigits ?? 2;
  const minimumFractionDigits = opts.minimumFractionDigits ?? Math.min(2, maximumFractionDigits);
  const key = `${currency}|${minimumFractionDigits}|${maximumFractionDigits}`;

  let fmt = moneyFormatters.get(key);
  if (fmt === undefined) {
    try {
      fmt = new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency,
        minimumFractionDigits,
        maximumFractionDigits,
        currencyDisplay: 'symbol',
        useGrouping: true,
      });
    } catch {
      fmt = null;
    }
    moneyFormatters.set(key, fmt);
  }

  if (fmt) {
    return fmt.format(n).replace(/ /g, ' ').replace(/−/g, '-');
  }

  // Manual fallback if Intl is unavailable: "1.500,23 €"
  const sign = n < 0 ? '-' : '';
  const fixed = Math.abs(n).toFixed(maximumFractionDigits);
  const [int, dec] = fixed.split('.');
  const intWithDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${intWithDots}${dec ? `,${dec}` : ''} €`;
}
