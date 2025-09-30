import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})

function gitVersion() {
    const run = (cmd: string) =>
    execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

  // 1) If HEAD is exactly on a tag, use it
  try { return run('git describe --tags --exact-match'); } catch {}

  // 2) Otherwise use the *nearest* tag only (no -N-gSHA)
  try { return run('git describe --tags --abbrev=0') + "-dev"; } catch {}

}