import { MODEL_KEY, type PoliticsLegend, UNCERTAIN_ALPHA } from '@roma-cognita/engine'
import { LayoutList } from 'lucide-react'
import { type ReactNode, useId, useMemo } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { useExplorer } from '@/store.ts'

/**
 * The legend (DESIGN.md §8.3): what each colour and mark on the map means, for the year
 * shown. Its row is in the title block, under the index, and the key opens beside the
 * block, no taller than it: anchored to the block, which never changes width, it
 * neither moves nor covers the person panel beneath. It is not a dialog: the
 * map and the timeline stay live while it is open, and only its row closes it. Colours
 * are read from the engine, never restated here, so a change to the palette cannot
 * leave the legend behind. Each kind of doubt is keyed only in a year that has some.
 * Zoomed right into Rome, where the model of the city stands, it keys the model
 * instead, and says which of it is recorded and which generated.
 */
export function Legend() {
  const map = useExplorer((s) => s.map)
  const year = useExplorer((s) => s.year)
  const modelShown = useExplorer((s) => s.modelShown)
  const open = useLegend((s) => s.open)
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
  if (!open || !data) return null
  return (
    <aside
      id="legend-key"
      aria-label="Legend"
      className="pointer-events-auto absolute inset-y-0 left-full ml-3 flex w-max animate-in rounded-lg rule-double bg-card/95 px-4 py-3 text-card-foreground shadow-plate backdrop-blur-sm duration-150 fade-in-0 slide-in-from-left-1 select-none"
    >
      <LegendKey {...data} model={modelShown ? MODEL_KEY : undefined} />
    </aside>
  )
}

