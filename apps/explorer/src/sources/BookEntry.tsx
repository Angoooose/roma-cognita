import { type ReactNode, useId, useMemo, useState } from 'react'
import { Fleuron, Section } from '@/components/Marks.tsx'
import { cn } from '@/lib/utils'
import {
  builtFrom,
  Choice,
  KindName,
  RunningHead,
  Signs,
  setName,
  sortKey,
  useTip,
  WorkName,
  workTitle,
} from './book.tsx'
import { BY_ID, DATA, era, KINDS, type Source } from './data.ts'

/**
 * One source's entry, as a catalogue sets one: the same leaf as the index, the work
 * named as the index names it, a paragraph saying what it is cited for, and its plates,
 * the years and the ground it speaks to, engraved in ink. Then its passages, set as a
 * commentary sets them, with the place in the margin. A work that carries little has
 * no plates: a short entry for a short life.
 */

const KIND_SAYS = { ancient: 'Ancient author', modern: 'Modern work', dataset: 'Dataset' }

/** The running head's way out to the work, by what is at the other end. */
const GO = {
  ancient: 'Read the text',
  modern: 'Find the work',
  dataset: 'Open the dataset',
}

const BACKS: Record<string, string> = {
  claim: 'who controlled the land',
  polity: 'states and peoples',
  relation: 'alliances and client states',
  outline: 'borders',
  place: 'towns and sites',
  feature: 'rivers, mountains and seas',
  landscape: 'coasts and lakes as they were',
}

/** Below this many records an entry is set short, without plates. */
const SHORT = 5

/**
 * Every work in the index's order, for turning to the one before and after; worked out
 * once, the first time an entry is opened (the index arrives after this module loads).
 */
let order: Source[] | undefined
const inOrder = () =>
  (order ??= DATA.sources
    .map((s) => ({ s, key: sortKey(setName(s).name) }))
    .sort(
      (a, b) =>
        a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }) ||
        KINDS.indexOf(a.s.kind) - KINDS.indexOf(b.s.kind) ||
        b.s.records - a.s.records,
    )
    .map((x) => x.s))

export function BookEntry({
  id,
  onOpen,
  onIndex,
}: {
  id: string
  onOpen: (id: string) => void
  onIndex: () => void
}) {
  const s = BY_ID.get(id)!
  const { name } = setName(s)
  // A plate only for what there is to draw: no years for a work whose records are
  // undated (a dataset of outlines), no ground for one that holds none.
  const dated = s.coverage.some(Boolean)
  const short = s.records < SHORT || (!dated && !s.atoms.length)
  const at = inOrder().indexOf(s)
  const before = inOrder()[at - 1]
  const after = inOrder()[at + 1]

  return (
    <article className="mx-auto max-w-[1120px] px-4 pt-6 pb-14 sm:px-10">
      <RunningHead
        left={
          <button onClick={onIndex} className="caps uppercase hover:text-foreground">
            ← Index of Sources
          </button>
        }
        right={
          // The way out to the work itself, opposite the way back to the index; a work
          // with nowhere to go keeps its name there, as a running head would.
          s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener"
              className="caps uppercase hover:text-foreground"
            >
              {GO[s.kind]} ↗
            </a>
          ) : (
            name
          )
        }
      />

      <header className="mx-auto mt-14 mb-10 max-w-[760px] text-center">
        <div className="caps text-[0.7rem] text-muted-foreground uppercase">
          {KIND_SAYS[s.kind]}
        </div>
        <h1 className="mt-3 mr-[-0.18em] text-[2rem] leading-tight font-medium tracking-[0.18em] uppercase">
          {name}
        </h1>
        {subtitle(s) && <p className="mt-2 text-xl text-pretty">{subtitle(s)}</p>}
        <Fleuron className="mx-auto my-6 w-56" />
        {/* The full citation, when it says more than the name and title above it (a
            dataset's are its whole citation). */}
        {s.kind !== 'dataset' && s.citation !== `${s.author}, ${workTitle(s)}` && (
          <p className="mx-auto max-w-[62ch] text-sm text-pretty text-muted-foreground">
            {s.citation}
          </p>
        )}
      </header>

      <div
        className={cn(
          'grid gap-x-14 gap-y-10',
          // Without plates, one measure with the passages below, not the page's width.
          short ? 'mx-auto max-w-[820px]' : 'lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]',
        )}
      >
        <div className="space-y-9">
          <Summary s={s} />
          {s.records > 0 && (
            <Section title="What it is cited for">
              <Stands s={s} />
            </Section>
          )}
          <CitedWith s={s} onOpen={onOpen} />
        </div>
        {!short && (
          <div className="space-y-9">
            {dated && (
              <Plate
                n="I"
                caption={
                  <>
                    The years it speaks to: how many of its records are in force in each
                    year of the map.
                  </>
                }
              >
                <Years s={s} />
              </Plate>
            )}
            {s.atoms.length > 0 && (
              <Plate
                n={dated ? 'II' : 'I'}
                caption={
                  <>
                    The ground it speaks to: {s.atoms.length} of the map’s{' '}
                    {Object.keys(DATA.atoms).length} grounds, inked.
                  </>
                }
              >
                <Ground s={s} />
              </Plate>
            )}
          </div>
        )}
      </div>

      {s.passageList.length > 0 && (
        <div className="mx-auto mt-12 max-w-[820px]">
          <Section
            title={s.kind === 'ancient' ? 'The passages cited' : 'The places in it cited'}
          >
            <Passages s={s} />
          </Section>
        </div>
      )}

      <footer className="mt-14">
        <Fleuron className="mx-auto mb-5 w-40" />
        <nav className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-6 text-sm">
          <Turn s={before} onOpen={onOpen} side="before" />
          <button
            onClick={onIndex}
            className="caps text-[0.7rem] text-muted-foreground uppercase hover:text-foreground"
          >
            Return to the index
          </button>
          <Turn s={after} onOpen={onOpen} side="after" />
        </nav>
      </footer>
    </article>
  )
}

