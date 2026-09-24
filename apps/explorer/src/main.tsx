import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { followSystemTheme } from '@/lib/theme.ts'
import { App } from './App.tsx'
import './index.css'

// No StrictMode: its double mount would create, load and throw away a second WebGPU
// renderer and all of the map's data on every dev reload.
followSystemTheme()

createRoot(document.getElementById('root')!).render(
  <TooltipProvider delayDuration={300}>
    <App />
  </TooltipProvider>,
)
