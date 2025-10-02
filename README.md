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
```
## Install on Linux (Flatpak, auto-updates)

One-time prerequisites:

```bash
sudo pacman -S flatpak      
flatpak --user remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
````

Install AssetTracker from our Flatpak repo (hosted via GitHub Pages):

```bash
flatpak install --user --from https://mackenzie779.github.io/asset-tracker/AssetTracker.flatpakref
```

Run:

```bash
flatpak run com.github.mackenzie779.assettracker
```

Update later:

```bash
flatpak update
```

Uninstall:

```bash
flatpak uninstall com.github.mackenzie779.assettracker
```
