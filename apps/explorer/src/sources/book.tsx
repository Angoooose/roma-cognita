import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Builds } from '@roma-cognita/schema'
import { type Kind, type Source, title } from './data.ts'

/**
 * The book's type, shared by the index of sources and each source's entry: how a work
 * is named for its kind (ancient authors in small capitals, datasets marked ◇), the
 * signs after it, the running head, and the quiet controls set in the text.
 */

/**
 * The page's running head: the book on the left (a way back to the map), the page's
 * own name on the right.
 */
export function RunningHead({ left, right }: { left?: ReactNode; right: ReactNode }) {
  return (
    // Three columns, the outer two of equal width, so the middle stays on the page's
    // centre however long the names either side of it.
    <div className="caps grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-4 border-b border-rule pb-2 text-[0.7rem] text-muted-foreground uppercase">
      <span className="truncate">
        {left ?? (
          <a href="/" className="hover:text-foreground">
            Roma Cognita
          </a>
        )}
      </span>
      <span className="font-sans text-xs tracking-normal normal-case italic">
        the Roman world, 133–27 BCE
      </span>
      <span className="truncate text-right">{right}</span>
    </div>
  )
}

/** An ancient author's name, in small capitals. */
export function Ancient({ children }: { children: ReactNode }) {
  return (
    <span className="tracking-[0.03em] [font-variant-caps:small-caps]">{children}</span>
  )
}

/** A dataset's mark: the fleuron's diamond, hollow, in gold. */
export function DatasetMark() {
  return (
    <span
      aria-label="dataset"
      className="mr-1.5 inline-block size-[0.45em] -translate-y-[0.1em] rotate-45 border border-gold"
    />
  )
}

/** A name set for its kind: small capitals for the ancients, ◇ before a dataset. */
export function KindName({ kind, children }: { kind: Kind; children: ReactNode }) {
  if (kind === 'ancient') return <Ancient>{children}</Ancient>
  if (kind === 'dataset')
    return (
      <>
        <DatasetMark />
        {children}
      </>
    )
  return <>{children}</>
}

/** A work named in full as the index sets it: its author or body, then its title. */
export function WorkName({ s }: { s: Source }) {
  const { name, head } = setName(s)
  return (
    <>
      <KindName kind={s.kind}>{name}</KindName>
      {head}
    </>
  )
}

/**
 * What the map builds straight from a work, in code rather than through its records:
 * `short` where an index sets a figure, `long` in a sentence.
 */
export const BUILDS: Record<Builds, { short: string; long: string; are: boolean }> = {
  people: { short: 'people', long: 'The map’s people', are: true },
  rome: { short: 'Rome', long: 'The model of Rome', are: false },
  roads: { short: 'roads', long: 'The roads', are: true },
}

/** "The model of Rome is", "The map's people and the roads are". */
export function builtFrom(s: Source): string | null {
  if (!s.builds.length) return null
  const [first, ...rest] = s.builds.map((b) => BUILDS[b])
  const names = [first.long, ...rest.map((b) => b.long.replace(/^The/, 'the'))]
  const are = rest.length > 0 || first.are
  return `${names.join(' and ')} ${are ? 'are' : 'is'}`
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="caps text-[0.7rem] text-muted-foreground uppercase">{children}</span>
  )
}

/** A choice set in the text: italic, underlined when it is the one made. */
export function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'italic',
        on
          ? 'text-foreground underline decoration-rule underline-offset-4'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** The signs after a work: † some records rest on it alone, ¶ passages quoted. */
export function Signs({ s }: { s: Source }) {
  const signs: ReactNode[] = []
  if (s.sole)
    signs.push(
      <span key="s" className="text-primary">
        †
      </span>,
    )
  if (s.quoted) signs.push(<span key="q">¶</span>)
  if (!signs.length) return null
  return <span className="ml-1.5 inline-flex gap-1 text-[0.85em]">{signs}</span>
}

