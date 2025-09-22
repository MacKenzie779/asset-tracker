
# AssetTracker (Tauri + React + Rust + SQLite)

Local-first, fast desktop app starter. Beautiful UI with Tailwind; Rust core with SQLite.

## Prereqs (Arch Linux)
```bash
sudo pacman -S --needed base-devel rustup nodejs npm sqlite webkit2gtk gtk3 libappindicator-gtk3 librsvg
rustup default stable   # if you haven't already
```

## Get started
```bash
cd assettracker-tauri
npm install
npm run tauri:dev
```

## Build a release binary
```bash
npm run tauri:build
```

## Where is my data?
The SQLite DB is created under your OS app data dir, e.g.
`~/.local/share/AssetTracker/assettracker.db` (exact path depends on your environment).
