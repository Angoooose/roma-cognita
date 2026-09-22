import { defineConfig } from 'vite'

export default defineConfig({
  // Pipeline outputs (the coast mask tiles) are served as static files. They are built,
  // not committed: `npm run water -w pipeline`.
  publicDir: '../../build',
  // Top-level await in main.ts, and module workers in the engine.
  build: { target: 'es2023' },
  worker: { format: 'es' },
  server: { port: 5180 },
})
