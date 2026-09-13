// Cross-page UI state of the application shell: privacy mask, ledger column
// tab, command palette, settle sheet, help. Pages read it; the header and the
// keyboard map write it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type LedgerTab = 'ledger' | 'accounts' | 'categories';

/** What the ledger column should do after switching tab (add row focused, row in edit, delete pending). */
export type LedgerIntent =
  | { kind: 'add'; type: 'account' | 'person' }
  | { kind: 'edit'; id: number }
  | { kind: 'delete'; id: number }
  | { kind: 'edit-category'; id: number }
  | { kind: 'delete-category'; id: number };

export type SettleState = { open: boolean; personId: number | null };

export type Shell = {
  hidden: boolean;
  setHidden: (v: boolean) => void;
  toggleHidden: () => void;

  ledgerTab: LedgerTab;
  ledgerIntent: LedgerIntent | null;
  setLedgerTab: (t: LedgerTab) => void;
  requestLedger: (tab: LedgerTab, intent?: LedgerIntent) => void;
  consumeLedgerIntent: () => void;

  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;

  settle: SettleState;
  openSettle: (personId?: number | null) => void;
  closeSettle: () => void;

  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
};

const Ctx = createContext<Shell | null>(null);

const HIDE_KEY = 'assettracker.hideAmounts';
const TAB_KEY = 'assettracker.ledgerTab';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch {} }, [hidden]);

  const [ledgerTab, setLedgerTabState] = useState<LedgerTab>(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY);
      return v === 'accounts' || v === 'categories' ? v : 'ledger';
    } catch { return 'ledger'; }
  });
  useEffect(() => { try { sessionStorage.setItem(TAB_KEY, ledgerTab); } catch {} }, [ledgerTab]);
  const [ledgerIntent, setLedgerIntent] = useState<LedgerIntent | null>(null);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settle, setSettle] = useState<SettleState>({ open: false, personId: null });
  const [helpOpen, setHelpOpen] = useState(false);

  const setHidden = useCallback((v: boolean) => setHiddenState(v), []);
  const toggleHidden = useCallback(() => setHiddenState((v) => !v), []);
  const setLedgerTab = useCallback((t: LedgerTab) => setLedgerTabState(t), []);
  const requestLedger = useCallback((tab: LedgerTab, intent?: LedgerIntent) => {
    setLedgerTabState(tab);
    setLedgerIntent(intent ?? null);
  }, []);
  const consumeLedgerIntent = useCallback(() => setLedgerIntent(null), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSettle = useCallback((personId?: number | null) => setSettle({ open: true, personId: personId ?? null }), []);
  const closeSettle = useCallback(() => setSettle((s) => ({ ...s, open: false })), []);

  const value = useMemo<Shell>(
    () => ({
      hidden, setHidden, toggleHidden,
      ledgerTab, ledgerIntent, setLedgerTab, requestLedger, consumeLedgerIntent,
      paletteOpen, openPalette, closePalette,
      settle, openSettle, closeSettle,
      helpOpen, setHelpOpen,
    }),
    [hidden, setHidden, toggleHidden, ledgerTab, ledgerIntent, setLedgerTab, requestLedger, consumeLedgerIntent, paletteOpen, openPalette, closePalette, settle, openSettle, closeSettle, helpOpen]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell must be used inside <ShellProvider>');
  return v;
}
