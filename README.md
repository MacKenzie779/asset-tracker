# AssetTracker

*Local-first desktop expense tracker — **Tauri (Rust)** + **React/Vite/TS** + **SQLite/SQLCipher**.*

> **Privacy-first & offline.** Your data lives on your machine, encrypted at rest.

---

## 🧱 Tech stack

* **Desktop shell:** Tauri (Rust)
* **Frontend:** React + Vite + TypeScript + Tailwind
* **DB:** SQLite via `sqlx` (SQLCipher-compatible)
* **PDF:** `printpdf` with tuned table layout & clipping
* **XLSX:** `rust_xlsxwriter` with autosizing + EU formats

---

## 🚀 Quickstart (npm)

**Prereqs:** Node 20+, Rust (stable), Tauri deps.
*(If you build yourself: ensure the SQLite runtime is SQLCipher-enabled.)*

```bash
npm install
npm run tauri:dev
# build installers/bundles
npm run tauri:build
```
