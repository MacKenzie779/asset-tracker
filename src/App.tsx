// src/App.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Home from './pages/Home';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Stats from './pages/Stats';
import Categories from './pages/Categories';
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
  if (ok === null) return <div className="h-screen bg-neutral-50 dark:bg-neutral-950" aria-busy="true" />;
  return ok ? children : null;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guard><Layout /></Guard>}>
            <Route path="/" element={<Home />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
