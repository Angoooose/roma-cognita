import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DATA, KIND_LABEL, KINDS, type Kind, type Source, short, title } from './data.ts'
import { Eyebrow, Intro, kindColor, Sheet, Spark } from './shared.tsx'

type Sort = 'records' | 'alpha' | 'sole'

/**
 * The catalogue as a printed index: one line a work, grouped by kind, with how much
 * of the map stands on it drawn as a rule beside it.
 */
export function Index() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('records')
  const [unused, setUnused] = useState(false)
  const max = DATA.sources[0].records

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const keep = (s: Source) =>
      (unused || s.records > 0) &&
      (!needle || `${s.citation} ${s.id}`.toLowerCase().includes(needle))
    const order = (a: Source, b: Source) =>
      sort === 'alpha'
        ? short(a).localeCompare(short(b))
        : sort === 'sole'
          ? b.sole - a.sole
          : b.records - a.records
    return KINDS.map((k) => ({
      kind: k,
      rows: DATA.sources.filter((s) => s.kind === k && keep(s)).sort(order),
    }))
  }, [q, sort, unused])

  return (
    <div>
      <Intro title="Index of sources">
        Every work the map cites, as the back of an atlas would list them. The rule beside
        each is how many records stand on it; the line, the years 133–27 BCE it speaks to.
      </Intro>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Strabo, Broughton, Pleiades…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={sort}
          onValueChange={(v) => v && setSort(v as Sort)}
        >
          <ToggleGroupItem value="records">Most cited</ToggleGroupItem>
          <ToggleGroupItem value="sole">Carries alone</ToggleGroupItem>
          <ToggleGroupItem value="alpha">A–Z</ToggleGroupItem>
        </ToggleGroup>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={unused}
            onChange={(e) => setUnused(e.target.checked)}
          />
          include works cited only from code
        </label>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {groups.map(({ kind, rows }) => (
          <Sheet key={kind} className={kind === 'ancient' ? 'xl:row-span-2' : ''}>
            <Group kind={kind} rows={rows} max={max} />
          </Sheet>
        ))}
      </div>
    </div>
  )
}

function Group({ kind, rows, max }: { kind: Kind; rows: Source[]; max: number }) {
  return (
    <>
      <div className="mb-3 flex items-baseline justify-between border-b border-rule pb-2">
        <h3 className="text-base font-semibold">{KIND_LABEL[kind]}</h3>
        <span className="figures text-sm text-muted-foreground">{rows.length}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_6.5rem_3rem] items-center gap-x-4 gap-y-1.5 text-sm">
        <Eyebrow>Work</Eyebrow>
        <Eyebrow>Records</Eyebrow>
        <Eyebrow>133–27 BCE</Eyebrow>
        <Eyebrow className="text-right">Alone</Eyebrow>
        {rows.map((s) => (
          <Row key={s.id} s={s} max={max} />
        ))}
      </div>
    </>
  )
}

function Row({ s, max }: { s: Source; max: number }) {
  const name =
    s.kind === 'ancient' ? (
      <>
        {s.author}, <i>{title(s)}</i>
      </>
    ) : (
      short(s)
    )
  return (
    <>
      <div className="min-w-0 truncate leading-snug" title={s.citation}>
        {s.url ? (
          <a href={s.url} target="_blank" rel="noopener" className="hover:underline">
            {name}
          </a>
        ) : (
          name
        )}
        {s.quoted > 0 && (
          <span className="ml-1.5 text-xs text-muted-foreground">· {s.quoted} quoted</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-r-full" style={{ background: 'var(--muted)' }}>
          <div
            className="h-full rounded-r-full"
            style={{
              width: `${Math.max(2, (s.records / max) * 100)}%`,
              background: kindColor(s.kind),
            }}
          />
        </div>
        <span className="figures w-7 text-right text-xs text-muted-foreground">
          {s.records || '–'}
        </span>
      </div>
      <div className="text-muted-foreground">
        <Spark values={s.coverage} width={104} height={14} color={kindColor(s.kind)} />
      </div>
      <div className="figures text-right text-xs">
        {s.sole || <span className="text-muted-foreground">–</span>}
      </div>
    </>
  )
}