/**
 * The title under the name, as the index sets it beneath an author: the work an
 * ancient wrote (none for a work filed under its own name, as an inscription is), or a
 * modern work and its year.
 */
function subtitle(s: Source): ReactNode {
  if (s.kind === 'ancient') {
    const t = workTitle(s)
    return t && <i>{t}</i>
  }
  return setName(s).under
}

/**
 * What stands on the work, in a paragraph: how many records, at how many places in it,
 * the years it speaks to, how many of its citations carry the words relied on, what
 * rests on it alone, and how sure it all is.
 */
function Summary({ s }: { s: Source }) {
  const first = s.coverage.findIndex((n) => n > 0)
  const last = s.coverage.findLastIndex((n) => n > 0)
  const max = Math.max(...s.coverage)
  const peak = s.coverage.map((n, i) => (n >= max * 0.85 ? i : -1)).filter((i) => i >= 0)
  const hist = s.conf.certain + s.conf.probable + s.conf.uncertain
  const F = ({ children }: { children: ReactNode }) => (
    <span className="figures">{children}</span>
  )
  const built = builtFrom(s)
  const self = s.kind === 'dataset' ? 'this dataset' : 'this work'
  // A work the map builds from in code, which no record cites: that, and no more, in
  // one line too short to sink a capital into.
  if (!s.records)
    return (
      <p className="text-[1.05rem] leading-relaxed text-pretty">
        {built} built from {self} directly, in the code that makes the map, so no record of
        the map cites it.
      </p>
    )
  return (
    <p className="text-[1.05rem] leading-relaxed drop-cap text-pretty">
      {s.kind === 'dataset' ? 'This dataset' : 'This work'} stands behind <F>{s.records}</F>{' '}
      of the map’s records
      {s.passages > 0 && (
        <>
          , cited at{' '}
          {s.passages === 1 ? (
            s.kind === 'ancient' ? (
              'one passage'
            ) : (
              'one place in it'
            )
          ) : (
            <>
              <F>{s.passages}</F> {s.kind === 'ancient' ? 'passages' : 'places in it'}
            </>
          )}
        </>
      )}
      .{' '}
      {first >= 0 && (
        <>
          It speaks to the years <span className="figures">{span(first, last)}</span>
          {/* A peak worth naming: one narrower than half the years it speaks to. */}
          {peak.length > 0 && peak.at(-1)! - peak[0] < (last - first) / 2 && (
            <>
              , above all to <span className="figures">{span(peak[0], peak.at(-1)!)}</span>
            </>
          )}
          .{' '}
        </>
      )}
      {s.quoted > 0 ? (
        <>
          <F>{s.quoted}</F> of its <F>{s.cites}</F> citations carry the very words relied
          on.{' '}
        </>
      ) : (
        <>
          None of its <F>{s.cites}</F> citations yet quotes the words relied on.{' '}
        </>
      )}
      {s.sole > 0 ? (
        <>
          <span className="text-primary">
            <F>{s.sole}</F> {s.sole === 1 ? 'record rests' : 'records rest'} on it alone
          </span>
          .{' '}
        </>
      ) : (
        <>No record rests on it alone. </>
      )}
      {hist > 0 && <Sureness s={s} hist={hist} />}
      {built && <> {built} also built from it directly.</>}
    </p>
  )
}

