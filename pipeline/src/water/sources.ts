/**
 * The two vector sources behind the coast mask, read once and projected into the plane.
 *
 * - OSM land polygons (ODbL), split edition: the modern coastline at full OSM detail,
 *   pre-cut into pieces a degree or so across, which is what lets a tile find its
 *   handful of rings without scanning the world.
 * - HydroLAKES v1.0 (CC BY 4.0): every lake over 10 ha, typed. Reservoirs (type 2) are
 *   dropped on purpose — Lake Nasser, Atatürk and Assad are twentieth-century, and a
 *   map of the Republic that floods the Euphrates valley is wrong at a glance. Lakes
 *   that are dammed natural lakes (type 3) stay.
 *
 * Both ship as zipped shapefiles; they are unzipped into .cache once.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as shapefile from 'shapefile'
import { DATA_RECT, projection } from '@roman-map/world'
import type { Ring } from './raster.ts'

export const SOURCES = {
  land: {
    url: 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip',
    zip: 'land-polygons-split-4326.zip',
    licence: 'ODbL 1.0, © OpenStreetMap contributors',
  },
  lakes: {
    url: 'https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip',
    zip: 'HydroLAKES_polys_v10_shp.zip',
    licence: 'CC BY 4.0, Messager et al. 2016',
  },
}

/**
 * Lakes smaller than this are never drawn. Each level then applies its own, larger
 * floor (see `minLakeKm2` in build.ts), so ponds only arrive when they are big enough
 * on screen to read as lakes rather than as noise.
 */
const MIN_LAKE_KM2 = 0.1
const HYDROLAKES_RESERVOIR = 2

/**
 * The lon/lat box that covers the whole plane rectangle the map draws. Not the frame
 * box plus a margin: on a conic, the rectangle's corners reach well past the meridians
 * and parallels of the box it was built from, and land read only from the smaller box
 * left the north-east corner — the steppe east of the Caspian — as open sea.
 */
export const BBOX = (() => {
  const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
  const steps = 128
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const { minX, minY, maxX, maxY } = DATA_RECT
    for (const [x, y] of [
      [minX + (maxX - minX) * t, minY],
      [minX + (maxX - minX) * t, maxY],
      [minX, minY + (maxY - minY) * t],
      [maxX, minY + (maxY - minY) * t],
    ]) {
      const [lon, lat] = projection.inverse(x, y)
      b.west = Math.min(b.west, lon)
      b.east = Math.max(b.east, lon)
      b.south = Math.min(b.south, lat)
      b.north = Math.max(b.north, lat)
    }
  }
  // A little slack for rings that cross the edge.
  return { west: b.west - 0.5, east: b.east + 0.5, south: b.south - 0.5, north: b.north + 0.5 }
})()

export function ensureUnzipped(cacheDir: string, zip: string) {
  const dir = join(cacheDir, zip.replace(/\.zip$/, ''))
  if (!existsSync(dir)) {
    const src = join(cacheDir, zip)
    if (!existsSync(src)) {
      throw new Error(`missing ${src} — download it first (see SOURCES in water/sources.ts)`)
    }
    mkdirSync(dir, { recursive: true })
    execFileSync('unzip', ['-q', '-o', src, '-d', dir])
  }
  return dir
}

function findShp(dir: string): string {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findShp(p)
      if (hit) return hit
    } else if (entry.name.endsWith('.shp')) return p
  }
  return ''
}

export interface ReadStats {
  features: number
  kept: number
  rings: number
  points: number
  dropped: Record<string, number>
}

/**
 * Reads polygons that overlap the data box, projects every ring, and returns them flat —
 * holes included, since the fill is even-odd and never needs to know which is which.
 */
export async function readRings(
  dir: string,
  keep: (props: Record<string, unknown> | null) => string | null,
  areaOf: (props: Record<string, unknown> | null) => number = () => Infinity,
): Promise<{ rings: Ring[]; stats: ReadStats }> {
  const shp = findShp(dir)
  const dbf = shp.replace(/\.shp$/, '.dbf')
  const source = await shapefile.open(shp, existsSync(dbf) ? dbf : undefined)
  const rings: Ring[] = []
  let polygonId = 0
  const stats: ReadStats = { features: 0, kept: 0, rings: 0, points: 0, dropped: {} }
  for (;;) {
    const { done, value } = await source.read()
    if (done) break
    stats.features++
    const g = value.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue
    if (!overlapsBbox(value.bbox ?? bboxOf(g))) continue
    const reason = keep(value.properties as Record<string, unknown> | null)
    if (reason) {
      stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1
      continue
    }
    stats.kept++
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    const areaKm2 = areaOf(value.properties as Record<string, unknown> | null)
    for (const poly of polys) {
      const id = polygonId++
      for (const ring of poly) {
        rings.push(projectRing(ring, id, areaKm2))
        stats.rings++
        stats.points += ring.length
      }
    }
  }
  return { rings, stats }
}

export const keepLand = () => null

export const lakeArea = (props: Record<string, unknown> | null) => Number(props?.Lake_area)

export function keepLake(props: Record<string, unknown> | null): string | null {
  if (!props) return 'no attributes'
  if (Number(props.Lake_type) === HYDROLAKES_RESERVOIR) return 'reservoir (modern)'
  if (Number(props.Lake_area) < MIN_LAKE_KM2) return `under ${MIN_LAKE_KM2} km²`
  return null
}

function overlapsBbox(b: number[]) {
  return !(b[2] < BBOX.west || b[0] > BBOX.east || b[3] < BBOX.south || b[1] > BBOX.north)
}

function bboxOf(g: { coordinates: unknown }): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c: unknown) => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as number[]
      b[0] = Math.min(b[0], x)
      b[1] = Math.min(b[1], y)
      b[2] = Math.max(b[2], x)
      b[3] = Math.max(b[3], y)
    } else for (const k of c as unknown[]) walk(k)
  }
  walk(g.coordinates)
  return b
}

/**
 * Segments longer than this (degrees) are subdivided before projecting. A parallel is
 * an arc in Albers, so a long east–west segment projected by its endpoints alone cuts
 * the corner: a 1° chord sags ~220 m from the true line, a 0.01° chord ~2 cm. OSM's
 * split pieces are bounded by whole-degree cuts, and lakes and coasts have long
 * straight runs too.
 */
const MAX_SEGMENT_DEG = 0.01

export function projectRing(ring: number[][], polygon: number, areaKm2: number): Ring {
  const pts: number[] = []
  for (let k = 0; k < ring.length; k++) {
    const [lon, lat] = ring[k]
    pts.push(lon, lat)
    const next = ring[k + 1]
    if (!next) break
    const steps = Math.ceil(Math.max(Math.abs(next[0] - lon), Math.abs(next[1] - lat)) / MAX_SEGMENT_DEG)
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      pts.push(lon + (next[0] - lon) * t, lat + (next[1] - lat) * t)
    }
  }
  const n = pts.length / 2
  const xy = new Float64Array(n * 2)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let k = 0; k < n; k++) {
    const [x, y] = projection.forward(pts[k * 2], pts[k * 2 + 1])
    xy[k * 2] = x
    xy[k * 2 + 1] = y
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { xy, minX, minY, maxX, maxY, polygon, areaKm2 }
}
