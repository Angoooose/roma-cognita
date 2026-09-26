/**
 * Turns an authored frontier — vertices, and how the frontier runs between them —
 * into a ring of positions.
 *
 * - `line`: straight.
 * - `river`: the modern main channel, from HydroRIVERS, chained reach by reach
 *   along NEXT_DOWN from whichever end is upstream. Each end snaps to the largest
 *   river within a few kilometres of it, so a vertex at a mouth takes the river,
 *   not the coastal stream beside it. A modern course is a stand-in for the
 *   ancient one; at the scale of a province it is the same line.
 * - `crest`: the least-cost path through the DEM with cost falling steeply with
 *   height, which runs along the ridge between the two vertices. It is a watershed
 *   in the sense the sources mean ("along the Pyrenees"), not a hydrological one.
 * - `curve`: a centripetal Catmull–Rom through a run of `curve` vertices, for an
 *   edge that is a convention (a desert margin) and should not read as a surveyed
 *   polygon. It passes through every vertex.
 *
 * Everything returned is simplified to under the political field's texel.
 */
import { join } from 'node:path'
import type { Leg } from '@roma-cognita/schema'
import { readDem, lonLatToPixel, pixelToLonLat, isSea } from '../features/dem.ts'
import { catmullRom, leastCostPath, simplifyIndices, type Pt } from '../features/grid.ts'
import { readDbf, readShp } from '../features/shp.ts'

/** Degrees, ~300 m. */
const TOLERANCE = 0.003
const SNAP_KM = 4

export interface Vertex {
  at: Pt
  via: 'line' | 'river' | 'crest' | 'curve'
  pleiades?: string
  note?: string
}

export const vertexOf = (leg: Leg): Vertex =>
  Array.isArray(leg) ? { at: leg as Pt, via: 'line' } : { ...leg, at: leg.at as Pt, via: leg.via ?? 'line' }

/** The closed ring through `edge`. Each vertex's `via` says how the frontier reaches it from the one before. */
export async function resolveEdge(edge: Leg[], what: string): Promise<Pt[]> {
  const vs = edge.map(vertexOf)
  // Start the walk on a vertex no curve runs into, so every curve run is contiguous.
  const start = vs.findIndex((v) => v.via !== 'curve')
  if (start < 0) {
    const pts = vs.map((v) => v.at)
    return close(catmullRom([...pts, pts[0], pts[1]], 8).slice(0, -8))
  }
  const order = [...vs.slice(start), ...vs.slice(0, start)]
  const out: Pt[] = [order[0].at]
  const n = order.length
  for (let k = 1; k <= n; k++) {
    const v = order[k % n]
    const prev = out[out.length - 1]
    if (v.via === 'curve') {
      const run: Pt[] = [prev]
      let m = k
      while (m <= n && order[m % n].via === 'curve') run.push(order[m++ % n].at)
      // The vertex after the run anchors the curve's end, so the run leaves smoothly.
      run.push(order[m % n].at)
      const pts = catmullRom(run, 10)
      // Drop the anchor span; the next leg draws it in its own way.
      const cut = pts.findIndex((p) => p[0] === run[run.length - 2][0] && p[1] === run[run.length - 2][1])
      out.push(...pts.slice(1, cut >= 0 ? cut + 1 : undefined))
      k = m - 1
      continue
    }
    if (v.via === 'line') out.push(v.at)
    else {
      try {
        const path = v.via === 'river' ? riverPath(prev, v.at) : await crestPath(prev, v.at)
        out.push(...path.slice(1))
      } catch (e) {
        throw new Error(`${what}: ${v.via} leg to ${v.note ?? v.at.join(',')}: ${(e as Error).message}`)
      }
    }
  }
  return close(out)
}

function close(ring: Pt[]): Pt[] {
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a]
}

const simplify = (pts: Pt[]) => simplifyIndices(pts, TOLERANCE).map((i) => pts[i])

/** Kilometres between two lon/lat points, planar with cos-latitude scaling — fine at snapping distances. */
export function km(a: Pt, b: Pt) {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57)
}

// --- rivers --------------------------------------------------------------------

const RIVERS = join(import.meta.dirname, '../../../.cache/sources')
const REGIONS = ['eu', 'af', 'as']
const riverShp = (r: string) =>
  join(RIVERS, `HydroRIVERS_v10_${r}_shp/HydroRIVERS_v10_${r}_shp/HydroRIVERS_v10_${r}.shp`)

interface Reach {
  id: number
  next: number
  upland: number
  line: Pt[]
}

function reachesNear(a: Pt, b: Pt, m: number): Map<number, Reach> {
  const bbox = {
    west: Math.min(a[0], b[0]) - m,
    east: Math.max(a[0], b[0]) + m,
    south: Math.min(a[1], b[1]) - m,
    north: Math.max(a[1], b[1]) + m,
  }
  const out = new Map<number, Reach>()
  for (const region of REGIONS) {
    const shp = riverShp(region)
    const recs = readShp(shp, bbox)
    if (!recs.length) continue
    const attrs = readDbf(shp.replace(/\.shp$/, '.dbf'), recs.map((r) => r.index), [
      'HYRIV_ID',
      'NEXT_DOWN',
      'UPLAND_SKM',
    ])
    for (const r of recs) {
      const at = attrs.get(r.index)!
      const upland = at.UPLAND_SKM as number
      if (upland < 30) continue
      out.set(at.HYRIV_ID as number, { id: at.HYRIV_ID as number, next: at.NEXT_DOWN as number, upland, line: r.parts[0] })
    }
  }
  return out
}

