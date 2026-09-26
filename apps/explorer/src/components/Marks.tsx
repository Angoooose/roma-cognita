import { ChevronDown } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatSpan, formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'

/**
 * The parts the person and province panels are drawn with, taken from the rest of the
 * map's interface so the panels read as the same hand: the timeline's ruler and gold
 * index, the legend's swatches and its "fainter" for doubt, and search's index lines
 * with their dotted leaders.
 */

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="caps mb-1.5 flex items-center gap-2 text-xs text-muted-foreground after:h-px after:flex-1 after:bg-rule after:content-['']">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A rule with a seat's diamond at its centre: the one ornament the theme allows. */
export function Fleuron({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-rule ${className ?? ''}`} aria-hidden>
      <span className="h-px flex-1 bg-current" />
      <span className="size-1.5 rotate-45 bg-gold" />
      <span className="h-px flex-1 bg-current" />
    </div>
  )
}

/**
 * Whether a fold is open, remembered in this browser under `name`, as the legend
 * remembers itself (Legend.tsx): a reader who opens Family keeps it open from one
 * person to the next. Closed where storage is blocked.
 */
export function useRemembered(name: string): [boolean, (open: boolean) => void] {
  const key = `fold-open:${name}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === 'true'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {}
  }
  return [open, set]
}

/** A section folded to its heading, for what not every reader wants; `name` keeps its state. */
export function Fold(props: { name: string; title: ReactNode; children: ReactNode }) {
  const { title, children } = props
  const [open, setOpen] = useRemembered(props.name)
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        className="caps flex w-full items-center gap-2 text-left text-xs whitespace-nowrap text-muted-foreground transition-colors after:h-px after:flex-1 after:bg-rule after:content-[''] hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {title}
        <ChevronDown
          className={cn('order-last size-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </section>
  )
}

/** The query mark: the one sign of doubt in words. It explains itself on hover. */
export function Q() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground">?</span>
      </TooltipTrigger>
      <TooltipContent>Uncertain: the sources leave this in doubt</TooltipContent>
    </Tooltip>
  )
}

/**
 * How sure a record is, in one word that explains itself, as the legend's key does.
 * One language for doubt, for territories, places and people alike: certain and
 * probable are drawn in full; uncertain is drawn fainter, with the query mark after its
 * name. A dashed line is not doubt but absence: no claim recorded, no one attested.
 */
export function Certainty({ level }: { level: string }) {
  const says: Record<string, string> = {
    certain: 'The sources agree on it.',
    probable: 'The sources agree on the substance, not every date.',
    uncertain: 'The sources conflict or are silent.',
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-foreground/30 decoration-dotted underline-offset-[3px]">
          {level}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{says[level] ?? level}</TooltipContent>
    </Tooltip>
  )
}

/** The timeline's index (Timeline.tsx): a small gold pointer whose tip meets the rule. */
export function Index() {
  return (
    <svg viewBox="0 0 12 9" className="h-2 w-[11px] overflow-visible" aria-hidden>
      <polygon points="0,0 12,0 6,9" fill="var(--gold)" />
    </svg>
  )
}

export const INK = 'var(--foreground)'
/** Uncertain is fainter, as the legend keys an uncertain claim. */
export const opacity = (fill: string, uncertain?: boolean) =>
  fill === INK ? (uncertain ? 0.2 : 0.55) : uncertain ? 0.45 : 1

/** A legend swatch (Legend.tsx). `open` fades it in, as the legend's schematic frontier. */
export function Swatch(props: { fill: string; uncertain?: boolean; open?: boolean }) {
  return (
    <span
      className="block h-3 w-5 rounded-[1px]"
      style={{
        background: props.open
          ? `linear-gradient(90deg, transparent, ${props.fill} 85%)`
          : props.fill,
        opacity: opacity(props.fill, props.uncertain),
      }}
    />
  )
}

/** The legend's "No claim recorded" swatch: an empty dashed box, for a year with no one in it. */
export function EmptySwatch() {
  return (
    <span className="block h-3 w-5 rounded-[1px] border border-dashed border-foreground/40" />
  )
}

