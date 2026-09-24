import { type PoliticsLegend, UNCERTAIN_ALPHA } from '@roman-map/engine'
import { Shapes, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePeople } from '@/peopleStore.ts'
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
  const personOpen = usePeople((s) => s.person !== null)
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
  return <LegendPanel {...data} folded={personOpen} className="fixed bottom-4 left-4" />
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
  folded = false,
  className,
}: LegendData & {
  /** Folded to its strip while the person panel needs the left side; the choice stays as it was. */
  folded?: boolean
  className?: string
}) {
  const [chosen, setChosen] = useState(initialOpen)
  // Opening the legend while it is folded away opens it anyway, until the fold lifts.
  const [unfolded, setUnfolded] = useState(false)
  const [wasFolded, setWasFolded] = useState(folded)
  if (folded !== wasFolded) {
    setWasFolded(folded)
    setUnfolded(false)
  }
  const open = chosen && (!folded || unfolded)
  const toggle = () => {
    const next = !open
    if (next && folded) setUnfolded(true)
    setChosen(next)
    try {
      localStorage.setItem(STORE, String(next))
    } catch {}
  }

  const [lead, ...others] = politics.powers
  const otherFills = [...new Set(others.map((p) => p.fill))]

  return (
    // The timeline's pattern (Timeline.tsx): a slim strip in the reader's theme that
    // never moves, with the key opening out of it, upward, not stacked on top of it.
    <div
      className={cn(
        'flex flex-col rounded-lg border border-rule bg-background/90 text-foreground shadow-plate backdrop-blur-sm select-none',
        open ? 'w-[240px]' : 'w-fit',
        className,
      )}
    >
      {open && (
        <div id="legend-body" className="space-y-1.5 px-3 pt-3 pb-2.5 text-sm">
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
          <Key
            swatch={
              <Mark>
                <Caput />
              </Mark>
            }
          >
            Rome
          </Key>
          <Key
            swatch={
              <Mark>
                <Capital />
              </Mark>
            }
          >
            Provincial or royal seat
          </Key>
          <Key
            swatch={
              <Mark>
                <Town />
              </Mark>
            }
          >
            Town
          </Key>
          {seat && (
            <Key
              swatch={
                <Mark>
                  <Seat fill={seat.fill} />
                </Mark>
              }
            >
              Kingdom, <span className="italic">extent unknown</span>
            </Key>
          )}
          <Key
            swatch={
              <Mark>
                <Road />
              </Mark>
            }
          >
            Road, where dated
          </Key>
        </div>
      )}
      {open && <span className="mx-3 h-px bg-rule" aria-hidden />}
      {/* Folded, just the icon: a square the timeline strip's height (40px), named by its
          tooltip. Open, the row also carries the word, as the key's title. */}
      {/* Only the icon toggles: folded, it is the whole square; open, it is the ✕, and
          the title beside it is only a title. One button in both states, so focus
          stays on it across the toggle. */}
      <div className="flex h-[38px] items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls="legend-body"
              aria-label={open ? 'Hide the legend' : 'Show the legend'}
              className={cn(
                'grid place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                open ? 'ml-1 size-7' : 'size-[38px]',
              )}
            >
              <span className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4">
                {open ? <X /> : <Shapes />}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {open ? 'Hide the legend' : 'Legend'}
          </TooltipContent>
        </Tooltip>
        {open && (
          <span className="pr-3.5 font-heading text-sm font-semibold tracking-[0.1em]">
            Legend
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * A map mark, as it is drawn: ink on a paper hairline. Over Parchment that reads as is;
 * over Ink & gold the ink would vanish, so the mark sits on a small tile of paper, as
 * it sits on land on the map.
 */
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-[18px] w-5 place-items-center rounded-[2px] dark:bg-[#EDE6D6]/90">
      {children}
    </span>
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
export function Swatch({ fill, alpha = 1 }: { fill: string; alpha?: number }) {
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

export const Town = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="3.2" fill={PAPER} opacity="0.55" />
    <circle cx="8" cy="8" r="2.4" fill={INK} />
  </svg>
)
export const Capital = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="4.5" fill={PAPER} stroke={INK} strokeWidth="1.3" />
    <circle cx="8" cy="8" r="1.8" fill={INK} />
  </svg>
)
export const Caput = () => (
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
export const Seat = ({ fill }: { fill: string }) => (
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
