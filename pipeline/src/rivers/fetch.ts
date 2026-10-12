/**
 * Fetches the courses of the rivers surveyed from OpenStreetMap into
 * data/geometry/features.geojson, where the rivers build draws them in place of
 * HydroRIVERS' (build.ts).
 *
 * As with the outlines of Rome (rome/fetch.ts), which lines is the records' business:
 * every river in data/features.yaml citing `osm-waterways` names its ways in the
 * locator ("way/547426106"), and exactly those are fetched, joined end to end into
 * one course. Other features in the file are left as they are.
 *
 *   npm run rivers:fetch -w pipeline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, loadDataset } from '../load.ts'
import { overpass } from '../overpass.ts'

const OUT = join(DATA_DIR, 'geometry/features.geojson')

/**
 * Each line's mean discharge, m³/s, which sizes it on the map: HydroRIVERS' for the
 * reaches it replaces, so the river keeps the width it had.
 */
const DISCHARGE: Record<string, number> = {
  // DIS_AV_CMS 190 above the Aniene, 220 through Rome, 228 at the mouth.
  tiber: 220,
}

type Coords = [number, number][]

const data = loadDataset()
const wanted = new Map<string, number[]>()
for (const f of data.features) {
  if (f.kind !== 'river') continue
  const refs = f.sources
    .filter((s) => s.source === 'osm-waterways' && s.locator)
    .flatMap((s) => s.locator!.split(','))
    .map((l) => /^way\/(\d+)$/.exec(l.trim()))
  if (!refs.length) continue
  if (refs.some((m) => !m))
    throw new Error(`${f.id}: an osm-waterways locator is not "way/123"`)
  if (!DISCHARGE[f.id]) throw new Error(`${f.id}: no discharge to size its line by`)
  wanted.set(
    f.id,
    refs.map((m) => Number(m![1])),
  )
}

const ids = [...wanted.values()].flat()
const { elements } = await overpass(
  `[out:json][timeout:120];way(id:${ids.join(',')});out geom;`,
  'rivers:fetch',
)
const byId = new Map(elements.map((e) => [e.id, e]))

const round = (v: number) => Math.round(v * 1e7) / 1e7
const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]

/** Joins ways end to end, in the direction the first runs (downstream, as OSM draws rivers). */
function joinWays(ways: Coords[], what: string): Coords {
  const open = ways.map((w) => [...w])
  const line = open.shift()!
  while (open.length) {
    const k = open.findIndex(
      (w) =>
        same(w[0], line[line.length - 1]) ||
        same(w[w.length - 1], line[line.length - 1]) ||
        same(w[0], line[0]) ||
        same(w[w.length - 1], line[0]),
    )
    if (k < 0) throw new Error(`${what}: its ways do not join end to end`)
    const [w] = open.splice(k, 1)
    if (same(w[0], line[line.length - 1])) line.push(...w.slice(1))
    else if (same(w[w.length - 1], line[line.length - 1]))
      line.push(...w.reverse().slice(1))
    else if (same(w[w.length - 1], line[0])) line.unshift(...w.slice(0, -1))
    else line.unshift(...w.reverse().slice(0, -1))
  }
  return line
}

const fetched = new Date().toISOString().slice(0, 10)
const existing: { id: string }[] = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, 'utf8')).features
  : []
const features = new Map<string, unknown>(existing.map((f) => [f.id, f]))
for (const [id, ways] of wanted) {
  const lines = ways.map((w) => {
    const e = byId.get(w)
    if (!e?.geometry) throw new Error(`${id}: way/${w} is not in OpenStreetMap`)
    if (e.tags?.waterway !== 'river') throw new Error(`${id}: way/${w} is not a river`)
    return e.geometry.map((q) => [round(q.lon), round(q.lat)] as [number, number])
  })
  const line = joinWays(lines, id)
  features.set(id, {
    type: 'Feature',
    id,
    properties: {
      discharge: DISCHARGE[id],
      replacesModern: true,
      derivation: `rivers:fetch ${fetched}: OpenStreetMap ${ways.map((w) => `way/${w}`).join(', ')}`,
    },
    geometry: { type: 'LineString', coordinates: line },
  })
  console.log(
    `  ${id}: ${line.length} points from ${ways.length} way${ways.length > 1 ? 's' : ''}`,
  )
}
writeFileSync(
  OUT,
  `${JSON.stringify({ type: 'FeatureCollection', features: [...features.values()] })}\n`,
)
console.log(`${wanted.size} river courses → ${OUT}`)
