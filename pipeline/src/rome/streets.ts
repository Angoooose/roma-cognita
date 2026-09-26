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
 * - **Consular roads** (roads.ts) run from the gate each left by, or the bridge it
 *   crossed on, through SITAR's reconstructions of their course and the finds and
 *   points the sources fix, and on along Itiner-e's line (build/roads, the map's own
 *   roads) past the edge of the board, so the board's road meets the map's. Inside
 *   the later Aurelian Wall Itiner-e runs its roads to a point in the middle of the
 *   city, which is not a road anyone surveyed, so it is taken up only beyond it.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'
import { DATA_DIR } from '../load.ts'
import { ROADS } from './roads.ts'
import { ROUTES, type Stop } from './routes.ts'
import { middleLine } from './servian.ts'

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
export function itinere(): Map<string, { pts: Pt[]; certain: boolean }[]> {
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

/**
 * The ground a drawn street crosses: its height, where no street may go, and how far
 * a road runs on along the map's line (`onBoard`: the board and a margin round it).
 */
export interface Ground {
  height: (x: number, y: number) => number
  keepOff: (x: number, y: number) => boolean
  onBoard: (p: Pt) => boolean
}

/** What a street drawn from the evidence runs through, besides the ground. */
interface Context {
  drawn: StreetLine[]
  ground: Ground
  gates: Map<string, Pt>
  itinere: Map<string, { pts: Pt[]; certain: boolean }[]>
}

export function streetLines(
  geometry: Map<string, [number, number][][]>,
  places: Map<string, Place>,
  circuit: Pt[],
  gates: Map<string, Pt>,
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
  const ctx: Context = { drawn: out, ground, gates, itinere: itinere() }
  for (const r of ROUTES) {
    if (!places.has(r.id)) throw new Error(`routes.ts: no place "${r.id}"`)
    for (const stops of r.lines)
      out.push({ id: r.id, pts: drawRoute(stops, ctx), road: false, known: false })
  }
  for (const r of ROADS) {
    const place = places.get(r.id)
    if (place?.kind !== 'road') throw new Error(`roads.ts: no road "${r.id}"`)
    for (const stops of r.lines)
      out.push({ id: r.id, pts: drawRoute(stops, ctx), road: true, known: r.known })
  }
  return out
}

/**
 * The Itiner-e lines the plan's roads take up (roads.ts): the plan draws these roads
 * itself, so their lines into the middle of the city are not roads the country's plots
 * face (plate.ts).
 */
export const TAKEN_UP = new Set(
  ROADS.flatMap((r) => r.lines.flat().flatMap((s) => (s.itinere ? [s.itinere] : []))),
)

// --- streets drawn from the evidence (routes.ts) --------------------------------------

/** A SITAR file's outlines by number, in plane metres: each part's outer ring. */
function readPieces(file: string): Map<number, Pt[][]> {
  const geo = JSON.parse(readFileSync(join(DATA_DIR, 'geometry', file), 'utf8'))
  const out = new Map<number, Pt[][]>()
  for (const f of geo.features) {
    const polys =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    out.set(
      f.id,
      polys.map((p: [number, number][][]) =>
        p[0].map(([lon, lat]) => projection.forward(lon, lat)),
      ),
    )
  }
  return out
}

/** The pieces of excavated street in and round the walls, by number, as plane-metre outlines. */
let pieces: Map<number, Pt[]> | null = null
/** The finds and reconstructions the consular roads cite (rome-roads.geojson), by number. */
let roadPieces: Map<number, Pt[][]> | null = null
function piece(n: number, need = true): Pt[] {
  if (!pieces)
    pieces = new Map(
      [...readPieces('rome-sitar.geojson')].map(([k, parts]) => [k, parts.flat()]),
    )
  const p = pieces.get(n) ?? roadPart(n, false)?.flat()
  if (!p && need)
    throw new Error(`SITAR ${n} is in neither rome-sitar.geojson nor rome-roads.geojson`)
  return p ?? []
}
function roadPart(n: number, need = true): Pt[][] | undefined {
  roadPieces ??= readPieces('rome-roads.geojson')
  const p = roadPieces.get(n)
  if (!p && need) throw new Error(`roads.ts: SITAR ${n} is not in rome-roads.geojson`)
  return p
}

/**
 * The excavated pieces long enough to show which way their street ran (4 m and
 * more), each as the line between its two ends: for the generated streets to pass
 * along (city.ts). Those on a recorded street are already drawn.
 */
export function excavatedPieces(): Pt[][] {
  piece(-1, false)
  return [...pieces!.values()].map(ends).filter(([a, b]) => dist(a, b) >= 4)
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

/** A street or road through its stops (routes.ts, roads.ts), in plane metres. */
function drawRoute(stops: Stop[], ctx: Context): Pt[] {
  const { drawn, ground, gates } = ctx
  const gate = (name: string) => {
    const g = gates.get(name)
    if (!g) throw new Error(`roads.ts: no gate "${name}"`)
    return g
  }
  // Where each stop is, roughly: to order a piece's ends, and to find where a street
  // it runs onto is nearest.
  const rough: (Pt | null)[] = stops.map((s) =>
    s.at
      ? projection.forward(...s.at)
      : s.sitar !== undefined
        ? centre(piece(s.sitar))
        : s.gate
          ? gate(s.gate)
          : s.along !== undefined
            ? s.to
              ? projection.forward(...s.to)
              : centre(roadPart(s.along)!.flat())
            : null,
  )
  const near = (i: number) => rough[i + 1] ?? rough[i - 1] ?? null
  let line: Pt[] = []
  stops.forEach((s, i) => {
    const end = line[line.length - 1]
    let points: Pt[]
    if (s.onto) {
      const to = rough[i] ?? near(i)
      if (!to) throw new Error(`routes.ts: "${s.onto}" has nothing to be near`)
      points = [nearestOnStreet(s.onto, drawn, to)]
    } else if (s.sitar !== undefined) {
      const [a, b] = ends(piece(s.sitar))
      const from =
        rough[i - 1] ?? (rough[i + 1] ? mirror(rough[i + 1]!, centre([a, b])) : a)
      points = dist(from, a) <= dist(from, b) ? [a, b] : [b, a]
    } else if (s.gate) points = [gate(s.gate)]
    else if (s.along !== undefined) {
      if (!end) throw new Error(`roads.ts: SITAR ${s.along} cannot begin a road`)
      const to = s.to ? projection.forward(...s.to) : rough[i + 1]
      points = alongBand(roadPart(s.along)!, end, to ?? null)
    } else if (s.itinere) {
      if (i !== stops.length - 1) throw new Error(`roads.ts: ${s.itinere} must come last`)
      points = alongItinere(s.itinere, projection.forward(...s.at!), ctx)
    } else points = [projection.forward(...s.at!)]
    if (!end) {
      line = [...points]
      return
    }
    // A leg over the ground is routed on a grid round it, so a far stop is a mistake.
    if (stops[i - 1].next !== 'straight' && dist(end, points[0]) > LEG_M)
      throw new Error(
        `routes: ${Math.round(dist(end, points[0]))} m over the ground from "${stops[i - 1].what.slice(0, 50)}" to "${s.what.slice(0, 50)}"`,
      )
    const leg =
      stops[i - 1].next === 'straight'
        ? [end, points[0]]
        : overGround(end, points[0], ground)
    line.push(...leg.slice(1), ...points.slice(1))
  })
  const short = stops[stops.length - 1].short
  if (short) line = trimEnd(line, short)
  return line.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt)
}

/** The longest leg a street or road is routed over the ground, metres. */
const LEG_M = 3000

/** Where the roads out of the city start from, for which way is out: the Forum. */
const CITY = projection.forward(12.4853, 41.8925)
/** Pieces of an Itiner-e line are one where their ends are this close, metres. */
const JOIN_M = 60

/**
 * The middle line of a reconstruction's band (its parts' outlines), from the point
 * nearest `from` to the point nearest `to`, or to its end.
 */
function alongBand(parts: Pt[][], from: Pt, to: Pt | null): Pt[] {
  // Each part's middle line, joined end to end in order along the road from `from`.
  const lines = parts.map((ring) => simplify(middleLine(ring), 0.5))
  const chain: Pt[] = []
  let at = from
  while (lines.length) {
    const k = lines.reduce(
      (best, l, j) =>
        Math.min(dist(l[0], at), dist(l[l.length - 1], at)) <
        Math.min(dist(lines[best][0], at), dist(lines[best][lines[best].length - 1], at))
          ? j
          : best,
      0,
    )
    let l = lines.splice(k, 1)[0]
    if (dist(l[l.length - 1], at) < dist(l[0], at)) l = [...l].reverse()
    chain.push(...l)
    at = l[l.length - 1]
  }
  const a = nearestAlong(chain, from)
  let out: Pt[] = [a.q, ...chain.slice(a.i + 1)]
  if (to) {
    const b = nearestAlong(out, to)
    out = [...out.slice(0, b.i + 1), b.q]
  }
  return out
}

/**
 * The map's line for a road (Itiner-e), from its point nearest `at` on out away from
 * the city, taking up the next piece of the same name where one ends, until it is past
 * the edge of the board.
 */
function alongItinere(name: string, at: Pt, ctx: Context): Pt[] {
  const pieces = (ctx.itinere.get(name) ?? []).map((l) => l.pts)
  if (!pieces.length) throw new Error(`roads.ts: no Itiner-e line "${name}" on the map`)
  let best = { k: -1, i: 0, q: at, d: Infinity }
  pieces.forEach((l, k) => {
    const n = nearestAlong(l, at)
    const d = dist(n.q, at)
    if (d < best.d) best = { k, ...n, d }
  })
  if (best.d > 150)
    console.log(
      `  doubt: ${name} passes ${Math.round(best.d)} m from where roads.ts takes it up`,
    )
  const first = pieces[best.k]
  // Out is towards the end further from the city.
  const out = dist(first[first.length - 1], CITY) > dist(first[0], CITY)
  let line: Pt[] = out
    ? [best.q, ...first.slice(best.i + 1)]
    : [best.q, ...first.slice(0, best.i + 1).reverse()]
  const used = new Set([best.k])
  for (;;) {
    const last = line[line.length - 1]
    if (!ctx.ground.onBoard(last)) break
    const k = pieces.findIndex(
      (l, j) =>
        !used.has(j) && Math.min(dist(l[0], last), dist(l[l.length - 1], last)) < JOIN_M,
    )
    if (k < 0) break
    used.add(k)
    const l = pieces[k]
    line.push(
      ...(dist(l[0], last) < dist(l[l.length - 1], last) ? l : [...l].reverse()).slice(1),
    )
  }
  // Cut just past the board's margin.
  const past = line.findIndex((p) => !ctx.ground.onBoard(p))
  return past < 0 ? line : line.slice(0, past + 1)
}

/** The point of a line nearest `p`, and the index of the segment it is on. */
function nearestAlong(l: Pt[], p: Pt): { i: number; q: Pt } {
  let best = { i: 0, q: l[0], d: Infinity }
  for (let i = 0; i + 1 < l.length; i++) {
    const [a, b] = [l[i], l[i + 1]]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    const q: Pt = [a[0] + dx * t, a[1] + dy * t]
    const d = dist(q, p)
    if (d < best.d) best = { i, q, d }
  }
  return { i: best.i, q: best.q }
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
  // In double precision, as each cost is reckoned: a float32 cost rounded up would
  // compare as dearer than the same path reckoned again, and on level ground each
  // node would be pushed again and again.
  const cost = new Float64Array(nx * ny).fill(Infinity)
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
