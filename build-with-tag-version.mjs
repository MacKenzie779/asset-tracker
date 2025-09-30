#!/usr/bin/env node
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const pkgPath = path.resolve(process.cwd(), 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
let changed = false;

function run(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

// Prefer an exact tag; optionally allow nearest if NEAREST_TAG=1
const exact = run('git describe --tags --exact-match');
const nearest = process.env.NEAREST_TAG ? run('git describe --tags --abbrev=0') : null;
const tag = exact || nearest;

if (tag) {
  const ver = tag.replace(/^v/, '');
  const pkg = JSON.parse(original);
  if (pkg.version !== ver) {
    pkg.version = ver;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    changed = true;
    console.log(`[tauri:build] package.json version set to ${ver} (from ${tag})`);
  } else {
    console.log(`[tauri:build] package.json already at ${ver}`);
  }
} else {
  console.log('[tauri:build] No tag on HEAD (and NEAREST_TAG not set). Leaving package.json unchanged.');
}

// forward any extra args, e.g. --bundles nsis -v
const extra = process.argv.slice(2);
const exe = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(exe, ['tauri', 'build', ...extra], { stdio: 'inherit' });

function restore() {
  if (changed) {
    fs.writeFileSync(pkgPath, original);
    console.log('[tauri:build] Restored original package.json');
  }
}

child.on('exit', (code) => { restore(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('uncaughtException', (e) => { console.error(e); restore(); process.exit(1); });
