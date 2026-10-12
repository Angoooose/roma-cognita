import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { type ReactNode, useMemo } from 'react'
import { Fleuron } from '@/components/Marks.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  Ancient,
  BUILDS,
  builtFrom,
  Choice,
  DatasetMark,
  KindName,
  Label,
  Mark,
  RunningHead,
  Signs,
  setName,
  Spark,
  sortKey,
} from './book.tsx'
import { DATA, type Kind, KINDS, type Source } from './data.ts'

/**
 * The sources as the index at the back of a book: one leaf, running heads, a preface
 * with its key to the signs, and every work in one alphabet, set in two columns, each
 * line a work, a dotted leader, and the number of records that rest on it (as search
 * sets its lines). What kind of work a line is shows in its type, not its place:
 * ancient authors in small capitals, modern works in roman, datasets marked ◇. A reader
 * looks a source up by its name, so there is nothing to turn between.
 */

type Arrangement = 'alphabet' | 'weight'
type Showing = 'all' | Kind

interface Entry {
  s: Source
  /** What the line says, as an index would set it, name and all. */
  head: ReactNode
  /** What it says under its author's name, when the author has more than one work. */
  under: ReactNode
}

interface Group {
  /** The name it files under: an author, a scholar, a body. */
  name: string
  kind: Kind
  /** Plain text, for sorting and letters. */
  key: string
  entries: Entry[]
}

const SHOWING: { id: Showing; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'ancient', label: 'ancient' },
  { id: 'modern', label: 'modern' },
  { id: 'dataset', label: 'datasets' },
]

/** The index's choices, as the address carries them; each left out when at its default. */
const QUERY = {
  find: parseAsString.withDefault('').withOptions({ throttleMs: 300 }),
  showing: parseAsStringLiteral(SHOWING.map((x) => x.id)).withDefault('all'),
  arrange: parseAsStringLiteral(['alphabet', 'weight'] as const).withDefault('alphabet'),
}
const KEYS = { showing: 'show', arrange: 'by' }