/** Two years of the window as one span, its era said once: "63–27 BCE", "133 BCE". */
function span(a: number, b: number): string {
  const [x, y] = [DATA.first + a, DATA.first + b]
  if (x === y) return era(x)
  return x <= 0 && y <= 0 ? `${1 - x}–${1 - y} BCE` : `${era(x)}–${era(y)}`
}

/**
 * How sure the records it supports are, in words that leave out what is not there:
 * "all 3 are probable"; "29 are certain, 73 probable and 58 uncertain".
 */
function Sureness({ s, hist }: { s: Source; hist: number }) {
  const parts = (['certain', 'probable', 'uncertain'] as const).filter((c) => s.conf[c])
  if (parts.length === 1)
    return (
      <>
        Of the records of rule, states and alliances it supports,{' '}
        {hist === 1 ? 'the one is' : 'all'}{' '}
        {hist > 1 && (
          <>
            <span className="figures">{hist}</span> are{' '}
          </>
        )}
        {parts[0]}.
      </>
    )
  return (
    <>
      Of the records of rule, states and alliances it supports,{' '}
      {parts.map((c, i) => (
        <span key={c}>
          {i > 0 && (i === parts.length - 1 ? ' and ' : ', ')}
          <span className="figures">{s.conf[c]}</span>
          {i === 0 && (s.conf[c] === 1 ? ' is' : ' are')} {c}
        </span>
      ))}
      .
    </>
  )
}

/** A line of the index: the words, a dotted leader, a figure. */
function Leader({
  children,
  figure,
  onClick,
}: {
  children: ReactNode
  figure: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="min-w-0 leading-snug text-pretty">{children}</span>
      <span
        className="mx-0.5 mb-[0.4em] min-w-4 flex-1 border-b border-dotted border-foreground/30"
        aria-hidden
      />
      <span className="figures shrink-0 leading-snug text-muted-foreground">{figure}</span>
    </>
  )
  return (
    <li>
      {onClick ? (
        <button
          onClick={onClick}
          className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-end gap-2 rounded-sm px-1.5 py-[3px] text-left hover:bg-accent/45"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-end gap-2 py-[3px]">{body}</div>
      )}
    </li>
  )
}

