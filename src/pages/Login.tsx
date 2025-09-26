// src/pages/Login.tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog, save as saveDialog } from "@tauri-apps/api/dialog";

type Mode = "create" | "open";

export default function Login() {
  const [mode, setMode] = useState<Mode>("create");
  const [path, setPath] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const nav = useNavigate();

  // Prefill last used path if available
  useEffect(() => {
    const last = localStorage.getItem("db_last_path");
    if (last) setPath(last);
  }, []);

  function validate(): string | null {
    if (!path) return "Choose a database file path.";
    if (!pw) return "Enter a password.";
    if (mode === "create" && pw !== pw2) return "Passwords do not match.";
    return null;
  }

  async function pickPath() {
    setErr("");
    try {
      if (mode === "create") {
        const chosen = await saveDialog({
          defaultPath: path || "assettracker.db",
          filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
        });
        if (typeof chosen === "string" && chosen.length > 0) setPath(chosen);
      } else {
        const chosen = await openDialog({
          multiple: false,
          filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
        });
        if (Array.isArray(chosen)) {
          if (chosen[0]) setPath(String(chosen[0]));
        } else if (typeof chosen === "string" && chosen.length > 0) {
          setPath(chosen);
        }
      }
    } catch (e: any) {
      setErr(String(e));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      if (mode === "create") {
        await invoke("create_database", { dbPath: path, passphrase: pw });
      } else {
        await invoke("open_database", { dbPath: path, passphrase: pw });
      }
      sessionStorage.setItem("db_unlocked", "1");
      localStorage.setItem("db_last_path", path);
      nav("/");
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="w-full max-w-xl bg-white dark:bg-neutral-900 rounded-2xl shadow border border-neutral-200/60 dark:border-neutral-800">
        <div className="p-6">
          <h1 className="text-2xl font-semibold mb-4">AssetTracker — Unlock database</h1>

          {/* Mode toggle */}
          <div className="mb-5 inline-flex rounded-xl border border-neutral-200/60 dark:border-neutral-800 overflow-hidden">
            <button
              type="button"
              onClick={() => { setMode("create"); setErr(""); }}
              className={`px-4 py-2 ${mode === "create" ? "bg-neutral-200/60 dark:bg-neutral-800" : ""}`}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setMode("open"); setErr(""); }}
              className={`px-4 py-2 ${mode === "open" ? "bg-neutral-200/60 dark:bg-neutral-800" : ""}`}
            >
              Open
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Path + Browse */}
            <div>
              <label className="block text-sm mb-1">Database file</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-transparent"
                  placeholder={
                    mode === "create"
                      ? "Where to create e.g. ~/Documents/assettracker.db"
                      : "Select existing encrypted .db"
                  }
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <button
                  type="button"
                  onClick={pickPath}
                  className="px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Browse…
                </button>
              </div>
            </div>

            {/* Passwords */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Password</label>
                <div className="flex gap-2">
                  <input
                    type={showPw ? "text" : "password"}
                    className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-transparent"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    title={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {mode === "create" && (
                <div>
                  <label className="block text-sm mb-1">Confirm password</label>
                  <input
                    type={showPw ? "text" : "password"}
                    className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 bg-transparent"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Error */}
            {err && (
              <div className="text-sm text-red-600 dark:text-red-400">
                {err}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                disabled={busy || !!validate()}
                className={`px-4 py-2 rounded-xl text-white dark:text-black
                  ${busy || !!validate()
                    ? "bg-neutral-400 dark:bg-neutral-600 cursor-not-allowed"
                    : "bg-black dark:bg-white hover:opacity-90"
                  }`}
              >
                {busy ? "Working…" : mode === "create" ? "Create & Unlock" : "Unlock"}
              </button>
            </div>
          </form>

          {/* Tiny helper note */}
          <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            Tip: You can open this database in “DB Browser for SQLite” with SQLCipher 4 settings using the same password.
          </p>
        </div>
      </div>
    </div>
  );
}
