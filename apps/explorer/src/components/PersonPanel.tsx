import type { PersonRecord } from '@roman-map/schema'
import { ChevronLeft, X } from 'lucide-react'
import type { RomeMap } from '@roman-map/engine'
import type { ReactNode } from 'react'
import { InPersonPanel, lifeLine, PersonLink } from '@/components/PersonLink.tsx'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  axis,
  Bar,
  Dot,
  Fold,
  IndexRow,
  INK,
  type Lane,
  LaneChart,
  opacity,
  Q,
  Section,
  Swatch,
  useRomeFills,
} from '@/components/Marks.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type Career,
  type CareerLine,
  type Command,
  type CommandPlace,
  knownName,
  type People,
} from '@/lib/people.ts'
import { cn } from '@/lib/utils'
import { formatSpan, formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'
import { usePeople } from '@/peopleStore.ts'

/**
 * The person panel: a life, on the left, beneath the title block, while the place stays
 * on the right (PEOPLE.md). It is not a dialog: the map stays live between the two, and
 * the timeline moves the gold index through the career. Opening a relative replaces the
 * person and remembers the way back; a name opened from anywhere else starts afresh.
 *
 * It is drawn with the map's own parts: the timeline's ruler and index, the legend's
 * swatches and its "fainter" for doubt, and search's index lines with dotted leaders.
 */
export function PersonPanel({ className }: { className?: string }) {
  const people = usePeople((s) => s.people)
  const failed = usePeople((s) => s.failed)
  const id = usePeople((s) => s.person)
  const trail = usePeople((s) => s.trail)
  const back = usePeople((s) => s.back)
  const close = usePeople((s) => s.close)
  if (!id) return null

  const person = people?.person(id)
  const plate = cn(
    'pointer-events-auto flex min-h-0 w-[360px] flex-col rounded-lg rule-double paper bg-card text-sm text-card-foreground shadow-plate',
    className,
  )
  if (!people || !person) {
    return (
      <aside className={cn(plate, 'px-4 py-3 text-muted-foreground italic')}>
        {failed
          ? `The people could not be loaded: ${failed}`
          : people
            ? 'No such person.'
            : 'Loading people…'}
      </aside>
    )
  }
  const previous = trail.at(-1) && people.person(trail.at(-1)!)
  const career = people.career(person.id)

  return (
    <aside className={plate} aria-label={`About ${knownName(person)}`}>
      <Header
        people={people}
        person={person}
        previous={previous || undefined}
        onBack={back}
        onClose={close}
      />
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-4 pb-3">
          <InPersonPanel value>
            <LifeChart career={career} />
            <CareerList career={career} />
            <Commands career={career} />
            <Family people={people} person={person} />
          </InPersonPanel>
          <Evidence people={people} person={person} />
        </div>
      </ScrollArea>
    </aside>
  )
}

// --- the header ----------------------------------------------------------------------

function Header(props: {
  people: People
  person: PersonRecord
  previous?: PersonRecord
  onBack: () => void
  onClose: () => void
}) {
  const { people, person, previous } = props
  const [kicker, title] = splitName(person)
  const office = people.highestOffice(person)
  const tags = [...standing(person), lifeLine(people, person)]
  return (
    <>
      <header className="flex items-start gap-1 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          {previous && (
            <button
              type="button"
              onClick={props.onBack}
              className="-ml-1 flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              <ChevronLeft className="size-3.5" />
              {knownName(previous)}
            </button>
          )}
          {kicker && (
            <div className="caps text-[0.6875rem] text-muted-foreground">{kicker}</div>
          )}
          <h2 className="font-heading text-lg leading-tight font-semibold">{title}</h2>
          <div className="text-xs text-pretty text-muted-foreground italic">
            {person.full}
            {person.re && <span className="not-italic"> · RE {person.re}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={props.onClose}>
          <X />
        </Button>
      </header>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {office && <Badge variant="secondary">{office}</Badge>}
        {tags.map((t) => (
          <Badge key={t} variant="probable">
            {t}
          </Badge>
        ))}
      </div>
    </>
  )
}

