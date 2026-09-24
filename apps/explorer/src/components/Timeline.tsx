import { ChevronLeft, ChevronRight, MoveHorizontal, X } from 'lucide-react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'

/**
 * The timeline (DESIGN.md §8.3): a slim ink strip in the bottom-right corner that
 * always shows the year shown, between two steps. Its toggle opens a ruler to the
 * year's left, to drag or click through the data's window; ← → work anywhere (shift
 * for five years). Every change cross-fades on the map.
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
  return (
    <TimelinePanel
      year={year}
      span={span}
      onYear={goToYear}
      className="fixed right-4 bottom-4"
    />
  )
}

const STORE = 'timeline-open'

/** Open on a first visit, so the scale is seen once; after that, as it was left. */
function initialOpen() {
  try {
    return localStorage.getItem(STORE) !== 'false'
  } catch {
    return true
  }
}

/** The timeline itself, from a year and a window; the playground drives it locally. */
export function TimelinePanel({
  year,
  span: [first, last],
  onYear,
  className,
}: {
  year: number
  span: [number, number]
  onYear: (year: number) => void
  className?: string
}) {
  const [open, setOpen] = useState(initialOpen)
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(STORE, String(!o))
      } catch {}
      return !o
    })

  return (
    // One slim strip in the reader's theme. The year never moves; the ruler opens to its
    // left on the same line, so nothing stacks on the year.
    <div
      className={cn(
        // One height, open or folded: the ruler's, so nothing shifts when it opens.
        'flex h-10 items-center rounded-lg border border-rule bg-background/90 pr-1 pl-1.5 text-foreground shadow-plate backdrop-blur-sm select-none',
        className,
      )}
    >
      <div
        className="overflow-hidden transition-[width,opacity] duration-300 ease-out"
        style={{ width: open ? SCALE_WIDTH : 0, opacity: open ? 1 : 0 }}
        aria-hidden={!open}
      >
        {open && <Scale year={year} first={first} last={last} onYear={onYear} />}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="timeline-scale"
            aria-label={open ? 'Hide the timeline' : 'Show the timeline'}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
          >
            {open ? <X /> : <MoveHorizontal />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{open ? 'Hide the timeline' : 'Timeline'}</TooltipContent>
      </Tooltip>
      <span className="mx-1 h-5 w-px bg-rule" aria-hidden />
      <Step label="Previous year" disabled={year <= first} onClick={() => onYear(year - 1)}>
        <ChevronLeft />
      </Step>
      <span className="min-w-[5.5em] text-center font-heading text-base leading-none font-semibold tracking-[0.1em]">
        {formatYear(year)}
      </span>
      <Step label="Next year" disabled={year >= last} onClick={() => onYear(year + 1)}>
        <ChevronRight />
      </Step>
    </div>
  )
}

const SCALE_WIDTH = 300
/** The index is the sea names' gold (labels/LabelLayer.ts), apart from the cream rule. */
const INDEX = 'var(--gold)'
/** Where the rule runs, from the top of the scale. */
const RULE_Y = 11

function Scale(props: {
  year: number
  first: number
  last: number
  onYear: (y: number) => void
}) {
  const { year, first, last, onYear } = props
  const at = (y: number) => `${((y - first) / (last - first)) * 100}%`
  // A fine tick every year, a longer one every five; those and the window's ends are
  // numbered.
  const ticks: { year: number; bce: number; major: boolean; label: boolean }[] = []
  for (let y = first; y <= last; y++) {
    const bce = 1 - y
    const major = bce % 5 === 0
    ticks.push({ year: y, bce, major, label: major || y === first || y === last })
  }
  // ← → belong to the page-wide handler, which knows shift means five years; stop the
  // slider stepping too when it has focus.
  const onSliderKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault()
  }
  return (
    // Radix does the dragging, clicks and keys; the Track fills the root, so the whole
    // strip takes clicks, not only the rule.
    // Padding outside the Root: Radix measures pointer positions against its box.
    <div className="px-2">
      <SliderPrimitive.Root
        id="timeline-scale"
        data-slot="slider"
        className="relative flex h-[38px] w-full touch-none items-start select-none"
        aria-label="Year"
        min={first}
        max={last}
        step={1}
        value={[year]}
        onValueChange={([y]) => onYear(y)}
        onKeyDown={onSliderKey}
      >
        <SliderPrimitive.Track className="relative h-full grow">
          {/* Inset by half the thumb, where Radix keeps its centre. */}
          <svg className="absolute inset-y-0 left-1.5 h-full w-[calc(100%-12px)] animate-in overflow-visible duration-300 fade-in-0">
            <line
              x1="0"
              x2="100%"
              y1={RULE_Y}
              y2={RULE_Y}
              stroke="currentColor"
              strokeOpacity="0.7"
            />
            {ticks.map((t) => (
              <g key={t.year}>
                <line
                  x1={at(t.year)}
                  x2={at(t.year)}
                  y1={RULE_Y}
                  y2={RULE_Y + (t.major || t.label ? 6 : 3.5)}
                  stroke="currentColor"
                  strokeOpacity={t.major ? 0.85 : 0.5}
                />
                {t.label && (
                  <text
                    x={at(t.year)}
                    y={RULE_Y + 18}
                    textAnchor="middle"
                    fill="currentColor"
                    fillOpacity={t.major ? 0.9 : 0.65}
                    className="figures text-xs"
                  >
                    {t.bce}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-valuetext={formatYear(year)}
          className="group/thumb relative block w-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          style={{ height: RULE_Y }}
        >
          {/* The index: a small pointer whose tip meets the rule. */}
          <svg
            viewBox="0 0 12 9"
            className="absolute inset-x-0 bottom-0 h-2 w-[11px] overflow-visible transition-transform group-hover/thumb:scale-110"
          >
            <polygon points="0,0 12,0 6,9" fill={INDEX} />
          </svg>
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
    </div>
  )
}

function Step(props: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="grid size-7 place-items-center rounded-md text-foreground/80 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4"
    >
      {props.children}
    </button>
  )
}
