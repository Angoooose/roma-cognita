/**
 * Fetches the outlines of Rome's monuments from OpenStreetMap into
 * data/geometry/rome.geojson (DESIGN.md §7.7).
 *
 * Which outlines is the records' business, not this file's: every place citing
 * `osm-rome` names its elements in the locator ("way/131451564, relation/1841081"),
 * and exactly those are fetched — so the citation and the shape can never disagree.
 * Ways are closed rings; a relation's outer and inner member ways are joined end to
 * end into rings. A street or road is lines instead: its ways, as they are. A node is
 * a location, not an outline: it is checked against the record's own and not
 * written.
 *
 * The output is lon/lat, RFC 7946 winding, one feature per place keyed by its id,
 * with the elements and the date it was fetched. Run it again to pick up OSM's
 * edits, and look at the diff.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AreaGeometry, LonLat } from '@roma-cognita/schema'
import { DATA_DIR, loadDataset } from '../load.ts'
import { distanceKm, rewindRFC7946 } from '../geo.ts'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
/** A record's location further than this from its outline's centre is worth a look. */
const NEAR_M = 80

type Kind = 'node' | 'way' | 'relation'
type Coords = [number, number][]

interface Element {
  type: Kind
  id: number
  lat?: number
  lon?: number
  geometry?: { lat: number; lon: number }[]
  members?: { type: Kind; role: string; geometry?: { lat: number; lon: number }[] }[]
}

const data = loadDataset()
const wanted = new Map<string, { type: Kind; id: number }[]>()
for (const p of data.places) {
  const refs = p.sources
    .filter((s) => s.source === 'osm-rome' && s.locator)
    .flatMap((s) => s.locator!.split(','))
    .map((l) => /^(node|way|relation)\/(\d+)$/.exec(l.trim()))
  if (!refs.length) continue
  if (refs.some((m) => !m)) throw new Error(`${p.id}: an osm-rome locator is not "way/123"`)
  wanted.set(
    p.id,
    refs.map((m) => ({ type: m![1] as Kind, id: Number(m![2]) })),
  )
}

const all = [...wanted.values()].flat()
const ids = (t: Kind) => all.filter((e) => e.type === t).map((e) => e.id)
const query = `[out:json][timeout:120];(${(['node', 'way', 'relation'] as const)
  .filter((t) => ids(t).length)
  .map((t) => `${t}(id:${ids(t).join(',')});`)
  .join('')});out geom;`
const elements: Element[] = (await overpass(query)).elements
const byKey = new Map(elements.map((e) => [`${e.type}/${e.id}`, e]))

/** The public server turns queries away when it is busy; it asks callers to back off. */
async function overpass(q: string, tries = 5): Promise<{ elements: Element[] }> {
  for (let i = 1; ; i++) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': 'roma-cognita pipeline (rome:fetch)' },
      body: new URLSearchParams({ data: q }),
    })
    const body = await res.text()
    if (res.ok && body.startsWith('{')) return JSON.parse(body)
    if (i === tries) throw new Error(`Overpass: ${res.status} ${body.slice(0, 400)}`)
    console.log(`Overpass busy (${res.status}), retrying in ${10 * i} s`)
    await new Promise((r) => setTimeout(r, 10_000 * i))
  }
}

const round = (v: number) => Math.round(v * 1e7) / 1e7
const coords = (g: { lat: number; lon: number }[]): Coords =>
  g.map((q) => [round(q.lon), round(q.lat)])
const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]

/** Joins ways end to end into closed rings; throws on anything left open. */
function rings(ways: Coords[], what: string): Coords[] {
  const open = ways.map((w) => [...w])
  const out: Coords[] = []
  while (open.length) {
    const ring = open.shift()!
    while (!same(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1]
      const k = open.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end))
      if (k < 0) throw new Error(`${what}: a ring does not close`)
      const [w] = open.splice(k, 1)
      ring.push(...(same(w[0], end) ? w : w.reverse()).slice(1))
    }
    out.push(ring)
  }
  return out
}

