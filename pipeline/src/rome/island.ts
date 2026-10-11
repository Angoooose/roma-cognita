/**
 * The Tiber Island's shore, as the model draws it (DESIGN.md §7.7). OpenStreetMap's
 * outline of the island is its modern embankment: stepped where the Lungotevere's
 * stairs and landings come down, and notched where the bridges land. The Republic's
 * embankment was built round it as the sides of a ship (designs/south.ts), so the
 * model smooths the steps out of the shore and draws its downstream end to a point,
 * the prow. The river's outline is changed where it goes round the island, so the
 * water on the board, the ground and the embankment keep to one shore.
 */
import { projection } from '@roma-cognita/world'
import { planeBearing } from './designs.ts'

type Pt = [number, number]

export const ISLAND = 'insula-tiberina'
/** Which way its prow points: downstream, east-south-east (designs/south.ts). */
const PROW_BEARING = 112
/** How far along the shore its steps are smoothed out over, metres (a Gaussian's sigma). */
const SMOOTH_M = 5
/** How far back from its tip the prow narrows to a point, metres. */
const PROW_M = 45
/** How far apart the points of the shore are, metres. */
const STEP_M = 2

/**
 * The island's shore in the river's rings: the smallest one round its location (the
 * river's hole the island is), or -1.
 */
export function islandRing(rings: Pt[][], at: Pt) {
  let best = -1
  for (let i = 0; i < rings.length; i++)
    if (inRing(at, rings[i]) && (best < 0 || area(rings[i]) < area(rings[best]))) best = i
  return best
}

/**
 * The shore as the ship's sides: its steps smoothed out, and its downstream end drawn
 * to a point. `location` is the island's (lon, lat), for the way its prow points.
 */
export function shipShore(ring: Pt[], location: [number, number]): Pt[] {
  const closed = samePt(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring
  // Every half metre round it, then smoothed along it.
  const fine = resample(closed, 0.5)
  const n = fine.length
  const reach = Math.ceil((SMOOTH_M * 3) / 0.5)
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) =>
    Math.exp(-(((k - reach) * 0.5) ** 2) / (2 * SMOOTH_M ** 2)),
  )
  const total = weights.reduce((a, b) => a + b, 0)
  const smooth: Pt[] = fine.map((_, i) => {
    let [x, y] = [0, 0]
    for (let k = -reach; k <= reach; k++) {
      const p = fine[(i + k + n) % n]
      const w = weights[k + reach]
      x += p[0] * w
      y += p[1] * w
    }
    return [x / total, y / total]
  })
  // The prow: towards its tip, each point drawn in to the island's axis through the
  // tip, the more the nearer, so its sides meet in a point.
  const b = planeBearing(PROW_BEARING, location)
  const f: Pt = [Math.sin(b), Math.cos(b)]
  const r: Pt = [f[1], -f[0]]
  const along = (p: Pt) => p[0] * f[0] + p[1] * f[1]
  const tip = smooth.reduce((m, p) => (along(p) > along(m) ? p : m), smooth[0])
  const prow = smooth.map((p): Pt => {
    const t = (along(tip) - along(p)) / PROW_M
    if (t >= 1) return p
    const s = Math.sqrt(1 - (1 - Math.max(0, t)) ** 2)
    const [dx, dy] = [p[0] - tip[0], p[1] - tip[1]]
    const across = dx * r[0] + dy * r[1]
    const back = dx * f[0] + dy * f[1]
    const k = across * s
    return [tip[0] + r[0] * k + f[0] * back, tip[1] + r[1] * k + f[1] * back]
  })
  const out = resample(prow, STEP_M)
  out.push(out[0])
  return out
}

/** The island's location in plane metres. */
export const islandAt = (location: [number, number]) => projection.forward(...location)

/** A closed ring's points every `step` metres round it. */
function resample(ring: Pt[], step: number): Pt[] {
  const n = ring.length
  let length = 0
  for (let i = 0; i < n; i++) length += dist(ring[i], ring[(i + 1) % n])
  const count = Math.max(8, Math.round(length / step))
  const d = length / count
  const out: Pt[] = []
  let [i, into] = [0, 0]
  for (let k = 0; k < count; k++) {
    const want = k * d
    while (into + dist(ring[i], ring[(i + 1) % n]) < want && i < n - 1) {
      into += dist(ring[i], ring[(i + 1) % n])
      i++
    }
    const [a, b] = [ring[i], ring[(i + 1) % n]]
    const t = Math.min(1, (want - into) / (dist(a, b) || 1))
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])
const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

function area(r: Pt[]) {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1])
  return Math.abs(s / 2)
}

function inRing([x, y]: Pt, ring: Pt[]) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
