// Format 'YYYY-MM-DD' or Date -> 'dd.mm.yyyy'
export function formatDate(d: string | Date): string {
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    // fallback to Date if not ISO
    const dt = new Date(d);
    if (!isNaN(+dt)) return fmt(dt);
    return d;
  }
  return fmt(d);
}

function fmt(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