/**
 * The name a reader knows, with the cognomen they know him by set large and the rest
 * above it: `Quintus Caecilius` over `Metellus Creticus`. Whole where it will not split.
 */
function splitName(p: PersonRecord): [string | null, string] {
  const known = knownName(p)
  const cognomen = p.names.cognomen?.split(' ')[0]
  const at = cognomen ? known.indexOf(cognomen) : -1
  if (at <= 0) return [null, known]
  return [known.slice(0, at).trim(), known.slice(at)]
}

/** Patrician, *nobilis*, new man; and where from. */
function standing(p: PersonRecord) {
  return [
    p.patrician && `patrician${p.patrician.uncertain ? '?' : ''}`,
    p.novus ? 'new man' : p.nobilis && 'consular family',
    p.origin && `from ${p.origin}`,
  ].filter((s): s is string => !!s)
}

/**
 * The first year a command's ground is drawn on the map, and the polity it was. DPRR's
 * years can run before the map's (Crete was a province only from 66 BCE), so the map
 * is asked, not the post.
 */
function onMap(c: Command, map: RomeMap | null) {
  if (!map) return null
  for (const p of c.places) {
    if (!p.polity) continue
    const ref = { kind: 'polity', id: p.polity } as const
    const year = p.years.find((y) => map.shows(ref, y))
    if (year !== undefined) return { polity: p.polity, year }
  }
  return null
}

/**
 * What a click on a command does: fly to its ground in its first year on the map; or,
 * where the ground is not ours (Italia), just move the timeline into the command.
 */
function useShowCommand(c: Command) {
  const map = useExplorer((s) => s.map)
  const span = map?.politics.window
  const goToPolity = useExplorer((s) => s.goToPolity)
  const goToYear = useExplorer((s) => s.goToYear)
  const ground = onMap(c, map)
  if (ground) return { go: () => goToPolity(ground.polity, ground.year) }
  if (span && c.from <= span[1] && c.to >= span[0]) {
    const year = Math.max(c.from, span[0])
    return { go: () => goToYear(year), year }
  }
  return { span }
}

// --- the chart -----------------------------------------------------------------------

/** The lanes' drawn width, CSS px: the panel less its padding and the lane labels. */
const TRACK = 360 - 32 - 68

/**
 * The life drawn in lanes on one axis: the offices as dots, commands in their ground's
 * colour, and the Senate or a priesthood as spans, over the timeline's ruler with its
 * gold index at the year the map shows.
 */
