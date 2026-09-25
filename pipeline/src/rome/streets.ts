/**
 * The streets and roads on the plan of Rome (DESIGN.md §7.7), as plane-metre lines
 * for the plate (plate.ts) to draw and letter.
 *
 * - **City streets** are the lines data/geometry/rome.geojson holds for each street
 *   and road record. Those traced along a modern street (TRACED) are cut to what
 *   lies inside the walls, since Platner & Ashby's identification is of the street
 *   within the city, and drawn lighter.
 * - **Streets drawn from the evidence** (routes.ts) run through the finds and the
 *   points the sources fix, and over the easiest ground between them; drawn lighter.
 * - **Consular roads** are Itiner-e's (build/roads, the map's own roads), each cut
 *   where it reaches the walled city or its crossing and joined to the gate Platner
 *   & Ashby say it left by (CONSULAR). Inside the walls Itiner-e runs its roads to a
 *   point in the middle of the city, which is not a street anyone surveyed.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'
import { DATA_DIR } from '../load.ts'
import { ROUTES, type Stop } from './routes.ts'

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

/** The ground a drawn street crosses: its height, and where no street may go. */
export interface Ground {
  height: (x: number, y: number) => number
  keepOff: (x: number, y: number) => boolean
}

export function streetLines(
  geometry: Map<string, [number, number][][]>,
  places: Map<string, Place>,
  circuit: Pt[],
  ground: Ground,
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
  for (const r of ROUTES) {
    if (!places.has(r.id)) throw new Error(`routes.ts: no place "${r.id}"`)
    for (const stops of r.lines)
      out.push({ id: r.id, pts: drawRoute(stops, out, ground), road: false, known: false })
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

// --- streets drawn from the evidence (routes.ts) --------------------------------------

/** The pieces of excavated street, by number, as plane-metre outlines. */
let pieces: Map<number, Pt[]> | null = null
function piece(n: number): Pt[] {
  if (!pieces) {
    const geo = JSON.parse(
      readFileSync(join(DATA_DIR, 'geometry/rome-sitar.geojson'), 'utf8'),
    )
    pieces = new Map()
    for (const f of geo.features) {
      const polys =
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      pieces.set(
        f.id,
        polys.flatMap((p: [number, number][][]) =>
          p[0].map(([lon, lat]) => projection.forward(lon, lat)),
        ),
      )
    }
  }
  const p = pieces.get(n)
  if (!p) throw new Error(`routes.ts: SITAR ${n} is not in rome-sitar.geojson`)
  return p
}

/** A piece's two ends: the extremes of its outline along its long axis. */
function ends(pts: Pt[]): [Pt, Pt] {
  const c: Pt = [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ]
  let [xx, xy, yy] = [0, 0, 0]
  for (const [x, y] of pts) {
    xx += (x - c[0]) ** 2
    xy += (x - c[0]) * (y - c[1])
    yy += (y - c[1]) ** 2
  }
  const a = 0.5 * Math.atan2(2 * xy, xx - yy)
  const u: Pt = [Math.cos(a), Math.sin(a)]
  const s = pts.map((p) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1])
  const [lo, hi] = [Math.min(...s), Math.max(...s)]
  return [
    [c[0] + u[0] * lo, c[1] + u[1] * lo],
    [c[0] + u[0] * hi, c[1] + u[1] * hi],
  ]
}

/** The point of the lines drawn for a street that is nearest `p`. */
function nearestOnStreet(id: string, drawn: StreetLine[], p: Pt): Pt {
  let best: Pt | null = null
  let bd = Infinity
  for (const l of drawn.filter((d) => d.id === id))
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [a, b] = [l.pts[i], l.pts[i + 1]]
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      )
      const q: Pt = [a[0] + dx * t, a[1] + dy * t]
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < bd) [best, bd] = [q, d]
    }
  if (!best) throw new Error(`routes.ts: runs onto "${id}", which is not drawn before it`)
  return best
}

