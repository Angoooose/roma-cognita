/**
 * Builds data/geometry/atoms.geojson from the `construction` of every atom in
 * data/atoms.yaml (DESIGN §5.6):
 *
 * 1. Each part becomes a shape: an `outline` is its frontier resolved leg by leg
 *    (legs.ts: straight, along a river, along a crest, or a curve); a `box` is a
 *    rectangle round an island.
 * 2. The parts are unioned and clipped to land (land.ts), so a coast is always the
 *    coastline and only the inland frontier is authored.
 * 3. Every atom earlier in atoms.yaml is cut out. A frontier two atoms share is
 *    authored once, by the earlier atom; the later one is drawn to overlap it.
 *    This is what makes the atoms tile without gaps or overlaps.
 *
 * It also checks every vertex that names a Pleiades place against the Pleiades
 * dump, when the dump is in .cache, and prints each atom's area.
 *
 *   npm run atoms -w pipeline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pc, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Atom } from '@roma-cognita/schema'
import { DATA_DIR, readDataset } from '../load.ts'
import { rewindRFC7946 } from '../geo.ts'
import { Land, boundsOf, type Bounds } from './land.ts'
import { km, resolveEdge, vertexOf } from './legs.ts'
import type { Pt } from '../features/grid.ts'

const OUT = join(DATA_DIR, 'geometry/atoms.geojson')
const PLEIADES = join(import.meta.dirname, '../../../.cache/sources/pleiades/pleiades-places-latest.csv')
/** Pieces smaller than this (deg², ~0.1 km²) are slivers of the difference, not ground. */
const MIN_PIECE = 1e-5
/** A vertex that names a Pleiades place should stand within this of it. */
const PLEIADES_KM = 6

async function shapeOf(atom: Atom): Promise<MultiPolygon> {
  const parts: Polygon[] = []
  for (const part of atom.construction) {
    if (part.method === 'box') {
      const [w, s, e, n] = part.bbox
      parts.push([[[w, s], [e, s], [e, n], [w, n], [w, s]]])
    } else {
      parts.push([await resolveEdge(part.edge, atom.id)])
    }
  }
  // A union of one also repairs a ring that crosses itself where two legs meet.
  return pc.union(parts[0], ...parts.slice(1))
}

const areaOf = (ring: Pt[]) => {
  let s = 0
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(s / 2)
}
const polygonArea = (p: Polygon) => areaOf(p[0] as Pt[]) - p.slice(1).reduce((a, h) => a + areaOf(h as Pt[]), 0)

/** Rough km² of a lon/lat multipolygon: each polygon scaled at its own latitude. */
function km2(shape: MultiPolygon) {
  return shape.reduce((sum, p) => {
    const lat = (boundsOf([p]).south + boundsOf([p]).north) / 2
    return sum + polygonArea(p) * 111.32 * Math.cos((lat * Math.PI) / 180) * 110.57
  }, 0)
}

const round = (shape: MultiPolygon): MultiPolygon =>
  shape.map((poly) =>
    poly.map((ring) => {
      const out: Pt[] = []
      for (const [x, y] of ring) {
        const p: Pt = [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]
        const last = out[out.length - 1]
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
      }
      return out
    }),
  )

const touches = (a: Bounds, b: Bounds) => a.east >= b.west && a.west <= b.east && a.north >= b.south && a.south <= b.north

function readPleiades(): Map<string, Pt> | null {
  if (!existsSync(PLEIADES)) return null
  const text = readFileSync(PLEIADES, 'utf8')
  const out = new Map<string, Pt>()
  let header: string[] | null = null
  // A minimal CSV reader: quoted fields may hold commas, quotes and newlines.
  let row: string[] = []
  let field = ''
  let quoted = false
  const endRow = () => {
    row.push(field)
    field = ''
    if (!header) header = row
    else {
      const get = (k: string) => row[header!.indexOf(k)]
      const lon = Number(get('reprLong'))
      const lat = Number(get('reprLat'))
      if (get('reprLat') && Number.isFinite(lon) && Number.isFinite(lat)) out.set(get('id'), [lon, lat])
    }
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field || row.length) endRow()
  return out
}

async function main() {
  const t0 = Date.now()
  const { dataset, issues } = readDataset(DATA_DIR)
  const fatal = issues.filter((i) => i.level === 'error' && i.rule !== 'missing-geometry' && i.rule !== 'orphan-geometry')
  if (fatal.length) {
    for (const i of fatal) console.error(`${i.where}: ${i.message}`)
    throw new Error('atoms.yaml does not load')
  }

  const pleiades = readPleiades()
  if (!pleiades) console.warn('no Pleiades dump in .cache; vertex places not checked')

  const shapes: { atom: Atom; raw: MultiPolygon }[] = []
  for (const atom of dataset.atoms) shapes.push({ atom, raw: await shapeOf(atom) })

  const all = shapes.map((s) => boundsOf(s.raw))
  const bounds = {
    west: Math.min(...all.map((b) => b.west)),
    south: Math.min(...all.map((b) => b.south)),
    east: Math.max(...all.map((b) => b.east)),
    north: Math.max(...all.map((b) => b.north)),
  }
  const land = new Land(bounds)
  console.log(`land ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  const taken: { id: string; shape: MultiPolygon; bounds: Bounds }[] = []
  const features: object[] = []
  let far = 0
  for (const { atom, raw } of shapes) {
    let shape = land.clip(raw)
    const b = boundsOf(shape.length ? shape : raw)
    const earlier = taken.filter((t) => touches(t.bounds, b)).map((t) => t.shape)
    if (earlier.length && shape.length) shape = pc.difference(shape, ...earlier)
    shape = round(shape.filter((p) => polygonArea(p) >= MIN_PIECE))
    // Rounding can pinch a ring; one more pass leaves it valid.
    if (shape.length) shape = pc.union(shape)
    if (!shape.length) throw new Error(`${atom.id}: nothing left after clipping to land and to earlier atoms`)
    taken.push({ id: atom.id, shape, bounds: boundsOf(shape) })
    features.push({
      type: 'Feature',
      id: atom.id,
      properties: {},
      geometry: rewindRFC7946({ type: 'MultiPolygon', coordinates: shape }),
    })

    const places: string[] = []
    for (const part of atom.construction) {
      if (part.method !== 'outline') continue
      for (const v of part.edge.map(vertexOf)) {
        if (!v.pleiades || !pleiades) continue
        const p = pleiades.get(v.pleiades)
        if (!p) places.push(`pleiades:${v.pleiades} (${v.note ?? ''}) is not in the dump`)
        else if (km(p, v.at) > PLEIADES_KM) {
          places.push(`${v.note ?? v.pleiades} is ${km(p, v.at).toFixed(0)} km from pleiades:${v.pleiades} [${p}]`)
          far++
        }
      }
    }
    console.log(`${atom.id.padEnd(26)} ${String(Math.round(km2(shape))).padStart(9)} km²  ${shape.length} piece(s)`)
    for (const s of places) console.log(`    ! ${s}`)
  }

  writeFileSync(
    OUT,
    `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`,
  )
  console.log(`wrote ${features.length} atoms in ${((Date.now() - t0) / 1000).toFixed(0)} s${far ? `; ${far} vertices far from their Pleiades place` : ''}`)
}

await main()
