import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type KeyboardEvent, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'

/**
 * The timeline: one strip along the bottom of the map (DESIGN.md §8.3). Drag or click
 * the track, or use ← → anywhere (shift for five years), to move through the data's
 * window. Every change cross-fades on the map.
 */
export function Timeline() {
  const map = useExplorer((s) => s.map)
  const year = useExplorer((s) => s.year)
  const goToYear = useExplorer((s) => s.goToYear)
  const span = map?.politics.window

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const step = e.shiftKey ? 5 : 1
      const now = useExplorer.getState().year
      if (e.key === 'ArrowLeft') goToYear(now - step)
      else if (e.key === 'ArrowRight') goToYear(now + step)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [goToYear])

  if (!span) return null
  const [first, last] = span
  const at = (y: number) => `${((y - first) / (last - first)) * 100}%`

  // A tick every five years, labelled every ten.
  const ticks: { year: number; bce: number; major: boolean }[] = []
  for (let y = first; y <= last; y++) {
    const bce = 1 - y
    if (bce % 5 === 0) ticks.push({ year: y, bce, major: bce % 10 === 0 })
  }

  // ← → belong to the page-wide handler above, which knows shift means five years;
  // stop the slider stepping too when it has focus.
  const onSliderKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()
  }

  return (
    <Card className="fixed bottom-5 left-1/2 w-[min(620px,calc(100vw-48px))] -translate-x-1/2 flex-row items-center gap-2 px-3 pt-6 pb-5 select-none">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous year"
        onClick={() => goToYear(year - 1)}
      >
        <ChevronLeft />
      </Button>
      <div className="relative flex-1">
        {/* Inset by half the thumb, where Radix keeps its centre. */}
        <div className="pointer-events-none absolute inset-x-1.5 inset-y-0">
          <span
            className="absolute bottom-1/2 mb-3 -translate-x-1/2 font-heading text-sm font-semibold tracking-[0.06em] whitespace-nowrap"
            style={{ left: at(year) }}
          >
            {formatYear(year)}
          </span>
          {ticks.map((t) => (
            <span
              key={t.year}
              className="absolute top-1/2 mt-2 flex -translate-x-1/2 flex-col items-center"
              style={{ left: at(t.year) }}
            >
              <span
                className={
                  t.major ? 'h-2 w-px bg-foreground/50' : 'h-1 w-px bg-foreground/25'
                }
              />
              {t.major && (
                <span className="figures text-[11px] text-muted-foreground">{t.bce}</span>
              )}
            </span>
          ))}
        </div>
        <Slider
          // The old track took clicks across 26px; the bare slider only its 4px line.
          className="h-7"
          aria-label="Year"
          min={first}
          max={last}
          step={1}
          value={[year]}
          onValueChange={([y]) => goToYear(y)}
          onKeyDown={onSliderKey}
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next year"
        onClick={() => goToYear(year + 1)}
      >
        <ChevronRight />
      </Button>
    </Card>
  )
}
