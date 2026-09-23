import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Pipeline outputs (the coast mask tiles) are served as static files. They are built,
  // not committed: `npm run water -w pipeline`.
  publicDir: '../../build',
  // Module workers in the engine.
  build: { target: 'es2023' },
  worker: { format: 'es' },
  server: { port: 5180 },
})
