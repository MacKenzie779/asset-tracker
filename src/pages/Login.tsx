// src/pages/Login.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import loginBg from "../assets/wallpaper/sajad.jpg"; 

// Optional wallpaper (leave empty for gradient background)
const WALLPAPER_URL = loginBg;

export default function Login() {
  const [path, setPath] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Create DB modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [cPath, setCPath] = useState("");
  const [cPw, setCPw] = useState("");
  const [cPw2, setCPw2] = useState("");
  const [cShowPw, setCShowPw] = useState(false);
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string>("");

  const nav = useNavigate();

  useEffect(() => {
    const last = localStorage.getItem("db_last_path");
    if (last) setPath(last);
  }, []);

  function validateLogin(): string | null {
    if (!path) return "Choose a database file.";
    if (!pw) return "Enter your password.";
    return null;
  }

  function validateCreate(): string | null {
    if (!cPath) return "Choose a file path.";
    if (!cPw) return "Enter a password.";
    if (cPw !== cPw2) return "Passwords do not match.";
    return null;
  }

  async function browseOpen() {
    setErr("");
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

  async function browseCreate() {
    setCErr("");
    const chosen = await saveDialog({
      defaultPath: cPath || "assettracker.db",
      filters: [{ name: "SQLite", extensions: ["db", "sqlite"] }],
    });
    if (typeof chosen === "string" && chosen.length > 0) setCPath(chosen);
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    const v = validateLogin();
    if (v) return setErr(v);
    setBusy(true);
    setErr("");
    try {
      await invoke("open_database", { dbPath: path, passphrase: pw });
      sessionStorage.setItem("db_unlocked", "1");        // re-auth each launch
      localStorage.setItem("db_last_path", path);        // convenience only
      nav("/");
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const v = validateCreate();
    if (v) return setCErr(v);
    setCBusy(true);
    setCErr("");
    try {
      await invoke("create_database", { dbPath: cPath, passphrase: cPw });
      sessionStorage.setItem("db_unlocked", "1");
      localStorage.setItem("db_last_path", cPath);
      setCreateOpen(false);
      nav("/");
    } catch (e: any) {
      setCErr(String(e));
    } finally {
      setCBusy(false);
    }
  }

  const bgStyle = WALLPAPER_URL
    ? { backgroundImage: `url(${WALLPAPER_URL})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div
        className={`absolute inset-0 ${WALLPAPER_URL ? "" : "bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900"} `}
        style={bgStyle}
      />
      {/* Readability overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Center card */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-xl shadow-xl">
          <div className="p-7 md:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
                Welcome back
              </h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                Unlock your encrypted database to continue.
              </p>
            </div>

            {/* Login form */}
            <form onSubmit={submitLogin} className="space-y-4">
              <div>
                <label className="block text-sm mb-1 text-neutral-800 dark:text-neutral-200">
                  Database file
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-2 bg-white/60 dark:bg-neutral-950/40 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/20"
                    placeholder="Select your encrypted .db"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={browseOpen}
                    className="px-3 py-2 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-950/40 hover:bg-white/80 dark:hover:bg-neutral-900/60"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1 text-neutral-800 dark:text-neutral-200">
                  Password
                </label>
                <div className="flex gap-2">
                  <input
                    type={showPw ? "text" : "password"}
                    className="w-full rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-2 bg-white/60 dark:bg-neutral-950/40 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/20"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="px-3 py-2 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-950/40 hover:bg-white/80 dark:hover:bg-neutral-900/60"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    title={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {err && <div className="text-sm text-red-500">{err}</div>}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={busy || !!validateLogin()}
                  className={`w-full rounded-xl px-4 py-2 text-white dark:text-black transition
                    ${busy || !!validateLogin()
                      ? "bg-neutral-400/70 dark:bg-neutral-600/70 cursor-not-allowed"
                      : "bg-black/80 hover:bg-black dark:bg-white/90 dark:hover:bg-white"
                    }`}
                >
                  {busy ? "Unlocking…" : "Unlock"}
                </button>
              </div>

            </form>
          </div>
        </div>
      </div>

      {/* Floating Create button */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute bottom-6 right-6">
          <button
            onClick={() => { setCreateOpen(true); setCErr(""); }}
            className="rounded-full px-5 py-3 shadow-lg bg-white/80 dark:bg-neutral-900/80 border border-white/20 dark:border-neutral-800/60 backdrop-blur-xl hover:bg-white dark:hover:bg-neutral-900 text-neutral-900 dark:text-neutral-50"
          >
            + Create new database
          </button>
        </div>
      </div>

      {/* Create DB Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCreateOpen(false)} />
          <div className="relative w-full max-w-xl mx-4 rounded-2xl border border-white/15 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-neutral-50">
              Create encrypted database
            </h2>

            <form onSubmit={submitCreate} className="space-y-4">
              <div>
                <label className="block text-sm mb-1 text-neutral-800 dark:text-neutral-200">File path</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-2 bg-white/60 dark:bg-neutral-950/40 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/20"
                    placeholder="Where to create, e.g. ~/Documents/assettracker.db"
                    value={cPath}
                    onChange={(e) => setCPath(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={browseCreate}
                    className="px-3 py-2 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-950/40 hover:bg-white/80 dark:hover:bg-neutral-900/60"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1 text-neutral-800 dark:text-neutral-200">Password</label>
                  <div className="flex gap-2">
                    <input
                      type={cShowPw ? "text" : "password"}
                      className="w-full rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-2 bg-white/60 dark:bg-neutral-950/40 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/20"
                      value={cPw}
                      onChange={(e) => setCPw(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setCShowPw((s) => !s)}
                      className="px-3 py-2 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-950/40 hover:bg-white/80 dark:hover:bg-neutral-900/60"
                      aria-label={cShowPw ? "Hide password" : "Show password"}
                      title={cShowPw ? "Hide password" : "Show password"}
                    >
                      {cShowPw ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1 text-neutral-800 dark:text-neutral-200">Confirm password</label>
                  <input
                    type={cShowPw ? "text" : "password"}
                    className="w-full rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-2 bg-white/60 dark:bg-neutral-950/40 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/20"
                    value={cPw2}
                    onChange={(e) => setCPw2(e.target.value)}
                  />
                </div>
              </div>

              {cErr && <div className="text-sm text-red-500">{cErr}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 rounded-xl border border-neutral-300/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-950/40 hover:bg-white/80 dark:hover:bg-neutral-900/60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={cBusy || !!validateCreate()}
                  className={`px-4 py-2 rounded-xl text-white dark:text-black
                    ${cBusy || !!validateCreate()
                      ? "bg-neutral-400/70 dark:bg-neutral-600/70 cursor-not-allowed"
                      : "bg-black/80 hover:bg-black dark:bg-white/90 dark:hover:bg-white"
                    }`}
                >
                  {cBusy ? "Creating…" : "Create & Unlock"}
                </button>
              </div>
            </form>

            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-4">
              Your database is encrypted with SQLCipher. Keep your password safe.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
