// Format 'YYYY-MM-DD' or Date -> 'dd.mm.yyyy'
export function formatDate(d: string | Date): string {
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    const dt = new Date(d);
    if (!isNaN(+dt)) return fmt(dt);
    return d;
  }
  return fmt(d);
}

// Parse 'dd.mm.yyyy' -> 'YYYY-MM-DD' (or null if invalid)
export function parseDateDEToISO(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const dt = new Date(yyyy, mm - 1, dd);
  // validate (handles 31/02 etc.)
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return null;
  }
  return toISO(dt);
}

// Today's date as 'dd.mm.yyyy'
export function todayDE(): string {
  return fmt(new Date());
}

// Internal helpers
function fmt(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function toISO(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}
