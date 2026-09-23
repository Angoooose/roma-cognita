import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Playground } from './Playground.tsx'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <TooltipProvider delayDuration={200}>
    <Playground />
  </TooltipProvider>,
)
