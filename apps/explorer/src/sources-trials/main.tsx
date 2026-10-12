import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SourcesDemo } from './SourcesDemo.tsx'
import '../index.css'
import './sources.css'

createRoot(document.getElementById('root')!).render(
  <TooltipProvider delayDuration={200}>
    <SourcesDemo />
  </TooltipProvider>,
)
