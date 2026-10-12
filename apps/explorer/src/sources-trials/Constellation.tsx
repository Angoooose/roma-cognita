import { useMemo, useState } from 'react'
import { BY_ID, DATA, type Source, short } from './data.ts'
import { Intro, KindMark, kindColor, Sheet, useTip } from './shared.tsx'

const W = 1000
const H = 640

interface Node {
  s: Source
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

/** Lay the sources out once: springs along shared citations, charge between all. */
function layout() {
  const ids = [...new Set(DATA.links.flatMap((l) => [l.a, l.b]))]
  const nodes: Node[] = ids.map((id, i) => {
    const s = BY_ID.get(id)!
    const a = (i / ids.length) * Math.PI * 2
    return {
      s,
      x: W / 2 + Math.cos(a) * 250,
      y: H / 2 + Math.sin(a) * 200,
      vx: 0,
      vy: 0,
      r: 3 + Math.sqrt(s.records) * 0.9,
    }
  })
  const at = new Map(nodes.map((n) => [n.s.id, n]))
  const links = DATA.links.map((l) => ({ a: at.get(l.a)!, b: at.get(l.b)!, n: l.n }))
  for (let t = 0; t < 500; t++) {
    const cool = 1 - t / 500
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = Math.max(dx * dx + dy * dy, 40)
        const f = 4200 / d2
        const d = Math.sqrt(d2)
        a.vx -= (dx / d) * f
        a.vy -= (dy / d) * f
        b.vx += (dx / d) * f
        b.vy += (dy / d) * f
      }
    for (const { a, b, n } of links) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      const f = (d - 120) * 0.005 * Math.log2(1 + n)
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.0015
      n.vy += (H / 2 - n.y) * 0.003
      n.x = Math.max(n.r + 60, Math.min(W - n.r - 60, n.x + n.vx * cool))
      n.y = Math.max(n.r + 14, Math.min(H - n.r - 14, n.y + n.vy * cool))
      n.vx *= 0.55
      n.vy *= 0.55
    }
  }
  return { nodes, links }
}

export function Constellation() {
  const { nodes, links } = useMemo(layout, [])
  const [focus, setFocus] = useState<string | null>(null)
  const tip = useTip()
  const near = useMemo(() => {
    if (!focus) return null
    const set = new Set([focus])
    for (const l of links) {
      if (l.a.s.id === focus) set.add(l.b.s.id)
      if (l.b.s.id === focus) set.add(l.a.s.id)
    }
    return set
  }, [focus, links])
  const maxN = Math.max(...links.map((l) => l.n))
  const labelled = new Set(
    [...nodes]
      .sort((a, b) => b.s.records - a.s.records)
      .slice(0, 14)
      .map((n) => n.s.id),
  )
  const name = (s: Source) => (s.kind === 'ancient' ? s.author : short(s))

  return (
    <div>
      <Intro title="Sources cited together">
        Two works are joined when they back the same records, three times or more; the
        thicker the thread, the more often. Clusters form by themselves: the Mithridatic
        East, Ptolemaic Egypt, Caesar's Gaul. Hover a work to see its company.
      </Intro>
      <Sheet className="p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseLeave={() => setFocus(null)}
        >
          {links.map((l, i) => {
            const on =
              !near ||
              (near.has(l.a.s.id) &&
                near.has(l.b.s.id) &&
                (l.a.s.id === focus || l.b.s.id === focus))
            return (
              <line
                key={i}
                x1={l.a.x}
                y1={l.a.y}
                x2={l.b.x}
                y2={l.b.y}
                stroke="currentColor"
                strokeOpacity={on ? (near ? 0.55 : 0.12 + 0.3 * (l.n / maxN)) : 0.04}
                strokeWidth={0.6 + 3 * (l.n / maxN)}
              />
            )
          })}
          {nodes.map((n) => {
            const on = !near || near.has(n.s.id)
            const showLabel = near ? near.has(n.s.id) : labelled.has(n.s.id)
            return (
              <g
                key={n.s.id}
                opacity={on ? 1 : 0.2}
                onMouseEnter={() => setFocus(n.s.id)}
                onMouseMove={(e) =>
                  tip.show(
                    e,
                    <>
                      <KindMark kind={n.s.kind} label={name(n.s)} />
                      <div className="mt-1 text-muted-foreground">
                        {n.s.records} records · cited with {near ? near.size - 1 : 0} others
                      </div>
                    </>,
                  )
                }
                onMouseLeave={tip.hide}
              >
                <circle cx={n.x} cy={n.y} r={n.r + 6} fill="transparent" />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={kindColor(n.s.kind)}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
                {showLabel && (
                  <text
                    x={n.x}
                    y={n.y - n.r - 5}
                    textAnchor="middle"
                    className="fill-foreground text-[12px]"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'var(--card)',
                      strokeWidth: 4,
                      strokeLinejoin: 'round',
                    }}
                  >
                    {name(n.s)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <div className="flex gap-6 border-t border-rule px-3 pt-3 pb-1 text-xs text-muted-foreground">
          <KindMark kind="ancient" label="ancient text" />
          <KindMark kind="modern" label="modern scholarship" />
          <KindMark kind="dataset" label="dataset" />
          <span className="ml-auto italic">size: records the work backs</span>
        </div>
      </Sheet>
      {tip.node}
    </div>
  )
}
