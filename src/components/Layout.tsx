import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from 'react';
import clsx from 'clsx';
import HideAmountsToggle from './HideAmountsToggle';
import ThemeToggle from './ThemeToggle';
import AppVersion from './AppVersion';
import ShortcutsHelp from './ShortcutsHelp';
import { useToast } from './Toast';
import {
  IconArrows,
  IconChart,
  IconHome,
  IconKeyboard,
  IconLock,
  IconTag,
  IconWallet,
  type IconProps,
} from './icons';
import { closeDatabase } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { requestFocus } from '../lib/focusBus';
import { isMod, type Shortcut } from '../lib/shortcuts';
import { useShortcuts } from '../hooks/useShortcuts';

export type LayoutOutletContext = {
  hidden: boolean;
  setHidden: Dispatch<SetStateAction<boolean>>;
};

const LS_KEY = 'assettracker.hideAmounts';

type NavEntry = {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  match: (path: string) => boolean;
};

/** Sidebar order also defines the Mod+1…5 shortcuts. */
const NAV_ITEMS: NavEntry[] = [
  { to: '/', label: 'Home', icon: IconHome, match: (p) => p === '/' },
  { to: '/transactions', label: 'Transactions', icon: IconArrows, match: (p) => p.startsWith('/transactions') },
  { to: '/categories', label: 'Categories', icon: IconTag, match: (p) => p.startsWith('/categories') },
  { to: '/accounts', label: 'Accounts', icon: IconWallet, match: (p) => p.startsWith('/accounts') },
  { to: '/stats', label: 'Stats', icon: IconChart, match: (p) => p.startsWith('/stats') },
];

export default function Layout() {
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();

  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, hidden ? '1' : '0'); } catch {} }, [hidden]);

  const [helpOpen, setHelpOpen] = useState(false);
  const [locking, setLocking] = useState(false);

  const pathname = loc.pathname;
  const title = NAV_ITEMS.find((n) => n.match(pathname))?.label ?? 'AssetTracker';

  const lock = useCallback(async () => {
    setLocking(true);
    try {
      await closeDatabase();
      sessionStorage.removeItem('db_unlocked');
      nav('/login', { replace: true });
    } catch (e) {
      toast.error('Could not lock the database', { description: errorMessage(e) });
      setLocking(false);
    }
  }, [nav, toast]);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        id: 'search',
        keys: 'Mod+K',
        description: 'Search transactions',
        global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k',
        run: () => {
          if (!pathname.startsWith('/transactions')) nav('/transactions');
          requestFocus('search');
        },
      },
      {
        id: 'slash',
        keys: '/',
        description: 'Focus the search field (Transactions)',
        when: () => pathname.startsWith('/transactions'),
        match: (e) => e.key === '/',
        run: () => requestFocus('search'),
      },
      {
        id: 'new',
        keys: 'N',
        description: 'New transaction (Home)',
        when: () => pathname === '/',
        match: (e) => !e.shiftKey && e.key.toLowerCase() === 'n',
        run: () => requestFocus('quick-add'),
      },
      {
        id: 'hide',
        keys: 'H',
        description: 'Hide / show amounts',
        match: (e) => !e.shiftKey && e.key.toLowerCase() === 'h',
        run: () => setHidden((v) => !v),
      },
      {
        id: 'nav',
        keys: 'Mod+1…5',
        description: 'Go to Home, Transactions, Categories, Accounts, Stats',
        global: true,
        match: (e) => isMod(e) && !e.shiftKey && !e.altKey && /^Digit[1-5]$/.test(e.code),
        run: (e) => {
          const item = NAV_ITEMS[Number(e.code.slice(5)) - 1];
          if (item) nav(item.to);
        },
      },
      {
        id: 'lock',
        keys: 'Mod+Shift+L',
        description: 'Lock the database',
        global: true,
        match: (e) => isMod(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l',
        run: () => void lock(),
      },
      {
        id: 'help',
        keys: '?',
        description: 'Show this list',
        match: (e) => e.key === '?',
        run: () => setHelpOpen(true),
      },
    ],
    [pathname, nav, lock]
  );
  useShortcuts(shortcuts);

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {/* LEFT SIDEBAR NAV: icon rail below lg, full labels from lg */}
      <aside className="flex w-16 shrink-0 flex-col border-r border-neutral-200/60 bg-white/90 backdrop-blur dark:border-neutral-800/60 dark:bg-neutral-900/80 lg:w-56">
        <div className="flex h-14 items-center justify-center lg:justify-start lg:px-4">
          <span className="hidden text-xl font-semibold lg:block">AssetTracker</span>
          <span className="text-xl font-semibold lg:hidden" aria-hidden="true">AT</span>
        </div>

        <nav className="flex-1 py-2" aria-label="Main">
          {NAV_ITEMS.map((n) => (
            <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} active={n.match(pathname)} />
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-neutral-200/60 p-2 dark:border-neutral-800/60 lg:px-3 lg:py-3">
          <button
            type="button"
            className="btn w-full justify-center lg:justify-start"
            onClick={() => void lock()}
            disabled={locking}
            title="Lock database (Ctrl+Shift+L)"
          >
            <IconLock />
            <span className="hidden lg:inline">{locking ? 'Locking…' : 'Lock database'}</span>
            <span className="sr-only lg:hidden">Lock database</span>
          </button>
          <div className="text-center text-xs text-neutral-500 lg:text-left">
            <AppVersion />
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-neutral-200/60 bg-white/90 px-4 backdrop-blur dark:border-neutral-800/60 dark:bg-neutral-900/80">
          <h1 className="text-sm font-semibold tracking-wide">{title}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => setHelpOpen(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              <IconKeyboard />
            </button>
            <ThemeToggle />
            <HideAmountsToggle hidden={hidden} onToggle={() => setHidden((v) => !v)} />
          </div>
        </header>

        {/* only page content scrolls */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet context={{ hidden, setHidden }} />
        </main>
      </div>

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={shortcuts} />
    </div>
  );
}

function NavItem({
  to,
  label,
  active,
  icon: Icon,
}: {
  to: string;
  label: string;
  active: boolean;
  icon: ComponentType<IconProps>;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'mx-2 my-0.5 flex items-center justify-center gap-3 rounded-xl border-l-2 px-3 py-2 transition lg:justify-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        active
          ? 'border-blue-600 bg-neutral-100 text-blue-600 dark:bg-neutral-800'
          : 'border-transparent text-neutral-600 hover:bg-neutral-100/70 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="hidden text-sm lg:inline">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
    </Link>
  );
}