function LifeChart({ career }: { career: Career }) {
  const fill = useRomeFills().province
  const offices = career.lines.filter((l) => l.chart)
  const years = [
    ...offices.map((l) => l.from),
    ...career.commands.flatMap((c) => [c.from, c.to]),
    ...career.standing.flatMap((l) => l.spans.flatMap((s) => [s.from, s.to])),
  ]
  if (!years.length) return null

  let lo = Math.min(...years) - 2
  let hi = Math.max(...years) + 2
  const short = 20 - (hi - lo)
  if (short > 0) {
    lo -= Math.ceil(short / 2)
    hi += Math.floor(short / 2)
  }
  const a = axis(lo, hi)

  const lanes: Lane[] = []
  if (offices.length) {
    const labels = placeLabels(offices, (y) => ((y - lo + 0.5) / a.n) * TRACK)
    // A row above the dots only if some label had to go there.
    const above = labels.includes('above')
    lanes.push({
      label: 'Offices',
      height: above ? 'h-10' : 'h-6',
      body: offices.map((l, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            {/* The dot and its label are one target: either shows what the office was. */}
            <span
              className={cn(
                'absolute grid size-3 -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center',
                above ? 'top-7' : 'top-1/2',
              )}
              style={{ left: a.mid(l.from) }}
            >
              <Dot uncertain={l.uncertain} />
              {labels[i] && (
                <span
                  className={cn(
                    'absolute text-[0.6875rem] leading-none whitespace-nowrap',
                    SIDE[labels[i]],
                  )}
                  style={{ opacity: l.uncertain ? 0.7 : 1 }}
                  aria-hidden
                >
                  {l.abbreviation}
                </span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {l.label}
            {l.uncertain && '?'}, {formatSpan([l.from, l.to])}
          </TooltipContent>
        </Tooltip>
      )),
    })
  }
  if (career.commands.length) {
    lanes.push({
      label: 'Commands',
      body: career.commands.map((c, i) => (
        <CommandBar
          key={i}
          command={c}
          fill={fill}
          left={a.at(c.from)}
          width={a.width(c.from, c.to)}
        />
      )),
    })
  }
  for (const lane of career.standing) {
    lanes.push({
      label: lane.label,
      body: lane.spans.map((s, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <Bar
              axis={a}
              from={s.from}
              to={s.to}
              fill={INK}
              uncertain={s.uncertain}
              className="cursor-default"
            />
          </TooltipTrigger>
          <TooltipContent>
            {lane.label}, {formatSpan([s.from, s.to])}
            {s.uncertain && ', uncertain'}
          </TooltipContent>
        </Tooltip>
      )),
    })
  }

  return <LaneChart axis={a} lanes={lanes} />
}

type Side = 'right' | 'left' | 'above'

/** Where a label sits, from the dot's 12px box: beside it on its line, or centred above. */
const SIDE: Record<Side, string> = {
  right: 'left-full top-1/2 -translate-y-1/2 pl-0.5',
  left: 'right-full top-1/2 -translate-y-1/2 pr-0.5',
  above: 'bottom-full left-1/2 -translate-x-1/2 pb-0.5',
}

let measure: CanvasRenderingContext2D | null | undefined
/** A label's width in the chart's type, measured; estimated where there is no canvas. */
function textWidth(s: string) {
  measure ??= document.createElement('canvas').getContext('2d')
  if (!measure) return s.length * 5.5
  measure.font = `11px ${getComputedStyle(document.body).fontFamily}`
  return measure.measureText(s).width
}

/**
 * Where each office's label goes: beside its dot, on the dot's line, as a legend row
 * sets a swatch and its words; above the dot only where neither side is free; or not at
 * all, and the dot still says what it is on hover. Tries every arrangement (a career has
 * a handful of offices) for the one that labels the most, with the fewest above.
 */
function placeLabels(lines: CareerLine[], px: (y: number) => number): (Side | null)[] {
  const GAP = 3
  const xs = lines.map((l) => px(l.from))
  const ws = lines.map((l) => (l.abbreviation ? textWidth(l.abbreviation) + 2 : 0))
  // Each option's row (0 beside the dots, 1 above them) and extent, px along the lane.
  const extent = (i: number, side: Side): [number, number, number] => {
    const [x, w] = [xs[i], ws[i]]
    if (side === 'right') return [0, x + 6, x + 6 + w]
    if (side === 'left') return [0, x - 6 - w, x - 6]
    const a = Math.min(Math.max(x - w / 2, 0), TRACK - w)
    return [1, a, a + w]
  }
  // The dots themselves are in the way of any label beside another dot.
  const dots = xs.map((x): [number, number, number] => [0, x - 4, x + 4])
  const fits = ([row, a, b]: [number, number, number], taken: [number, number, number][]) =>
    a >= 0 &&
    b <= TRACK &&
    taken.every(([r, c, d]) => r !== row || b + GAP <= c || a >= d + GAP)

  let best: (Side | null)[] = lines.map(() => null)
  let bestScore = -1
  const score = (sides: (Side | null)[]) =>
    sides.reduce((n, s) => n + (s ? (s === 'above' ? 9 : s === 'right' ? 10.1 : 10) : 0), 0)
  const options: (Side | null)[] = ['right', 'left', 'above', null]
  const search = (i: number, sides: (Side | null)[], taken: [number, number, number][]) => {
    if (i === lines.length) {
      const s = score(sides)
      if (s > bestScore) [best, bestScore] = [sides, s]
      return
    }
    for (const side of ws[i] ? options : [null]) {
      if (!side) {
        search(i + 1, [...sides, null], taken)
        continue
      }
      const e = extent(i, side)
      const others = dots.filter((_, k) => k !== i)
      if (fits(e, [...taken, ...others])) search(i + 1, [...sides, side], [...taken, e])
    }
  }
  // A long career would take too long to try every way: place greedily instead.
  if (lines.length <= 9) search(0, [], [])
  else {
    const taken: [number, number, number][] = []
    best = lines.map((_, i) => {
      if (!ws[i]) return null
      const others = dots.filter((_, k) => k !== i)
      for (const side of ['right', 'left', 'above'] as const) {
        const e = extent(i, side)
        if (fits(e, [...taken, ...others])) {
          taken.push(e)
          return side
        }
      }
      return null
    })
  }
  return best
}

/**
 * A command in its lane. The bar is thin, so the hover target is the lane's full height
 * over the bar's years. A click shows it on the map, as its place link does.
 */
function CommandBar(props: {
  command: Command
  fill: string
  left: string
  width: string
}) {
  const { command: c } = props
  const show = useShowCommand(c)
  const map = useExplorer((s) => s.map)
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${c.label}, ${places(c, map)}, ${formatSpan([c.from, c.to])}`}
          onClick={show.go}
          className={cn(
            'group absolute inset-y-0 z-20 px-px',
            show.go ? 'cursor-pointer' : 'cursor-default',
          )}
          style={{ left: props.left, width: props.width }}
        >
          <span
            className="absolute inset-x-px top-1/2 h-2.5 -translate-y-1/2 rounded-[1px] ring-foreground/50 transition-shadow group-hover:ring-1"
            style={{ background: props.fill, opacity: opacity(props.fill, c.uncertain) }}
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        className="paper rule-double w-64 bg-card"
      >
        <div className="space-y-1">
          <div className="font-heading text-sm leading-snug font-semibold">
            {places(c, map) || c.label}
          </div>
          <div className="figures text-xs text-muted-foreground">
            {c.label}
            {c.uncertain && '?'} · {formatSpan([c.from, c.to])}
          </div>
          {(c.source || c.citations.length > 0) && (
            <div className="text-xs text-muted-foreground italic">
              {[c.source, ...c.citations].filter(Boolean).join('; ')}
            </div>
          )}
          <div className="pt-0.5 text-xs text-muted-foreground">
            {show.go
              ? show.year !== undefined
                ? `Click to go to ${formatYear(show.year)}`
                : 'Click to show on the map'
              : show.span
                ? `Outside the years this map covers, ${formatSpan(show.span)}`
                : null}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/** A place as the map names it: our polity's name where it is ours, else DPRR's. */
function placeName(p: CommandPlace, map: RomeMap | null) {
  return (p.polity && map?.politics.nameOf(p.polity, p.years[0] ?? map.year)) || p.name
}

const places = (c: Command, map: RomeMap | null) =>
  c.places.map((p) => `${placeName(p, map)}${p.uncertain ? '?' : ''}`).join(', ')

// --- the lists -----------------------------------------------------------------------

function CareerList({ career }: { career: Career }) {
  if (!career.lines.length) return null
  return (
    <Section title="Career">
      <ol>
        {career.lines.map((l, i) => (
          <IndexRow
            key={i}
            mark={l.kind === 'office' ? <Dot uncertain={l.uncertain} /> : undefined}
            from={l.from}
            to={l.to}
          >
            <CareerWords line={l} />
          </IndexRow>
        ))}
      </ol>
    </Section>
  )
}

/** A line in the legend's grammar: the thing, then what qualifies it in italic. */
function CareerWords({ line: l }: { line: CareerLine }) {
  return (
    <>
      {l.label}
      {l.uncertain && <Q />}
      {l.kind === 'candidacy' && (
        <>
          , <span className="italic">not elected</span>
        </>
      )}
      {l.detail && (
        <>
          , <span className="italic">{l.detail}</span>
        </>
      )}
      {l.colleagues.length > 0 && (
        <>
          , {/* The colleague moves as one, so a narrow line never strands "with". */}
          <span className="whitespace-nowrap">
            <span className="italic">with </span>
            {l.colleagues.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' and '}
                <PersonLink id={p.id} />
              </span>
            ))}
          </span>
        </>
      )}
    </>
  )
}

function Commands({ career }: { career: Career }) {
  const fill = useRomeFills().province
  if (!career.commands.length) return null
  return (
    <Section title="Commands">
      <ol>
        {career.commands.map((c, i) => (
          <IndexRow
            key={i}
            mark={<Swatch fill={fill} uncertain={c.uncertain} />}
            from={c.from}
            to={c.to}
          >
            <CommandWords command={c} />
          </IndexRow>
        ))}
      </ol>
    </Section>
  )
}

function CommandWords({ command: c }: { command: Command }) {
  const map = useExplorer((s) => s.map)
  const goToPolity = useExplorer((s) => s.goToPolity)
  const label = c.label.toLowerCase()
  if (!c.places.length) {
    return (
      <>
        {c.label}
        {c.uncertain && <Q />}
      </>
    )
  }
  return (
    <>
      {c.places.map((p, i) => {
        const ground = onMap({ ...c, places: [p] }, map)
        return (
          <span key={p.polity ?? p.name}>
            {i > 0 && ', '}
            {ground ? (
              <Place onClick={() => goToPolity(ground.polity, ground.year)}>
                {placeName(p, map)}
              </Place>
            ) : (
              placeName(p, map)
            )}
            {p.uncertain && <Q />}
          </span>
        )
      })}
      , <span className="italic">{label}</span>
      {c.uncertain && <Q />}
    </>
  )
}

/** A province named in a command: a link, as sources print theirs, that takes the map there. */
function Place({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="cursor-pointer underline decoration-foreground/35 underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>Show on the map</TooltipContent>
    </Tooltip>
  )
}

// --- family and evidence -------------------------------------------------------------

function Family({ people, person }: { people: People; person: PersonRecord }) {
  const groups = people.family(person.id)
  if (!groups.length) return null
  const count = groups.reduce((n, g) => n + g.relatives.length, 0)
  return (
    <Fold name="family" title={`Family · ${count}`}>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="text-xs text-muted-foreground italic">{g.name}</div>
            <ul className="space-y-0.5">
              {g.relatives.map((r) => (
                <li key={r.person.id} className="flex items-baseline gap-1.5">
                  <PersonLink id={r.person.id} uncertain={r.uncertain} className="shrink-0">
                    {r.person.name}
                  </PersonLink>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {r.labels.join(', ')}
                    {' · '}
                    <span className="figures">{lifeLine(people, r.person)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Fold>
  )
}

function Evidence({ people, person }: { people: People; person: PersonRecord }) {
  const sources = people.sourcesFor(person.id)
  const link = 'underline underline-offset-2'
  return (
    <Fold name="evidence" title="Evidence & credit">
      <div className="space-y-2 text-xs text-muted-foreground">
        {sources.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4">
            {sources.map((s) => (
              <li key={s.id}>{s.biblio ?? s.name}</li>
            ))}
          </ul>
        )}
        <p>
          From the{' '}
          <a className={link} href={person.dprr.page} target="_blank" rel="noopener">
            Digital Prosopography of the Roman Republic
          </a>
          , King's College London (
          <a
            className={link}
            href="https://creativecommons.org/licenses/by-nc/4.0/"
            target="_blank"
            rel="noopener"
          >
            CC BY-NC 4.0
          </a>
          ), rearranged for the map
          {person.en && (
            <>
              ; English name from{' '}
              <a
                className={link}
                href={`https://www.wikidata.org/wiki/${person.en.wikidata}`}
                target="_blank"
                rel="noopener"
              >
                Wikidata
              </a>
            </>
          )}
          .
        </p>
      </div>
    </Fold>
  )
}
