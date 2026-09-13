// src/pages/Login.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Modal from "../components/Modal";
import { IconEye, IconEyeOff, IconPlus } from "../components/icons";
import { errorMessage } from "../lib/errors";
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
  const cPathRef = useRef<HTMLInputElement>(null);

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
    } catch (e: unknown) {
      setErr(errorMessage(e, "Could not open the database."));
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
    } catch (e: unknown) {
      setCErr(errorMessage(e, "Could not create the database."));
    } finally {
      setCBusy(false);
    }
  }

  const bgStyle = WALLPAPER_URL
    ? { backgroundImage: `url(${WALLPAPER_URL})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background */}
      <div
        className={`absolute inset-0 ${WALLPAPER_URL ? "" : "bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900"} `}
        style={bgStyle}
      />
      {/* Readability overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Center card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-white/70 shadow-xl backdrop-blur-xl dark:bg-neutral-900/60">
          <div className="p-7 md:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Unlock your encrypted database to continue.
              </p>
            </div>

            {/* Login form */}
            <form onSubmit={submitLogin} className="space-y-4" noValidate>
              <div>
                <label htmlFor="login-path" className="mb-1 block text-sm text-neutral-800 dark:text-neutral-200">
                  Database file
                </label>
                <div className="flex gap-2">
                  <input
                    id="login-path"
                    className="input flex-1"
                    placeholder="Select your encrypted .db"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
                  <button type="button" onClick={browseOpen} className="btn shrink-0">
                    Browse…
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="mb-1 block text-sm text-neutral-800 dark:text-neutral-200">
                  Password
                </label>
                <div className="flex gap-2">
                  <input
                    id="login-password"
                    type={showPw ? "text" : "password"}
                    className="input"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="btn shrink-0"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    aria-pressed={showPw}
                    title={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>

              {err && (
                <div role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {err}
                </div>
              )}

              <div className="pt-2">
                <button type="submit" disabled={busy} className="btn btn-primary w-full">
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
            type="button"
            onClick={() => { setCreateOpen(true); setCErr(""); }}
            className="btn rounded-full border-white/20 bg-white/80 px-5 py-3 text-neutral-900 shadow-lg backdrop-blur-xl hover:bg-white dark:border-neutral-800/60 dark:bg-neutral-900/80 dark:text-neutral-50 dark:hover:bg-neutral-900"
          >
            <IconPlus className="h-4 w-4" strokeWidth={2} />
            Create new database
          </button>
        </div>
      </div>

      {/* Create DB Modal */}
      <Modal
        open={createOpen}
        onClose={() => { if (!cBusy) setCreateOpen(false); }}
        title="Create encrypted database"
        size="xl"
        initialFocus={cPathRef}
        panelClassName="border-white/15 bg-white/85 backdrop-blur-xl dark:border-neutral-800/60 dark:bg-neutral-900/85"
      >
        <form onSubmit={submitCreate} className="space-y-4" noValidate>
          <div>
            <label htmlFor="create-path" className="mb-1 block text-sm text-neutral-800 dark:text-neutral-200">File path</label>
            <div className="flex gap-2">
              <input
                id="create-path"
                ref={cPathRef}
                className="input flex-1"
                placeholder="Where to create, e.g. ~/Documents/assettracker.db"
                value={cPath}
                onChange={(e) => setCPath(e.target.value)}
              />
              <button type="button" onClick={browseCreate} className="btn shrink-0">
                Browse…
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="create-password" className="mb-1 block text-sm text-neutral-800 dark:text-neutral-200">Password</label>
              <div className="flex gap-2">
                <input
                  id="create-password"
                  type={cShowPw ? "text" : "password"}
                  className="input"
                  value={cPw}
                  onChange={(e) => setCPw(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setCShowPw((s) => !s)}
                  className="btn shrink-0"
                  aria-label={cShowPw ? "Hide password" : "Show password"}
                  aria-pressed={cShowPw}
                  title={cShowPw ? "Hide password" : "Show password"}
                >
                  {cShowPw ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="create-password2" className="mb-1 block text-sm text-neutral-800 dark:text-neutral-200">Confirm password</label>
              <input
                id="create-password2"
                type={cShowPw ? "text" : "password"}
                className="input"
                value={cPw2}
                onChange={(e) => setCPw2(e.target.value)}
              />
            </div>
          </div>

          {cErr && (
            <div role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {cErr}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setCreateOpen(false)} className="btn" disabled={cBusy}>
              Cancel
            </button>
            <button type="submit" disabled={cBusy} className="btn btn-primary">
              {cBusy ? "Creating…" : "Create & Unlock"}
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
          Your database is encrypted with SQLCipher. There is no way to recover a lost password — keep it safe.
        </p>
      </Modal>
    </div>
  );
}
