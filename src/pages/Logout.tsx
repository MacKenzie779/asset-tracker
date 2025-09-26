// LockButton.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";

export default function LockButton() {
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function lockNow() {
    setBusy(true);
    try {
      await invoke("close_database");       // swap to placeholder pool
    } catch (_) {
      // ignore
    } finally {
      sessionStorage.removeItem("db_unlocked");
      setBusy(false);
      nav("/login");
    }
  }

  return (
    <button
      onClick={lockNow}
      disabled={busy}
      className="px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      title="Lock & return to login"
    >
      {busy ? "Locking…" : "Lock"}
    </button>
  );
}
