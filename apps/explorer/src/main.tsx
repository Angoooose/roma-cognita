import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

// No StrictMode: its double mount would create, load and throw away a second WebGPU
// renderer and all of the map's data on every dev reload.
createRoot(document.getElementById('root')!).render(<App />)
