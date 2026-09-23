import { BookOpen, ChevronDown, Crosshair, Info, MapPin, Plus, Scroll } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SectionHead } from './InSitu.tsx'

export function Specimens() {
  return (
    <section className="space-y-4">
      <SectionHead title="Specimina" note="every component, in both inks" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] items-start gap-5">
        <Type />
        <Palette />
        <Buttons />
        <Badges />
        <Controls />
        <Choices />
        <TabsSpecimen />
        <Overlays />
        <SourcesSpecimen />
        <SearchSpecimen />
        <Odds />
      </div>
    </section>
  )
}

function Specimen(props: {
  title: string
  note?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Card className={props.wide ? 'col-span-full' : undefined}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.note && <CardDescription>{props.note}</CardDescription>}
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
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

function Type() {
  return (
    <Specimen
      title="Typographia"
      note="Cinzel for inscriptions, EB Garamond for the book"
      wide
    >
      <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <div className="font-heading text-5xl font-medium tracking-[0.12em]">
            Orbis Romanus
          </div>
          <div className="font-heading text-2xl tracking-[0.1em] text-muted-foreground">
            Res Publica · 133–27 BCE
          </div>
          <Fleuron className="max-w-md py-1" />
          <p className="max-w-prose text-base">
            In 63 BCE, the year Cicero and Antonius held the consulship, Pompey was settling
            the East. Much of the ground on this map is still drawn soft, for{' '}
            <em>the source’s silence is not evidence</em>, and where the sources fall silent
            the map says so.
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Figures in running text are old-style — 63 BCE, 1,400 km — and lining in tables:{' '}
            <span className="figures text-foreground">63 BCE, 1,400 km</span>.
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-3 self-start">
          <dt className="caps text-[0.6875rem] text-muted-foreground">Display</dt>
          <dd className="font-heading text-3xl">Italia</dd>
          <dt className="caps text-[0.6875rem] text-muted-foreground">Title</dt>
          <dd className="font-heading text-lg font-semibold tracking-[0.08em]">
            Gallia Transalpina
          </dd>
          <dt className="caps text-[0.6875rem] text-muted-foreground">Label</dt>
          <dd className="caps text-[0.6875rem]">Confidence</dd>
          <dt className="caps text-[0.6875rem] text-muted-foreground">Body</dt>
          <dd className="text-sm">Province of Rome, held before 68 BCE.</dd>
          <dt className="caps text-[0.6875rem] text-muted-foreground">Voice</dt>
          <dd className="text-lg text-gold italic">Mare Tyrrhenum</dd>
          <dt className="caps text-[0.6875rem] text-muted-foreground">Note</dt>
          <dd className="text-xs text-muted-foreground italic">asia-phrygia · draft</dd>
        </dl>
      </div>
    </Specimen>
  )
}

const TOKENS = [
  'background',
  'card',
  'popover',
  'foreground',
  'muted-foreground',
  'primary',
  'secondary',
  'accent',
  'gold',
  'rule',
  'destructive',
  'sea',
]

function Palette() {
  // Re-read on mode or tuner change: poll cheaply, the page is a playground.
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      setValues(
        Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(`--${t}`).trim()])),
      )
    }
    read()
    const id = setInterval(read, 500)
    return () => clearInterval(id)
  }, [])
  return (
    <Specimen title="Colores" note="the map’s inks, as tokens">
      <div className="grid grid-cols-3 gap-3">
        {TOKENS.map((t) => (
          <div key={t} className="space-y-1">
            <div
              className="h-10 rounded-sm ring-1 ring-foreground/15"
              style={{ background: `var(--${t})` }}
            />
            <div className="text-xs leading-tight">{t}</div>
            <div className="font-mono text-[10px] text-muted-foreground uppercase">
              {values[t]?.replace(/^rgb\((.*)\)$/, '$1')}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className="h-4 flex-1 rounded-[1px]"
            style={{ background: `var(--chart-${n})` }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground italic">
        chart-1…5: Rome and the powers’ colours from politics/palette.ts
      </p>
    </Specimen>
  )
}

function Buttons() {
  return (
    <Specimen title="Imperia" note="buttons: variants and sizes">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button>Go to year</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="gilt">
            <Scroll /> Gilt
          </Button>
          <Button variant="destructive">Discard</Button>
          <Button variant="link">Pleiades 550812</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">xs</Button>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline" aria-label="Locate">
            <Crosshair />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Add">
            <Plus />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
    </Specimen>
  )
}

function Badges() {
  return (
    <Specimen title="Notae" note="badges; confidence drawn as the map draws it">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="certain">certain</Badge>
          <Badge variant="probable">probable</Badge>
          <Badge variant="uncertain">uncertain</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Province</Badge>
          <Badge variant="secondary">Client</Badge>
          <Badge variant="outline">Allied</Badge>
          <Badge variant="gold">Conventus</Badge>
          <Badge variant="destructive">Occupied</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          A <em>dashed</em> edge is doubt, as a dashed line is on the map (DESIGN.md §1.3).
        </p>
      </div>
    </Specimen>
  )
}

function Controls() {
  const [span, setSpan] = useState([-80, -44])
  return (
    <Specimen title="Instrumenta" note="inputs, select, slider">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pl">Place</Label>
          <Input id="pl" placeholder="e.g. Tarraco" defaultValue="Pergamum" />
        </div>
        <div className="space-y-1.5">
          <Label>Relation</Label>
          <Select defaultValue="province">
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Held by Rome</SelectLabel>
                <SelectItem value="province">Province</SelectItem>
                <SelectItem value="citizen-territory">Citizen territory</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="allied">Allied</SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Otherwise</SelectLabel>
                <SelectItem value="independent">Independent</SelectItem>
                <SelectItem value="occupied">Occupied</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>Window</Label>
            <span className="figures text-sm text-muted-foreground">
              {1 - span[0]}–{1 - span[1]} BCE
            </span>
          </div>
          <Slider min={-132} max={-26} value={span} onValueChange={setSpan} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Note</Label>
          <Textarea id="note" placeholder="Reasoning that should survive…" rows={2} />
        </div>
      </div>
    </Specimen>
  )
}

function Choices() {
  return (
    <Specimen title="Optiones" note="switches, checkboxes, radios">
      <div className="space-y-4">
        {[
          ['roads', 'Roads', true],
          ['labels', 'Settlement names', true],
          ['graticule', 'Graticule', false],
        ].map(([id, label, on]) => (
          <div key={id as string} className="flex items-center justify-between">
            <Label htmlFor={id as string} className="text-sm font-normal">
              {label}
            </Label>
            <Switch id={id as string} defaultChecked={on as boolean} />
          </div>
        ))}
        <Separator />
        <div className="space-y-2">
          <div className="caps text-[0.6875rem] text-muted-foreground">Show confidence</div>
          {['certain', 'probable', 'uncertain'].map((c, i) => (
            <div key={c} className="flex items-center gap-2">
              <Checkbox id={c} defaultChecked={i < 2} />
              <Label htmlFor={c} className="font-normal">
                {c}
              </Label>
            </div>
          ))}
        </div>
        <Separator />
        <RadioGroup defaultValue="latin" className="gap-2">
          <div className="caps text-[0.6875rem] text-muted-foreground">Names</div>
          {[
            ['latin', 'Latin'],
            ['greek', 'Greek where attested'],
            ['modern', 'Modern'],
          ].map(([v, l]) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem value={v} id={`r-${v}`} />
              <Label htmlFor={`r-${v}`} className="font-normal">
                {l}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </Specimen>
  )
}

function TabsSpecimen() {
  return (
    <Specimen title="Tabulae" note="tabs, both variants">
      <div className="space-y-5">
        <Tabs defaultValue="claim">
          <TabsList>
            <TabsTrigger value="claim">Claim</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="names">Names</TabsTrigger>
          </TabsList>
          <TabsContent value="claim" className="pt-2 text-sm">
            Province of Rome, before 68 BCE – 57 BCE.
          </TabsContent>
          <TabsContent value="sources" className="pt-2 text-sm">
            Dmitriev 2000, n. 80.
          </TabsContent>
          <TabsContent value="names" className="pt-2 text-sm">
            Asia · Ἀσία
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="political">
          <TabsList variant="line">
            <TabsTrigger value="political">Political</TabsTrigger>
            <TabsTrigger value="physical">Physical</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </Specimen>
  )
}

function Overlays() {
  return (
    <Specimen title="Tabellae" note="dialog, popover, hover card, tooltip, menu">
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">
              <BookOpen /> Attributions
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Fontes</DialogTitle>
              <DialogDescription>
                Every layer carries its sources’ licences; ODbL layers are credited apart.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5 text-sm">
              {[
                ['Pleiades, a gazetteer of past places', 'CC BY 3.0'],
                ['Itiner-e, Roman roads', 'CC BY 4.0'],
                ['EMODnet DTM 2024, bathymetry', 'CC BY 4.0'],
                ['OpenStreetMap land polygons', 'ODbL'],
              ].map(([what, licence]) => (
                <li key={what} className="flex items-baseline gap-2">
                  <span>{what}</span>
                  <span className="mb-1 flex-1 border-b border-dotted border-foreground/35" />
                  <span className="caps text-[0.6875rem] text-muted-foreground">
                    {licence}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              Year <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <div className="font-heading text-sm font-semibold tracking-[0.08em]">
              Go to year
            </div>
            <Input defaultValue="49 BCE" />
            <p className="text-xs text-muted-foreground italic">
              “63 BCE”, “c. 81 BCE”, “14 CE”. Nobody types a sign.
            </p>
          </PopoverContent>
        </Popover>

        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link" className="px-1">
              <MapPin /> Pergamum
            </Button>
          </HoverCardTrigger>
          <HoverCardContent className="w-72 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-heading font-semibold tracking-[0.08em]">Pergamum</span>
              <Badge variant="gold">Conventus</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Assize town of Asia. Pleiades <span className="figures">550812</span>.
            </p>
          </HoverCardContent>
        </HoverCard>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="About">
              <Info />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Drawn soft: the sources leave this frontier vague</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              View <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuLabel>Layers</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked>Borders</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked>Roads</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>Graticule</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Fly to Roma</DropdownMenuItem>
            <DropdownMenuItem>Copy link to view</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Specimen>
  )
}

function SourcesSpecimen() {
  return (
    <Specimen title="Fontes" note="accordion">
      <Accordion type="single" collapsible defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>Broughton, MRR</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">
            T. R. S. Broughton, <em>The Magistrates of the Roman Republic</em>, 3 vols (New
            York, 1951–1986).
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Sherk, RDGE</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">
            R. K. Sherk, <em>Roman Documents from the Greek East</em> (Baltimore, 1969), no.
            52.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="c">
          <AccordionTrigger>Barrington Atlas</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">
            Reference only — cited, never digitised from.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Specimen>
  )
}

function SearchSpecimen() {
  return (
    <Specimen title="Quaestio" note="command palette, inline">
      <Command>
        <CommandInput placeholder="Find a place…" />
        <CommandList className="max-h-56">
          <CommandEmpty>Nothing by that name.</CommandEmpty>
          <CommandGroup heading="Places">
            {[
              ['Roma', 'Latium'],
              ['Ostia', 'Latium'],
              ['Puteoli', 'Campania'],
              ['Brundisium', 'Calabria'],
            ].map(([name, region]) => (
              <CommandItem key={name}>
                {name}
                <CommandShortcut>{region}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </Specimen>
  )
}

function Odds() {
  return (
    <Specimen title="Varia" note="keys, loading, rules">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <KbdGroup>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </KbdGroup>
          <span className="text-muted-foreground">a year;</span>
          <KbdGroup>
            <Kbd>⇧</Kbd>
            <Kbd>←</Kbd>
          </KbdGroup>
          <span className="text-muted-foreground">five</span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Separator />
        <Fleuron />
      </div>
    </Specimen>
  )
}
