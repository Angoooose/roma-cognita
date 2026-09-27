import { Layers, Search, X } from 'lucide-react'
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
import { type LegendData, LegendKey } from '@/components/Legend.tsx'
import { TimelinePanel } from '@/components/Timeline.tsx'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
        <LegendKey
          {...LEGEND_63_BCE}
          className="absolute bottom-4 left-4 rounded-lg rule-double bg-card/95 px-4 py-2.5 text-card-foreground backdrop-blur-sm"
        />
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

/**
 * The real legend, drawn from the live map's legend for 63 BCE (read from
 * `map.politics.legend(-62)`), so the playground shows what the app does.
 */
const LEGEND_63_BCE: LegendData = {
  politics: {
    powers: [
      {
        id: 'rome',
        name: 'Roma',
        fill: '#ae4a42',
        province: '#b85556',
        client: '#c39790',
        atoms: 53,
      },
      { id: 'parthia', name: 'Parthia', fill: '#5e8c84', client: '#a5b0a9', atoms: 2 },
      ...['#a0734f', '#7a6a96', '#b98f4a', '#8e9a52', '#5a7398', '#9a6a7e'].map(
        (fill, k) => ({
          id: `other-${k}`,
          name: '',
          fill,
          atoms: 1,
        }),
      ),
    ],
    uncertain: true,
    schematic: true,
    unclaimed: true,
  },
  seat: { fill: '#bb938a' },
}

/** The explorer's timeline, driven locally over the data's window, 68–27 BCE. */
function TimelineDemo() {
  const [year, setYear] = useState(-62)
  const span: [number, number] = [-132, -26]
  const go = (y: number) => setYear(Math.min(span[1], Math.max(span[0], y)))
  return (
    <TimelinePanel
      year={year}
      span={span}
      onYear={go}
      className="absolute right-4 bottom-4"
    />
  )
}
