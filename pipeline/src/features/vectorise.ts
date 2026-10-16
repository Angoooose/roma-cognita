/**
 * From a 0/1 mask on a DEM raster to sound RFC 7946 lon/lat polygons: marching
 * squares (d3-contour) on a lightly blurred mask, Douglas–Peucker in the equal-area
 * plane, specks dropped, windings asserted. Shared by the floodplain and the ancient
 * coast derivations.
 */
import { contours } from 'd3-contour'
import { projection } from '@roma-cognita/world'
import type { AreaGeometry } from '@roma-cognita/schema'
import { rewindRFC7946, ringProblems } from '../geo.ts'
import { type Raster, pixelToLonLat } from '../lib/dem.ts'
import { type Pt, blur, simplifyIndices } from '../lib/grid.ts'

export interface VectoriseOptions {
  /** Douglas–Peucker tolerance, metres. */
  simplifyM: number
  /** Rings smaller than this after simplifying are dropped: an exterior with its holes, or a hole alone. */
  minRingKm2: number
}

export function vectorise(mask: Uint8Array, dem: Raster, opts: VectoriseOptions): AreaGeometry {
  // Crop to the mask with a margin so the contour closes inside the grid.
  let i0 = dem.width
  let j0 = dem.height
  let i1 = -1
  let j1 = -1
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const i = p % dem.width
    const j = (p / dem.width) | 0
    i0 = Math.min(i0, i)
    i1 = Math.max(i1, i)
    j0 = Math.min(j0, j)
    j1 = Math.max(j1, j)
  }
  if (i1 < 0) throw new Error('empty mask')
  const pad = 2
  const w = i1 - i0 + 1 + 2 * pad
  const h = j1 - j0 + 1 + 2 * pad
  const values = new Float32Array(w * h)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) values[(j - j0 + pad) * w + (i - i0 + pad)] = mask[j * dem.width + i]
  const smooth = blur(values, w, h, 1)
  const [mp] = contours().size([w, h]).thresholds([0.5])(smooth as unknown as number[])
  const polys: Pt[][][] = []
  for (const poly of mp.coordinates as Pt[][][]) {
    const rings: Pt[][] = []
    for (const [ri, ring] of poly.entries()) {
      const ll = ring.map(([x, y]) => pixelToLonLat(dem.z, x + i0 - pad + dem.x0, y + j0 - pad + dem.y0))
      const s = simplifyRing(ll, opts.simplifyM)
      if (s.length < 4) continue
      const a = Math.abs(ringArea(s))
      if (ri === 0 && a < opts.minRingKm2) break // an exterior too small after simplifying: drop the polygon
      if (ri > 0 && a < opts.minRingKm2) continue
      rings.push(s)
    }
    if (rings.length) polys.push(rings)
  }
  const g = rewindRFC7946({ type: 'MultiPolygon', coordinates: polys } as AreaGeometry)
  const problems = ringProblems(g)
  if (problems.length) throw new Error(`vectorised geometry is unsound: ${JSON.stringify(problems.slice(0, 3))}`)
  return g
}

const round = (v: number) => Math.round(v * 1e5) / 1e5

function simplifyRing(ring: Pt[], tolerance: number): Pt[] {
  const planar = ring.map(([lon, lat]) => projection.forward(lon, lat) as Pt)
  const keep = simplifyIndices(planar, tolerance)
  const out: Pt[] = []
  for (const k of keep) {
    const p: Pt = [round(ring[k][0]), round(ring[k][1])]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0])
  return out
}

/** Signed area in km² in the equal-area plane. */
export function ringArea(ring: Pt[]): number {
  let s = 0
  const p = ring.map(([lon, lat]) => projection.forward(lon, lat))
  for (let k = 0; k + 1 < p.length; k++) s += p[k][0] * p[k + 1][1] - p[k + 1][0] * p[k][1]
  return s / 2 / 1e6
}

export function geometryArea(g: AreaGeometry): number {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let a = 0
  for (const poly of polys) poly.forEach((r, i) => (a += (i === 0 ? 1 : -1) * Math.abs(ringArea(r as Pt[]))))
  return a
}
