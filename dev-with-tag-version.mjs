#!/usr/bin/env node
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const pkgPath = path.resolve(process.cwd(), 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
let changed = false;

function tryRun(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

// 1) exact tag on HEAD, else (optional) nearest tag if NEAREST_TAG=1 is set
const exactTag = tryRun('git describe --tags --exact-match');
const nearestTag = process.env.NEAREST_TAG ? tryRun('git describe --tags --abbrev=0') : null;
const tag = exactTag || nearestTag;

if (tag) {
  const ver = tag.replace(/^v/, ''); // strip leading "v"
  const pkg = JSON.parse(original);
  if (pkg.version !== ver) {
    pkg.version = ver;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    changed = true;
    console.log(`[tauri:dev] package.json version set to ${ver} (from ${tag})`);
  } else {
    console.log(`[tauri:dev] package.json already at ${ver}`);
  }
} else {
  console.log('[tauri:dev] No tag on HEAD (and NEAREST_TAG not set). Leaving package.json unchanged.');
}

// Launch tauri dev
const exe = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(exe, ['tauri', 'dev'], { stdio: 'inherit' });

// Restore package.json when dev exits
function restore() {
  if (changed) {
    fs.writeFileSync(pkgPath, original);
    console.log('[tauri:dev] Restored original package.json');
  }
}

child.on('exit', (code) => { restore(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('uncaughtException', (e) => { console.error(e); restore(); process.exit(1); });
