import { type PoliticsLegend, UNCERTAIN_ALPHA } from '@roman-map/engine'
import { ChevronUp } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useExplorer } from '@/store.ts'

/**
 * The legend (DESIGN.md §8.3): what each colour and mark on the map means, for the year
 * shown. Colours are read from the engine, never restated here, so a change to the
 * palette cannot leave the legend behind. Each kind of doubt is keyed only in a year
 * that has some.
 */
export function Legend() {
  const map = useExplorer((s) => s.map)
  const year = useExplorer((s) => s.year)
  const data = useMemo(() => {
    if (!map) return null
    const politics = map.politics.legend(year)
    if (!politics) return null
    const seat = map.places.seatsIn(year)[0]
    return {
      politics,
      seat: seat && {
        fill: `#${map.politics.colourOf(seat.polity, year).getHexString()}`,
      },
    }
  }, [map, year])
  if (!data) return null
  return <LegendPanel {...data} className="fixed bottom-4 left-4" />
}

const STORE = 'legend-open'

function initialOpen() {
  try {
    return localStorage.getItem(STORE) !== 'false'
  } catch {
    return true
  }
}

export interface LegendData {
  politics: PoliticsLegend
  /** A kingdom drawn by its seat this year, in its colour. The map names it. */
  seat?: { fill: string }
}

/** The legend itself, from data; the playground draws it from a sample. */
export function LegendPanel({
  politics,
  seat,
  className,
}: LegendData & { className?: string }) {
  const [open, setOpen] = useState(initialOpen)
  // Open and collapsed are different buttons; keep focus on the toggle across the swap.
  const toggleRef = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (toggled.current) toggleRef.current?.focus()
    toggled.current = false
  }, [open])
  const toggle = () =>
    setOpen((o) => {
      toggled.current = true
      try {
        localStorage.setItem(STORE, String(!o))
      } catch {}
      return !o
    })

  const [lead, ...others] = politics.powers
  const otherFills = [...new Set(others.map((p) => p.fill))]

  // Collapsed, it is lettered on the map rather than boxed: the settlement names' light
  // Cinzel on their dark halo (labels/PlaceLayer.ts), so it reads as part of the sheet.
  if (!open)
    return (
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        aria-expanded={false}
        className={cn(
          'px-1 py-1 font-heading text-[0.8125rem] font-semibold tracking-[0.14em] text-[#F3EBDA] opacity-80 transition-opacity outline-none [text-shadow:0_0_2px_#1B1612,0_0_4px_#1B1612,0_0_9px_rgb(27_22_18/0.7)] hover:opacity-100 focus-visible:opacity-100 focus-visible:underline focus-visible:underline-offset-4',
          className,
        )}
      >
        Legend
      </button>
    )

  return (
    <Card size="sm" className={cn('w-[240px] gap-0 py-0', className)}>
      {/* Not a CardHeader: that is a size container, and needs a width given. */}
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        aria-expanded
        aria-controls="legend-body"
        className="flex w-full items-center justify-between gap-3 px-(--card-spacing) py-2.5 text-left outline-none focus-visible:text-primary"
      >
        <CardTitle className="text-xs">Legend</CardTitle>
        <ChevronUp className="size-4 rotate-180 text-muted-foreground" />
      </button>
      <CardContent id="legend-body" className="space-y-1.5 pb-(--card-spacing) text-sm">
        {lead && (
          <>
            <Key swatch={<Swatch fill={lead.fill} />}>{lead.name}</Key>
            {lead.province && (
              <Key swatch={<Swatch fill={lead.province} />}>its provinces</Key>
            )}
            {lead.client && (
              <Key swatch={<Swatch fill={lead.client} />}>its client kingdoms</Key>
            )}
          </>
        )}
        {otherFills.length > 0 && (
          <Key swatch={<Strip fills={otherFills} />}>
            Other powers, <span className="italic">named on the map</span>
          </Key>
        )}
        {politics.uncertain && lead && (
          <Key
            swatch={<Swatch fill={lead.province ?? lead.fill} alpha={UNCERTAIN_ALPHA} />}
          >
            Claim uncertain: <span className="italic">fainter</span>
          </Key>
        )}
        {politics.schematic && lead && (
          <Key
            swatch={
              <span
                className="block h-3 w-5"
                style={{
                  background: `linear-gradient(90deg, transparent, ${lead.province ?? lead.fill} 85%)`,
                }}
              />
            }
          >
            Frontier schematic: <span className="italic">no line</span>
          </Key>
        )}
        {politics.unclaimed && (
          <Key
            swatch={
              <span className="block h-3 w-5 rounded-[1px] border border-dashed border-foreground/40" />
            }
          >
            No claim recorded
          </Key>
        )}
        <Separator className="my-2" />
        <Key swatch={<Caput />}>Rome</Key>
        <Key swatch={<Capital />}>Provincial or royal seat</Key>
        <Key swatch={<Town />}>Town</Key>
        {seat && (
          <Key swatch={<Seat fill={seat.fill} />}>
            Kingdom, <span className="italic">extent unknown</span>
          </Key>
        )}
        <Key swatch={<Road />}>Road, where dated</Key>
      </CardContent>
    </Card>
  )
}

