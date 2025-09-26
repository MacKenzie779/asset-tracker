import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',                 // ← important for Tauri release builds
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})
