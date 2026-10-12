import { useMemo, useState } from 'react'
import { BY_ID, CONFIDENCES, DATA, era, KIND_LABEL, KINDS, short } from './data.ts'
import {
  CONF_OPACITY,
  Eyebrow,
  Intro,
  KindMark,
  kindColor,
  pct,
  Sheet,
  useTip,
} from './shared.tsx'

const T = DATA.totals

/** What the map stands on, in round numbers, and where it stands on least. */
export function Ledger() {
  return (
    <div className="space-y-6">
      <Intro title="What the map stands on">
        The whole apparatus at a glance: how many works, how many citations, how many of
        those we've read and quoted, and how sure each year of the window is.
      </Intro>
      <div className="grid gap-4 md:grid-cols-4">
        <Hero value={T.sources} label="works cited">
          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-sm">
            {KINDS.map((k) => (
              <div key={k} style={{ flex: T.byKind[k], background: kindColor(k) }} />
            ))}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {KINDS.map((k) => (
              <div key={k} className="flex justify-between">
                <KindMark kind={k} label={KIND_LABEL[k]} />
                <span className="figures">{T.byKind[k]}</span>
              </div>
            ))}
          </div>
        </Hero>
        <Hero value={T.citations.toLocaleString()} label="citations">
          <Meter part={T.located} of={T.citations} text="point to a page or passage" />
        </Hero>
        <Hero value={pct(T.quoted, T.citations)} label="quoted and checked">
          <Meter
            part={T.quoted}
            of={T.citations}
            text={`${T.quoted} citations carry the words relied on`}
          />
        </Hero>
        <Hero value={T.single} label="records on one source" accent>
          <Meter
            part={T.single}
            of={T.hist}
            text={`of ${T.hist} claims, states and ties; ${T.noAncient} cite no ancient text`}
          />
        </Hero>
      </div>

      <Sheet>
        <div className="mb-4 flex items-baseline justify-between">
          <Eyebrow>Who held what, year by year, by how sure</Eyebrow>
          <div className="flex gap-4 text-xs text-muted-foreground">
            {CONFIDENCES.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-sm bg-foreground"
                  style={{ opacity: CONF_OPACITY[c] }}
                />
                {c}
              </span>
            ))}
          </div>
        </div>
        <Strip />
      </Sheet>

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Sheet>
          <Eyebrow className="mb-3">The state of the work</Eyebrow>
          <Bars
            rows={Object.entries(T.review).map(([k, n]) => ({
              label: k === 'needs-check' ? 'needs checking' : k,
              n,
            }))}
            of={T.hist}
          />
          <p className="mt-3 text-xs text-pretty text-muted-foreground italic">
            Nothing is marked verified yet: every record awaits an independent re-reading.
          </p>
          <Eyebrow className="mt-6 mb-3">How sure the records are</Eyebrow>
          <Bars
            rows={CONFIDENCES.map((c) => ({
              label: c,
              n: T.conf[c],
              opacity: CONF_OPACITY[c],
            }))}
            of={T.hist}
          />
        </Sheet>
        <Sheet>
          <Eyebrow className="mb-3">Hanging by one thread</Eyebrow>
          <Fragile />
        </Sheet>
      </div>
    </div>
  )
}

function Hero({
  value,
  label,
  accent,
  children,
}: {
  value: React.ReactNode
  label: string
  accent?: boolean
  children?: React.ReactNode
}) {
  return (
    <Sheet className="p-5">
      <div className={`figures font-heading text-4xl ${accent ? 'text-primary' : ''}`}>
        {value}
      </div>
      <div className="caps mt-1 text-[0.7rem] text-muted-foreground uppercase">{label}</div>
      {children}
    </Sheet>
  )
}

function Meter({ part, of, text }: { part: number; of: number; text: string }) {
  return (
    <>
      <div className="mt-3 h-2 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-r-sm bg-foreground/70"
          style={{ width: pct(part, of) }}
        />
      </div>
      <div className="mt-2 text-xs text-pretty text-muted-foreground">{text}</div>
    </>
  )
}