/** The works it is cited beside, as index lines that open their own entries. */
function CitedWith({ s, onOpen }: { s: Source; onOpen: (id: string) => void }) {
  const rows = useMemo(
    () =>
      DATA.links
        .filter((l) => l.a === s.id || l.b === s.id)
        .map((l) => ({ other: BY_ID.get(l.a === s.id ? l.b : l.a)!, n: l.n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 10),
    [s],
  )
  if (!rows.length) return null
  return (
    <Section title="Cited together with">
      <ol className="text-[0.95rem]">
        {rows.map(({ other, n }) => (
          <Leader key={other.id} figure={n} onClick={() => onOpen(other.id)}>
            <WorkName s={other} />
            <Signs s={other} />
          </Leader>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground italic">
        The figure is how many records cite both.
      </p>
    </Section>
  )
}

/** An engraved plate: a hairline frame, and its number and caption beneath. */
function Plate({
  n,
  caption,
  children,
}: {
  n: string
  caption: ReactNode
  children: ReactNode
}) {
  return (
    <figure>
      <div className="border border-rule p-3">{children}</div>
      <figcaption className="mt-2 text-sm text-pretty text-muted-foreground">
        <span className="caps text-[0.7rem] text-foreground uppercase">Plate {n}.</span>{' '}
        <span className="italic">{caption}</span>
      </figcaption>
    </figure>
  )
}

/**
 * What stands on the work, kind by kind: each a bar engraved to its length against the
 * largest, hatched as the plates are, with its count beside it.
 */
function Stands({ s }: { s: Source }) {
  const hatch = useId()
  const rows = Object.entries(s.byType).sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] ?? 1
  return (
    <ol className="grid grid-cols-[max-content_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-[0.95rem]">
      <svg width={0} height={0} className="absolute" aria-hidden>
        <Hatch id={hatch} gap={3} />
      </svg>
      {rows.map(([t, n]) => (
        <li key={t} className="contents">
          <span className="leading-snug">{BACKS[t] ?? t}</span>
          {/* Scaled to the largest, so the first bar runs the measure. */}
          <svg width="100%" height={9} className="block overflow-visible" aria-hidden>
            <rect
              x={0.5}
              y={0.5}
              width={`${(n / max) * 100}%`}
              height={8}
              fill={`url(#${hatch})`}
              stroke="var(--foreground)"
              strokeWidth={0.75}
              strokeOpacity={0.8}
            />
          </svg>
          <span className="figures text-right text-sm text-muted-foreground">{n}</span>
        </li>
      ))}
    </ol>
  )
}

/** Diagonal hatching, as an engraver shades: the plates' only fill. */
function Hatch({ id, gap = 3.2 }: { id: string; gap?: number }) {
  return (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1={0} y1={0} x2={0} y2={gap} stroke="var(--foreground)" strokeWidth={0.7} />
    </pattern>
  )
}

/** Plate I: records in force each year, hatched under an ink line, with a crosshair. */
function Years({ s }: { s: Source }) {
  const hatch = useId()
  const tip = useTip()
  const [hover, setHover] = useState<number | null>(null)
  const W = 440
  const H = 120
  const max = Math.max(1, ...s.coverage)
  const step = W / (s.coverage.length - 1)
  const y = (v: number) => H - (v / max) * (H - 8)
  const pts = s.coverage.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const ticks = [-132, -100, -70, -44, -26]
  return (
    <>
      <svg
        viewBox={`0 -4 ${W} ${H + 24}`}
        className="w-full overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round((((e.clientX - r.left) / r.width) * W) / step)
          if (i < 0 || i >= s.coverage.length) return
          setHover(i)
          tip.show(
            e,
            <>
              <span className="figures">{era(DATA.first + i)}</span>: {s.coverage[i]}{' '}
              records in force
            </>,
          )
        }}
        onMouseLeave={() => {
          setHover(null)
          tip.hide()
        }}
      >
        <defs>
          <Hatch id={hatch} />
        </defs>
        <path
          d={`M0,${H}L${pts.join('L')}L${W},${H}Z`}
          fill={`url(#${hatch})`}
          opacity={0.55}
        />
        <path
          d={`M${pts.join('L')}`}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--foreground)" strokeWidth={0.8} />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={(t - DATA.first) * step}
              x2={(t - DATA.first) * step}
              y1={H}
              y2={H + 4}
              stroke="var(--foreground)"
              strokeWidth={0.8}
            />
            <text
              x={(t - DATA.first) * step}
              y={H + 17}
              textAnchor={t === -132 ? 'start' : t === -26 ? 'end' : 'middle'}
              className="figures fill-muted-foreground text-[11px]"
            >
              {era(t)}
            </text>
          </g>
        ))}
        {hover !== null && (
          <>
            <line
              x1={hover * step}
              x2={hover * step}
              y1={0}
              y2={H}
              stroke="var(--primary)"
              strokeWidth={1}
            />
            <circle
              cx={hover * step}
              cy={y(s.coverage[hover])}
              r={3.5}
              fill="var(--primary)"
              stroke="var(--card)"
              strokeWidth={1.5}
            />
          </>
        )}
      </svg>
      {tip.node}
    </>
  )
}

/** Plate II: the map's grounds, those the work speaks to hatched in ink. */
function Ground({ s }: { s: Source }) {
  const hatch = useId()
  const on = new Set(s.atoms)
  return (
    <svg viewBox="0 40 1000 470" className="block w-full" aria-hidden>
      <defs>
        <Hatch id={hatch} gap={4} />
      </defs>
      {Object.entries(DATA.atoms).map(([id, d]) => (
        <path
          key={id}
          d={d}
          fill={on.has(id) ? `url(#${hatch})` : 'var(--foreground)'}
          fillOpacity={on.has(id) ? 1 : 0.05}
          stroke={on.has(id) ? 'var(--foreground)' : 'var(--rule)'}
          strokeOpacity={on.has(id) ? 0.7 : 0.5}
          strokeWidth={on.has(id) ? 0.9 : 0.5}
        />
      ))}
    </svg>
  )
}

/**
 * The passages as a commentary sets them: the place in the margin, the words relied on
 * in italic, and what they stand behind beneath. Quoted passages first, in the text's
 * order; the rest follow, folded after the first few.
 */
