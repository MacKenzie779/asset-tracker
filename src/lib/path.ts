// Minimal path helpers that work for both POSIX and Windows paths.

function lastSeparator(p: string): number {
  return Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
}

function stripTrailing(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

/** "C:\\Users\\me\\Downloads\\a.xlsx" -> "a.xlsx"; "/tmp/a.pdf" -> "a.pdf" */
export function basename(p: string): string {
  const s = stripTrailing(p);
  const i = lastSeparator(s);
  return i >= 0 ? s.slice(i + 1) : s;
}

/** "/tmp/a.pdf" -> "/tmp"; "C:\\a.xlsx" -> "C:\\"; "a.pdf" -> "." */
export function dirname(p: string): string {
  const s = stripTrailing(p);
  const i = lastSeparator(s);
  if (i < 0) return '.';
  if (i === 0) return s[0];
  const dir = s.slice(0, i);
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}
