import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { type Confidence, DATA, type Kind } from './data.ts'

export const kindColor = (k: Kind) => `var(--kind-${k})`

/** Confidence is one ink at three strengths, as the map draws it: sure is dark. */
export const CONF_OPACITY: Record<Confidence, number> = {
  certain: 0.85,
  probable: 0.5,
  uncertain: 0.2,
}

/** A small swatch and the kind's name: colour never stands alone. */
export function KindMark({ kind, label }: { kind: Kind; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ background: kindColor(kind) }} />
      {label ?? kind}
    </span>
  )
}

/** Inscriptional small capitals above a value. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('caps text-[0.68rem] text-muted-foreground uppercase', className)}>
      {children}
    </div>
  )
}

/** The double-ruled sheet every variation sits on. */
export function Sheet({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('paper rule-double rounded-lg bg-card p-6', className)}>
      {children}
    </section>
  )
}

export function Intro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 max-w-[62ch]">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-pretty text-muted-foreground italic">{children}</p>
    </div>
  )
}

/** Records in force each year, 133–27 BCE, as a filled line. */
export function Spark({
  values,
  max,
  width = 120,
  height = 18,
  color = 'currentColor',
}: {
  values: number[]
  max?: number
  width?: number
  height?: number
  color?: string
}) {
  const m = max ?? Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - (v / m) * (height - 1)).toFixed(1)}`,
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

/** The known world, drawn from the atoms' outlines, with some of them inked. */
export function Footprint({
  atoms,
  color,
  className,
  crop = [0, 40, 1000, 470],
}: {
  atoms: Set<string>
  color: string
  className?: string
  crop?: [number, number, number, number]
}) {
  return (
    <svg viewBox={crop.join(' ')} className={cn('block w-full', className)} aria-hidden>
      {Object.entries(DATA.atoms).map(([id, d]) => (
        <path
          key={id}
          d={d}
          fill={atoms.has(id) ? color : 'var(--muted-foreground)'}
          fillOpacity={atoms.has(id) ? 0.75 : 0.1}
          stroke="var(--card)"
          strokeWidth={0.8}
        />
      ))}
    </svg>
  )
}

/** A hover note that follows the pointer. */
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

export function pct(n: number, of: number) {
  return `${Math.round((n / of) * 100)}%`
}