/** An office: a small ink dot, the same on the chart and in the list. */
export function Dot({ uncertain }: { uncertain?: boolean }) {
  return (
    <span
      className="block size-[7px] rounded-full"
      style={{ background: INK, opacity: uncertain ? 0.35 : 0.9 }}
    />
  )
}

/** Rome's fills as the legend shows them this year: a command is its ground's colour. */
export function useRomeFills() {
  const map = useExplorer((s) => s.map)
  const year = useExplorer((s) => s.year)
  return useMemo(() => {
    const rome = map?.politics.legend(year)?.powers.find((p) => p.id === 'rome')
    return {
      rome: rome?.fill ?? '#ae4a42',
      province: rome?.province ?? '#b85556',
      client: rome?.client ?? '#c39790',
    }
  }, [map, year])
}

export function KeyItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="grid w-5 shrink-0 place-items-center">{swatch}</span>
      <span className="leading-tight">{children}</span>
    </span>
  )
}

/** A legend row (Legend.tsx): a swatch, then the words, on a line of their own. */
export function KeyRow({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid w-5 shrink-0 place-items-center">{swatch}</span>
      <span className="leading-tight">{children}</span>
    </div>
  )
}

// --- the chart -----------------------------------------------------------------------

/** A run of years drawn across a lane, one cell a year, so a single year has width. */
export interface Axis {
  lo: number
  hi: number
  n: number
  /** The left edge of a year's cell, as a CSS length. */
  at(y: number): string
  /** The middle of a year's cell. */
  mid(y: number): string
  /** The width of a run of years' cells. */
  width(from: number, to: number): string
}

export function axis(lo: number, hi: number): Axis {
  const n = hi - lo + 1
  return {
    lo,
    hi,
    n,
    at: (y) => `${((y - lo) / n) * 100}%`,
    mid: (y) => `${((y - lo + 0.5) / n) * 100}%`,
    width: (from, to) => `${((to - from + 1) / n) * 100}%`,
  }
}

export interface Lane {
  label: string
  /** A Tailwind height; lanes are h-5 unless they need more. */
  height?: string
  body: ReactNode
}

/**
 * Lanes on one axis over the timeline's ruler, with the gold index at the year the map
 * shows and its hairline up through the lanes, and a key in the legend's manner.
 */
export function LaneChart(props: {
  axis: Axis
  lanes: Lane[]
  fill?: string
  /** Keys in place of Held and Uncertain, for a chart that is not of holding. */
  legend?: ReactNode
}) {
  const year = useExplorer((s) => s.year)
  const { axis: a, lanes } = props
  const shows = a.lo <= year && year <= a.hi
  const fill = props.fill ?? INK
  return (
    <div>
      <div className="grid grid-cols-[4.25rem_1fr]">
        <div className="flex flex-col">
          {lanes.map((l) => (
            <div
              key={l.label}
              className={cn(
                'flex items-center truncate text-xs text-muted-foreground italic',
                l.height ?? 'h-5',
              )}
            >
              {l.label}
            </div>
          ))}
        </div>
        <div className="relative">
          {shows && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-gold/60"
              style={{ left: a.mid(year) }}
            />
          )}
          {lanes.map((l) => (
            <div key={l.label} className={cn('relative', l.height ?? 'h-5')}>
              {l.body}
            </div>
          ))}
        </div>
        <div className="figures pt-3.5 text-[0.6875rem] text-muted-foreground">BCE</div>
        <Ruler axis={a} year={shows ? year : null} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
        {props.legend ?? (
          <>
            <KeyItem swatch={<Swatch fill={fill} />}>Held</KeyItem>
            <KeyItem swatch={<Swatch fill={fill} uncertain />}>Uncertain</KeyItem>
          </>
        )}
        {shows && <KeyItem swatch={<Index />}>The map's year</KeyItem>}
      </div>
    </div>
  )
}