export function BookIndex({ onOpen }: { onOpen: (id: string) => void }) {
  // Every choice lives in the address, so a narrowed index can be linked to, and is
  // still narrowed on coming back from an entry: `?show=modern&find=magie&by=weight`.
  const [{ find, showing, arrange }, setQuery] = useQueryStates(QUERY, { urlKeys: KEYS })
  const setFind = (find: string) => setQuery({ find })
  const setShowing = (showing: Showing) => setQuery({ showing })
  const setArrange = (arrange: Arrangement) => setQuery({ arrange })
  const T = DATA.totals
  const found = useMemo(() => groups(find, arrange), [find, arrange])
  const shown = showing === 'all' ? found : found.filter((g) => g.kind === showing)
  const letters = new Set(shown.map((g) => initial(g.key)))
  const tally = (s: Showing) =>
    count(s === 'all' ? found : found.filter((g) => g.kind === s))

  return (
    <article className="mx-auto max-w-[1120px] px-4 pt-6 pb-16 sm:px-10">
      <RunningHead right="Index of Sources" />

      <header className="mt-16 mb-8 text-center">
        <h1 className="mr-[-0.24em] text-[2.1rem] font-medium tracking-[0.24em] uppercase">
          Index of Sources
        </h1>
        <Fleuron className="mx-auto my-5 w-64" />
        <p className="text-lg text-muted-foreground italic">
          the works on which the map of the Roman world, 133–27 BCE, rests
        </p>
      </header>

      <Key />

      {/* The page's own colour behind the bar, so what scrolls under it is hidden. */}
      <nav className="sticky top-0 z-30 -mx-4 mb-8 sm:-mx-10">
        <div className="bg-card px-4 pt-3 sm:px-10">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-rule pb-2.5">
            <div className="flex items-baseline gap-2 text-sm">
              <Label>Showing</Label>
              {SHOWING.map((x, i) => (
                <span key={x.id} className="flex items-baseline gap-2">
                  {i > 0 && <span className="text-muted-foreground">·</span>}
                  <Choice on={showing === x.id} onClick={() => setShowing(x.id)}>
                    {x.label}
                  </Choice>
                  {/* A slot of fixed width, so the line holds still as the figures change. */}
                  <span
                    className={cn(
                      'figures inline-block w-[3ch] text-xs text-muted-foreground',
                      find.trim() && !tally(x.id) && 'opacity-40',
                    )}
                  >
                    {tally(x.id)}
                  </span>
                </span>
              ))}
            </div>
            <label className="ml-auto flex items-baseline gap-2">
              <Label>Find</Label>
              <input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="an author, a title"
                className="w-48 border-b border-rule bg-transparent pb-0.5 italic outline-none placeholder:text-muted-foreground/60 focus:border-foreground/60"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-rule/60 py-2.5">
            <div className="flex items-baseline gap-2 text-sm">
              <Label>Arranged</Label>
              <Choice on={arrange === 'alphabet'} onClick={() => setArrange('alphabet')}>
                alphabetically
              </Choice>
              <span className="text-muted-foreground">·</span>
              <Choice on={arrange === 'weight'} onClick={() => setArrange('weight')}>
                by weight
              </Choice>
            </div>
            {arrange === 'alphabet' && (
              <div className="caps flex flex-wrap gap-x-2.5 text-[0.8rem]">
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) =>
                  letters.has(l) ? (
                    <button
                      key={l}
                      onClick={() => jump(`letter-${l}`)}
                      className="hover:text-primary"
                    >
                      {l}
                    </button>
                  ) : (
                    <span key={l} className="text-muted-foreground/35">
                      {l}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      <section className="mb-16 min-h-[60vh]">
        {shown.length ? (
          <Columns
            groups={shown}
            letters={arrange === 'alphabet'}
            find={find}
            onOpen={onOpen}
          />
        ) : (
          <div className="text-center text-muted-foreground italic">
            <p>Nothing here answers to “{find}”.</p>
            {showing !== 'all' && found.length > 0 && (
              <p className="mt-2">
                <button
                  onClick={() => setShowing('all')}
                  className="text-foreground not-italic underline decoration-rule underline-offset-4 hover:text-primary"
                >
                  Show all
                </button>{' '}
                ({count(found)} found)
              </p>
            )}
          </div>
        )}
      </section>

      <footer className="mx-auto max-w-[52ch] text-center">
        <Fleuron className="mx-auto mb-5 w-40" />
        <p className="text-sm text-pretty text-muted-foreground italic">
          The figure beside each work is how many of the map’s{' '}
          <span className="figures">{T.records.toLocaleString()}</span> records cite it.
          Many records cite more than one work, so the figures add up to more.
        </p>
      </footer>
    </article>
  )
}

/**
 * The key to the signs, set as one centred line beneath the title: each sign, then in
 * italic what it means. A sign no work in the index carries is left out.
 */
function Key() {
  const signs: [ReactNode, string][] = [
    [<Ancient>Strabo</Ancient>, 'an ancient author'],
    [<DatasetMark />, 'a dataset'],
    [<span className="figures">{DATA.sources[0].records}</span>, 'records citing it'],
    [<span className="text-primary">†</span>, 'some rest on it alone'],
  ]
  if (DATA.totals.quoted) signs.push([<>¶</>, 'passages quoted'])
  return (
    <dl className="mx-auto mb-14 flex max-w-[900px] flex-wrap items-baseline justify-center gap-x-7 gap-y-2 text-sm">
      {signs.map(([sign, meaning]) => (
        <div key={meaning} className="flex items-baseline gap-2">
          <dt>{sign}</dt>
          <dd className="text-muted-foreground italic">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Two columns with a hairline between, a letter set above each new initial. */
function Columns(props: {
  groups: Group[]
  letters: boolean
  find: string
  onOpen: (id: string) => void
}) {
  let last = ''
  return (
    <div className="gap-14 [column-rule:1px_solid_var(--rule)] lg:columns-2">
      {props.groups.map((g) => {
        const l = initial(g.key)
        const head = props.letters && l !== last
        last = l
        return (
          <div key={`${g.kind}:${g.name}`} className="break-inside-avoid">
            {head && (
              <div
                id={`letter-${l}`}
                className="mt-5 mb-1.5 flex scroll-mt-32 items-center gap-3 first:mt-0"
              >
                <span className="font-heading text-xl text-primary">{l}</span>
                <span className="h-px flex-1 bg-rule" />
              </div>
            )}
            {g.entries.length > 1 ? (
              <>
                <div className="pt-[3px] leading-snug">
                  <Name g={g} find={props.find} />
                </div>
                {g.entries.map((e) => (
                  <Line key={e.s.id} s={e.s} indent onOpen={props.onOpen}>
                    {e.under}
                  </Line>
                ))}
              </>
            ) : (
              <Line s={g.entries[0].s} onOpen={props.onOpen}>
                <Name g={g} find={props.find} />
                {g.entries[0].head}
              </Line>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The name a group files under, set for its kind. */
function Name({ g, find }: { g: Group; find: string }) {
  return (
    <KindName kind={g.kind}>
      <Mark text={g.name} find={find} />
    </KindName>
  )
}

/** One line of the index: the work, its signs, a dotted leader, its figure. */
function Line({
  s,
  indent,
  onOpen,
  children,
}: {
  s: Source
  indent?: boolean
  onOpen: (id: string) => void
  children: ReactNode
}) {
  // A work no record cites, which the map builds from in code, says in a word what
  // that is where the figure would stand: "people", "Rome".
  const none = s.records === 0
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          onClick={() => onOpen(s.id)}
          className={cn(
            // The figure stands on the entry's last line, as a printed index sets it.
            'group -mx-1.5 flex w-[calc(100%+0.75rem)] items-end gap-2 rounded-sm px-1.5 py-[3px] text-left hover:bg-accent/45',
            indent && 'pl-6',
          )}
        >
          <span className="min-w-0 leading-snug text-pretty">
            {children}
            <Signs s={s} />
          </span>
          <span
            className="mx-0.5 mb-[0.4em] min-w-4 flex-1 border-b border-dotted border-foreground/30"
            aria-hidden
          />
          <span
            className={cn(
              'figures shrink-0 leading-snug',
              !none && s.sole ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {none ? <i>{s.builds.map((b) => BUILDS[b].short).join(', ')}</i> : s.records}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-80 p-3 font-normal">
        <Slip s={s} />
      </TooltipContent>
    </Tooltip>
  )
}

/** The slip a hover shows: the full citation, and what stands on the work, in brief. */
function Slip({ s }: { s: Source }) {
  return (
    <div className="space-y-2">
      <div className="text-pretty">{s.citation}</div>
      {s.records > 0 ? (
        <>
          <div className="flex items-end gap-3">
            <Spark values={s.coverage} width={150} height={20} color="currentColor" />
            <span className="figures text-[0.7rem] opacity-70">133–27 BCE</span>
          </div>
          <div className="figures opacity-80">
            {s.records} records
            {s.sole > 0 && ` · ${s.sole} on it alone`}
            {s.quoted > 0 && ` · ${s.quoted} quoted`}
          </div>
          <div className="italic opacity-70">Open its page</div>
        </>
      ) : (
        <>
          <div className="opacity-80">{builtFrom(s)} built from it.</div>
          <div className="italic opacity-70">Open its page</div>
        </>
      )}
    </div>
  )
}

/** Scroll to a letter without touching the address, which names the view. */
const jump = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const initial = (key: string) =>
  key
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .charAt(0)
    .toUpperCase()

const count = (gs: Group[]) => gs.reduce((n, g) => n + g.entries.length, 0)

// --- setting the entries ------------------------------------------------------------

/**
 * Every work that answers to `find`, gathered under the name it files under (an author
 * with several works heads them all), in one alphabet or by weight.
 */
function groups(find: string, arrange: Arrangement): Group[] {
  const q = find.trim().toLowerCase()
  const by = new Map<string, Group>()
  for (const s of DATA.sources) {
    if (q && !s.citation.toLowerCase().includes(q)) continue
    const { name, head, under } = setName(s)
    const id = `${s.kind}:${name}`
    const g = by.get(id) ?? {
      name,
      kind: s.kind,
      key: sortKey(name),
      entries: [],
    }
    g.entries.push({ s, head, under })
    by.set(id, g)
  }
  const out = [...by.values()]
  for (const g of out) g.entries.sort((a, b) => b.s.records - a.s.records)
  if (arrange === 'weight') return out.sort((a, b) => weight(b) - weight(a))
  // Within a name, ancient before modern before datasets (Strabo the geographer before
  // any scholar called Strabo).
  return out.sort(
    (a, b) =>
      a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }) ||
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
  )
}

const weight = (g: Group) => Math.max(...g.entries.map((e) => e.s.records))
