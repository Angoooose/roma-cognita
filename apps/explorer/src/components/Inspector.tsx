import type { ClaimRecord, PlaceHit, PoliticalHit } from '@roman-map/engine'
import { ChevronRight, X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
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
import { cn } from '@/lib/utils'
import { standing } from '@/lib/standing.ts'
import { formatSpan, formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'
import { usePeople } from '@/peopleStore.ts'
import {
  axis,
  Bar,
  EmptySwatch,
  Fold,
  IndexRow,
  INK,
  KeyRow,
  type Lane,
  LaneChart,
  opacity,
  Section,
  Swatch,
  useRemembered,
  useRomeFills,
} from '@/components/Marks.tsx'
import { PersonLink } from '@/components/PersonLink.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
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
    <Card className="fixed top-4 right-4 max-h-[calc(100vh-140px)] w-[300px] gap-4 overflow-auto">
      {inspected.kind === 'place' ? (
        <PlaceBody hit={inspected.hit} year={year} onClose={close} />
      ) : (
        <TerritoryBody hit={inspected.hit} year={year} onClose={close} />
      )}
    </Card>
  )
}

interface BodyProps<H> {
  hit: H
  year: number
  onClose: () => void
}

function PlaceBody({
  hit: { place: p, status, seatOf },
  year,
  onClose,
}: BodyProps<PlaceHit>) {
  const what = [status ? status[0].toUpperCase() + status.slice(1) : 'Settlement']
  if (seatOf) what.push(`seat of ${seatOf.name}`)
  return (
    <>
      <Header title={p.name} standing={what.join(', ')} onClose={onClose} />
      <CardContent className="space-y-3 text-sm">
        <Facts>
          <Fact label="Confidence">
            <ConfidenceBadge confidence={p.confidence} />
          </Fact>
          {p.pleiades && (
            <Fact label="Pleiades">
              <a
                className="underline underline-offset-2"
                href={`https://pleiades.stoa.org/places/${p.pleiades}`}
                target="_blank"
                rel="noopener"
              >
                {p.pleiades}
              </a>
            </Fact>
          )}
        </Facts>
        {p.note && <Note>{p.note}</Note>}
        <Sources sources={p.sources} />
      </CardContent>
      <Meta id={p.id} year={year} review={p.review} />
    </>
  )
}

/**
 * A territory, drawn as the person panel draws a life: its years on the map in lanes
 * (who held it, and who governed it), who is in command in the year shown, then the
 * whole list of governors and the evidence, folded. Where DPRR's provinces are not
 * joined to this polity, there are no governors to show, and it says only who held it.
 */
function TerritoryBody({ hit, year, onClose }: BodyProps<PoliticalHit>) {
  // The store only keeps territory hits that have both.
  const c = hit.claim!
  const polity = hit.polity!
  const overlord = hit.power && hit.power.id !== polity.id ? hit.power.name : null
  const people = usePeople((s) => s.people)
  const joined = !!people?.isJoined(polity.id)
  return (
    <>
      <Header
        title={polity.name}
        standing={standing(c.relation, overlord)}
        onClose={onClose}
      />
      <CardContent className="space-y-4 text-sm">
        {/* A plain line, flush with the rest: a ruler has no swatch to key him. */}
        {polity.ruler && <p>Ruled by {polity.ruler}</p>}
        {joined ? (
          <>
            <TerritoryChart hit={hit} />
            <InCommand polity={polity.id} year={year} />
            <AllGovernors hit={hit} />
            <Fold name="held" title="Held & sources">
              <Held hit={hit} />
            </Fold>
          </>
        ) : (
          <Held hit={hit} />
        )}
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
            {standing(c.relation, null)}, {c.from.text} – {c.to.text}
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

/** Who held it and how sure, as legend rows; then the note, and the sources as index lines. */
function Held({ hit }: { hit: PoliticalHit }) {
  const c = hit.claim!
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
        <KeyRow swatch={<Swatch fill={fill} open />}>
          <span className="figures">
            {c.from.text} – {c.to.text}
          </span>
        </KeyRow>
        <KeyRow swatch={<Swatch fill={fill} uncertain={c.confidence === 'uncertain'} />}>
          Border <Confidence level={c.confidence} />
        </KeyRow>
      </div>
      {c.note && <p className="text-pretty text-foreground/80">{c.note}</p>}
      <SourceRows sources={hit.sources} />
    </div>
  )
}

/** How sure the border is, in a word that explains itself, as the legend's key does. */
function Confidence({ level }: { level: string }) {
  const says: Record<string, string> = {
    certain: 'The sources agree on it.',
    probable: 'The sources agree on the substance, not every date. Drawn in full colour.',
    uncertain: 'The sources conflict or are silent. Drawn fainter on the map.',
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

/**
 * Sources as a printed page cites them: the work, then the place in it after a comma,
 * `Suetonius, Divus Iulius, 25`, running on however long either is. A hanging indent
 * keeps each source apart when it wraps. No leaders: a citation that wraps would leave
 * a stub of dots, and its locator stranded at the far edge.
 */
function SourceRows({ sources }: { sources: PoliticalHit['sources'] }) {
  if (!sources.length) return null
  return (
    <ol className="space-y-1 text-xs">
      {sources.map((s, i) => (
        <li key={i} className="pl-3 -indent-3 leading-snug text-pretty">
          <Link href={s.url}>{s.citation}</Link>
          {s.locator && (
            <>
              ,{' '}
              <span className="figures text-muted-foreground">
                <Link href={s.passage}>{s.locator}</Link>
              </span>
            </>
          )}
        </li>
      ))}
    </ol>
  )
}

function Header(props: { title: string; standing: string; onClose: () => void }) {
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

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">{children}</dl>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <Badge variant="secondary" className={cn(confidence === 'uncertain' && 'italic')}>
      {confidence}
    </Badge>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-gold/60 pl-2.5 text-pretty text-foreground/80">
      {children}
    </p>
  )
}

function Sources({
  sources,
}: {
  sources: { citation: string; locator?: string; url?: string; passage?: string }[]
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Sources</h3>
      <ul className="list-disc space-y-0.5 pl-4">
        {sources.map((s, i) => (
          <li key={i}>
            <Link href={s.url}>{s.citation}</Link>
            {s.locator && (
              <>
                ,{' '}
                <span className="text-muted-foreground">
                  <Link href={s.passage}>{s.locator}</Link>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
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

function Meta({ id, year, review }: { id: string; year: number; review: string }) {
  return (
    <CardFooter className="text-xs text-muted-foreground">
      {id} · {formatYear(year)}
      {review !== 'verified' && ` · ${review}`}
    </CardFooter>
  )
}
