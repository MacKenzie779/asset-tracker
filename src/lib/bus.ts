// Tiny typed event bus for shell -> page requests (shortcuts, palette actions).
// Pages subscribe while mounted; the shell fires without knowing who listens.

export type BusEvents = {
  'focus:quick-entry': void;
  'focus:search': void;
  'export': void;
  'undo': void;
  /** Filter the blotter. Empty object clears every filter. */
  'blotter:filter': { query?: string; accountId?: number | null; clear?: boolean };
  /** Prefill the quick entry (duplicate / palette shorthand hand-off). */
  'quick-entry:prefill': QuickEntryPrefill;
  /** Something changed the data on disk; every consumer re-reads. */
  'data:changed': void;
};

export type QuickEntryPrefill = {
  direction?: 'in' | 'out' | 'trf';
  date?: string; // dd.mm.yyyy
  category?: string;
  notes?: string;
  amount?: number;
  accountId?: number;
  personId?: number;
  focus?: 'amount' | 'account' | 'category';
};

const PREFIX = 'assettracker:';

export function emit<K extends keyof BusEvents>(name: K, ...args: BusEvents[K] extends void ? [] : [BusEvents[K]]) {
  window.dispatchEvent(new CustomEvent(PREFIX + name, { detail: args[0] }));
}

export function subscribe<K extends keyof BusEvents>(name: K, handler: (payload: BusEvents[K]) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<BusEvents[K]>).detail);
  window.addEventListener(PREFIX + name, fn);
  return () => window.removeEventListener(PREFIX + name, fn);
}
