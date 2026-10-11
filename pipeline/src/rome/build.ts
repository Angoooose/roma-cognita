/**
 * Bakes the model of Rome (DESIGN.md §7.7): `npm run rome -w pipeline`.
 *
 * Reads the records in data/places/rome.yaml and their shapes in
 * data/geometry/rome.geojson — monuments' outlines, the river's water, streets' and
 * roads' lines — and hands them to the plate (plate.ts: the board the model stands on
 * and its names) and the model (model.ts: the buildings). Writes build/rome/plan.json:
 * the plate's grid, and each monument's and garden's outline and years for picking.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pc, { type Polygon } from 'polygon-clipping'
import { projection } from '@roma-cognita/world'
import { DATA_DIR, loadDataset } from '../load.ts'
import { bakePlate } from './plate.ts'

const OUT = resolve(import.meta.dirname, '../../../build/rome')

type Ring = [number, number][]

const data = loadDataset()
const places = new Map(data.places.map((p) => [p.id, p]))
const geo = JSON.parse(readFileSync(join(DATA_DIR, 'geometry/rome.geojson'), 'utf8'))

/** Monuments' outlines in plane metres: polygons of rings, outer first. */
const outlines: { id: string; polys: Ring[][] }[] = []
/** The river is water on the plate, not a monument. */
const river: [number, number][][][] = []
/**
 * Gardens, groves and the burial ground are ground on the plate (fields.ts), not
 * buildings. Their outlines are drawn by hand (rome-grounds.geojson), since
 * rome.geojson is OpenStreetMap's and rewritten by each fetch.
 */
const grounds = new Map<string, Ring[][]>()
const GROUND_KINDS = new Set(['garden', 'grove', 'cemetery'])
for (const f of JSON.parse(
  readFileSync(join(DATA_DIR, 'geometry/rome-grounds.geojson'), 'utf8'),
).features) {
  const p = places.get(f.id)
  if (!p || !GROUND_KINDS.has(p.kind))
    throw new Error(`rome-grounds.geojson: no garden, grove or cemetery "${f.id}"`)
  const raw: [number, number][][][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  grounds.set(
    f.id,
    raw.map((poly) => poly.map((r) => r.map(([lon, lat]) => projection.forward(lon, lat)))),
  )
}
/** Streets and roads are lines on the plate, by id. */
const streets = new Map<string, [number, number][][]>()
for (const f of geo.features) {
  if (!places.has(f.id)) throw new Error(`rome.geojson: no place "${f.id}"`)
  if (f.geometry.type === 'MultiLineString') {
    streets.set(f.id, f.geometry.coordinates)
    continue
  }
  const raw: [number, number][][][] =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  if (places.get(f.id)!.kind === 'river') {
    // OpenStreetMap maps the Tiber's water in pieces laid end to end: joined into one,
    // so no seam between them draws as a bank across the river.
    river.push(...pc.union(raw[0] as Polygon, ...(raw.slice(1) as Polygon[])))
    continue
  }
  outlines.push({
    id: f.id,
    polys: raw.map((poly) =>
      poly.map((r) => r.map(([lon, lat]) => projection.forward(lon, lat))),
    ),
  })
}

mkdirSync(OUT, { recursive: true })
const { drawn, ...plate } = await bakePlate(
  OUT,
  river,
  streets,
  places,
  outlines.map((o) => ({ id: o.id, kind: places.get(o.id)!.kind, polys: o.polys })),
  grounds,
)
const tenth = (v: number) => Math.round(v * 10) / 10
writeFileSync(
  join(OUT, 'plan.json'),
  JSON.stringify({
    _comment:
      'The plan of Rome: the plate’s grid (plate-<n>.png, ground.png), and each monument’s outline (plane metres) and years (astronomical, inclusive) for picking.',
    plate,
    outlines: [
      ...outlines.map((o) => ({ id: o.id, polys: o.polys })),
      ...[...grounds].map(([id, polys]) => ({ id, polys })),
      // Monuments with no surveyed outline are picked by the footprint the model drew.
      ...drawn.map((p) => ({ id: p.id, polys: [[p.ring]] })),
    ].map((o) => {
      const p = places.get(o.id)!
      return {
        id: o.id,
        years: [p.from.year, p.to.year],
        rings: o.polys.map((poly) =>
          poly.map((r) => r.map(([x, y]) => [tenth(x), tenth(y)])),
        ),
      }
    }),
  }),
)
console.log(`${outlines.length} outlines, ${streets.size} streets and roads → ${OUT}`)
