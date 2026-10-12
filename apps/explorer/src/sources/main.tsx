import { NuqsAdapter } from 'nuqs/adapters/react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { followSystemTheme } from '@/lib/theme.ts'
import { loadSources } from './data.ts'
import { SourcesPage } from './SourcesPage.tsx'
import '../index.css'

followSystemTheme()
// The map's page keeps the window still; this one is read by scrolling.
document.body.style.overflow = 'auto'
// A plain page in the leaf's colour, edge to edge, rather than a leaf laid on the table.
document.body.style.background = 'var(--card)'

const root = createRoot(document.getElementById('root')!)
loadSources().then(
  () =>
    root.render(
      <NuqsAdapter>
        <TooltipProvider delayDuration={300}>
          <SourcesPage />
        </TooltipProvider>
      </NuqsAdapter>,
    ),
  (e) => {
    console.error(e)
    root.render(
      <p className="mx-auto mt-24 max-w-[48ch] text-center text-muted-foreground italic">
        The index of sources has not been built. Run{' '}
        <code className="not-italic">npm run sources -w pipeline</code> and reload.
      </p>,
    )
  },
)
