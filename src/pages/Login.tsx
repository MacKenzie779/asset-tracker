// src/pages/Login.tsx — unlock screen in the terminal skin.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { createDatabase, openDatabase } from "../lib/api";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Modal from "../components/Modal";
import AppVersion from "../components/AppVersion";
import { errorMessage } from "../lib/errors";
import { LanguageControl } from "../components/terminal/HeaderControls";
import { useI18n } from "../hooks/useI18n";

export default function Login() {
  const { t } = useI18n();
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
    if (!path) return t('login.chooseFile');
    if (!pw) return t('login.enterPw');
    return null;
  }

  function validateCreate(): string | null {
    if (!cPath) return t('login.choosePath');
    if (!cPw) return t('login.enterNewPw');
    if (cPw !== cPw2) return t('login.pwMismatch');
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
      setErr(errorMessage(e, t('login.openFailed')));
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
      setCErr(errorMessage(e, t('login.createFailed')));
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
          <span id="login-title" className="t-label">{t('login.unlock')}</span>
          <div className="t-spacer" />
          <LanguageControl />
          <span className="t-login-version"><AppVersion /></span>
        </div>

        <form onSubmit={submitLogin} className="t-login-body" noValidate>
          <div className="t-field">
            <label htmlFor="login-path" className="t-label">{t('login.dbFile')}</label>
            <div className="t-frow">
              <input
                id="login-path"
                className={clsx("t-in", err && !path && "is-invalid")}
                placeholder={t('login.dbPlaceholder')}
                value={path}
                spellCheck={false}
                onChange={(e) => setPath(e.target.value)}
              />
              <button type="button" onClick={() => void browseOpen()} className="t-btn t-btn--secondary">{t('login.browse')}</button>
            </div>
          </div>

          <div className="t-field">
            <label htmlFor="login-password" className="t-label">{t('login.passphrase')}</label>
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
                aria-label={showPw ? t('login.hidePw') : t('login.showPw')}
                aria-pressed={showPw}
              >
                {showPw ? t('login.hide') : t('login.show')}
              </button>
            </div>
          </div>

          {err && (
            <div role="alert" className="t-login-err">{err}</div>
          )}

          <button type="submit" disabled={busy} className="t-btn t-btn--primary t-btn--wide t-login-submit">
            {busy ? t('login.unlocking') : t('login.submit')}
          </button>
        </form>

        <div className="t-login-foot">
          <span>{t('login.foot')}</span>
          <div className="t-spacer" />
          <button type="button" className="t-btn--text" onClick={() => { setCreateOpen(true); setCErr(""); }}>
            {t('login.newDb')}
          </button>
        </div>
      </div>

      {/* Create DB Modal */}
      <Modal
        open={createOpen}
        onClose={() => { if (!cBusy) setCreateOpen(false); }}
        title={t('login.createTitle')}
        size="lg"
        initialFocus={cPathRef}
      >
        <form onSubmit={submitCreate} className="t-login-body" style={{ padding: 0 }} noValidate>
          <div className="t-field">
            <label htmlFor="create-path" className="t-label">{t('login.filePath')}</label>
            <div className="t-frow">
              <input
                id="create-path"
                ref={cPathRef}
                className="t-in"
                placeholder={t('login.createPlaceholder')}
                value={cPath}
                spellCheck={false}
                onChange={(e) => setCPath(e.target.value)}
              />
              <button type="button" onClick={() => void browseCreate()} className="t-btn t-btn--secondary">{t('login.browse')}</button>
            </div>
          </div>

          <div className="t-frow" style={{ alignItems: "flex-start", gap: 12 }}>
            <div className="t-field" style={{ flex: 1 }}>
              <label htmlFor="create-password" className="t-label">{t('login.passphrase')}</label>
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
                  aria-label={cShowPw ? t('login.hidePw') : t('login.showPw')}
                  aria-pressed={cShowPw}
                >
                  {cShowPw ? t('login.hide') : t('login.show')}
                </button>
              </div>
            </div>
            <div className="t-field" style={{ flex: 1 }}>
              <label htmlFor="create-password2" className="t-label">{t('login.confirm')}</label>
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
            <button type="button" onClick={() => setCreateOpen(false)} className="t-btn t-btn--secondary" disabled={cBusy}>{t('action.cancel')}</button>
            <button type="submit" disabled={cBusy} className="t-btn t-btn--primary">{cBusy ? t('login.creating') : t('login.createSubmit')}</button>
          </div>

          <p className="t-help" style={{ marginTop: 2 }}>
            {t('login.recoveryNote')}
          </p>
        </form>
      </Modal>
    </div>
  );
}