function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid w-5 shrink-0 place-items-center">{swatch}</span>
      <span className="leading-tight">{children}</span>
    </div>
  )
}

/**
 * A fill as the map shows it. A faded one is laid over land (DESIGN.md §8.1
 * `ground-green`), not over the panel: on the map it is the terrain that shows through,
 * which is why an uncertain province reads brown, not pale pink.
 */
function Swatch({ fill, alpha = 1 }: { fill: string; alpha?: number }) {
  return (
    <span
      className="block h-3 w-5 overflow-hidden rounded-[1px] ring-1 ring-foreground/25"
      style={{ background: alpha < 1 ? GROUND : fill }}
    >
      {alpha < 1 && (
        <span className="block size-full" style={{ background: fill, opacity: alpha }} />
      )}
    </span>
  )
}

const GROUND = '#7C8848'

function Strip({ fills }: { fills: string[] }) {
  return (
    <span className="flex h-3 w-5 overflow-hidden rounded-[1px] ring-1 ring-foreground/25">
      {fills.map((f) => (
        <span key={f} className="flex-1" style={{ background: f }} />
      ))}
    </span>
  )
}

// The engine's own marks (labels/PlaceLayer.ts): engraved symbols in ink, on a paper
// hairline. Colours are the renderer's INK and PAPER.
const INK = '#2A241E'
const PAPER = '#EDE6D6'

const Town = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="3.2" fill={PAPER} opacity="0.55" />
    <circle cx="8" cy="8" r="2.4" fill={INK} />
  </svg>
)
const Capital = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="4.5" fill={PAPER} stroke={INK} strokeWidth="1.3" />
    <circle cx="8" cy="8" r="1.8" fill={INK} />
  </svg>
)
const Caput = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle
      cx="8"
      cy="8"
      r="7"
      fill={PAPER}
      fillOpacity="0.5"
      stroke={INK}
      strokeWidth="0.9"
    />
    <circle cx="8" cy="8" r="4.3" fill={PAPER} stroke={INK} strokeWidth="1.2" />
    <circle cx="8" cy="8" r="1.7" fill={INK} />
  </svg>
)
const Seat = ({ fill }: { fill: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <rect
      x="4.5"
      y="4.5"
      width="7"
      height="7"
      transform="rotate(45 8 8)"
      fill={fill}
      stroke={INK}
      strokeWidth="1.1"
    />
  </svg>
)
// A main road (roads/shading.ts): 3.2 px, a warm core between 0.8 px edges.
const Road = () => (
  <svg width="20" height="8" viewBox="0 0 20 8" aria-hidden>
    <rect x="0" y="2.4" width="20" height="3.2" fill="#2E1C13" />
    <rect x="0" y="3.2" width="20" height="1.6" fill="#E4D3AE" />
  </svg>
)