/** The legend's row in the title block, under the index: it opens the key beside it. */
export function LegendRow() {
  const open = useLegend((s) => s.open)
  const toggle = useLegend((s) => s.toggle)
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-controls="legend-key"
      className="group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
    >
      <LayoutList
        className={cn(
          'transition-colors group-hover:text-primary',
          open ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <span
        className={cn('transition-colors group-hover:text-primary', open && 'text-primary')}
      >
        Legend
      </span>
      {/* Open, the row is marked as a list's chosen row is: the seat's diamond, in gold. */}
      <span
        className={cn(
          'mr-1 ml-auto size-1.5 rotate-45 bg-gold transition-opacity duration-200',
          !open && 'opacity-0',
        )}
        aria-hidden
      />
    </button>
  )
}

const STORE = 'legend-open'

/**
 * Whether the key is open, shared by its row and its plate: closed until the reader
 * opens it, then as they left it.
 */
const useLegend = create<{ open: boolean; toggle(): void }>()((set, get) => ({
  open: (() => {
    try {
      return localStorage.getItem(STORE) === 'true'
    } catch {
      return false
    }
  })(),
  toggle() {
    const open = !get().open
    set({ open })
    try {
      localStorage.setItem(STORE, String(open))
    } catch {}
  },
}))

export interface LegendData {
  politics: PoliticsLegend
  /** A kingdom drawn by its seat this year, in its colour. The map names it. */
  seat?: { fill: string }
  /** The model of Rome's colours, while it stands: the legend keys it instead. */
  model?: typeof MODEL_KEY
}

/**
 * The key itself, from data; the playground draws it from a sample. Set in columns, each
 * five rows at most, so that it is no taller than the title block: Rome's colours, then
 * the kinds of doubt (only in a year that has some), then the map's marks.
 */
export function LegendKey({
  politics,
  seat,
  model,
  className,
}: LegendData & { className?: string }) {
  if (model) return <ModelKey model={model} className={className} />
  const [lead, ...others] = politics.powers
  const otherFills = [...new Set(others.map((p) => p.fill))]
  const doubt = lead && (politics.uncertain || politics.schematic || politics.unclaimed)

  return (
    <div className={cn('flex gap-4 text-sm', className)}>
      <Column>
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
      </Column>
      {doubt && (
        <>
          <Rule />
          <Column>
            {politics.uncertain && (
              <Key
                swatch={
                  <Swatch fill={lead.province ?? lead.fill} alpha={UNCERTAIN_ALPHA} />
                }
              >
                Claim uncertain: <span className="italic">fainter</span>
              </Key>
            )}
            {politics.schematic && (
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
          </Column>
        </>
      )}
      <Rule />
      <Column>
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
      </Column>
    </div>
  )
}

/** The model of Rome's key: its stones, the houses as illustrative, and what that means. */
function ModelKey({ model, className }: { model: typeof MODEL_KEY; className?: string }) {
  return (
    <div className={cn('flex gap-4 text-sm', className)}>
      <Column>
        <Key swatch={<Swatch fill={model.marble} />}>Marble</Key>
        <Key swatch={<Swatch fill={model.stucco} />}>Stucco over tufa</Key>
        <Key swatch={<Swatch fill={model.travertine} />}>Travertine</Key>
        <Key swatch={<Swatch fill={model.basalt} />}>Basalt streets</Key>
        <Key
          swatch={
            <span className="flex h-3 w-5 flex-col overflow-hidden rounded-[1px]">
              <span className="h-1" style={{ background: model.roof }} />
              <span className="flex-1" style={{ background: model.house }} />
            </span>
          }
        >
          Houses, <span className="italic">illustrative</span>
        </Key>
        <Key
          swatch={
            <span className="flex h-3 w-5 overflow-hidden rounded-[1px]">
              {model.fields.map((c) => (
                <span key={c} className="flex-1" style={{ background: c }} />
              ))}
            </span>
          }
        >
          Fields, <span className="italic">illustrative</span>
        </Key>
        <Key swatch={<Swatch fill={model.garden} />}>Gardens and groves</Key>
      </Column>
      <Rule />
      <p className="w-[220px] text-xs leading-snug text-muted-foreground">
        Only the named buildings, gardens and groves are from the records, in the stone and
        outline their sources give. The houses, tombs and farmland between them are
        generated to show what the city and its country were like, not where any of them
        stood.
      </p>
    </div>
  )
}

function Column({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>
}

/** The hairline between the key's columns. */
function Rule() {
  return <span className="w-px self-stretch bg-rule" aria-hidden />
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
      <span className="leading-tight whitespace-nowrap">{children}</span>
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
/**
 * A person, for the index: not a mark the map draws, but engraved as those are, as a
 * coin shows a Roman: a head in profile, the bust cut off by the rim. It has no wreath:
 * at this size a laurel cannot be told from hair.
 */
export const Portrait = () => {
  const clip = useId()
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <circle cx="8" cy="8" r="7.2" />
        </clipPath>
      </defs>
      <circle cx="8" cy="8" r="7.2" fill={PAPER} />
      <path
        clipPath={`url(#${clip})`}
        fill={INK}
        d="M5.2 15.5 5.5 12.4C5.5 11.6 5 11 4.6 10.3 3.7 8.9 3.6 6.6 4.6 5.1 5.6 3.6 7.6 3.1 8.9 3.6 10.2 3.9 10.9 4.9 11 6.1L12.4 8.4C12.4 8.6 12.1 8.7 11.5 8.7L11.65 9.15 11.3 9.35 11.5 9.75C11.5 10.6 11.1 11 10.4 11.1 10 11.15 9.8 11.4 9.8 11.9L10.3 15.5Z"
      />
      {/* The rim over the bust, so that no paper shows between them. */}
      <circle cx="8" cy="8" r="7.2" fill="none" stroke={INK} strokeWidth="0.8" />
    </svg>
  )
}
// A main road (roads/shading.ts): 3.2 px, a warm core between 0.8 px edges.
const Road = () => (
  <svg width="20" height="8" viewBox="0 0 20 8" aria-hidden>
    <rect x="0" y="2.4" width="20" height="3.2" fill="#2E1C13" />
    <rect x="0" y="3.2" width="20" height="1.6" fill="#E4D3AE" />
  </svg>
)
