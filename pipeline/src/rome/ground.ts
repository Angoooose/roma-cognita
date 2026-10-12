/**
 * The ancient ground of Rome's valleys (DESIGN.md §7.7): how much lower the valley
 * floors lay in the late Republic than the terrain the map is laid on.
 *
 * The terrain is today's, and since antiquity the valleys have filled up. Where an
 * excavation found the ground people walked on then, and SITAR records its height
 * (rome-levels.geojson, sitar.ts), the valley floor is set to it: each correction
 * below is one valley floor, its height the median of the levels of the pieces it
 * cites. Most are dated to span 68–27 BCE; where only a level from just after is
 * known, it is a ceiling for the Republican one and taken as it is.
 *
 * A correction follows its valley rather than spreading round its point: from the
 * point it runs out over the ground no more than RELIEF_M above the valley floor
 * (a geodesic, round the hills), up to REACH_M along it, and lowers ground on the
 * floor by the whole change and ground up the valley's sides less, to nothing
 * RELIEF_M up. So the valley deepens and the hills beside it stand higher. Where no
 * valley floor was excavated — the Subura, the valleys of the north — the terrain is
 * left as it is. Hillsides and the Velia are left out: there the terrain model is
 * itself too uncertain to measure a change against.
 *
 * A ridge whose terrain carries modern work and whose ancient level is published
 * (`RIDGES`) is capped at that level along its line instead, the ground beside it
 * rising at a hillside's slope to meet the terrain.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projection } from '@roma-cognita/world'
import { DATA_DIR } from '../load.ts'

type Pt = [number, number]

export interface Correction {
  /** The valley floor it sets, and where. */
  what: string
  at: [number, number]
  /** The SITAR pieces whose levels give its height. */
  pieces: number[]
}

/** The paving of the Forum's square and the street beside it, by the Lacus Iuturnae. */
export const FORUM_PAVING_PIECES = [17854, 17890]

export const CORRECTIONS: Correction[] = [
  {
    what: 'the Forum valley at the mouth of the Argiletum: a street and the lane between two houses, later under the Forum of Caesar, in use 380–101 BCE and until 55 BCE',
    at: [12.48567, 41.89345],
    pieces: [16681, 16671],
  },
  {
    what: "the Forum's square by the Lacus Iuturnae: its travertine paving and the street west of the Lacus, of the early 2nd century CE, a ceiling for the Republican level",
    at: [12.48591, 41.89158],
    pieces: FORUM_PAVING_PIECES,
  },
  {
    what: 'the valley of the Colosseum at the head of the street from the Porta Capena: the paved square and street there of 7 BCE to 64 CE, a ceiling for the Republican level',
    at: [12.49057, 41.88991],
    pieces: [15456, 15428],
  },
  {
    what: "the Via Appia just inside the Porta Capena, paved in 312 BCE and found by Gatti in 1939, 7.2 m under today's ground",
    at: [12.48949, 41.88481],
    pieces: [17004],
  },
  {
    what: "the Via Appia at the Porta Capena, on Parker and Gori's plan of the excavation",
    at: [12.49062, 41.88398],
    pieces: [16624],
  },
  {
    what: 'the Via Flaminia at the foot of the Capitol, under the Piazza Venezia: its paving, 220 BCE to 1 BCE, and the square beside it, 200 BCE to 50 CE',
    at: [12.48254, 41.89587],
    pieces: [6627, 6628],
  },
]

/**
 * A line the terrain stands too high along — a col between two hills, or a street
 * climbing to one — where it carries modern work and the ancient level is published
 * rather than in SITAR: the ground along the line, and `flat` metres either side,
 * capped at `level` (or at levels from its first end to its last, straight between
 * them along it), beyond that rising no more steeply than `rise` (a share of the distance) to
 * meet the terrain. Only ever lowered.
 */
export interface Ridge {
  what: string
  /** Its line, lon/lat: its points, or a street's drawn line in rome.geojson, by id. */
  line: [number, number][] | { street: string }
  level: number | [number, number]
  flat: number
  rise: number
  source: string
}