/** A street through its stops (routes.ts), in plane metres. */
function drawRoute(stops: Stop[], drawn: StreetLine[], ground: Ground): Pt[] {
  // Where each stop is, roughly: to order a piece's ends, and to find where a street
  // it runs onto is nearest.
  const rough: (Pt | null)[] = stops.map((s) =>
    s.at
      ? projection.forward(...s.at)
      : s.sitar !== undefined
        ? centre(piece(s.sitar))
        : null,
  )
  const near = (i: number) => rough[i + 1] ?? rough[i - 1] ?? null
  const points: Pt[][] = stops.map((s, i) => {
    if (s.onto) {
      const to = rough[i] ?? near(i)
      if (!to) throw new Error(`routes.ts: "${s.onto}" has nothing to be near`)
      return [nearestOnStreet(s.onto, drawn, to)]
    }
    if (s.sitar !== undefined) {
      const [a, b] = ends(piece(s.sitar))
      const from =
        rough[i - 1] ?? (rough[i + 1] ? mirror(rough[i + 1]!, centre([a, b])) : a)
      return dist(from, a) <= dist(from, b) ? [a, b] : [b, a]
    }
    return [projection.forward(...s.at!)]
  })
  let line: Pt[] = [...points[0]]
  for (let i = 0; i + 1 < stops.length; i++) {
    const [a, b] = [line[line.length - 1], points[i + 1][0]]
    const leg = stops[i].next === 'straight' ? [a, b] : overGround(a, b, ground)
    line.push(...leg.slice(1), ...points[i + 1].slice(1))
  }
  const short = stops[stops.length - 1].short
  if (short) line = trimEnd(line, short)
  return line.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt)
}

const centre = (pts: Pt[]): Pt => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
]
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])
const mirror = (p: Pt, about: Pt): Pt => [2 * about[0] - p[0], 2 * about[1] - p[1]]

function trimEnd(line: Pt[], m: number): Pt[] {
  const out = [...line]
  while (out.length > 1 && m > 0) {
    const [a, b] = [out[out.length - 2], out[out.length - 1]]
    const d = dist(a, b)
    if (d > m) {
      out[out.length - 1] = [b[0] + ((a[0] - b[0]) * m) / d, b[1] + ((a[1] - b[1]) * m) / d]
      break
    }
    out.pop()
    m -= d
  }
  return out
}

/** The step of the grid a street is routed over, metres. */
const ROUTE_STEP_M = 3
/** The steps a routed street may take over the grid: the eight neighbours and the
 * knight's moves between them, so its line is not held to eight directions. */
const STEPS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [1, -2],
  [2, -1],
]
/** How much a slope costs: a step on a rise of 1 in 5 costs twice one on the flat. */
const SLOPE_COST = 25

/**
 * The easiest way from `a` to `b` over the ground, keeping off the monuments and
 * the river: a cheapest path over a grid, where a step costs its length and more on
 * a slope, smoothed. It keeps to the valleys, and climbs a hill across its slope.
 */