/** Records in force each year of the window, as a filled line. */
export function Spark({
  values,
  width = 120,
  height = 18,
  color = 'currentColor',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 1)).toFixed(1)}`,
  )
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <path
        d={`M0,${height}L${pts.join('L')}L${width},${height}Z`}
        fill={color}
        opacity={0.18}
      />
      <path d={`M${pts.join('L')}`} fill="none" stroke={color} strokeWidth={1.25} />
      <line x1={0} x2={width} y1={height} y2={height} stroke="var(--rule)" />
    </svg>
  )
}

/** A note that follows the pointer, for what a plate says at a point. */
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)
  const show = (e: React.MouseEvent, body: ReactNode) =>
    setTip({ x: e.clientX, y: e.clientY, body })
  const hide = () => setTip(null)
  const node = tip && (
    <div
      className="pointer-events-none fixed z-50 max-w-72 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-plate"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      {tip.body}
    </div>
  )
  return { show, hide, node }
}

/** The words, with what was looked for picked out. */
export function Mark({ text, find }: { text: string; find: string }) {
  const q = find.trim()
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-gold/30 text-inherit">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  )
}

// --- setting a name ------------------------------------------------------------------

/**
 * How the index sets a work: `name`, what it files under; `head`, what follows the name
 * on the work's own line; `under`, what it says beneath its author's name when the
 * author has more than one work.
 */
export function setName(s: Source): { name: string; head: ReactNode; under: ReactNode } {
  return s.kind === 'ancient' ? ancient(s) : modern(s)
}

/** An ancient work: its author's name, then its title in italic. */
function ancient(s: Source) {
  const t = workTitle(s)
  return {
    name: s.author,
    head: t ? (
      <>
        , <i>{t}</i>
      </>
    ) : null,
    under: <i>{t ?? s.citation}</i>,
  }
}

/**
 * An ancient work's title as an index sets it: no edition, translator or note in
 * brackets (the slip keeps the whole citation). A work filed under its own name, as an
 * inscription is ("Philae stele"), has no title after it.
 */
export function workTitle(s: Source): string | null {
  if (!s.citation.startsWith(s.author) && !s.citation.startsWith(sortKey(s.author)))
    return null
  const t = title(s).split(/ \(|, (?:ed|trans)\. /)[0]
  if (t === s.citation || t === s.author || /^(ed|trans)\. /.test(t)) return null
  // An inscription's citation goes on to describe it, not to title it: "The law on the
  // praetorian provinces, 101/100 BCE, …"; "Decree … of Diophantus, general of …".
  if (/^(c\. )?\d|^[a-z]/.test(t)) return null
  return t
}

/**
 * What a name files under: "[Caesar]", a work wrongly given to Caesar, under Caesar;
 * "The law on the praetorian provinces" under law.
 */
export const sortKey = (name: string) => name.replace(/^\[|\]$/g, '').replace(/^The /, '')

/**
 * A modern citation turned for an index: the surname first, then the initials, the
 * title in italic (an article's in quotation marks), and the year.
 * "T. R. S. Broughton, The Magistrates of the Roman Republic, 3 vols (New York, 1951–1986)"
 * → "Broughton, T. R. S., The Magistrates of the Roman Republic (1951–1986)".
 */
function modern(s: Source) {
  const c = s.citation
  const cut = c.indexOf(', ')
  const who = cut < 0 ? c : c.slice(0, cut)
  let name = invert(who)
  let work: ReactNode = null
  let rest = cut < 0 ? '' : c.slice(cut + 2)
  // "L. Richardson, jr, A New …"; "S. B. Platner, completed and revised by T. Ashby, A …"
  const suffix = rest.match(/^(jr|completed and revised by [^,]+), /)
  if (suffix) {
    name +=
      suffix[1] === 'jr'
        ? ' jr'
        : ` and ${suffix[1].replace('completed and revised by ', '')}`
    rest = rest.slice(suffix[0].length)
  }
  // Co-authors after the first ("J. C. Kraft, H. Brückner, I. Kayan and …, "Title""):
  // the first stands for them all, and the title is the quoted one that follows.
  if (/^(?:[A-Z][a-z]?\.\s?)+[A-Z]/.test(rest)) {
    name += ' and others'
    rest =
      rest.match(/"[^"]+"/)?.[0] ??
      rest.match(/(?:et al\.|and [A-Z][^,]*), (.+)$/)?.[1] ??
      ''
  }
  const quoted = rest.match(/^"([^"]+)"/)
  if (quoted) work = <>“{quoted[1].replace(/,$/, '')}”</>
  else if (rest) {
    const t = rest
      .split(
        / \(|, \d+ vols|, vol\.|, the successor|, rev\. |: the |, fetched|, items|, King/,
      )[0]
      .split(/ ?: /)[0]
      .replace(/,$/, '')
    work = <i>{t}</i>
  }
  const year = c.match(/\b(1[89]\d\d|20[0-2]\d)(–\d{4})?\b/g)?.at(-1)
  const dated = year && <span className="figures text-muted-foreground"> ({year})</span>
  return {
    name,
    head: (
      <>
        {work && <>, {work}</>}
        {dated}
      </>
    ),
    under: (
      <>
        {work ?? <i>untitled</i>}
        {dated}
      </>
    ),
  }
}

/** "T. R. S. Broughton" → "Broughton, T. R. S."; institutions and teams are left alone. */
function invert(who: string): string {
  const ed = who.match(/\s*\((eds?\.?)\)$/)?.[0] ?? ''
  if (ed) return `${invert(who.slice(0, -ed.length))}${ed}`
  const m = who.match(/^((?:[A-Z][a-z]?\.\s?(?:-[A-Z]\.\s?)?)+)\s*(.+)$/)
  if (!m || / and |et al|contributors/.test(who)) {
    const lead = who.match(/^((?:[A-Z]\.\s?)+)(\S+)(.*)$/)
    return lead ? `${lead[2]}, ${lead[1].trim()}${lead[3]}` : who
  }
  return `${m[2]}, ${m[1].trim()}`
}
