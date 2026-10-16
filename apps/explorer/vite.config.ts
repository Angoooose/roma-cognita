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
  // The other page is the index of sources, /sources, whose data is built by
  // `npm run sources -w pipeline`. The theme playground, /playground.html, is left out
  // of the build: `vite dev` serves any html file in this folder, so it is dev-only.
  build: {
    target: 'es2023',
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        sources: path.resolve(import.meta.dirname, 'sources.html'),
      },
    },
  },
  // Module workers in the engine.
  worker: { format: 'es' },
  server: { port: 5180 },
})