export const RIDGES: Ridge[] = [
  {
    what: 'the saddle between the Capitol and the Quirinal, along the Servian Wall by the Porta Fontinalis, before Trajan cut it away: the terrain there stands 33–36 m, the smoothed Vittoriano and the Capitol’s modern north slope',
    line: [
      [12.48415, 41.89412],
      [12.48503, 41.89486],
    ],
    level: 20,
    flat: 20,
    rise: 0.4,
    source:
      'Delfino, Forum Iulium (2014), II.3 and III.3.4: the saddle about 20 m above the sea, the first slopes behind the forum 18–20 m; the Via Flaminia just outside at 13.2–13.9 m (SITAR 6627)',
  },
  {
    what: 'the Clivus Argentarius, from the Forum by the Carcer up behind the shops of the Forum of Caesar to the Porta Fontinalis: the terrain beside the Carcer stands 25 m, the Vittoriano’s flank and the modern street',
    // Its excavated paving as OpenStreetMap traces it, from the saddle down to the
    // Forum.
    line: { street: 'clivus-argentarius' },
    // From the saddle (above) to the Forum's square as the model lays it; straight
    // between them, since no level on the street itself is published.
    level: [20, 13.5],
    flat: 5,
    rise: 0.4,
    source:
      'Platner & Ashby, Clivus Argentarius, p. 121: from the Forum by the Carcer to the Porta Fontinalis; Delfino, Forum Iulium (2014), III.3: the upper storey of the forum’s shops opening onto it, their cut face up to about 20 m',
  },
]

/** How far up a valley's sides a correction reaches, metres above its floor. */
const RELIEF_M = 12
/** How far along its valley a correction reaches, metres. */
const REACH_M = 450
/** The most the ground is lowered or raised, metres. */
const CHANGE_M: [number, number] = [-15, 6]

export interface Grid {
  x0: number
  y1: number
  width: number
  height: number
  texel: number
}

/** The levels SITAR records on each of `pieces`, metres above the sea. */
function levelsOf(pieces: number[]): number[] {
  const geo = JSON.parse(
    readFileSync(join(DATA_DIR, 'geometry/rome-levels.geojson'), 'utf8'),
  )
  return geo.features
    .filter((f: { properties: { piece: number } }) => pieces.includes(f.properties.piece))
    .map((f: { properties: { level: number } }) => f.properties.level)
    .sort((a: number, b: number) => a - b)
}

/** The median of the levels SITAR records on `pieces`, metres above the sea. */
export function levelOf(pieces: number[]) {
  const levels = levelsOf(pieces)
  if (!levels.length) throw new Error(`ground.ts: no level for SITAR ${pieces.join(', ')}`)
  return levels[Math.floor(levels.length / 2)]
}

/** The change to the terrain at every texel of `grid`, metres, and what each correction found. */
export function ancientGround(grid: Grid, terrain: Float32Array) {
  const { width: W, height: H, texel: T } = grid
  const cellOf = ([x, y]: Pt) => {
    const c = Math.floor((x - grid.x0) / T)
    const r = Math.floor((grid.y1 - y) / T)
    return c < 0 || r < 0 || c >= W || r >= H ? -1 : r * W + c
  }
  const sum = new Float32Array(W * H)
  const weight = new Float32Array(W * H)
  const found: { what: string; level: number; floor: number; change: number }[] = []
  for (const k of CORRECTIONS) {
    const level = levelOf(k.pieces)
    const start = cellOf(projection.forward(...k.at))
    if (start < 0) continue
    const floor = terrain[start]
    const change = Math.max(CHANGE_M[0], Math.min(CHANGE_M[1], level - floor))
    found.push({ what: k.what, level, floor, change })
    // Out along the valley: a cheapest path over the texels no more than RELIEF_M
    // above its floor, by distance.
    const dist = new Float32Array(W * H).fill(Infinity)
    dist[start] = 0
    const queue: number[] = [start]
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]
      const [c, r] = [i % W, Math.floor(i / W)]
      for (const [dc, dr, len] of [
        [1, 0, 1],
        [-1, 0, 1],
        [0, 1, 1],
        [0, -1, 1],
        [1, 1, Math.SQRT2],
        [1, -1, Math.SQRT2],
        [-1, 1, Math.SQRT2],
        [-1, -1, Math.SQRT2],
      ]) {
        const [cc, rr] = [c + dc, r + dr]
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue
        const j = rr * W + cc
        const d = dist[i] + len * T
        if (d >= dist[j] || d > REACH_M || terrain[j] > floor + RELIEF_M) continue
        dist[j] = d
        queue.push(j)
      }
    }
    for (let i = 0; i < W * H; i++) {
      if (!Number.isFinite(dist[i])) continue
      const up = Math.min(1, Math.max(0, (terrain[i] - floor) / RELIEF_M))
      const along = 1 - smoothstep(REACH_M * 0.4, REACH_M, dist[i])
      const w = (1 - up) * along
      sum[i] += w * change
      weight[i] += w
    }
  }
  const change = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++)
    change[i] = weight[i] > 0 ? sum[i] / Math.max(weight[i], 1) : 0
  return { change: blur(change, W, H, 3), found }
}

