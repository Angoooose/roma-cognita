import type { CitedSource, ClaimRecord, PlaceHit, PoliticalHit } from '@roma-cognita/engine'
import { ChevronRight, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { standing } from '@/lib/standing.ts'
import { formatSpan } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'
import { usePeople } from '@/peopleStore.ts'
import {
  axis,
  Bar,
  Certainty,
  EmptySwatch,
  Fold,
  IndexRow,
  INK,
  KeyItem,
  KeyRow,
  type Lane,
  LaneChart,
  opacity,
  Q,
  Section,
  Swatch,
  useRemembered,
  useRomeFills,
} from '@/components/Marks.tsx'
import { PersonLink } from '@/components/PersonLink.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type FastiLine, knownName } from '@/lib/people.ts'

/**
 * The inspector: click the map, and it says who held that ground in the year shown,
 * on what footing, how sure we are, and where that comes from. Every claim on the map
 * can be traced to a source from here — the point of drawing confidence at all.
 */
export function Inspector() {
  const map = useExplorer((s) => s.map)
  const inspected = useExplorer((s) => s.inspected)
  const year = useExplorer((s) => s.year)
  const inspect = useExplorer((s) => s.inspect)
  const close = useExplorer((s) => s.closeInspector)

  // A click is a press and release without a drag; a drag pans the map.
  useEffect(() => {
    if (!map) return
    const canvas = map.renderer.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      inspect(e.clientX, e.clientY)
    }
    const onKey = (e: KeyboardEvent) => {
      // A dialog over the map takes its own Escape first.
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [map, inspect, close])

  if (!inspected) return null
  return (
    <Card className="fixed top-4 right-4 max-h-[calc(100vh-140px)] w-[300px] py-0">
      <ScrollArea>
        <div className="flex flex-col gap-4 py-(--card-spacing)">
          {inspected.kind === 'place' ? (
            <PlaceBody hit={inspected.hit} year={year} onClose={close} />
          ) : (
            <TerritoryBody hit={inspected.hit} year={year} onClose={close} />
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}

interface BodyProps<H> {
  hit: H
  year: number
  onClose: () => void
}

/**
 * A place, drawn as a territory is: what it was in the year shown and where, with how
 * sure the record is; its note as the opening; its years in lanes, its status and a
 * monument's building works; then its sources, folded.
 */
function PlaceBody({ hit, year, onClose }: BodyProps<PlaceHit>) {
  const p = hit.place
  const doubt = p.confidence === 'uncertain'
  return (
    <>
      <Header
        title={
          <>
            {p.name}
            {doubt && <Q />}
          </>
        }
        standing={
          <>
            <PlaceStanding hit={hit} year={year} /> · <Certainty level={p.confidence} />
          </>
        }
        onClose={onClose}
      />
      <CardContent className="space-y-4 text-sm">
        {p.note && <Lede>{p.note}</Lede>}
        <PlaceChart hit={hit} />
        <Fold name="place-sources" title={`Sources · ${p.sources.length}`}>
          <SourceRows sources={p.sources} />
        </Fold>
      </CardContent>
    </>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Between a record's years: `before 133 BCE – 84 BCE`, but `241–211 BCE to after 27 BCE` where an end is a range. */
const sep = (from: { text: string }, to: { text: string }) =>
  from.text.includes('–') || to.text.includes('–') ? ' to ' : ' – '
const between = (from: { text: string }, to: { text: string }) =>
  `${from.text}${sep(from, to)}${to.text}`

/**
 * What a place was in the year shown, and where: `Basilica in Roma, under construction`,
 * `Provincial seat in Cilicia`. A monument is in its city; a settlement is in the polity
 * that holds its ground, unless it is that polity's seat or shares its name. The name
 * where it stands opens it.
 */
function PlaceStanding({ hit, year }: { hit: PlaceHit; year: number }) {
  const { place: p, status, condition, seatOf } = hit
  const map = useExplorer((s) => s.map)
  const goToPlace = useExplorer((s) => s.goToPlace)
  const goToPolity = useExplorer((s) => s.goToPolity)
  const ground = useGround(p.within ? null : p, year)
  const city = p.within ? map?.places.all.find((q) => q.id === p.within) : undefined
  const where = city
    ? { name: city.name, go: () => goToPlace(city.id, year) }
    : ground && !seatOf && ground.name !== p.name
      ? { name: ground.name, go: () => goToPolity(ground.id, year) }
      : null
  const rest = [condition, seatOf && `seat of ${seatOf.name}`].filter(Boolean)
  return (
    <>
      {status ? cap(status) : p.within ? cap(p.kind.replace(/-/g, ' ')) : 'Settlement'}
      {where && (
        <>
          {' '}
          in{' '}
          <button
            type="button"
            onClick={where.go}
            className="cursor-pointer italic underline decoration-rule underline-offset-2 transition-colors hover:text-foreground hover:decoration-current"
          >
            {where.name}
          </button>
        </>
      )}
      {rest.map((x) => `, ${x}`)}
    </>
  )
}

/** The polity holding the ground a settlement stands on in `year`, read from the map. */
function useGround(p: PlaceHit['place'] | null, year: number) {
  const map = useExplorer((s) => s.map)
  const [atom, setAtom] = useState<string | null>(null)
  const x = p?.x
  const y = p?.y
  useEffect(() => {
    setAtom(null)
    if (!map || x === undefined || y === undefined) return
    let live = true
    map.politics.atomAt(x, y).then((a) => live && setAtom(a))
    return () => {
      live = false
    }
  }, [map, x, y])
  const held = atom && map ? map.politics.hitAt(atom, year) : null
  return held?.claim ? held.polity : undefined
}

/** The note as the entry's opening, with a gold initial dropped two lines. */
function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="text-pretty first-letter:mr-1.5 first-letter:font-heading first-letter:text-gold first-letter:[-webkit-initial-letter:2] first-letter:[initial-letter:2]">
      {children}
    </p>
  )
}

/** Building works hatched, as a plan draws them. */
const HATCH =
  'repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 45%, transparent) 0 1.5px, transparent 1.5px 4px)'
/** Finishing work after the dedication: a sparser hatch over the standing grey. */
const FINISHING =
  'repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 70%, transparent) 0 1.5px, transparent 1.5px 6px), color-mix(in oklab, var(--foreground) 32%, transparent)'

/** What the Fabric lane's key calls a condition. */
const CONDITION_NAME: Record<string, string> = {
  'under construction': 'Building',
  'being finished': 'Being finished',
}

/**
 * A place's years in lanes on the map's axis: its status, in the colours its mark takes
 * (a seat its ground's, Rome Rome's), and a monument's fabric, standing, building,
 * being finished or burnt. Uncertain, both are drawn fainter.
 */
function PlaceChart({ hit }: { hit: PlaceHit }) {
  const p = hit.place
  const map = useExplorer((s) => s.map)
  const fills = useRomeFills()
  const span = map?.politics.window
  if (!map || !span) return null
  const a = axis(span[0], span[1])
  const doubt = p.confidence === 'uncertain'
  const seat = map.places.allSeats.find((s) => s.place === p.id)
  const seatFill = seat
    ? `#${map.politics.colourOf(seat.polity, seat.years[0]).getHexString()}`
    : fills.client

  const statusFill = (v: string) =>
    v === 'caput mundi'
      ? fills.rome
      : v === 'provincial seat'
        ? fills.province
        : v === 'royal seat'
          ? seatFill
          : INK
  const conditionFill = (v: string) =>
    v === 'under construction' ? HATCH : v === 'being finished' ? FINISHING : INK
  const hatched = (fill: string) => fill === HATCH || fill === FINISHING
  const background = (v: string, kind: 'status' | 'condition') =>
    kind === 'status' ? statusFill(v) : conditionFill(v)
  const strength = (v: string, kind: 'status' | 'condition') => {
    const fill = background(v, kind)
    if (hatched(fill)) return doubt ? 0.45 : 1
    // Burnt is drawn in the darkest ink, standing in the lane's ordinary grey.
    if (v === 'burnt') return doubt ? 0.35 : 0.9
    return opacity(fill, doubt)
  }

  const runs = (
    xs: { value: string; years: [number, number] }[],
    kind: 'status' | 'condition',
  ) =>
    xs
      .filter((r) => r.years[1] >= span[0] && r.years[0] <= span[1])
      .map((r, i) => {
        const from = Math.max(r.years[0], span[0])
        const to = Math.min(r.years[1], span[1])
        const fill = background(r.value, kind)
        const open = r.years[0] < span[0] && !hatched(fill)
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span
                className="absolute top-1/2 h-2.5 -translate-y-1/2 cursor-default rounded-[1px]"
                style={{
                  left: a.at(from),
                  width: a.width(from, to),
                  background: open
                    ? `linear-gradient(90deg, transparent, ${fill} 12%)`
                    : fill,
                  opacity: strength(r.value, kind),
                }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {cap(r.value)}, {formatSpan(r.years)}
            </TooltipContent>
          </Tooltip>
        )
      })

  const lanes: Lane[] = []
  if (p.status.length) lanes.push({ label: 'Status', body: runs(p.status, 'status') })
  if (p.condition?.length)
    lanes.push({ label: 'Fabric', body: runs(p.condition, 'condition') })
  if (!lanes.length) return null

  const keyed = new Map<string, ReactNode>()
  for (const r of p.status)
    keyed.set(r.value, <Swatch fill={statusFill(r.value)} uncertain={doubt} />)
  for (const r of p.condition ?? [])
    keyed.set(
      r.value,
      hatched(conditionFill(r.value)) ? (
        <span
          className="block h-3 w-5 rounded-[1px]"
          style={{ background: conditionFill(r.value), opacity: doubt ? 0.45 : 1 }}
        />
      ) : (
        <span
          className="block h-3 w-5 rounded-[1px]"
          style={{ background: INK, opacity: strength(r.value, 'condition') }}
        />
      ),
    )
  return (
    <LaneChart
      axis={a}
      lanes={lanes}
      legend={[...keyed].map(([v, swatch]) => (
        <KeyItem key={v} swatch={swatch}>
          {CONDITION_NAME[v] ?? cap(v)}
        </KeyItem>
      ))}
    />
  )
}

/**
 * A territory is two records, and the panel keeps them apart: the polity (what it was,
 * its years, its rulers) and its claim on the ground clicked, "Held here" (on what
 * footing, in which years, how sure the holding is). A province joined to DPRR's draws
 * its years in lanes, who is in command in the year shown and the whole list of
 * governors, with "Held here" folded. The polity's own note and its sources come last,
 * folded.
 */
function TerritoryBody({ hit, year, onClose }: BodyProps<PoliticalHit>) {
  // The store only keeps territory hits that have both.
  const c = hit.claim!
  const polity = hit.polity!
  const overlord = hit.power && hit.power.id !== polity.id ? hit.power.name : null
  const people = usePeople((s) => s.people)
  const joined = !!people?.isJoined(polity.id)
  const kind = polity.kind.replace(/-/g, ' ')
  return (
    <>
      <Header
        title={
          <>
            {polity.name}
            {polity.confidence === 'uncertain' && <Q />}
          </>
        }
        standing={
          <Backed sources={backing(hit, 'claim', 'polity', 'relation')}>
            {standing(c.relation, overlord)}
          </Backed>
        }
        onClose={onClose}
      />
      <CardContent className="space-y-4 text-sm">
        {/* Plain lines, flush with the rest: a polity and its ruler have no swatch to key them. */}
        <div className="space-y-1">
          <p>
            <Backed sources={backing(hit, 'polity', 'kind')}>{cap(kind)}</Backed>,{' '}
            <span className="figures">
              <Backed sources={backing(hit, 'polity', 'from')}>{polity.from.text}</Backed>
              {sep(polity.from, polity.to)}
              <Backed sources={backing(hit, 'polity', 'to')}>{polity.to.text}</Backed>
            </span>
          </p>
          {polity.ruler && (
            <p>
              Ruled by{' '}
              <Backed sources={backing(hit, 'polity', 'ruler')}>{polity.ruler}</Backed>
            </p>
          )}
        </div>
        {joined ? (
          <>
            <TerritoryChart hit={hit} />
            <InCommand polity={polity.id} year={year} />
            <AllGovernors hit={hit} />
            <Fold name="held" title="Held here">
              <Held hit={hit} />
            </Fold>
          </>
        ) : (
          <Section title="Held here">
            <Held hit={hit} />
          </Section>
        )}
        {polity.note && (
          <Fold name="polity-note" title={`About the ${kind}`}>
            <p className="text-pretty text-foreground/80">{polity.note}</p>
          </Fold>
        )}
        <Fold name="territory-sources" title={`Sources · ${cited(hit).length}`}>
          <SourceRows sources={cited(hit)} />
        </Fold>
      </CardContent>
    </>
  )
}

/** Each relation as a lane's word, for the chart. */
const RELATION_WORDS: Record<string, string> = {
  province: 'Province',
  'citizen-territory': 'Citizens',
  client: 'Client',
  allied: 'Ally',
  independent: 'Free',
}

/** This polity's claims on the ground clicked, within the map's years. */
function useClaims(hit: PoliticalHit) {
  const map = useExplorer((s) => s.map)
  const span = map?.politics.window
  const claims =
    map?.politics.claimsOf(hit.atom).filter((c) => c.polity === hit.polity!.id) ?? []
  return { span, claims }
}

/** The years this polity holds the ground, on the map's axis: when it had governors to have. */
function heldYears(claims: ClaimRecord[], span: [number, number]) {
  const years = new Set<number>()
  for (const c of claims)
    for (let y = Math.max(c.from.year, span[0]); y <= Math.min(c.to.year, span[1]); y++)
      years.add(y)
  return [...years]
}

/** Governors' terms can overlap (the outgoing man and his successor): each gets a track. */
function tracks(terms: { from: number; to: number }[]) {
  const ends: number[] = []
  return terms.map((t) => {
    let k = ends.findIndex((end) => end < t.from)
    if (k < 0) k = ends.length
    ends[k] = t.to
    return k
  })
}

function TerritoryChart({ hit }: { hit: PoliticalHit }) {
  const people = usePeople((s) => s.people)!
  const fills = useRomeFills()
  const { span, claims } = useClaims(hit)
  if (!span) return null
  const a = axis(span[0], span[1])
  const fillOf = (relation: string) =>
    relation === 'province' ? fills.province : relation === 'client' ? fills.client : INK
  const terms = people
    .fasti(hit.polity!.id, heldYears(claims, span))
    .filter((l) => l.kind === 'term')
  const track = tracks(terms)
  const stacked = track.some((k) => k > 0)
  const relations = [...new Set(claims.map((c) => c.relation))]
  const lanes: Lane[] = [
    {
      label: relations.length === 1 ? (RELATION_WORDS[relations[0]] ?? 'Held') : 'Held',
      body: claims.map((c, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span>
              <Bar
                axis={a}
                from={Math.max(c.from.year, span[0])}
                to={Math.min(c.to.year, span[1])}
                fill={fillOf(c.relation)}
                uncertain={c.confidence === 'uncertain'}
                openStart={c.from.year < span[0] || c.from.text.startsWith('before')}
                openEnd={c.to.year > span[1] || c.to.text.startsWith('after')}
                className="cursor-default"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {standing(c.relation, null)}, {between(c.from, c.to)}
          </TooltipContent>
        </Tooltip>
      )),
    },
    {
      label: 'Governors',
      height: stacked ? 'h-8' : 'h-5',
      body: terms.map((t, i) => (
        <TermBar
          key={i}
          term={t}
          fill={fills.province}
          left={a.at(t.from)}
          width={a.width(t.from, t.to)}
          top={stacked ? (track[i] ? '70%' : '30%') : '50%'}
        />
      )),
    },
  ]
  return <LaneChart axis={a} lanes={lanes} fill={fills.province} />
}

/** A governor's term in its lane, with a hover card as the person's commands have; a click opens him. */
function TermBar(props: {
  term: Extract<FastiLine, { kind: 'term' }>
  fill: string
  left: string
  width: string
  top: string
}) {
  const { term: t } = props
  const people = usePeople((s) => s.people)!
  const open = usePeople((s) => s.open)
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${t.person.name}, ${formatSpan([t.from, t.to])}`}
          onClick={() => open(t.person.id)}
          className="group absolute z-20 h-3.5 -translate-y-1/2 cursor-pointer px-px"
          style={{ left: props.left, width: props.width, top: props.top }}
        >
          <span
            className="absolute inset-x-px top-1/2 h-2.5 -translate-y-1/2 rounded-[1px] ring-foreground/50 transition-shadow group-hover:ring-1"
            style={{ background: props.fill, opacity: opacity(props.fill, t.uncertain) }}
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
            {knownName(t.person)}
            {t.uncertain && '?'}
          </div>
          <div className="figures text-xs text-muted-foreground">
            {people.officeLabel(t.post)} · {formatSpan([t.from, t.to])}
          </div>
          {t.person.en?.description && (
            <p className="text-xs text-pretty text-foreground/80">
              {t.person.en.description}
            </p>
          )}
          <div className="pt-0.5 text-xs text-muted-foreground">Click to open</div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * Who held command in the year shown, from DPRR through data/dprr-provinces.yaml, with
 * their staff folded beneath. "In command", not "governor": in a civil war the generals
 * in a province are listed with its governor. Two in one year is ordinary, the outgoing
 * man before his successor. "No one attested" is an answer, not a blank.
 */
function InCommand({ polity, year }: { polity: string; year: number }) {
  const people = usePeople((s) => s.people)!
  const fills = useRomeFills()
  const [staffOpen, setStaffOpen] = useRemembered('staff')
  const { command, staff } = people.governors(polity, year)
  const said = (y: string) => `In command in ${y}`
  return (
    <Section title="In command">
      <ol>
        {command.length ? (
          command.map((s) => (
            <div key={s.person.id}>
              <IndexRow
                mark={<Swatch fill={fills.province} uncertain={s.uncertain} />}
                from={s.tenure[0]}
                to={s.tenure[1]}
                now={said}
              >
                <PersonLink id={s.person.id} uncertain={s.uncertain} />
              </IndexRow>
              <div className="pl-[1.875rem] text-xs text-muted-foreground">
                <span className="italic">{people.officeLabel(s.post).toLowerCase()}</span>
                {people.highestOffice(s.person) && <> · {people.highestOffice(s.person)}</>}
              </div>
            </div>
          ))
        ) : (
          <IndexRow mark={<EmptySwatch />} from={year} to={year} now={said} faint>
            No one attested
          </IndexRow>
        )}
      </ol>
      {staff.length > 0 && (
        <div className="mt-1 pl-[1.875rem] text-xs text-muted-foreground">
          {/* A disclosure, not a link: no underline, so it does not promise a hover card. */}
          <button
            type="button"
            aria-expanded={staffOpen}
            onClick={() => setStaffOpen(!staffOpen)}
            className="-ml-4 flex items-center gap-0.5 transition-colors select-none hover:text-foreground"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', staffOpen && 'rotate-90')}
            />
            Staff · {staff.length}
          </button>
          {staffOpen && (
            <ul className="mt-1 space-y-0.5 text-sm text-foreground">
              {staff.map((s) => (
                <li key={s.person.id} className="leading-snug">
                  <PersonLink id={s.person.id} uncertain={s.uncertain} />
                  <span className="text-xs text-muted-foreground italic">
                    , {people.officeLabel(s.post).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

function AllGovernors({ hit }: { hit: PoliticalHit }) {
  const people = usePeople((s) => s.people)!
  const fills = useRomeFills()
  const { span, claims } = useClaims(hit)
  if (!span) return null
  const lines = people.fasti(hit.polity!.id, heldYears(claims, span))
  const count = new Set(lines.flatMap((l) => (l.kind === 'term' ? [l.person.id] : []))).size
  if (!count) return null
  const said = (y: string) => `In command in ${y}`
  return (
    <Fold name="governors" title={`All governors · ${count}`}>
      <ol>
        {lines.map((l, i) =>
          l.kind === 'term' ? (
            <IndexRow
              key={i}
              mark={<Swatch fill={fills.province} uncertain={l.uncertain} />}
              from={l.from}
              to={l.to}
              now={said}
            >
              <PersonLink id={l.person.id} uncertain={l.uncertain} />
            </IndexRow>
          ) : (
            <IndexRow
              key={i}
              mark={<EmptySwatch />}
              from={l.from}
              to={l.to}
              now={() => 'No one attested'}
              faint
            >
              No one attested
            </IndexRow>
          ),
        )}
      </ol>
    </Fold>
  )
}

/**
 * How the polity held the ground clicked and how sure the border is, as legend rows,
 * then the claim's note. Its years are left out where they are the polity's own.
 */
function Held({ hit }: { hit: PoliticalHit }) {
  const c = hit.claim!
  const p = hit.polity!
  const ownYears = c.from.text === p.from.text && c.to.text === p.to.text
  const fills = useRomeFills()
  const fill =
    c.relation === 'province'
      ? fills.province
      : c.relation === 'client'
        ? fills.client
        : INK
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {!ownYears && (
          <KeyRow swatch={<Swatch fill={fill} open />}>
            <span className="figures">
              <Backed sources={backing(hit, 'claim', 'from')}>{c.from.text}</Backed>
              {sep(c.from, c.to)}
              <Backed sources={backing(hit, 'claim', 'to')}>{c.to.text}</Backed>
            </span>
          </KeyRow>
        )}
        <KeyRow swatch={<Swatch fill={fill} uncertain={c.confidence === 'uncertain'} />}>
          Holding <Certainty level={c.confidence} />
        </KeyRow>
      </div>
      {c.note && <p className="text-pretty text-foreground/80">{c.note}</p>}
    </div>
  )
}

/**
 * Sources as a printed page cites them: the work, then the place in it after a comma,
 * `Suetonius, Divus Iulius, 25`, running on however long either is. A hanging indent
 * keeps each source apart when it wraps. No leaders: a citation that wraps would leave
 * a stub of dots, and its locator stranded at the far edge.
 */
function SourceRows({ sources }: { sources: CitedSource[] }) {
  if (!sources.length) return null
  return (
    <ol className="space-y-1 text-xs">
      {sources.map((s, i) => (
        <li key={i} className="pl-3 -indent-3 leading-snug text-pretty">
          <Cite s={s} />
        </li>
      ))}
    </ol>
  )
}

/** A source's work, and the place in it after a comma. */
function Cite({ s }: { s: CitedSource }) {
  return (
    <>
      <Link href={s.url}>{s.citation}</Link>
      {s.locator && (
        <>
          ,{' '}
          <span className="figures text-muted-foreground">
            <Link href={s.passage}>{s.locator}</Link>
          </span>
        </>
      )}
    </>
  )
}

const passageKey = (s: CitedSource) => `${s.citation}|${s.locator}|${s.quote}`

/**
 * The quoted passages that back some of a record's fields. A claim whose years are its
 * polity's draws them on the polity's line, so the polity's years carry the claim's
 * passages for them too.
 */
function backing(hit: PoliticalHit, record: 'polity' | 'claim', ...fields: string[]) {
  const quoted = (sources: CitedSource[]) =>
    sources.filter((s) => s.quote && s.supports?.some((f) => fields.includes(f)))
  let out = quoted(record === 'polity' ? hit.politySources : hit.sources)
  const p = hit.polity!
  const c = hit.claim!
  const shared = fields.every(
    (f) => (f === 'from' || f === 'to') && c[f].text === p[f].text,
  )
  if (record === 'polity' && shared) out = [...out, ...quoted(hit.sources)]
  const seen = new Set<string>()
  return out.filter((s) => !seen.has(passageKey(s)) && seen.add(passageKey(s)))
}

/** Every source both records cite, each once: the polity's, then the claim's. */
function cited(hit: PoliticalHit) {
  const seen = new Set<string>()
  return [...hit.politySources, ...hit.sources].filter(
    (s) => !seen.has(passageKey(s)) && seen.add(passageKey(s)),
  )
}

/**
 * A value the sources were read for: underlined dotted, as "probable" is, and a click
 * shows the words it rests on and where. The first passage is open; the rest follow on
 * a click. A value nothing quoted backs is plain text, which is itself an answer.
 */
function Backed({ sources, children }: { sources: CitedSource[]; children: ReactNode }) {
  const [all, setAll] = useState(false)
  // Out beside the panel, not over it: the value it explains stays in view.
  const [offset, setOffset] = useState(8)
  if (!sources.length) return children
  const shown = all ? sources : sources.slice(0, 1)
  return (
    <Popover onOpenChange={(open) => !open && setAll(false)}>
      <PopoverTrigger asChild>
        {/* A span, not a button: a button will not wrap across lines as the ruler line must. */}
        <span
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.currentTarget.click()
          }}
          // A click or a key: either way it opens beside the panel, not over it.
          onClick={(e) => {
            const panel = e.currentTarget.closest('[data-slot=card]')
            if (panel)
              setOffset(
                e.currentTarget.getBoundingClientRect().left -
                  panel.getBoundingClientRect().left +
                  8,
              )
          }}
          className="cursor-pointer underline decoration-foreground/30 decoration-dotted underline-offset-[3px] hover:decoration-foreground/70 data-[state=open]:decoration-gold data-[state=open]:decoration-solid"
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={offset}
        className="paper rule-double max-h-[60vh] w-72 overflow-y-auto bg-card not-italic"
      >
        <div className="space-y-3 text-xs text-pretty">
          {shown.map((s, i) => (
            <div key={i} className="space-y-1">
              <p className="text-sm leading-snug text-foreground/90">“{s.quote}”</p>
              <p className="pl-3 -indent-3 leading-snug">
                <Cite s={s} />
              </p>
            </div>
          ))}
          {!all && sources.length > 1 && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setAll(true)}
            >
              {sources.length - 1} more {sources.length === 2 ? 'passage' : 'passages'}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Header(props: { title: ReactNode; standing: ReactNode; onClose: () => void }) {
  return (
    <CardHeader>
      <CardTitle>{props.title}</CardTitle>
      <CardDescription className="italic">{props.standing}</CardDescription>
      <CardAction>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={props.onClose}>
          <X />
        </Button>
      </CardAction>
    </CardHeader>
  )
}

/** The work, or the passage cited in it, opened in a new tab; plain text when there is no link. */
function Link({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return children
  return (
    <a className="underline underline-offset-2" href={href} target="_blank" rel="noopener">
      {children}
    </a>
  )
}
