import { Outlet, useLocation, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import HideAmountsToggle from './HideAmountsToggle';

export type LayoutOutletContext = {
  hidden: boolean;
  setHidden: React.Dispatch<React.SetStateAction<boolean>>;
};

const LS_KEY = 'assettracker.hideAmounts';

export default function Layout() {
  const loc = useLocation();
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, hidden ? '1' : '0'); } catch {} }, [hidden]);

  const title =
    loc.pathname === '/' ? 'Home' :
    loc.pathname.startsWith('/transactions') ? 'Transactions' :
    loc.pathname.startsWith('/accounts') ? 'Accounts' :
    loc.pathname.startsWith('/categories') ? 'Categories' :  // ← added
    loc.pathname.startsWith('/stats') ? 'Stats' :
    'Settings';

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex">
      {/* LEFT SIDEBAR NAV (vertical) */}
      <aside className="w-60 shrink-0 border-r border-neutral-200/60 dark:border-neutral-800/60 bg-white/90 dark:bg-neutral-900/80 backdrop-blur flex flex-col">
        {/* (If your Figma has a logo/header in the sidebar, put it here) */}
        <div className="h-14 flex items-center px-4">
          <div className="text-xl font-semibold">AssetTracker</div>
        </div>

        <nav className="flex-1 py-2">
          <NavItem to="/" active={loc.pathname === '/'} label="Home" icon={IconHome} />
          <NavItem to="/transactions" active={loc.pathname.startsWith('/transactions')} label="Transactions" icon={IconArrows} />
          <NavItem to="/categories" active={loc.pathname.startsWith('/categories')} label="Categories" icon={IconTag} />
          <NavItem to="/accounts" active={loc.pathname.startsWith('/accounts')} label="Accounts" icon={IconWallet} />
          <NavItem to="/stats" active={loc.pathname.startsWith('/stats')} label="Stats" icon={IconChart} />
        </nav>

        {/* Optional: sidebar footer area (profile/version/etc.) */}
        <div className="px-4 py-3 text-xs text-neutral-500 border-t border-neutral-200/60 dark:border-neutral-800/60">
          v0.1.2
        </div>
      </aside>

      {/* RIGHT: HEADER + CONTENT + FOOTER */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* HEADER (center title, actions on right/left) */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-neutral-200/60 dark:border-neutral-800/60 bg-white/90 dark:bg-neutral-900/80 backdrop-blur">
          <div className="flex items-center gap-2">
            {/* If your Figma has a back button or extra icon on the left, add it here */}
          </div>
          <div className="text-sm font-semibold tracking-wide">{title}</div>
          <div className="flex items-center gap-2">
            <HideAmountsToggle hidden={hidden} onToggle={() => setHidden(v => !v)} />
          </div>
        </header>

        {/* PAGE BODY */}
        <main className="flex-1 overflow-y-auto">
          <Outlet context={{ hidden, setHidden }} />
        </main>

        {/* FOOTER (thin status/footer like in Home.png) */}
        {/* <footer className="px-4 py-3 text-xs text-neutral-500 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-900/70 backdrop-blur">
          Database lives in your App Data directory; everything stays on your machine.
        </footer> */}
      </div>
    </div>
  );
}

function NavItem({
  to, label, active, icon: Icon,
}: { to: string; label: string; active: boolean; icon: (p:{className?:string})=>JSX.Element }) {
  return (
    <Link
      to={to}
      className={[
        'mx-2 my-0.5 flex items-center gap-3 px-3 py-2 rounded-xl transition',
        active
          ? 'bg-neutral-100 dark:bg-neutral-800 text-blue-600 border-l-2 border-blue-600'
          : 'text-neutral-600 hover:bg-neutral-100/70 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
      ].join(' ')}
    >
      <Icon className={active ? 'h-5 w-5 text-blue-600' : 'h-5 w-5'} />
      <span className="text-sm">{label}</span>
    </Link>
  );
}

/* Inline icons (tweak stroke/size to match Figma exactly) */
function IconHome({ className='' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"><path d="M3 11.5 12 4l9 7.5V20a2 2 0 0 1-2 2h-5v-6H10v6H5a2 2 0 0 1-2-2z" strokeWidth="1.8"/></svg>;
}
function IconWallet({ className='' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="12" rx="2" strokeWidth="1.8"/><path d="M16 12h4" strokeWidth="1.8"/></svg>;
}
function IconArrows({ className='' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"><path d="M7 7h10l-3-3M17 17H7l3 3" strokeWidth="1.8"/></svg>;
}
function IconChart({ className='' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"><path d="M4 19V5M8 19v-7M12 19V8M16 19v-4M20 19V10" strokeWidth="1.8"/></svg>;
}
function IconCog({ className='' }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3" strokeWidth="1.8"/><path d="M19 12a7 7 0 0 0-.16-1.5l2.11-1.64-2-3.46-2.5 1A7 7 0 0 0 14.5 4l-.5-3h-4l-.5 3a7 7 0 0 0-1.95 1.4l-2.5-1-2 3.46L5.16 10.5A7 7 0 0 0 5 12c0 .51.06 1.01.16 1.5l-2.11 1.64 2 3.46 2.5-1c.57.56 1.24 1.02 1.95 1.4l.5 3h4l.5-3a7 7 0 0 0 1.95-1.4l2.5 1 2-3.46-2.11-1.64c.1-.49.16-.99.16-1.5Z" strokeWidth="1.2"/></svg>;
}
/* NEW */
function IconTag({ className='' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor">
      <path d="M20 12l-8 8-8-8V4h8l8 8z" strokeWidth="1.8"/>
      <circle cx="9.5" cy="8.5" r="1.3" />
    </svg>
  );
}
