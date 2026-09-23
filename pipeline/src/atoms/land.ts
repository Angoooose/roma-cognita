/**
 * The land every atom outline is clipped to: Natural Earth 1:10m land plus its
 * minor islands (public domain), the coastline the migrated atoms were already
 * clipped to. It is coarser than the OSM coast the map draws, on purpose: the
 * political bake gives any sliver between the two coasts to the nearest atom
 * (politics/bake-worker.ts), so a ~1 km coast is all an outline needs, and it
 * keeps atoms.geojson small.
 *
 * Cut into square tiles as they are needed, so an outline is clipped against
 * the few tiles under it instead of against Eurasia's one enormous ring.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pc, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { readShp } from '../features/shp.ts'
import { simplifyIndices, type Pt } from '../features/grid.ts'
import { signedArea } from '../geo.ts'

const CACHE = join(import.meta.dirname, '../../../.cache/sources/natural-earth')
export const LAND_SOURCES = {
  land: { url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip', shp: 'land/ne_10m_land.shp' },
  minor: {
    url: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_minor_islands.zip',
    shp: 'minor/ne_10m_minor_islands.shp',
  },
}

/** Degrees. Tiles this size hold a few thousand coast points each. */
const TILE = 2
/** Coast simplification, degrees (~300 m): under the 431 m texel of the political field. */
const COAST_TOLERANCE = 0.003

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export class Land {
  private tiles = new Map<string, MultiPolygon | null>()
  private outers: Pt[][] = []
  private holes: Pt[][] = []

  constructor(bounds: Bounds) {
    for (const src of Object.values(LAND_SOURCES)) {
      const path = join(CACHE, src.shp)
      if (!existsSync(path)) throw new Error(`missing ${path} — download and unzip ${src.url} into ${CACHE}`)
      for (const rec of readShp(path, bounds))
        for (const ring of rec.parts) {
          const kept = simplifyIndices(ring, COAST_TOLERANCE).map((i) => ring[i])
          if (kept.length < 4) continue
          // Shapefile outers wind clockwise, holes (the Caspian, lakes) counter-clockwise.
          ;(signedArea(kept) < 0 ? this.outers : this.holes).push(kept)
        }
    }
  }

  /** The land in one tile, built the first time it is asked for. */
  private tile(x: number, y: number): MultiPolygon | null {
    const key = `${x},${y}`
    if (this.tiles.has(key)) return this.tiles.get(key)!
    const box = [x, y, x + TILE, y + TILE] as const
    // Sutherland–Hodgman first: it cuts Eurasia's one great ring down to the tile
    // in linear time, so polygon-clipping only ever sees a tile's worth of coast.
    const cut = (rings: Pt[][]) =>
      rings
        .filter((r) => overlapsBox(r, ...box))
        .map((r) => clipToBox(r, ...box))
        .filter((r) => r.length >= 4)
        .map((r): Polygon => [r])
    const o = cut(this.outers)
    let tile: MultiPolygon | null = null
    if (o.length) {
      tile = pc.union(o[0], ...o.slice(1))
      const h = cut(this.holes)
      if (h.length && tile.length) tile = pc.difference(tile, ...h)
      if (!tile.length) tile = null
    }
    this.tiles.set(key, tile)
    return tile
  }

  /** `shape` ∩ land. */
  clip(shape: MultiPolygon): MultiPolygon {
    const b = boundsOf(shape)
    const pieces: MultiPolygon[] = []
    for (let x = Math.floor(b.west / TILE) * TILE; x < b.east; x += TILE) {
      for (let y = Math.floor(b.south / TILE) * TILE; y < b.north; y += TILE) {
        const tile = this.tile(x, y)
        if (!tile) continue
        const piece = pc.intersection(shape, tile)
        if (piece.length) pieces.push(piece)
      }
    }
    if (!pieces.length) return []
    return pc.union(pieces[0], ...pieces.slice(1))
  }
}

/**
 * Sutherland–Hodgman against an axis-aligned box. A concave ring can come out
 * with edges doubled back along the box's side; polygon-clipping's union removes
 * them.
 */
function clipToBox(ring: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ]
  let pts = ring.slice(0, -1)
  for (const [inside, cross] of edges) {
    if (!pts.length) break
    const out: Pt[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]
      const b = pts[i]
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b))
        out.push(b)
      } else if (inside(a)) out.push(cross(a, b))
    }
    pts = out
  }
  return pts.length ? [...pts, pts[0]] : []
}

function overlapsBox(ring: Pt[], x0: number, y0: number, x1: number, y1: number) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of ring) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return e >= x0 && w <= x1 && n >= y0 && s <= y1
}

export function boundsOf(shape: MultiPolygon): Bounds {
  const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  for (const poly of shape)
    for (const [x, y] of poly[0]) {
      b.west = Math.min(b.west, x)
      b.east = Math.max(b.east, x)
      b.south = Math.min(b.south, y)
      b.north = Math.max(b.north, y)
    }
  return b
}
