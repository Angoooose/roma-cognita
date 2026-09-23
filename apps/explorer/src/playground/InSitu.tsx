import { ChevronLeft, ChevronRight, Layers, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatYear } from '@/lib/year.ts'

/**
 * The interface laid over a screenshot of the map: the explorer's timeline and
 * inspector as they are today, plus the legend and mode bar DESIGN.md §8.3 plans.
 */
export function InSitu({ backdrop }: { backdrop: string }) {
  return (
    <section className="space-y-3">
      <SectionHead title="In situ" note="the interface over the map, at its real size" />
      <div
        className="relative aspect-[16/10] min-h-[640px] overflow-hidden rounded-lg border border-rule bg-sea bg-cover bg-center"
        style={{ backgroundImage: `url(${backdrop})` }}
      >
        <ModeBar />
        <InspectorDemo />
        <Legend />
        <TimelineDemo />
      </div>
    </section>
  )
}

export function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <span className="text-muted-foreground italic">{note}</span>
      <span className="h-px flex-1 self-center bg-rule" />
    </div>
  )
}

function ModeBar() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Card
        size="sm"
        className="absolute top-4 left-4 flex-row items-center gap-2 px-2 py-2"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Layers">
              <Layers />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Layers</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-5" />
        <ToggleGroup type="single" size="sm" defaultValue="political" aria-label="Map mode">
          <ToggleGroupItem value="political">Political</ToggleGroupItem>
          <ToggleGroupItem value="physical">Physical</ToggleGroupItem>
          <ToggleGroupItem value="status">Status</ToggleGroupItem>
        </ToggleGroup>
        <Separator orientation="vertical" className="h-5" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Search /> Quaere
          <Kbd className="ml-1">⌘K</Kbd>
        </Button>
      </Card>
      <CommandDialog open={open} onOpenChange={setOpen} title="Find a place">
        <Command>
          <CommandInput placeholder="Find a place, province or people…" />
          <CommandList>
            <CommandEmpty>Nothing by that name in 63 BCE.</CommandEmpty>
            <CommandGroup heading="Provinces">
              <CommandItem>Asia</CommandItem>
              <CommandItem>Cilicia</CommandItem>
              <CommandItem>Gallia Transalpina</CommandItem>
              <CommandItem>Macedonia</CommandItem>
            </CommandGroup>
            <CommandGroup heading="Places">
              <CommandItem>Roma</CommandItem>
              <CommandItem>Pergamum</CommandItem>
              <CommandItem>Alexandria</CommandItem>
              <CommandItem>Massilia</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

/** A territory, as the real inspector shows one (data/claims.yaml, asia-phrygia). */
function InspectorDemo() {
  return (
    <Card className="absolute top-4 right-4 w-[300px] gap-4">
      <CardHeader>
        <CardTitle>Asia</CardTitle>
        <CardDescription>Province of Rome</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          <Fact label="Held">
            <span className="figures">before 68 BCE – 57 BCE</span>
          </Fact>
          <Fact label="Confidence">
            <Badge variant="probable">probable</Badge>
          </Fact>
        </dl>
        <p className="border-l-2 border-gold/60 pl-2.5 text-pretty text-foreground/80">
          Phrygia passed to Cilicia in 56, and returned to Asia under the proconsul C.
          Fannius in 49.
        </p>
        <div>
          <h3 className="mb-1 text-[0.6875rem] text-muted-foreground">Sources</h3>
          <ul className="space-y-1 text-sm">
            <li>
              <a
                className="underline decoration-rule underline-offset-2 hover:decoration-current"
                href="#"
              >
                S. Dmitriev, “Observations on the Historical Geography of Roman Lycaonia”
              </a>
              , <span className="text-muted-foreground">n. 80</span>
            </li>
          </ul>
        </div>
      </CardContent>
      <CardFooter className="figures text-xs text-muted-foreground">
        asia-phrygia · 63 BCE · draft
      </CardFooter>
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="caps text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function Legend() {
  return (
    <Card size="sm" className="absolute bottom-4 left-4 w-[220px] gap-2">
      <CardHeader>
        <CardTitle className="text-xs">Legenda</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Key swatch="#AE4A42">Rome and her provinces</Key>
        <Key swatch="#BE7E73">Client kingdoms</Key>
        <Key swatch="#5A7398">Other powers</Key>
        <Key
          swatch="linear-gradient(90deg, transparent, #7A6A96 70%)"
          className="opacity-80"
        >
          <span className="italic">Extent uncertain</span>
        </Key>
        <Separator className="my-2" />
        <Key mark={<Capital />}>Capital</Key>
        <Key mark={<Town />}>Town</Key>
        <Key mark={<Seat />}>Kingdom, by its seat</Key>
        <Key mark={<Road />}>Road, dated</Key>
      </CardContent>
    </Card>
  )
}

function Key(props: {
  swatch?: string
  mark?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid w-5 place-items-center">
        {props.swatch ? (
          <span
            className={`h-3 w-5 rounded-[1px] ring-1 ring-foreground/25 ${props.className ?? ''}`}
            style={{ background: props.swatch }}
          />
        ) : (
          props.mark
        )}
      </span>
      <span className="leading-tight">{props.children}</span>
    </div>
  )
}

// The engine's own markers (PlaceLayer.ts): ink on a paper hairline.
const Capital = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="5" fill="#EDE6D6" stroke="#2A241E" strokeWidth="1.2" />
    <circle cx="7" cy="7" r="2.2" fill="#2A241E" />
  </svg>
)
const Town = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="2.6" fill="#2A241E" stroke="#EDE6D6" strokeWidth="1" />
  </svg>
)
const Seat = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect
      x="3.5"
      y="3.5"
      width="7"
      height="7"
      transform="rotate(45 7 7)"
      fill="#5A7398"
      stroke="#2A241E"
      strokeWidth="1"
    />
  </svg>
)
const Road = () => (
  <svg width="20" height="8" viewBox="0 0 20 8">
    <rect x="0" y="2" width="20" height="4" fill="#2A241E" />
    <rect x="0" y="3" width="20" height="2" fill="#F3EBDA" />
  </svg>
)

/** The explorer's Timeline, lifted off the store so it runs without a map. */
function TimelineDemo() {
  const first = -132
  const last = -26
  const [year, setYear] = useState(-62)
  const at = (y: number) => `${((y - first) / (last - first)) * 100}%`
  const ticks: { year: number; bce: number; major: boolean }[] = []
  for (let y = first; y <= last; y++) {
    const bce = 1 - y
    if (bce % 5 === 0) ticks.push({ year: y, bce, major: bce % 10 === 0 })
  }
  const go = (y: number) => setYear(Math.min(last, Math.max(first, y)))
  return (
    <Card className="absolute bottom-5 left-1/2 w-[min(620px,calc(100%-500px))] -translate-x-1/2 flex-row items-center gap-2 px-3 pt-6 pb-5 select-none">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous year"
        onClick={() => go(year - 1)}
      >
        <ChevronLeft />
      </Button>
      <div className="relative flex-1">
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
          className="h-7"
          aria-label="Year"
          min={first}
          max={last}
          step={1}
          value={[year]}
          onValueChange={([y]) => setYear(y)}
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next year"
        onClick={() => go(year + 1)}
      >
        <ChevronRight />
      </Button>
    </Card>
  )
}