function overGround(a: Pt, b: Pt, g: Ground): Pt[] {
  const S = ROUTE_STEP_M
  const pad = Math.max(80, dist(a, b) * 0.35)
  const x0 = Math.min(a[0], b[0]) - pad
  const y0 = Math.min(a[1], b[1]) - pad
  const nx = Math.ceil((Math.max(a[0], b[0]) + pad - x0) / S)
  const ny = Math.ceil((Math.max(a[1], b[1]) + pad - y0) / S)
  const cell = (p: Pt) => Math.floor((p[1] - y0) / S) * nx + Math.floor((p[0] - x0) / S)
  const [from, to] = [cell(a), cell(b)]
  const h = new Float32Array(nx * ny)
  const off = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [x, y] = [x0 + (i + 0.5) * S, y0 + (j + 0.5) * S]
      h[j * nx + i] = g.height(x, y)
      off[j * nx + i] = g.keepOff(x, y) ? 1 : 0
    }
  // The ends may lie on what is kept off (a gate in the wall, a temple's front): the
  // ground round them is open, as far as a point temple reaches.
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p: Pt = [x0 + (i + 0.5) * S, y0 + (j + 0.5) * S]
      if (dist(p, a) < 18 || dist(p, b) < 18) off[j * nx + i] = 0
    }
  const cost = new Float32Array(nx * ny).fill(Infinity)
  const prev = new Int32Array(nx * ny).fill(-1)
  const [bi, bj] = [to % nx, Math.floor(to / nx)]
  const heap = new MinHeap()
  cost[from] = 0
  heap.push(from, 0)
  while (heap.size) {
    const k = heap.pop()
    if (k === to) break
    const [i, j] = [k % nx, Math.floor(k / nx)]
    for (const [di, dj] of STEPS) {
      const [ii, jj] = [i + di, j + dj]
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
      const q = jj * nx + ii
      // A long step may not jump what is kept off: the cell it passes over.
      const mid = (j + Math.round(dj / 2)) * nx + (i + Math.round(di / 2))
      if (off[q] || off[mid]) continue
      const run = Math.hypot(di, dj) * S
      const rise = Math.abs(h[q] - h[k]) / run
      const c = cost[k] + run * (1 + SLOPE_COST * rise * rise)
      if (c < cost[q]) {
        cost[q] = c
        prev[q] = k
        heap.push(q, c + Math.hypot(ii - bi, jj - bj) * S)
      }
    }
  }
  if (!Number.isFinite(cost[to])) {
    console.log(
      `  doubt: no way over the ground from ${a.map(Math.round)} to ${b.map(Math.round)}; drawn straight`,
    )
    return [a, b]
  }
  const path: Pt[] = []
  for (let k = to; k >= 0; k = prev[k])
    path.push([x0 + ((k % nx) + 0.5) * S, y0 + (Math.floor(k / nx) + 0.5) * S])
  path.reverse()
  path[0] = a
  path[path.length - 1] = b
  return smoothLine(simplify(path, 3), 3)
}

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  let [idx, md] = [0, 0]
  const [a, b] = [pts[0], pts[pts.length - 1]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(
      0,
      Math.min(
        1,
        ((pts[i][0] - a[0]) * dx + (pts[i][1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    )
    const d = dist(pts[i], [a[0] + dx * t, a[1] + dy * t])
    if (d > md) [idx, md] = [i, d]
  }
  if (md <= tol) return [a, b]
  return [
    ...simplify(pts.slice(0, idx + 1), tol).slice(0, -1),
    ...simplify(pts.slice(idx), tol),
  ]
}

/** Corners cut, `n` times, keeping the ends (Chaikin). */
function smoothLine(pts: Pt[], n: number): Pt[] {
  let p = pts
  for (let r = 0; r < n; r++) {
    const q: Pt[] = [p[0]]
    for (let i = 0; i + 1 < p.length; i++) {
      const [a, b] = [p[i], p[i + 1]]
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    q.push(p[p.length - 1])
    p = q
  }
  return p
}

class MinHeap {
  private k: number[] = []
  private p: number[] = []
  get size() {
    return this.k.length
  }
  push(k: number, p: number) {
    this.k.push(k)
    this.p.push(p)
    let i = this.k.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (this.p[up] <= this.p[i]) break
      ;[this.k[up], this.k[i]] = [this.k[i], this.k[up]]
      ;[this.p[up], this.p[i]] = [this.p[i], this.p[up]]
      i = up
    }
  }
  pop(): number {
    const top = this.k[0]
    const [lk, lp] = [this.k.pop()!, this.p.pop()!]
    if (this.k.length) {
      this.k[0] = lk
      this.p[0] = lp
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2]
        let m = i
        if (l < this.k.length && this.p[l] < this.p[m]) m = l
        if (r < this.k.length && this.p[r] < this.p[m]) m = r
        if (m === i) break
        ;[this.k[m], this.k[i]] = [this.k[i], this.k[m]]
        ;[this.p[m], this.p[i]] = [this.p[i], this.p[m]]
        i = m
      }
    }
    return top
  }
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