/** A span in a lane: a legend swatch stretched over its years. */
export function Bar(props: {
  axis: Axis
  from: number
  to: number
  fill: string
  uncertain?: boolean
  /** The sources leave this end open: it fades out, as the legend's schematic frontier. */
  openStart?: boolean
  openEnd?: boolean
  className?: string
}) {
  const { fill } = props
  const background =
    props.openStart || props.openEnd
      ? `linear-gradient(90deg, ${props.openStart ? 'transparent' : fill}, ${fill} 12%, ${fill} 88%, ${props.openEnd ? 'transparent' : fill})`
      : fill
  return (
    <span
      className={cn(
        'absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[1px]',
        props.className,
      )}
      style={{
        left: props.axis.at(props.from),
        width: props.axis.width(props.from, props.to),
        background,
        opacity: opacity(fill, props.uncertain),
      }}
    />
  )
}

/**
 * The timeline's scale, drawn small: fine ticks, longer ones at intervals, numbered in
 * years BCE, and the gold index at the year the map shows.
 */
function Ruler({ axis: a, year }: { axis: Axis; year: number | null }) {
  const [minor, major, label] =
    a.n <= 60 ? [1, 5, 10] : a.n <= 150 ? [5, 10, 20] : [10, 50, 50]
  const ticks: number[] = []
  for (let y = a.lo; y <= a.hi; y++) if ((1 - y) % minor === 0) ticks.push(y)
  return (
    <div className="relative h-7">
      {year !== null && (
        <div className="absolute top-0 -translate-x-1/2" style={{ left: a.mid(year) }}>
          <Index />
        </div>
      )}
      <svg
        className="absolute inset-x-0 top-2 h-5 w-full overflow-visible text-foreground"
        aria-hidden
      >
        <line x1="0" x2="100%" y1="0" y2="0" stroke="currentColor" strokeOpacity="0.7" />
        {ticks.map((y) => {
          const bce = 1 - y
          const long = bce % major === 0
          return (
            <g key={y}>
              <line
                x1={a.mid(y)}
                x2={a.mid(y)}
                y1="0"
                y2={long ? 5.5 : 3}
                stroke="currentColor"
                strokeOpacity={long ? 0.8 : 0.4}
              />
              {bce % label === 0 && bce > 0 && (
                <text
                  x={a.mid(y)}
                  y="16"
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity="0.75"
                  className="figures text-[0.6875rem]"
                >
                  {bce}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// --- the lists -----------------------------------------------------------------------

/**
 * A line of the index, as search sets one (Search.tsx): its mark, the words, a dotted
 * leader, and the years. What is current in the map's year is shaded, with the gold
 * index, and says so on hover.
 */
export function IndexRow(props: {
  mark?: ReactNode
  from: number
  to: number
  children: ReactNode
  /** What the index says on hover: `Held in 63 BCE`. */
  now?: (year: string) => string
  /** A line saying there is nothing here, such as "No one attested". */
  faint?: boolean
}) {
  const year = useExplorer((s) => s.year)
  const now = props.from <= year && year <= props.to
  const said = (props.now ?? ((y) => `Held in ${y}`))(formatYear(year))
  return (
    <li
      className={cn(
        '-mx-1.5 flex items-center gap-2.5 rounded-sm px-1.5 py-[3px]',
        now && 'bg-accent/40',
      )}
    >
      <span className="grid w-5 shrink-0 place-items-center">{props.mark}</span>
      <span
        className={cn(
          'min-w-0 leading-snug text-pretty',
          props.faint && 'text-muted-foreground italic',
        )}
      >
        {props.children}
      </span>
      <span
        className="mx-0.5 min-w-4 flex-1 self-center border-b border-dotted border-foreground/30"
        aria-hidden
      />
      {now && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="-mr-1 grid shrink-0 place-items-center">
              <Index />
              <span className="sr-only">{said}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{said}, the year the map shows</TooltipContent>
        </Tooltip>
      )}
      <span className="figures shrink-0 whitespace-nowrap text-muted-foreground">
        {formatSpan([props.from, props.to])}
      </span>
    </li>
  )
}
