/**
 * The streets and roads on the plan of Rome (DESIGN.md §7.7), as plane-metre lines
 * for the plate (plate.ts) to draw and letter.
 *
 * - **City streets** are the lines data/geometry/rome.geojson holds for each street
 *   and road record. Those traced along a modern street (TRACED) are cut to what
 *   lies inside the walls, since Platner & Ashby's identification is of the street
 *   within the city, and drawn lighter.
 * - **Consular roads** are Itiner-e's (build/roads, the map's own roads), each cut
 *   where it reaches the walled city or its crossing and joined to the gate Platner
 *   & Ashby say it left by (CONSULAR). Inside the walls Itiner-e runs its roads to a
 *   point in the middle of the city, which is not a street anyone surveyed.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'

type Pt = [number, number]

export interface StreetLine {
  id: string
  pts: Pt[]
  /** A road (wider) rather than a street. */
  road: boolean
  /** Surveyed, or on a line the sources fix; otherwise drawn lighter. */
  known: boolean
}

/**
 * Streets traced along the modern street Platner & Ashby identify them with: the
 * modern line only approximates the ancient one, so they are drawn lighter.
 */
export const TRACED = new Set([
  'alta-semita',
  'vicus-patricius',
  'clivus-suburanus',
  'vicus-cuprius',
  'clivus-argentarius',
])

/**
 * The consular roads: which Itiner-e lines, the record they belong to, and where
 * they meet the city, lon/lat. The gates are the circuit's (servian.ts).
 */
const CONSULAR: { itinere: string; id: string; to: Pt; what: string }[] = [
  {
    itinere: 'Tarracinae-Rome',
    id: 'via-appia',
    to: [12.491, 41.884],
    what: 'the Porta Capena (Platner & Ashby, Via Appia; Porta Capena)',
  },
  {
    itinere: 'Rome-Tibur',
    id: 'via-tiburtina',
    to: [12.50136, 41.89578],
    what: 'the Porta Esquilina, which it "probably" left by (Platner & Ashby, Via Tiburtina)',
  },
]

/** An Itiner-e line is joined to its end once it comes this close to it, metres. */
const JOIN_M = 150

const inRing = ([x, y]: Pt, ring: Pt[]) => {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** The parts of a line inside a ring, split where it crosses the ring's edges. */
function clipInside(line: Pt[], ring: Pt[]): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  const flush = () => {
    if (cur.length > 1) out.push(cur)
    cur = []
  }
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]]
    // Where the segment crosses the ring, as fractions along it.
    const ts = [0, 1]
    for (let k = 0; k + 1 < ring.length; k++) {
      const [p, q] = [ring[k], ring[k + 1]]
      const d = (b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0])
      if (!d) continue
      const t = ((p[0] - a[0]) * (q[1] - p[1]) - (p[1] - a[1]) * (q[0] - p[0])) / d
      const u = ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / d
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t)
    }
    ts.sort((x, y) => x - y)
    const at = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    for (let k = 0; k + 1 < ts.length; k++) {
      const inside = inRing(at((ts[k] + ts[k + 1]) / 2), ring)
      if (inside) {
        if (!cur.length) cur.push(at(ts[k]))
        cur.push(at(ts[k + 1]))
      } else flush()
    }
  }
  flush()
  return out
}

/** The built Itiner-e lines by name (build/roads, see pipeline/src/roads/build.ts). */
function itinere(): Map<string, { pts: Pt[]; certain: boolean }[]> {
  const dir = resolve(import.meta.dirname, '../../../build/roads')
  const meta = JSON.parse(readFileSync(join(dir, 'roads.json'), 'utf8')).lines
  const b = readFileSync(join(dir, 'roads.bin'))
  const out = new Map<string, { pts: Pt[]; certain: boolean }[]>()
  let o = 4
  for (let k = 0; k < b.readUInt32LE(0); k++) {
    const n = b.readUInt16LE(o)
    const certainty = b.readUInt8(o + 5)
    o += 6
    const pts: Pt[] = []
    for (let i = 0; i < n; i++, o += 8) pts.push([b.readFloatLE(o), b.readFloatLE(o + 4)])
    const list = out.get(meta[k].name) ?? []
    list.push({ pts, certain: certainty === 0 })
    out.set(meta[k].name, list)
  }
  return out
}

export function streetLines(
  geometry: Map<string, [number, number][][]>,
  places: Map<string, Place>,
  circuit: Pt[],
): StreetLine[] {
  const out: StreetLine[] = []
  for (const [id, lines] of geometry) {
    const road = places.get(id)?.kind === 'road'
    for (const l of lines) {
      const pts = l.map(([lon, lat]) => projection.forward(lon, lat))
      const parts = TRACED.has(id) ? clipInside(pts, circuit) : [pts]
      for (const p of parts) out.push({ id, pts: p, road, known: !TRACED.has(id) })
    }
  }
  const roads = itinere()
  for (const c of CONSULAR) {
    if (!places.has(c.id)) continue
    const to = projection.forward(...c.to)
    for (const { pts, certain } of roads.get(c.itinere) ?? []) {
      // From the far end in, until it reaches the city or its end; then to the end.
      const far = Math.hypot(pts[0][0] - to[0], pts[0][1] - to[1])
      const near = Math.hypot(
        pts[pts.length - 1][0] - to[0],
        pts[pts.length - 1][1] - to[1],
      )
      const line = far > near ? pts : [...pts].reverse()
      const kept: Pt[] = []
      for (const q of line) {
        if (inRing(q, circuit) || Math.hypot(q[0] - to[0], q[1] - to[1]) < JOIN_M) break
        kept.push(q)
      }
      if (!kept.length) continue
      out.push({ id: c.id, pts: [...kept, to], road: true, known: certain })
    }
  }
  return out
}

/**
 * A path to letter a street along: its longest line, resampled every `step` metres
 * and smoothed, so the name does not jitter along a path mapped in short pieces.
 */
export function letteringPath(lines: StreetLine[], step = 6): Pt[] | null {
  const length = (p: Pt[]) =>
    p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
  const best = [...lines].sort((a, b) => length(b.pts) - length(a.pts))[0]
  if (!best || length(best.pts) < 30) return null
  const pts = best.pts
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    let t = step - carry
    while (t <= d) {
      out.push([a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d])
      t += step
    }
    carry = d - (t - step)
  }
  const k = 3
  return out.map((_, i) => {
    const w = out.slice(Math.max(0, i - k), i + k + 1)
    return [
      Math.round(w.reduce((s, q) => s + q[0], 0) / w.length),
      Math.round(w.reduce((s, q) => s + q[1], 0) / w.length),
    ] as Pt
  })
}
