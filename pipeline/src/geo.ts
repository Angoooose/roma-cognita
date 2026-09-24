/**
 * The little planar geometry the validator and the builds need.
 *
 * Ring winding is owned here, once, because it is easy to lose an afternoon to:
 * polygon-clipping emits RFC 7946 rings (exteriors counter-clockwise), d3-geo
 * reads the opposite, and a ring handed over the wrong way round means "the
 * whole sphere except this shape" — every province filled the plate. So the
 * rule is: **everything under data/geometry is RFC 7946**, the pipeline rewinds
 * at ingest and the validator asserts it, and any consumer that wants another
 * convention converts at its own boundary and says so.
 *
 * Winding is judged by the shoelace sum on raw lon/lat. That is not an area on
 * the sphere, but its sign is the ring's orientation, which is all this needs,
 * for any ring that does not cross the antimeridian — none in this frame do.
 */
import pc from 'polygon-clipping'
import type { AreaGeometry, LonLat } from '@roman-map/schema'

type Ring = number[][]
type Polys = Ring[][]

/** Positive for counter-clockwise, negative for clockwise (lon east, lat north). */
export function signedArea(ring: Ring): number {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return s / 2
}

export const polygonsOf = (g: AreaGeometry): Polys =>
  g.type === 'Polygon' ? [g.coordinates] : g.coordinates

/** RFC 7946 §3.1.6: exteriors counter-clockwise, holes clockwise. */
export function rewindRFC7946<G extends AreaGeometry>(g: G): G {
  const wind = (poly: Ring[]) =>
    poly.map((ring, i) => {
      const ccw = signedArea(ring) > 0
      return ccw === (i === 0) ? ring : [...ring].reverse()
    })
  return (
    g.type === 'Polygon'
      ? { ...g, coordinates: wind(g.coordinates) }
      : { ...g, coordinates: g.coordinates.map(wind) }
  ) as G
}

export interface RingProblem {
  polygon: number
  ring: number
  problem: string
}

/** Everything wrong with a geometry's rings, as a list; empty means sound. */
export function ringProblems(g: AreaGeometry): RingProblem[] {
  const out: RingProblem[] = []
  polygonsOf(g).forEach((poly, p) =>
    poly.forEach((ring, r) => {
      const at = { polygon: p, ring: r }
      if (ring.length < 4) out.push({ ...at, problem: `only ${ring.length} positions` })
      const [a, b] = [ring[0], ring[ring.length - 1]]
      if (a[0] !== b[0] || a[1] !== b[1]) out.push({ ...at, problem: 'not closed' })
      const bad = ring.find(([x, y]) => !(x >= -180 && x <= 180 && y >= -90 && y <= 90))
      if (bad) {
        out.push({
          ...at,
          problem: `position [${bad}] is not lon/lat — projected coordinates?`,
        })
        return
      }
      const area = signedArea(ring)
      if (area === 0) out.push({ ...at, problem: 'zero area' })
      else if (area > 0 !== (r === 0)) {
        out.push({
          ...at,
          problem: r === 0 ? 'exterior is clockwise' : 'hole is counter-clockwise',
        })
      }
    }),
  )
  return out
}

/** Even–odd ray casting against one ring. */
function inRing([x, y]: LonLat, ring: Ring): boolean {
  let hit = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) hit = !hit
  }
  return hit
}

export const contains = (g: AreaGeometry, pt: LonLat) =>
  polygonsOf(g).some(
    ([outer, ...holes]) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h)),
  )

/** Great-circle distance in kilometres, for reporting how far a position moved. */
export function distanceKm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Approximate km² that two area geometries share (each polygon scaled at its mean latitude). */
export function overlapArea(a: AreaGeometry, b: AreaGeometry): number {
  const [pa, pb] = [polygonsOf(a), polygonsOf(b)]
  const box = (ps: Polys) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const p of ps) for (const [x, y] of p[0]) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y))
    return { w, s, e, n }
  }
  const [ba, bb] = [box(pa), box(pb)]
  if (ba.e < bb.w || bb.e < ba.w || ba.n < bb.s || bb.n < ba.s) return 0
  const shared = pc.intersection(pa as pc.MultiPolygon, pb as pc.MultiPolygon)
  let km2 = 0
  for (const poly of shared) {
    const lat = poly[0].reduce((t, p) => t + p[1], 0) / poly[0].length
    const deg2 = poly.reduce((t, ring, i) => t + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0)
    km2 += deg2 * 111.32 * Math.cos((lat * Math.PI) / 180) * 110.57
  }
  return km2
}