/** Whether ring `a` lies inside ring `b`, by its first vertex. */
function inside([x, y]: [number, number], ring: Coords) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** The area-weighted centre of some rings: a long, irregular outline's vertices are not. */
function centroid(outers: Coords[]): LonLat {
  // Relative to one vertex: on a shrine a few metres across, products of raw lon/lat
  // cancel away most of their precision.
  const [ox, oy] = outers[0][0]
  let a = 0
  let cx = 0
  let cy = 0
  for (const r of outers)
    for (let i = 0; i < r.length - 1; i++) {
      const [x0, y0] = [r[i][0] - ox, r[i][1] - oy]
      const [x1, y1] = [r[i + 1][0] - ox, r[i + 1][1] - oy]
      const k = x0 * y1 - x1 * y0
      a += k
      cx += (x0 + x1) * k
      cy += (y0 + y1) * k
    }
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

const features = []
const problems: string[] = []
const fetched = new Date().toISOString().slice(0, 10)
for (const [id, refs] of wanted) {
  const place = data.places.find((p) => p.id === id)!
  const polygons: Coords[][] = []
  const lines: Coords[] = []
  const linear = place.kind === 'street' || place.kind === 'road'
  for (const ref of refs) {
    const key = `${ref.type}/${ref.id}`
    const e = byKey.get(key)
    if (!e) {
      problems.push(`${id}: ${key} is not in OpenStreetMap`)
      continue
    }
    if (e.type === 'node') {
      const d = distanceKm(place.location, [e.lon!, e.lat!]) * 1000
      if (d > NEAR_M)
        problems.push(`${id}: ${key} is ${d.toFixed(0)} m from the record's location`)
      continue
    }
    if (e.type === 'way' && linear) {
      lines.push(coords(e.geometry!))
      continue
    }
    if (e.type === 'way') {
      const ring = coords(e.geometry!)
      if (!same(ring[0], ring[ring.length - 1])) {
        problems.push(`${id}: ${key} is not a closed outline`)
        continue
      }
      polygons.push([ring])
      continue
    }
    const members = (e.members ?? []).filter((m) => m.type === 'way' && m.geometry)
    const outer = rings(
      members.filter((m) => m.role !== 'inner').map((m) => coords(m.geometry!)),
      key,
    )
    const inner = rings(
      members.filter((m) => m.role === 'inner').map((m) => coords(m.geometry!)),
      key,
    )
    for (const o of outer) polygons.push([o, ...inner.filter((r) => inside(r[0], o))])
  }
  if (lines.length) {
    features.push({
      type: 'Feature',
      id,
      properties: { osm: refs.map((r) => `${r.type}/${r.id}`), fetched },
      geometry: { type: 'MultiLineString', coordinates: lines },
    })
    continue
  }
  if (!polygons.length) continue
  const geometry = rewindRFC7946<AreaGeometry>(
    polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons },
  )
  // The record's location is the monument's: it should sit on its outline.
  const d = distanceKm(place.location, centroid(polygons.map((p) => p[0]))) * 1000
  if (d > NEAR_M && place.kind !== 'city-wall' && place.kind !== 'river')
    problems.push(`${id}: its location is ${d.toFixed(0)} m from its outline's centre`)
  features.push({
    type: 'Feature',
    id,
    properties: { osm: refs.map((r) => `${r.type}/${r.id}`), fetched },
    geometry,
  })
}

const out = join(DATA_DIR, 'geometry/rome.geojson')
writeFileSync(
  out,
  JSON.stringify({ type: 'FeatureCollection', features }, null, 1).replace(
    /\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g,
    '[$1, $2]',
  ) + '\n',
)
console.log(`${features.length} outlines → ${out}`)
for (const p of problems) console.log(`  doubt: ${p}`)
