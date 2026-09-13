// src/App.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import { DataProvider } from './lib/data';
import { ShellProvider, useShell, type LedgerTab } from './lib/shell';
import Terminal from './pages/Terminal';
import Stats from './pages/Stats';
import Login from './pages/Login';

function Guard({ children }: { children: JSX.Element }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    const unlocked = sessionStorage.getItem("db_unlocked") === "1";
    if (!unlocked) {
      setOk(false);
      nav("/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const isOpen = await invoke<boolean>("is_database_open");
        if (isOpen) setOk(true);
        else {
          sessionStorage.removeItem("db_unlocked");
          setOk(false);
          nav("/login", { replace: true });
        }
      } catch {
        sessionStorage.removeItem("db_unlocked");
        setOk(false);
        nav("/login", { replace: true });
      }
    })();
  }, [nav]);

  // Themed blank while the session check runs (avoids a white flash).
  if (ok === null) return <div className="h-screen" style={{ background: 'var(--ground)' }} aria-busy="true" />;
  return ok ? children : null;
}

/** The old per-page routes land in the terminal with the ledger column on the matching tab. */
function LedgerRedirect({ tab }: { tab: LedgerTab }) {
  const shell = useShell();
  useEffect(() => { shell.requestLedger(tab); }, [shell, tab]);
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Guard>
                <ShellProvider>
                  <DataProvider>
                    <Layout />
                  </DataProvider>
                </ShellProvider>
              </Guard>
            }
          >
            <Route path="/" element={<Terminal />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/transactions" element={<Navigate to="/" replace />} />
            <Route path="/accounts" element={<LedgerRedirect tab="accounts" />} />
            <Route path="/categories" element={<LedgerRedirect tab="categories" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
