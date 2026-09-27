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