function Bars({
  rows,
  of,
}: {
  rows: { label: string; n: number; opacity?: number }[]
  of: number
}) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-sm"
        >
          <span>{r.label}</span>
          <div
            className="h-2 rounded-r-full bg-foreground"
            style={{ width: pct(r.n, of), opacity: r.opacity ?? 0.7 }}
          />
          <span className="figures text-right text-xs text-muted-foreground">
            {r.n} · {pct(r.n, of)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Claims in force each year, stacked sure to unsure, with a crosshair. */
function Strip() {
  const tip = useTip()
  const [hover, setHover] = useState<number | null>(null)
  const W = 1000
  const H = 150
  const s = DATA.strip
  const max = Math.max(...s.map((d) => d.certain + d.probable + d.uncertain))
  const step = W / (s.length - 1)
  const y = (v: number) => H - (v / max) * (H - 4)
  const layers = useMemo(() => {
    let base = s.map(() => 0)
    return CONFIDENCES.map((c) => {
      const top = s.map((d, i) => base[i] + d[c])
      const d = `M${top.map((v, i) => `${i * step},${y(v)}`).join('L')}L${[...base]
        .reverse()
        .map((v, i) => `${(s.length - 1 - i) * step},${y(v)}`)
        .join('L')}Z`
      base = top
      return { c, d }
    })
  }, [])
  const events: [number, string][] = [
    [-132, 'Tiberius Gracchus'],
    [-90, 'Social War'],
    [-81, 'Sulla dictator'],
    [-63, 'Pompey in the East'],
    [-48, 'Pharsalus'],
    [-30, 'Egypt annexed'],
  ]
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H + 22}`}
        className="w-full overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round((((e.clientX - r.left) / r.width) * W) / step)
          if (i < 0 || i >= s.length) return
          setHover(i)
          const d = s[i]
          tip.show(
            e,
            <div className="space-y-0.5">
              <div className="figures font-semibold">{era(d.year)}</div>
              {CONFIDENCES.map((c) => (
                <div key={c} className="flex justify-between gap-6">
                  <span>{c}</span>
                  <span className="figures">{d[c]}</span>
                </div>
              ))}
            </div>,
          )
        }}
        onMouseLeave={() => {
          setHover(null)
          tip.hide()
        }}
      >
        {layers.map(({ c, d }) => (
          <path
            key={c}
            d={d}
            fill="var(--foreground)"
            opacity={CONF_OPACITY[c]}
            stroke="var(--card)"
            strokeWidth={1.5}
          />
        ))}
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--rule)" />
        {events.map(([yr, label]) => (
          <g key={yr}>
            <line
              x1={(yr - DATA.first) * step}
              x2={(yr - DATA.first) * step}
              y1={H}
              y2={H + 5}
              stroke="var(--rule)"
            />
            <text
              x={(yr - DATA.first) * step}
              y={H + 18}
              textAnchor={yr === -132 ? 'start' : 'middle'}
              className="fill-muted-foreground text-[11px] italic"
            >
              {label}
            </text>
          </g>
        ))}
        {hover !== null && (
          <line
            x1={hover * step}
            x2={hover * step}
            y1={0}
            y2={H}
            stroke="var(--primary)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      {tip.node}
    </>
  )
}

/** The records that cite one work only, gathered under that work. */
function Fragile() {
  const groups = useMemo(() => {
    const m = new Map<string, typeof DATA.fragile>()
    for (const f of DATA.fragile) m.set(f.source, [...(m.get(f.source) ?? []), f])
    return [...m].sort((a, b) => b[1].length - a[1].length).slice(0, 7)
  }, [])
  return (
    <div className="space-y-3">
      {groups.map(([id, rows]) => {
        const s = BY_ID.get(id)!
        return (
          <div key={id} className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
            <div>
              <KindMark kind={s.kind} label={s.kind === 'ancient' ? s.author : short(s)} />
              <div className="figures pl-3.5 text-xs text-muted-foreground">
                {rows.length} alone
              </div>
            </div>
            <div className="text-xs text-pretty text-muted-foreground">
              {rows.slice(0, 4).map((r, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <span className={r.conf === 'uncertain' ? 'italic' : 'text-foreground'}>
                    {r.label}
                  </span>
                </span>
              ))}
              {rows.length > 4 && <span> · and {rows.length - 4} more</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
