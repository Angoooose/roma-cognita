import { defineConfig } from 'vite'

export default defineConfig({
  // Top-level await in main.ts, and module workers in the engine.
  build: { target: 'es2023' },
  worker: { format: 'es' },
  server: { port: 5180 },
})
