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
  // The other pages: the index of sources, /sources, whose data is built by
  // `npm run sources -w pipeline`; the theme playground, /playground.html; and the
  // trials the sources page was chosen from, /sources-trials.html.
  build: {
    target: 'es2023',
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        sources: path.resolve(import.meta.dirname, 'sources.html'),
        playground: path.resolve(import.meta.dirname, 'playground.html'),
        'sources-trials': path.resolve(import.meta.dirname, 'sources-trials.html'),
      },
    },
  },
  worker: { format: 'es' },
  server: { port: 5180 },
})
