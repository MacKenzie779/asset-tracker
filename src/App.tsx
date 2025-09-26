// src/App.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { appWindow } from "@tauri-apps/api/window";
import './index.css';
import Layout from './components/Layout';
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

  if (ok === null) return null; // or a tiny splash
  return ok ? children : null;
}


export default function App() {
  return (
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
  );
}