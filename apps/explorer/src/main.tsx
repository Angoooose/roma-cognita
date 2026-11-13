import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { mapWanted } from '@/lib/handheld.ts'
import { followSystemTheme } from '@/lib/theme.ts'
import './index.css'

// No StrictMode: its double mount would create, load and throw away a second WebGPU
// renderer and all of the map's data on every dev reload.
followSystemTheme()

// The app is imported only once the map is wanted, so a phone or tablet, which keeps
// the handheld plate, fetches none of it.
mapWanted()
  .then(() => import('./App.tsx'))
  .then(({ App }) => {
    createRoot(document.getElementById('root')!).render(
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>,
    )
  })
