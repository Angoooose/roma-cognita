import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BY_ID,
  CONFIDENCES,
  DATA,
  era,
  KIND_LABEL,
  KINDS,
  type Source,
  short,
  title,
} from './data.ts'
import {
  CONF_OPACITY,
  Eyebrow,
  Footprint,
  KindMark,
  kindColor,
  pct,
  Sheet,
  useTip,
} from './shared.tsx'

const TYPE_LABEL: Record<string, string> = {
  claim: 'who held what',
  polity: 'states and peoples',
  relation: 'ties between them',
  outline: 'outlines of ground',
  place: 'places',
  feature: 'rivers, seas, plains',
  landscape: 'ancient coasts',
}

/** One source as the first thing on the page: what it is, what stands on it, where, and its words. */
export function Folio({ initial = 'strabo' }: { initial?: string }) {
  const [id, setId] = useState(BY_ID.has(initial) ? initial : 'strabo')
  const s = BY_ID.get(id)!
  const picks = KINDS.map((k) => ({
    k,
    rows: DATA.sources
      .filter((x) => x.kind === k && (x.records >= 8 || x.id === id))
      .slice(0, 15),
  }))
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="text-sm text-muted-foreground italic">Open the folio of</span>
        <Select value={id} onValueChange={setId}>
          <SelectTrigger className="w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {picks.map(({ k, rows }) => (
              <SelectGroup key={k}>
                <SelectLabel>{KIND_LABEL[k]}</SelectLabel>
                {rows.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.kind === 'ancient' ? `${x.author}, ${title(x)}` : short(x)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Page s={s} key={s.id} />
    </div>
  )
}

