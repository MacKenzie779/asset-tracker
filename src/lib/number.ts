// src/lib/number.ts
/** Parse EU/US decimals like "5,23", "5.23", "1.234,56", "1,234.56".
 *  Returns null for "in-progress" inputs ("" / "5," / "5." etc.). */
export function parseDecimal(input: string): number | null {
  if (input == null) return null;
  let s = input.trim().replace(/\s/g, '');
  if (s === '') return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.'); // "1.234,56" -> "1234.56"
    } else {
      s = s.replace(/,/g, '');                    // "1,234.56" -> "1234.56"
    }
  } else if (hasComma) {
    s = s.replace(',', '.');                      // "5,23" -> "5.23"
  }

  // If user typed only "-" or ends with decimal sep (e.g. "5."), keep editing
  if (s === '-' || /[-+]?\d+[.]?$/.test(s)) return null;

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
