import type { MapEntry } from '@roma-cognita/engine'
import type { PersonRecord } from '@roma-cognita/schema'
import { defaultFilter } from 'cmdk'
import { ArrowUpRight, BookOpen, Search as SearchIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Capital,
  Caput,
  Legend,
  LegendRow,
  Mark,
  Portrait,
  Seat,
  Swatch,
  Town,
} from '@/components/Legend.tsx'
import { Preface } from '@/components/Preface.tsx'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { lifeLine } from '@/components/PersonLink.tsx'
import { activeIn, knownName, nearness, type People, searchTerms } from '@/lib/people.ts'
import { standing } from '@/lib/standing.ts'
import { cn } from '@/lib/utils'
import { formatSpan, formatYear } from '@/lib/year.ts'
import { usePeople } from '@/peopleStore.ts'
import { useExplorer } from '@/store.ts'

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
const KEY = MAC ? '⌘K' : 'Ctrl K'

/** How many of the year's powers and cities to offer before anything is typed. */
const OFFERED = 5

/**
 * The least score that counts as a match. cmdk scores any name holding the letters in
 * order, however scattered (`ill` finds Mytilene at 0.017); a typo or an abbreviation
 * scores near 0.17 (`masilia`, `gal com`), and a prefix near 1.
 */
const MIN_SCORE = 0.1

/**
 * How much the year shown may add to a match's score, to order what matches equally:
 * what is on the map, or who is attested, before the rest. Less than the gap between
 * any two of cmdk's scores, so it never lifts a worse match over a better one.
 */
const TIE = 0.004

/** The most people listed for a query: `crassus` alone matches seventy. */
const PEOPLE_SHOWN = 30

/**
 * Search, as an atlas's index. The top-left corner carries the map's title block, and
 * under it the index: ⌘K (Ctrl K elsewhere) or a click opens it. Each name is set
 * against what it belongs to, beside the mark the map draws it with. Enter flies there
 * and opens the inspector; what is not on the map in the year shown is listed greyed
 * with its years, and going to it moves the timeline to the first of them.
 *
 * People are listed too (PEOPLE.md §5.3), ordered by the year shown but never filtered
 * by it: those attested then first, everyone else greyed after. Each is set against
 * their highest office, which tells namesakes apart. Enter opens the person panel.
 */
