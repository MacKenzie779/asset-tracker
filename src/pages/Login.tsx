// src/pages/Login.tsx — unlock screen in the terminal skin.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { createDatabase, openDatabase } from "../lib/api";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Modal from "../components/Modal";
import AppVersion from "../components/AppVersion";
import { errorMessage } from "../lib/errors";

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
    if (!pw) return "Enter your passphrase.";
    return null;
  }

  function validateCreate(): string | null {
    if (!cPath) return "Choose a file path.";
    if (!cPw) return "Enter a passphrase.";
    if (cPw !== cPw2) return "Passphrases do not match.";
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
      const result = await openDatabase(path, pw);
      sessionStorage.setItem("db_unlocked", "1");        // re-auth each launch
      localStorage.setItem("db_last_path", path);        // convenience only
      if (result.migrated) {
        // The shell shows a one-time notice about the upgrade and the backup.
        sessionStorage.setItem("db_upgrade_notice", JSON.stringify(result));
      }
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
      await createDatabase(cPath, cPw);
      sessionStorage.setItem("db_unlocked", "1");
      localStorage.setItem("db_last_path", cPath);
      setCreateOpen(false);
      nav("/");
    } catch (e: unknown) {
      setErr("");
      setCErr(errorMessage(e, "Could not create the database."));
    } finally {
      setCBusy(false);
    }
  }

  return (
    <div className="t-app t-login">
      <div className="t-login-panel" role="main" aria-labelledby="login-title">
        <div className="t-login-head">
          <span className="t-wordmark">ASSETTRACKER</span>
          <div className="t-vdiv" aria-hidden="true" />
          <span id="login-title" className="t-label">UNLOCK</span>
          <div className="t-spacer" />
          <span className="t-login-version"><AppVersion /></span>
        </div>

        <form onSubmit={submitLogin} className="t-login-body" noValidate>
          <div className="t-field">
            <label htmlFor="login-path" className="t-label">DATABASE FILE</label>
            <div className="t-frow">
              <input
                id="login-path"
                className={clsx("t-in", err && !path && "is-invalid")}
                placeholder="select your encrypted .db"
                value={path}
                spellCheck={false}
                onChange={(e) => setPath(e.target.value)}
              />
              <button type="button" onClick={() => void browseOpen()} className="t-btn t-btn--secondary">BROWSE…</button>
            </div>
          </div>

          <div className="t-field">
            <label htmlFor="login-password" className="t-label">PASSPHRASE</label>
            <div className="t-frow">
              <input
                id="login-password"
                type={showPw ? "text" : "password"}
                className={clsx("t-in", err && !pw && "is-invalid")}
                placeholder="•••••••••"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="t-btn t-btn--secondary"
                aria-label={showPw ? "Hide passphrase" : "Show passphrase"}
                aria-pressed={showPw}
              >
                {showPw ? "HIDE" : "SHOW"}
              </button>
            </div>
          </div>

          {err && (
            <div role="alert" className="t-login-err">{err}</div>
          )}

          <button type="submit" disabled={busy} className="t-btn t-btn--primary t-btn--wide t-login-submit">
            {busy ? "UNLOCKING…" : "UNLOCK ⏎"}
          </button>
        </form>

        <div className="t-login-foot">
          <span>SQLCipher-encrypted · the passphrase never touches the disk</span>
          <div className="t-spacer" />
          <button type="button" className="t-btn--text" onClick={() => { setCreateOpen(true); setCErr(""); }}>
            + NEW DATABASE
          </button>
        </div>
      </div>

      {/* Create DB Modal */}
      <Modal
        open={createOpen}
        onClose={() => { if (!cBusy) setCreateOpen(false); }}
        title="CREATE ENCRYPTED DATABASE"
        size="lg"
        initialFocus={cPathRef}
      >
        <form onSubmit={submitCreate} className="t-login-body" style={{ padding: 0 }} noValidate>
          <div className="t-field">
            <label htmlFor="create-path" className="t-label">FILE PATH</label>
            <div className="t-frow">
              <input
                id="create-path"
                ref={cPathRef}
                className="t-in"
                placeholder="where to create, e.g. ~/Documents/assettracker.db"
                value={cPath}
                spellCheck={false}
                onChange={(e) => setCPath(e.target.value)}
              />
              <button type="button" onClick={() => void browseCreate()} className="t-btn t-btn--secondary">BROWSE…</button>
            </div>
          </div>

          <div className="t-frow" style={{ alignItems: "flex-start", gap: 12 }}>
            <div className="t-field" style={{ flex: 1 }}>
              <label htmlFor="create-password" className="t-label">PASSPHRASE</label>
              <div className="t-frow">
                <input
                  id="create-password"
                  type={cShowPw ? "text" : "password"}
                  className="t-in"
                  value={cPw}
                  onChange={(e) => setCPw(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setCShowPw((s) => !s)}
                  className="t-btn t-btn--secondary"
                  aria-label={cShowPw ? "Hide passphrase" : "Show passphrase"}
                  aria-pressed={cShowPw}
                >
                  {cShowPw ? "HIDE" : "SHOW"}
                </button>
              </div>
            </div>
            <div className="t-field" style={{ flex: 1 }}>
              <label htmlFor="create-password2" className="t-label">CONFIRM</label>
              <input
                id="create-password2"
                type={cShowPw ? "text" : "password"}
                className={clsx("t-in", cPw2 && cPw !== cPw2 && "is-invalid")}
                value={cPw2}
                onChange={(e) => setCPw2(e.target.value)}
              />
            </div>
          </div>

          {cErr && <div role="alert" className="t-login-err">{cErr}</div>}

          <div className="t-frow" style={{ justifyContent: "flex-end", gap: 6 }}>
            <button type="button" onClick={() => setCreateOpen(false)} className="t-btn t-btn--secondary" disabled={cBusy}>CANCEL</button>
            <button type="submit" disabled={cBusy} className="t-btn t-btn--primary">{cBusy ? "CREATING…" : "CREATE & UNLOCK ⏎"}</button>
          </div>

          <p className="t-help" style={{ marginTop: 2 }}>
            There is no way to recover a lost passphrase — keep it safe, and back up the .db file itself.
          </p>
        </form>
      </Modal>
    </div>
  );
}