function Page({ s }: { s: Source }) {
  const gap = s.written
    ? s.written.from - (DATA.first + s.coverage.findLastIndex((n) => n > 0))
    : null
  const hist = s.conf.certain + s.conf.probable + s.conf.uncertain
  return (
    <Sheet className="p-8">
      <header className="mb-6 border-b border-rule pb-5">
        <Eyebrow>
          <KindMark kind={s.kind} label={KIND_LABEL[s.kind]} />
        </Eyebrow>
        <h2 className="mt-2 text-3xl font-semibold">
          {s.kind === 'ancient' ? s.author : short(s)}
        </h2>
        <p className="mt-1 text-lg text-pretty italic">
          {s.kind === 'ancient' ? title(s) : s.citation}
        </p>
        {s.written && (
          <p className="mt-2 text-sm text-muted-foreground">
            Written {era(s.written.from)}
            {s.written.to !== s.written.from && ` – ${era(s.written.to)}`}
            {s.written.eyewitness
              ? ', while the events were unfolding'
              : gap && gap > 0
                ? `, ${gap} years after the last event we cite it for`
                : ''}
            <span className="italic"> (placeholder date)</span>
          </p>
        )}
      </header>

      <div className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat value={s.records} label="records stand on it" />
        <Stat
          value={s.passages}
          label={s.kind === 'ancient' ? 'passages cited' : 'places in it cited'}
        />
        <Stat
          value={s.quoted}
          label="citations quoted and checked"
          sub={s.cites ? pct(s.quoted, s.cites) : undefined}
        />
        <Stat value={s.sole} label="records it carries alone" accent={s.sole > 0} />
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-8">
          <Block title="The years it speaks to">
            <Coverage s={s} />
          </Block>
          {hist > 0 && (
            <Block title="How sure the records are">
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-sm">
                {CONFIDENCES.map((c) =>
                  s.conf[c] ? (
                    <div
                      key={c}
                      style={{
                        flex: s.conf[c],
                        background: 'var(--foreground)',
                        opacity: CONF_OPACITY[c],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-2 flex gap-5 text-xs text-muted-foreground">
                {CONFIDENCES.map((c) => (
                  <span key={c}>
                    <span className="figures text-foreground">{s.conf[c]}</span> {c}
                  </span>
                ))}
              </div>
            </Block>
          )}
          <Block title="What it backs">
            <div className="space-y-1.5">
              {Object.entries(s.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <div
                    key={t}
                    className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm"
                  >
                    <span>{TYPE_LABEL[t] ?? t}</span>
                    <div
                      className="h-1.5 rounded-r-full"
                      style={{
                        width: `${(n / s.records) * 100}%`,
                        background: kindColor(s.kind),
                      }}
                    />
                    <span className="figures text-right text-xs text-muted-foreground">
                      {n}
                    </span>
                  </div>
                ))}
            </div>
          </Block>
          <Block title="Cited alongside">
            <CitedWith s={s} />
          </Block>
        </div>

        <div className="space-y-8">
          {s.atoms.length > 0 && (
            <Block title={`The ground it speaks to · ${s.atoms.length}`}>
              <Footprint
                atoms={new Set(s.atoms)}
                color={kindColor(s.kind)}
                className="rounded-sm"
              />
            </Block>
          )}
          <Block title={s.kind === 'ancient' ? 'The passages' : 'Where in it'}>
            <Passages s={s} />
          </Block>
        </div>
      </div>
    </Sheet>
  )
}

function Stat({
  value,
  label,
  sub,
  accent,
}: {
  value: number
  label: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="border-l border-rule pl-4">
      <div className={`figures font-heading text-3xl ${accent ? 'text-primary' : ''}`}>
        {value}
        {sub && <span className="ml-2 font-sans text-sm text-muted-foreground">{sub}</span>}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Eyebrow className="mb-3 border-b border-rule pb-1.5">{title}</Eyebrow>
      {children}
    </section>
  )
}

/** Records in force each year, with a hover crosshair. */
function Coverage({ s }: { s: Source }) {
  const tip = useTip()
  const W = 420
  const H = 90
  const max = Math.max(1, ...s.coverage)
  const step = W / (s.coverage.length - 1)
  const pts = s.coverage.map((v, i) => `${i * step},${H - (v / max) * (H - 6)}`)
  const [hover, setHover] = useState<number | null>(null)
  const ticks = [-132, -99, -69, -43, -26]
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
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
        <path
          d={`M0,${H}L${pts.join('L')}L${W},${H}Z`}
          fill={kindColor(s.kind)}
          opacity={0.16}
        />
        <path
          d={`M${pts.join('L')}`}
          fill="none"
          stroke={kindColor(s.kind)}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--rule)" />
        {ticks.map((t) => (
          <text
            key={t}
            x={(t - DATA.first) * step}
            y={H + 14}
            textAnchor="middle"
            className="figures fill-muted-foreground text-[10px]"
          >
            {era(t)}
          </text>
        ))}
        {hover !== null && (
          <>
            <line
              x1={hover * step}
              x2={hover * step}
              y1={0}
              y2={H}
              stroke="currentColor"
              strokeOpacity={0.35}
            />
            <circle
              cx={hover * step}
              cy={H - (s.coverage[hover] / max) * (H - 6)}
              r={4}
              fill={kindColor(s.kind)}
              stroke="var(--card)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      {tip.node}
    </>
  )
}

function CitedWith({ s }: { s: Source }) {
  const rows = useMemo(
    () =>
      DATA.links
        .filter((l) => l.a === s.id || l.b === s.id)
        .map((l) => ({ other: BY_ID.get(l.a === s.id ? l.b : l.a)!, n: l.n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 8),
    [s],
  )
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground italic">
        Never cited three times with the same work.
      </p>
    )
  const max = rows[0].n
  return (
    <div className="space-y-1.5">
      {rows.map(({ other, n }) => (
        <div
          key={other.id}
          className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm"
        >
          <span className="truncate">
            <KindMark
              kind={other.kind}
              label={other.kind === 'ancient' ? other.author : short(other)}
            />
          </span>
          <div
            className="h-1.5 rounded-r-full bg-foreground/50"
            style={{ width: `${(n / max) * 100}%` }}
          />
          <span className="figures text-right text-xs text-muted-foreground">{n}</span>
        </div>
      ))}
    </div>
  )
}

function Passages({ s }: { s: Source }) {
  const [all, setAll] = useState(false)
  const list = [...s.passageList].sort((a, b) => Number(!!b.quote) - Number(!!a.quote))
  if (!list.length)
    return (
      <p className="text-sm text-muted-foreground italic">
        Cited as a whole, without a place in it.
      </p>
    )
  const shown = all ? list : list.slice(0, 8)
  return (
    <ol className="space-y-3">
      {shown.map((p) => (
        <li key={p.locator} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
          <span className="figures pt-0.5 text-right text-muted-foreground">
            {p.locator}
          </span>
          <div className="min-w-0">
            {p.quote && (
              <blockquote
                className="mb-1 border-l-2 pl-3 text-pretty italic"
                style={{ borderColor: kindColor(s.kind) }}
              >
                “{p.quote.length > 260 ? `${p.quote.slice(0, 260)}…` : p.quote}”
              </blockquote>
            )}
            <div className="text-xs text-pretty text-muted-foreground">
              {p.records.join(' · ')}
            </div>
          </div>
        </li>
      ))}
      {list.length > 8 && (
        <li>
          <button
            className="text-sm text-primary underline underline-offset-2"
            onClick={() => setAll((a) => !a)}
          >
            {all ? 'Fewer' : `All ${list.length} shown here`}
          </button>
        </li>
      )}
    </ol>
  )
}