export function Search() {
  const map = useExplorer((s) => s.map)
  const year = useExplorer((s) => s.year)
  const goTo = useExplorer((s) => s.goTo)
  const people = usePeople((s) => s.people)
  const openPerson = usePeople((s) => s.open)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<MapEntry[]>([])
  const list = useRef<HTMLDivElement>(null)

  // cmdk scrolls to the selected row before it re-sorts the list, which leaves it scrolled
  // to where the best match used to be. The best match is first: go back to the top.
  useEffect(() => {
    const id = requestAnimationFrame(() => list.current?.scrollTo({ top: 0 }))
    return () => cancelAnimationFrame(id)
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Named for the year shown; the first read also finds the ground under each place.
  useEffect(() => {
    let live = true
    map?.entries().then((e) => live && setAll(e))
    return () => {
      live = false
    }
  }, [map, year])

  const lists = useMemo(() => {
    const now = (e: MapEntry) => e.years.some(([a, b]) => a <= year && year <= b)
    // What is on the map now first, then alphabetically.
    const sorted = all
      .map((entry) => ({ entry, now: now(entry) }))
      .sort(
        (p, q) => Number(q.now) - Number(p.now) || p.entry.name.localeCompare(q.entry.name),
      )
    const polities = sorted.filter((r) => r.entry.ref.kind === 'polity')
    const places = sorted.filter((r) => r.entry.ref.kind === 'place')
    // Before anything is typed: the year's largest polities, and its great cities.
    const largest = polities
      .filter((r) => r.now)
      .sort((p, q) => (q.entry.reach ?? 0) - (p.entry.reach ?? 0))
      .slice(0, OFFERED)
    const cities = places
      .filter((r) => r.now && r.entry.prominence === 1)
      .sort((p, q) => MARK_RANK[p.entry.mark] - MARK_RANK[q.entry.mark])
      .slice(0, OFFERED)
    return { polities, places, largest, cities }
  }, [all, year])

  // Each person's names as one string, matched against every keystroke.
  const terms = useMemo(
    () =>
      people ? [...people.persons.values()].map((p) => [p, searchTerms(p)] as const) : [],
    [people],
  )

  const typing = query.trim().length > 0

  // Ranked here, not by cmdk, so that only the best few of five thousand are mounted.
  const found = useMemo(() => {
    if (!typing) return []
    return terms
      .map(([person, words]) => ({
        person,
        score: score(defaultFilter(words, query), person, year),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PEOPLE_SHOWN)
      .map((r) => r.person)
  }, [terms, query, year, typing])

  const consuls = useMemo(() => people?.consuls(year) ?? [], [people, year])

  // What the year shown adds to each row's score, by its value, for the filter to read.
  const tiebreak = useMemo(() => {
    const m = new Map<string, number>()
    const now = (e: MapEntry) => e.years.some(([a, b]) => a <= year && year <= b)
    for (const e of all) m.set(`${e.ref.kind}:${e.ref.id}`, now(e) ? 1 : 0)
    for (const p of [...found, ...consuls]) m.set(`person:${p.id}`, nearness(p, year))
    return m
  }, [all, found, consuls, year])

  const span = map?.politics.window
  const last = span?.[1] ?? year

  const select = (entry: MapEntry) => {
    setOpen(false)
    goTo(entry)
  }
  const choosePerson = (person: PersonRecord) => {
    setOpen(false)
    openPerson(person.id)
  }
  const openChange = (o: boolean) => {
    setOpen(o)
    if (o) setQuery('')
  }

  return (
    <>
      <TitleBlock years={span ? formatSpan(span) : ''} onSearch={() => openChange(true)} />
      <DialogPrimitive.Root open={open} onOpenChange={openChange}>
        <DialogPrimitive.Portal>
          {/* A thin paper wash, not a blur: the map stays legible behind the index. */}
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#EDE6D6]/25 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-[#1b1612]/30" />
          <DialogPrimitive.Content className="fixed top-1/4 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg rule-double bg-card px-5 pt-3 pb-4 text-card-foreground outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:max-w-lg">
            <DialogPrimitive.Title className="sr-only">
              Index of names
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Find a place, polity or person by name, and go to it.
            </DialogPrimitive.Description>
            {/* Values are ids, which are unique; matching is on the names alone. */}
            <Command
              filter={(value, search, keywords) => {
                const score = defaultFilter(keywords?.join(' ') ?? '', search)
                return score >= MIN_SCORE ? score + TIE * (tiebreak.get(value) ?? 0) : 0
              }}
            >
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="A place, province or person…"
                // Not a login field: keep password managers' icons out of it.
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
              <CommandList ref={list} className="max-h-80">
                <CommandEmpty>Nothing by that name.</CommandEmpty>
                {typing ? (
                  <>
                    <Group
                      heading="Polities"
                      rows={lists.polities}
                      last={last}
                      onSelect={select}
                    />
                    <Group
                      heading="Places"
                      rows={lists.places}
                      last={last}
                      onSelect={select}
                    />
                    {people && (
                      <PersonGroup
                        heading="People"
                        persons={found}
                        people={people}
                        year={year}
                        onSelect={choosePerson}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Group
                      heading={`Largest in ${formatYear(year)}`}
                      rows={lists.largest}
                      last={last}
                      onSelect={select}
                    />
                    <Group
                      heading="Cities"
                      rows={lists.cities}
                      last={last}
                      onSelect={select}
                    />
                    {people && (
                      <PersonGroup
                        heading={`Consuls of ${formatYear(year)}`}
                        persons={consuls}
                        people={people}
                        year={year}
                        onSelect={choosePerson}
                        consuls
                      />
                    )}
                  </>
                )}
              </CommandList>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

/**
 * An atlas plate's title block: the map's name and the years it covers, framed in the
 * double rule, with its rows beneath: the search, the sources (a page
 * of its own), the legend and the preface. App.tsx
 * places it at the head of the left column, above the person panel.
 */
function TitleBlock({ years, onSearch }: { years: string; onSearch: () => void }) {
  return (
    <div className="pointer-events-auto relative w-[248px] shrink-0 rounded-lg rule-double bg-card/95 text-card-foreground backdrop-blur-sm select-none">
      <div className="px-4 pt-3 pb-2.5 text-center">
        <h1 className="font-heading text-lg leading-tight font-semibold tracking-[0.16em]">
          Roma Cognita
        </h1>
        <div className="figures text-xs text-muted-foreground italic">
          the Roman world, {years}
        </div>
      </div>
      <span className="mx-3 block h-px bg-rule" aria-hidden />
      {/* The block's rows, set as one short list: as close to each other as to the
          rule above and the frame below. */}
      <div className="py-1.5">
        <button
          type="button"
          onClick={onSearch}
          className="group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
        >
          <SearchIcon className="text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="transition-colors group-hover:text-primary">Search</span>
          <span className="figures ml-auto text-muted-foreground">{KEY}</span>
        </button>
        <a
          href="/sources"
          target="_blank"
          rel="noopener"
          className="group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
        >
          <BookOpen className="text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="transition-colors group-hover:text-primary">Sources</span>
          <ArrowUpRight className="ml-auto text-muted-foreground" />
        </a>
        <LegendRow />
        <Preface years={years} />
      </div>
      <Legend />
    </div>
  )
}

/** A person's match, with the year shown to order namesakes; 0 if it is no match. */
function score(match: number, person: PersonRecord, year: number) {
  return match >= MIN_SCORE ? match + TIE * nearness(person, year) : 0
}

/** A group's heading in small capitals, ruled to the edge. */
const HEADING =
  "**:[[cmdk-group-heading]]:caps **:[[cmdk-group-heading]]:flex **:[[cmdk-group-heading]]:items-center **:[[cmdk-group-heading]]:gap-2 **:[[cmdk-group-heading]]:after:h-px **:[[cmdk-group-heading]]:after:flex-1 **:[[cmdk-group-heading]]:after:bg-rule **:[[cmdk-group-heading]]:after:content-['']"

interface Row {
  entry: MapEntry
  now: boolean
}

function Group(props: {
  heading: string
  rows: Row[]
  /** The last year of the data. */
  last: number
  onSelect: (entry: MapEntry) => void
}) {
  if (!props.rows.length) return null
  return (
    <CommandGroup heading={props.heading} className={HEADING}>
      {props.rows.map(({ entry, now }) => (
        <CommandItem
          key={`${entry.ref.kind}:${entry.ref.id}`}
          value={`${entry.ref.kind}:${entry.ref.id}`}
          keywords={[entry.name, ...entry.names]}
          onSelect={() => props.onSelect(entry)}
          className={cn(
            'items-center gap-2.5',
            !now && 'text-muted-foreground data-selected:text-muted-foreground',
          )}
        >
          <span className="grid w-5 shrink-0 place-items-center">
            <EntryMark entry={entry} />
          </span>
          <span className="shrink-0">{entry.name}</span>
          {/* The index's leader, from the name to what it belongs to, on the lowercase's
              middle so it runs level with both. */}
          <span
            className="mx-0.5 min-w-4 flex-1 self-center border-b border-dotted border-foreground/30"
            aria-hidden
          />
          {/* A shortcut slot, so the item leaves out its check mark. */}
          <CommandShortcut
            className={cn('ml-0 shrink-0 pr-1 font-normal', !now && 'figures not-italic')}
          >
            {now ? context(entry) : when(entry.years, props.last)}
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/**
 * People, set as places are: the name, a leader, and against it their highest office
 * (`consul 70 BCE`), or their dates where DPRR gives none, or among the year's consuls.
 * Those not attested in the year shown are greyed.
 */
function PersonGroup(props: {
  heading: string
  persons: PersonRecord[]
  people: People
  year: number
  onSelect: (person: PersonRecord) => void
  /** The year's consuls: the heading says their office, so the row gives their dates. */
  consuls?: boolean
}) {
  if (!props.persons.length) return null
  return (
    <CommandGroup heading={props.heading} className={HEADING}>
      {props.persons.map((person) => {
        const now = activeIn(person, props.year)
        const office = !props.consuls && props.people.highestOffice(person)
        return (
          <CommandItem
            key={person.id}
            value={`person:${person.id}`}
            keywords={[searchTerms(person)]}
            onSelect={() => props.onSelect(person)}
            className={cn(
              'items-center gap-2.5',
              !now && 'text-muted-foreground data-selected:text-muted-foreground',
            )}
          >
            <span className="grid w-5 shrink-0 place-items-center">
              <Mark>
                <Portrait />
              </Mark>
            </span>
            <span className="min-w-0 truncate">{knownName(person)}</span>
            <span
              className="mx-0.5 min-w-4 flex-1 self-center border-b border-dotted border-foreground/30"
              aria-hidden
            />
            <CommandShortcut
              className={cn(
                'ml-0 shrink-0 pr-1 font-normal',
                !office && 'figures not-italic',
              )}
            >
              {office || lifeLine(props.people, person)}
            </CommandShortcut>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

/** Cities offered first by the weight of their mark: Rome, then the capitals. */
const MARK_RANK: Record<MapEntry['mark'], number> = {
  caput: 0,
  capital: 1,
  seat: 1,
  town: 2,
  fill: 3,
}

/** The mark the map draws it with, as the legend keys it. */
function EntryMark({ entry }: { entry: MapEntry }) {
  switch (entry.mark) {
    case 'fill':
      return <Swatch fill={entry.fill ?? 'transparent'} />
    case 'caput':
      return (
        <Mark>
          <Caput />
        </Mark>
      )
    case 'capital':
      return (
        <Mark>
          <Capital />
        </Mark>
      )
    case 'seat':
      return (
        <Mark>
          <Seat fill={entry.fill ?? 'transparent'} />
        </Mark>
      )
    default:
      return (
        <Mark>
          <Town />
        </Mark>
      )
  }
}

/** What it belongs to: `Province of Roma`, `Aegyptus`; else what it is: `Kingdom`. */
function context(entry: MapEntry) {
  if (entry.ref.kind === 'place' && entry.prominence === 5)
    return entry.of ? `${kindLabel(entry.kind)}, ${entry.of}` : kindLabel(entry.kind)
  if (entry.ref.kind === 'place') return entry.of ?? kindLabel(entry.kind)
  if (entry.relation && entry.relation !== 'independent')
    return standing(entry.relation, entry.of ?? null)
  return kindLabel(entry.kind)
}

function kindLabel(kind: string) {
  const words = kind.replace(/-/g, ' ')
  return words[0].toUpperCase() + words.slice(1)
}

/** `58–51 BCE`, or `from 49 BCE` when it runs to the end of the data. */
function when(years: [number, number][], last: number) {
  const [a, b] = years[0]
  if (years.length === 1 && b === last && a !== b) return `from ${formatYear(a)}`
  return years.map(formatSpan).join(', ')
}