function Passages({ s }: { s: Source }) {
  const [all, setAll] = useState(false)
  const order = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
  const quoted = s.passageList
    .filter((p) => p.quote)
    .sort((a, b) => order(a.locator, b.locator))
  const rest = s.passageList
    .filter((p) => !p.quote)
    .sort((a, b) => order(a.locator, b.locator))
  const shown = all ? rest : rest.slice(0, Math.max(0, 8 - quoted.length))
  // Short references ("3.3.4") stand in the margin; a work cited by its articles
  // ("Aedes Castoris, pp. 102–105") has each set above its text instead.
  const margin = s.passageList.every((p) =>
    locate(p.locator).places.every((x) => x.length <= 12),
  )
  const row = margin ? 'grid grid-cols-[6.5rem_1fr] gap-x-6' : 'block'
  return (
    <ol className="divide-y divide-rule/60">
      {[...quoted, ...shown].map((p) => {
        const { places, note } = locate(p.locator)
        const names = [...new Set(p.records.map((r) => r.name))]
        const kinds = [...new Set(p.records.map((r) => BACKS[r.type] ?? r.type))]
        return (
          <li key={p.locator} className={cn(row, 'py-3')}>
            {/* The place, in the margin one reference to a line; where there is a
                translation online, a way to it. */}
            <a
              href={p.passage}
              target="_blank"
              rel="noopener"
              title={p.passage && 'Read the passage'}
              className={cn(
                'figures text-[0.95rem] leading-relaxed text-primary',
                margin ? 'text-right' : 'block',
                p.passage
                  ? 'hover:underline hover:underline-offset-4'
                  : 'pointer-events-none',
              )}
            >
              {places.map((x) => (
                <span key={x} className={margin ? 'block whitespace-nowrap' : undefined}>
                  {!margin && x !== places[0] && ', '}
                  {x}
                </span>
              ))}
            </a>
            <div className="min-w-0 leading-relaxed">
              {p.quote && (
                <p className="mb-1 text-[1.02rem] text-pretty italic">
                  “{p.quote.length > 320 ? `${p.quote.slice(0, 320)}…` : p.quote}”
                </p>
              )}
              <p className="text-pretty">
                {names.join(', ')}
                {note && <span className="text-muted-foreground italic"> · {note}</span>}
              </p>
              <p className="text-sm text-muted-foreground">{kinds.join(' · ')}</p>
            </div>
          </li>
        )
      })}
      {rest.length > shown.length || all ? (
        <li className={cn(row, 'pt-3')}>
          {margin && <span />}
          <span>
            <Choice on={false} onClick={() => setAll((a) => !a)}>
              {all
                ? 'show fewer'
                : `and ${rest.length - shown.length} more ${s.kind === 'ancient' ? 'passages' : 'places'}`}
            </Choice>
          </span>
        </li>
      ) : null}
    </ol>
  )
}

/**
 * A locator as the margin sets it: each reference on its own ("3.3.1, 3.4.20"), and
 * any note in brackets after them ("3.4.10 (Baetica bounded near Castulo)") taken out
 * to stand with the text.
 */
function locate(locator: string): { places: string[]; note?: string } {
  const m = locator.match(/^(.*?)\s*\(([^)]+)\)$/)
  // An article's anchor is for the link, not the reader: "Aedes Castoris#in_Foro_Romano".
  const refs = (m ? m[1] : locator).replace(/#[^,]*/, '')
  // Only between references that are each a number ("3.3.1, 3.4.20"), not inside
  // one that reads on ("vol. 2, p. 45").
  return { places: refs.split(/,\s*(?=\d)/).filter(Boolean), note: m?.[2] }
}

/** The neighbouring entry, as a book's foot names the page before and after. */
function Turn({
  s,
  onOpen,
  side,
}: {
  s?: Source
  onOpen: (id: string) => void
  side: 'before' | 'after'
}) {
  if (!s) return <span />
  return (
    <button
      onClick={() => onOpen(s.id)}
      className={cn(
        'min-w-0 truncate text-muted-foreground hover:text-foreground',
        side === 'after' ? 'text-right' : 'text-left',
      )}
    >
      {side === 'before' && '‹ '}
      <KindName kind={s.kind}>{setName(s).name}</KindName>
      {/* An ancient author's works stand side by side: the title tells them apart. */}
      {s.kind === 'ancient' && workTitle(s) && (
        <>
          , <i>{workTitle(s)}</i>
        </>
      )}
      {side === 'after' && ' ›'}
    </button>
  )
}
