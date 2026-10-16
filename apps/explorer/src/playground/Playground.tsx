import { Moon, SlidersHorizontal, Sun } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import paper from './backdrops/paper.jpg'
import political from './backdrops/political.jpg'
import terrain from './backdrops/terrain.jpg'
import { InSitu } from './InSitu.tsx'
import { Specimens } from './Specimens.tsx'
import { type Mode, Tuner } from './Tuner.tsx'

export const BACKDROPS = { paper, political, terrain } as const
export type Backdrop = keyof typeof BACKDROPS

function initialMode(): Mode {
  try {
    return localStorage.getItem('playground-mode') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * The theme playground. The top half is the interface as it would sit on
 * the map (over screenshots of the three zoom tiers, DESIGN.md §7.6); the bottom is a
 * specimen sheet of every component. The tuner on the right edits the tokens live.
 */
export function Playground() {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [backdrop, setBackdrop] = useState<Backdrop>('political')
  const [tuning, setTuning] = useState(true)

  // Before the tuner's effects, so it reads this mode's defaults.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.body.style.overflow = 'auto'
    try {
      localStorage.setItem('playground-mode', mode)
    } catch {}
  }, [mode])

  // cmdk scrolls its selected item into view on mount, which drags the page down to
  // the inline command specimen; start at the top instead.
  useEffect(() => {
    requestAnimationFrame(() => scrollTo(0, 0))
  }, [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-rule bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-6 py-3">
          <div className="mr-auto leading-none">
            <div className="font-heading text-lg font-semibold tracking-[0.14em]">
              Theme playground
            </div>
            <div className="text-xs text-muted-foreground italic">
              the Roma Cognita interface, for tuning
            </div>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={backdrop}
            onValueChange={(v) => v && setBackdrop(v as Backdrop)}
            aria-label="Backdrop"
          >
            <ToggleGroupItem value="paper">Paper</ToggleGroupItem>
            <ToggleGroupItem value="political">Political</ToggleGroupItem>
            <ToggleGroupItem value="terrain">Terrain</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            aria-label="Mode"
          >
            <ToggleGroupItem value="light">
              <Sun /> Parchment
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              <Moon /> Ink &amp; gold
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant={tuning ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setTuning((t) => !t)}
          >
            <SlidersHorizontal /> Tune
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px] gap-6 px-6 py-6">
        <main className="min-w-0 flex-1 space-y-10">
          <InSitu backdrop={BACKDROPS[backdrop]} />
          <Specimens />
        </main>
        {tuning && (
          <aside className="w-[300px] shrink-0">
            <Card className="sticky top-[84px]">
              <CardHeader>
                <CardTitle>Tokens</CardTitle>
                <CardDescription>
                  Editing {mode === 'light' ? 'Parchment' : 'Ink & gold'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tuner mode={mode} />
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </div>
  )
}