/**
 * The ridges (`RIDGES`) capped on `terrain` once its valleys are corrected: the change
 * at every texel of `grid`, metres (never above nothing), and what each found. Its
 * level is published, so it is not held to `CHANGE_M`.
 */
export function capRidges(grid: Grid, terrain: Float32Array) {
  const { width: W, height: H, texel: T } = grid
  const change = new Float32Array(W * H)
  const found: { what: string; level: number; floor: number; change: number }[] = []
  for (const k of RIDGES) {
    const pts = lineOf(k).map((q) => projection.forward(...q))
    // Each point's distance along the line, for a level that changes along it.
    const at = [0]
    for (let n = 1; n < pts.length; n++)
      at.push(at[n - 1] + Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]))
    const length = at[at.length - 1] || 1
    const levelOf = (t: number) =>
      typeof k.level === 'number' ? k.level : k.level[0] + (k.level[1] - k.level[0]) * t
    // Out to where the cap stands 60 m over its level, above any terrain near it.
    const reach = k.flat + 60 / k.rise
    const xs = pts.map((q) => q[0])
    const ys = pts.map((q) => q[1])
    const [c0, c1] = [Math.min(...xs) - reach, Math.max(...xs) + reach].map((x) =>
      Math.round((x - grid.x0) / T),
    )
    const [r0, r1] = [Math.max(...ys) + reach, Math.min(...ys) - reach].map((y) =>
      Math.round((grid.y1 - y) / T),
    )
    let deepest = 0
    let floor = -Infinity
    for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) {
        const i = r * W + c
        const p: Pt = [grid.x0 + (c + 0.5) * T, grid.y1 - (r + 0.5) * T]
        // The nearest point of the line, and how far along it that is.
        let [d, along] = [Infinity, 0]
        for (let n = 0; n + 1 < pts.length; n++) {
          const [dd, t] = segNear(p, pts[n], pts[n + 1])
          if (dd < d) [d, along] = [dd, at[n] + t * (at[n + 1] - at[n])]
        }
        if (d < k.flat) floor = Math.max(floor, terrain[i])
        const cap = levelOf(along / length) + Math.max(0, d - k.flat) * k.rise
        if (terrain[i] + change[i] > cap) change[i] = cap - terrain[i]
        deepest = Math.min(deepest, change[i])
      }
    found.push({ what: k.what, level: levelOf(1), floor, change: deepest })
  }
  return { change, found }
}

/** A ridge's line, lon/lat: its own points, or its street's drawn line. */
function lineOf(k: Ridge): [number, number][] {
  if (Array.isArray(k.line)) return k.line
  const id = k.line.street
  const geo = JSON.parse(readFileSync(join(DATA_DIR, 'geometry/rome.geojson'), 'utf8'))
  const f = geo.features.find((f: { id: string }) => f.id === id)
  if (!f) throw new Error(`ground.ts: no line for "${id}" in rome.geojson`)
  const g = f.geometry
  const parts: [number, number][][] =
    g.type === 'LineString'
      ? [g.coordinates]
      : g.type === 'MultiLineString'
        ? g.coordinates
        : []
  // Its pieces joined end to end, in their order.
  return parts.flatMap((part, n) => (n ? part.slice(1) : part))
}

/** The distance from `p` to the segment from `a` to `b`, and how far along it the nearest point is (0–1). */
function segNear(p: Pt, a: Pt, b: Pt): [number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t]
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A separable Gaussian blur, `sigma` in texels: so the change has no steps. */
function blur(src: Float32Array, w: number, h: number, sigma: number) {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: rad * 2 + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const pass = (a: Float32Array, horizontal: boolean) => {
    const b = new Float32Array(a.length)
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        let [s, ws] = [0, 0]
        for (let i = -rad; i <= rad; i++) {
          const [cc, rr] = horizontal ? [c + i, r] : [c, r + i]
          if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue
          s += a[rr * w + cc] * k[i + rad]
          ws += k[i + rad]
        }
        b[r * w + c] = s / ws
      }
    return b
  }
  return pass(pass(src, true), false)
}
