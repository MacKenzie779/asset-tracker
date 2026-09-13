// Application shell: 40px header (wordmark, tabs, command affordance, theme,
// privacy), the page outlet, and the overlays (command palette, settle sheet,
// shortcut help). The keyboard map lives here.
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { open as openWithSystem } from '@tauri-apps/plugin-shell';
import ShortcutsHelp from './ShortcutsHelp';
import CommandPalette from './terminal/CommandPalette';
import SettleSheet from './terminal/SettleSheet';
import { PrivacyControl, ThemeControl } from './terminal/HeaderControls';
import { useToast } from './Toast';
import { closeDatabase } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { emit } from '../lib/bus';
import { basename, dirname } from '../lib/path';
import { isEditableTarget, isMod, type Shortcut } from '../lib/shortcuts';
import { useShell } from '../lib/shell';
import { useShortcuts } from '../hooks/useShortcuts';
import type { OpenDatabaseResult } from '../types';

const UPGRADE_NOTICE_KEY = 'db_upgrade_notice';

export default function Layout() {
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const shell = useShell();

  const onTerminal = loc.pathname === '/';
  const onStats = loc.pathname.startsWith('/stats');

  const lock = useCallback(async () => {
    try {
      await closeDatabase();
      sessionStorage.removeItem('db_unlocked');
      nav('/login', { replace: true });
    } catch (e) {
      toast.error('Could not lock the database', { description: errorMessage(e) });
    }
  }, [nav, toast]);

  // One-time notice after the database file was upgraded to a newer schema.
  const noticeShown = useRef(false);
  useEffect(() => {
    if (noticeShown.current) return;
    noticeShown.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(UPGRADE_NOTICE_KEY);
      sessionStorage.removeItem(UPGRADE_NOTICE_KEY);
    } catch {}
    if (!raw) return;
    try {
      const info = JSON.parse(raw) as OpenDatabaseResult;
      const backup = info.backup_path;
      toast.info('Your database was upgraded to the new format', {
        description: backup
          ? `Reimbursable accounts are now “people” with a natural sign. A copy of the old file was saved as ${basename(backup)}.`
          : 'Reimbursable accounts are now “people” with a natural sign.',
        duration: null,
        actions: backup ? [{ label: 'SHOW BACKUP', onClick: () => openWithSystem(dirname(backup)).catch(() => {}) }] : undefined,
      });
    } catch {}
  }, [toast]);

  const goTerminal = useCallback(() => { if (!onTerminal) nav('/'); }, [nav, onTerminal]);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { id: 'palette', keys: 'Mod+K', description: 'Search / command palette', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k', run: () => shell.openPalette() },
      { id: 'new', keys: 'Mod+N', description: 'Focus quick entry', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n',
        run: () => { goTerminal(); emit('focus:quick-entry'); } },
      { id: 'settle', keys: 'Mod+S', description: 'Settle up', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's', run: () => shell.openSettle() },
      { id: 'export', keys: 'Mod+E', description: 'Export the current filter', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e',
        run: () => { goTerminal(); emit('export'); } },
      { id: 'accounts', keys: 'Mod+,', description: 'Ledger column → ACCOUNTS tab', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key === ',',
        run: () => { goTerminal(); shell.requestLedger('accounts'); } },
      { id: 'tab1', keys: 'Mod+1', description: 'Terminal tab', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.code === 'Digit1', run: () => nav('/') },
      { id: 'tab2', keys: 'Mod+2', description: 'Stats tab', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.code === 'Digit2', run: () => nav('/stats') },
      { id: 'undo', keys: 'Mod+Z', description: 'Undo the last commit or delete', global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target),
        run: () => emit('undo') },
      { id: 'rows', keys: 'J / K', description: 'Move the row selection (also ↑ ↓)', match: () => false, run: () => {} },
      { id: 'open', keys: 'Enter', description: 'Edit the selected row', match: () => false, run: () => {} },
      { id: 'del', keys: 'Backspace', description: 'Delete the selected row (undoable)', match: () => false, run: () => {} },
      { id: 'slash', keys: '/', description: 'Focus the blotter search', when: () => onTerminal,
        match: (e) => e.key === '/', run: () => emit('focus:search') },
      { id: 'hide', keys: 'H', description: 'Mask / show amounts',
        match: (e) => !e.shiftKey && e.key.toLowerCase() === 'h', run: () => shell.toggleHidden() },
      { id: 'lock', keys: 'Mod+Shift+L', description: 'Lock the database', global: true,
        match: (e) => isMod(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l', run: () => void lock() },
      { id: 'help', keys: '?', description: 'Show this list', match: (e) => e.key === '?', run: () => shell.setHelpOpen(true) },
    ],
    [shell, nav, lock, goTerminal, onTerminal]
  );
  useShortcuts(shortcuts);

  return (
    <div className="t-app">
      <header className="t-header">
        <span className="t-wordmark">ASSETTRACKER</span>
        <div className="t-vdiv" aria-hidden="true" />
        <nav className="t-tabs" aria-label="Main">
          <button type="button" className={clsx('t-tab', onTerminal && 'is-active')} aria-current={onTerminal ? 'page' : undefined} onClick={() => nav('/')} title="Terminal (Ctrl+1)">
            TERMINAL
          </button>
          <button type="button" className={clsx('t-tab', onStats && 'is-active')} aria-current={onStats ? 'page' : undefined} onClick={() => nav('/stats')} title="Stats (Ctrl+2)">
            STATS
          </button>
        </nav>
        <div className="t-spacer" />
        <button type="button" className="t-cmd" onClick={() => shell.openPalette()} aria-label="Search or run a command">
          <span className="t-cmd-label">SEARCH / COMMAND</span>
          <span className="t-cmd-key">⌘K</span>
        </button>
        <ThemeControl />
        <PrivacyControl hidden={shell.hidden} onChange={shell.setHidden} />
      </header>

      <div className="t-main">
        <Outlet />
      </div>

      <CommandPalette onLock={lock} />
      <SettleSheet />
      <ShortcutsHelp open={shell.helpOpen} onClose={() => shell.setHelpOpen(false)} shortcuts={shortcuts} />
    </div>
  );
}
