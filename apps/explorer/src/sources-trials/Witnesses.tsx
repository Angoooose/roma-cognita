import { useMemo, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Author, authors, DATA, era } from './data.ts'
import { Intro, Sheet, useTip } from './shared.tsx'

const AXIS_FROM = -200
const AXIS_TO = 450
const LEFT = 230
const WIDTH = 760
const ROW = 30
const TICKS = [-200, -100, 0, 100, 200, 300, 400]

const x = (y: number) =>
  LEFT +
  ((Math.max(AXIS_FROM, Math.min(AXIS_TO, y)) - AXIS_FROM) / (AXIS_TO - AXIS_FROM)) * WIDTH

type Order = 'written' | 'records'

/**
 * Who our witnesses are and how close they stood. Each author's row lights the years
 * of the window they speak to, then runs a thread out to when they wrote.
 */
export function Witnesses() {
  const [order, setOrder] = useState<Order>('written')
  const tip = useTip()
  const rows = useMemo(() => {
    const all = authors()
    return order === 'written'
      ? all.sort((a, b) => a.written.from - b.written.from)
      : all.sort((a, b) => b.records - a.records)
  }, [order])
  const maxCov = Math.max(...rows.flatMap((a) => a.coverage))
  const height = rows.length * ROW + 60

  return (
    <div>
      <Intro title="The witnesses">
        Every ancient author the map cites. The shaded band is the window, 133–27 BCE, and
        each row lights the years its author speaks to. The thread runs out to when they
        wrote: short for those who lived through it, two centuries long for Appian and Dio.
      </Intro>
      <div className="mb-4 flex items-center gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={order}
          onValueChange={(v) => v && setOrder(v as Order)}
        >
          <ToggleGroupItem value="written">By when they wrote</ToggleGroupItem>
          <ToggleGroupItem value="records">By weight carried</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground italic">
          Dates of writing are rough placeholders for the mockup, not yet researched.
        </span>
      </div>
      <Sheet>
        <svg
          viewBox={`0 0 ${LEFT + WIDTH + 90} ${height}`}
          className="w-full"
          role="img"
          aria-label="Ancient authors: years covered and when they wrote"
        >
          <rect
            x={x(DATA.first)}
            y={18}
            width={x(DATA.last) - x(DATA.first)}
            height={height - 30}
            fill="var(--primary)"
            opacity={0.07}
          />
          <text
            x={(x(DATA.first) + x(DATA.last)) / 2}
            y={12}
            textAnchor="middle"
            className="caps fill-muted-foreground text-[10px]"
          >
            133–27 BCE
          </text>
          {TICKS.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={24}
                y2={height - 12}
                stroke="var(--rule)"
                strokeDasharray="1 4"
              />
              <text
                x={x(t)}
                y={height}
                textAnchor="middle"
                className="figures fill-muted-foreground text-[11px]"
              >
                {t === 0 ? '1 BCE | 1 CE' : era(t)}
              </text>
            </g>
          ))}
          {rows.map((a, i) => (
            <Row key={a.name} a={a} y={30 + i * ROW} maxCov={maxCov} tip={tip} />
          ))}
        </svg>
        <div className="mt-4 flex flex-wrap gap-6 border-t border-rule pt-3 text-xs text-muted-foreground">
          <Legend
            swatch={
              <span
                className="h-2 w-6 rounded-sm"
                style={{ background: 'var(--kind-ancient)' }}
              />
            }
          >
            years spoken to (darker: more records)
          </Legend>
          <Legend
            swatch={
              <span className="h-px w-6 border-t border-dashed border-foreground/50" />
            }
          >
            the distance to the writing
          </Legend>
          <Legend
            swatch={
              <span
                className="size-2.5 rounded-full border-2"
                style={{ borderColor: 'var(--kind-ancient)' }}
              />
            }
          >
            written after the events
          </Legend>
          <Legend
            swatch={
              <span
                className="size-2.5 rounded-full"
                style={{ background: 'var(--kind-ancient)' }}
              />
            }
          >
            written through them: eyewitness or document
          </Legend>
        </div>
      </Sheet>
      {tip.node}
    </div>
  )
}

function Row({
  a,
  y,
  maxCov,
  tip,
}: {
  a: Author
  y: number
  maxCov: number
  tip: ReturnType<typeof useTip>
}) {
  const lastCovered = DATA.first + a.coverage.findLastIndex((n) => n > 0)
  const gap = a.written.from - lastCovered
  const early = a.written.to < AXIS_FROM
  const cx = x((a.written.from + a.written.to) / 2)
  const step = (x(DATA.last) - x(DATA.first)) / a.coverage.length
  return (
    <g
      onMouseMove={(e) =>
        tip.show(
          e,
          <div className="space-y-1">
            <div className="font-semibold">{a.name}</div>
            <div>
              wrote {era(a.written.from)}
              {a.written.to !== a.written.from && `–${era(a.written.to)}`}
            </div>
            <div className="text-muted-foreground">
              {a.records} records · {a.works.length}{' '}
              {a.works.length === 1 ? 'work' : 'works'}
              {gap > 0 && ` · ${gap} years after the last event cited`}
            </div>
          </div>,
        )
      }
      onMouseLeave={tip.hide}
    >
      <rect
        x={0}
        y={y - ROW / 2}
        width={LEFT + WIDTH + 90}
        height={ROW}
        fill="transparent"
      />
      <text
        x={LEFT - 14}
        y={y + 4}
        textAnchor="end"
        className="fill-foreground text-[13px]"
      >
        {a.name}
      </text>
      {a.coverage.map((n, i) =>
        n ? (
          <rect
            key={i}
            x={x(DATA.first) + i * step}
            y={y - 5}
            width={step + 0.3}
            height={10}
            fill="var(--kind-ancient)"
            opacity={0.15 + 0.85 * Math.sqrt(n / maxCov)}
          />
        ) : null,
      )}
      {!early && gap > 3 && (
        <line
          x1={x(lastCovered) + 2}
          x2={x(a.written.from) - 5}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeDasharray="2 3"
        />
      )}
      {early ? (
        <text x={LEFT - 2} y={y + 4} className="figures fill-muted-foreground text-[10px]">
          ← {era(a.written.from)}
        </text>
      ) : (
        <>
          {a.written.to - a.written.from > 4 && (
            <line
              x1={x(a.written.from)}
              x2={x(a.written.to)}
              y1={y}
              y2={y}
              stroke="var(--kind-ancient)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}
          <circle
            cx={cx}
            cy={y}
            r={4.5}
            fill={a.written.eyewitness ? 'var(--kind-ancient)' : 'var(--card)'}
            stroke="var(--kind-ancient)"
            strokeWidth={2}
          />
          {gap > 30 && (
            <text
              x={x(a.written.to) + 10}
              y={y + 4}
              className="figures fill-muted-foreground text-[11px] italic"
            >
              {gap} yrs on
            </text>
          )}
        </>
      )}
    </g>
  )
}

function Legend({
  swatch,
  children,
}: {
  swatch: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-2">
      {swatch}
      <span>{children}</span>
    </span>
  )
}