interface Snap {
  reach: Reach
  /** Index of the segment [k, k+1] the point projects onto. */
  seg: number
  at: Pt
  km: number
}

function project(p: Pt, a: Pt, b: Pt): Pt {
  const kx = Math.cos((p[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * kx
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, (((p[0] - a[0]) * kx) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}

/** Every river within SNAP_KM (or within 1 km of the nearest, if that is further), largest first. */
function snaps(p: Pt, reaches: Map<number, Reach>): Snap[] {
  const best = new Map<number, Snap>()
  let nearest = Infinity
  for (const reach of reaches.values()) {
    for (let k = 0; k + 1 < reach.line.length; k++) {
      const q = project(p, reach.line[k], reach.line[k + 1])
      const d = km(p, q)
      nearest = Math.min(nearest, d)
      const cur = best.get(reach.id)
      if (!cur || d < cur.km) best.set(reach.id, { reach, seg: k, at: q, km: d })
    }
  }
  const reachKm = Math.max(SNAP_KM, nearest + 1)
  const candidates = [...best.values()].filter((s) => s.km <= reachKm)
  if (!candidates.length || nearest > 10) throw new Error(`no river within 10 km of [${p}]`)
  candidates.sort((a, b) => b.reach.upland - a.reach.upland || a.km - b.km)
  return candidates.slice(0, 10)
}

/** Upstream `from` down to `to`, or null if `to` is not downstream of `from`. */
function walk(from: Snap, to: Snap, reaches: Map<number, Reach>): Pt[] | null {
  const ids: number[] = []
  for (let id = from.reach.id; ; ) {
    ids.push(id)
    if (id === to.reach.id) break
    const r = reaches.get(id)
    if (!r || !reaches.has(r.next) || ids.length > 50000) return null
    id = r.next
  }
  if (ids.length === 1 && from.seg > to.seg) return null
  const out: Pt[] = [from.at]
  ids.forEach((id, k) => {
    const line = reaches.get(id)!.line
    const lo = k === 0 ? from.seg + 1 : 0
    const hi = k === ids.length - 1 ? to.seg : line.length - 1
    for (let i = lo; i <= hi; i++) out.push(line[i])
  })
  out.push(to.at)
  return out
}

export function riverPath(a: Pt, b: Pt): Pt[] {
  let path: Pt[] | null | undefined = null
  // A river can bow far outside the box its two ends make (the Danube runs down
  // to 43.6° N between the Tisza and the delta), so widen the search until the
  // walk connects.
  for (const margin of [0.6, 2, 4]) {
    const reaches = reachesNear(a, b, margin)
    // The largest pair of nearby reaches that one river actually joins: near a
    // mouth the biggest stream is not always the one the frontier follows.
    const pairs = snaps(a, reaches)
      .flatMap((sa) => snaps(b, reaches).map((sb) => [sa, sb] as const))
      .sort(([a1, b1], [a2, b2]) => Math.min(a2.reach.upland, b2.reach.upland) - Math.min(a1.reach.upland, b1.reach.upland))
    for (const [sa, sb] of pairs) {
      path = walk(sa, sb, reaches) ?? walk(sb, sa, reaches)?.reverse()
      if (path) break
    }
    if (path) break
  }
  if (!path) throw new Error(`[${a}] and [${b}] are not on one river`)
  // The authored vertices stay the ends, so neighbouring legs meet where the data says.
  return [a, ...simplify(path).slice(1, -1), b]
}

// --- crests --------------------------------------------------------------------

export async function crestPath(a: Pt, b: Pt): Promise<Pt[]> {
  const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))
  const m = Math.max(0.25, span * 0.2)
  const bbox = {
    west: Math.min(a[0], b[0]) - m,
    east: Math.max(a[0], b[0]) + m,
    south: Math.min(a[1], b[1]) - m,
    north: Math.max(a[1], b[1]) + m,
  }
  // The finest zoom that keeps the raster under ~2,500 px across: ~300–600 m pixels.
  let z = 9
  while (z > 5) {
    const [x0] = lonLatToPixel(z, bbox.west, bbox.north)
    const [x1] = lonLatToPixel(z, bbox.east, bbox.south)
    if (x1 - x0 < 2500) break
    z--
  }
  const dem = await readDem(bbox, z)
  let lo = Infinity
  let hi = -Infinity
  for (const h of dem.data) if (!isSea(h)) (lo = Math.min(lo, h)), (hi = Math.max(hi, h))
  const cost = new Float32Array(dem.data.length)
  for (let k = 0; k < cost.length; k++) {
    const h = dem.data[k]
    // Cubed depth below the box's highest ground: a ridge costs almost nothing, a
    // valley a great deal, so the path climbs to the crest and stays on it.
    cost[k] = isSea(h) ? 50 : ((hi - h) / (hi - lo)) ** 3 + 0.004
  }
  const px = (p: Pt) => {
    const [x, y] = lonLatToPixel(z, p[0], p[1])
    return Math.round(y - dem.y0) * dem.width + Math.round(x - dem.x0)
  }
  const path = leastCostPath(cost, dem.width, px(a), px(b), [0, 0, dem.width - 1, dem.height - 1])
  const pts = path.map((q): Pt => pixelToLonLat(z, dem.x0 + (q % dem.width) + 0.5, dem.y0 + Math.floor(q / dem.width) + 0.5))
  // Pixel staircases would survive a tight simplification; the crest is not known to better than ~1 km anyway.
  const kept = simplifyIndices(pts, 0.006).map((i) => pts[i])
  return [a, ...kept.slice(1, -1), b]
}
