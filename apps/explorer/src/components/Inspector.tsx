import type { PlaceHit, PoliticalHit } from '@roman-map/engine'
import { X } from 'lucide-react'
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
import { formatYear } from '@/lib/year.ts'
import { useExplorer } from '@/store.ts'

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
      if (e.key === 'Escape') close()
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

function TerritoryBody({ hit, year, onClose }: BodyProps<PoliticalHit>) {
  // The store only keeps territory hits that have both.
  const c = hit.claim!
  const polity = hit.polity!
  const overlord = hit.power && hit.power.id !== polity.id ? hit.power.name : null
  return (
    <>
      <Header
        title={polity.name}
        standing={standing(c.relation, overlord)}
        onClose={onClose}
      />
      <CardContent className="space-y-3 text-sm">
        <Facts>
          <Fact label="Held">
            {c.from.text} – {c.to.text}
          </Fact>
          <Fact label="Confidence">
            <ConfidenceBadge confidence={c.confidence} />
          </Fact>
          {polity.ruler && <Fact label="Ruler">{polity.ruler}</Fact>}
        </Facts>
        {c.note && <Note>{c.note}</Note>}
        <Sources sources={hit.sources} />
      </CardContent>
      <Meta id={hit.atom} year={year} review={c.review} />
    </>
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
  return <p className="border-l-2 pl-2.5 text-muted-foreground">{children}</p>
}

function Sources({
  sources,
}: {
  sources: { citation: string; locator?: string; url?: string }[]
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Sources</h3>
      <ul className="list-disc space-y-0.5 pl-4">
        {sources.map((s, i) => (
          <li key={i}>
            {s.url ? (
              <a
                className="underline underline-offset-2"
                href={s.url}
                target="_blank"
                rel="noopener"
              >
                {s.citation}
              </a>
            ) : (
              s.citation
            )}
            {s.locator && (
              <>
                , <span className="text-muted-foreground">{s.locator}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
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

function standing(relation: string, overlord: string | null) {
  const of = overlord ? ` of ${overlord}` : ''
  switch (relation) {
    case 'province':
      return `Province${of}`
    case 'citizen-territory':
      return `Citizen territory${of}`
    case 'client':
      return `Client kingdom${of}`
    case 'allied':
      return `Allied${overlord ? ` to ${overlord}` : ''}`
    case 'occupied':
      return `Occupied`
    default:
      return 'Independent'
  }
}
