// Export settings shared by the ledger column and the settle sheet; persisted per device.
export type ExportFormat = 'xlsx' | 'pdf';
export type ExportConfig = { format: ExportFormat; columns: string[] };

export const EXPORT_COLUMNS = [
  { key: 'date', label: 'DATE' },
  { key: 'account', label: 'ACCOUNT' },
  { key: 'category', label: 'CATEGORY' },
  { key: 'description', label: 'NOTES' },
  { key: 'amount', label: 'VALUE' },
] as const;

const KEY = 'assettracker.export';
const DEFAULT: ExportConfig = { format: 'xlsx', columns: EXPORT_COLUMNS.map((c) => c.key) };

export function readExportConfig(): ExportConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<ExportConfig>;
    const format: ExportFormat = v.format === 'pdf' ? 'pdf' : 'xlsx';
    const valid = new Set<string>(EXPORT_COLUMNS.map((c) => c.key));
    const columns = Array.isArray(v.columns) ? v.columns.filter((c): c is string => typeof c === 'string' && valid.has(c)) : DEFAULT.columns;
    return { format, columns };
  } catch {
    return DEFAULT;
  }
}

export function writeExportConfig(cfg: ExportConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}
