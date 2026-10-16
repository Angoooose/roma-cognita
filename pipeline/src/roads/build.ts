/**
 * Roman roads from Itiner-e (static version 2024, CC BY 4.0; Zenodo
 * 10.5281/zenodo.17122148), dated segment by segment. Writes build/roads/.
 *
 *   npm run roads -w pipeline
 *
 * What to know about the source:
 *
 * - Its GeoJSON is EPSG:3395 — ellipsoidal World Mercator, metres — whatever the
 *   paper says; the file's own `crs` is right. Unprojected here (iterated latitude).
 * - It maps the network of ca. 150 CE. Only what it positively dates to the end of
 *   our window (27 BCE) is kept — see dating.ts. An undated road cannot take part in
 *   a time series: it can never arrive as the timeline moves, so drawing it faintly
 *   would put a constant on the map dressed as evidence. That leaves the Republican
 *   trunk network as historians name it, every line with a builder and a year.
 * - Iberia and Africa come out nearly empty. That is a gap in the source's
 *   attributions, not in history, and the legend should say so.
 *
 * Every segment keeps its first year, so at 68 BCE the map does not draw a road
 * built in 46.
 *
 * Where the sources show a road in use that Itiner-e leaves undated, or dates by a
 * later paving, data/road-corrections.yaml dates the line instead, and the build
 * says which lines it corrected.
 *
 * Output:
 * - roads.bin: u32 line count; per line u16 point count, i16 first year
 *   (astronomical), u8 class (0 main, 1 secondary), u8 certainty (0 certain,
 *   1 conjectured, 2 hypothetical), then f32 x, y per point in plane metres.
 * - roads.json: the same lines' names, builders and dates, in the same order.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_RECT, projection } from '@roma-cognita/world'
import { formatYear } from '@roma-cognita/schema'
import { loadDataset, ROOT_DIR, CACHE_DIR } from '../load.ts'
import { firstYear } from './dating.ts'

const SRC = join(CACHE_DIR, 'itinere/itinere_roads.geojson')
const URL_SRC = 'https://zenodo.org/records/17122148/files/itinere_roads.geojson?download=1'
const OUT = join(ROOT_DIR, 'build/roads')

/** The last year the map claims to show: the end of the window, 27 BCE. */
const CUTOFF = -26
/** Douglas–Peucker tolerance in plane metres: well under a pixel at the closest zoom. */
const TOLERANCE_M = 25

// --- EPSG:3395 inverse -----------------------------------------------------------
const A = 6378137
const F = 1 / 298.257223563
const E = Math.sqrt(F * (2 - F))
const xToLon = (x: number) => (x / A) * (180 / Math.PI)
function yToLat(y: number) {
  const t = Math.exp(-y / A)
  let phi = Math.PI / 2 - 2 * Math.atan(t)
  for (let i = 0; i < 10; i++) {
    const s = E * Math.sin(phi)
    const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (E / 2))
    if (Math.abs(next - phi) < 1e-12) return next * (180 / Math.PI)
    phi = next
  }
  return phi * (180 / Math.PI)
}

function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    let far = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
      const d = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2
      if (d > far) {
        far = d
        idx = i
      }
    }
    if (far > tol * tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

if (!existsSync(SRC)) throw new Error(`missing ${SRC}; download it from ${URL_SRC}`)
interface Props {
  Name: string | null
  Type: string
  Segment_s: string
  Cons_per_e: string | null
  Lower_Date: number | null
  Low_Date_E: number | null
  Shape_Leng: number | null
  Bibliograp: string | null
}
const fc = JSON.parse(readFileSync(SRC, 'utf8')) as {
  features: { properties: Props; geometry: { coordinates: number[][][] } }[]
}

/** The corrections to its dating, by line name (data/road-corrections.yaml). */
const corrections = new Map(loadDataset().roadCorrections.map((c) => [c.itinere, c]))
const corrected = new Map<string, number>()

interface Line {
  pts: [number, number][]
  from: number
  cls: number
  certainty: number
  meta: {
    name: string | null
    builder: string | null
    from: string
    type: string
    certainty: string
    bibliography: string | null
    /** The correction that dates it, when Itiner-e's own dating is not used. */
    corrected?: string
  }
}
const lines: Line[] = []
let undated = 0
let late = 0
const km: Record<string, number> = {}
for (const f of fc.features) {
  const p = f.properties
  const correction = p.Name ? corrections.get(p.Name) : undefined
  if (correction) corrected.set(correction.id, (corrected.get(correction.id) ?? 0) + 1)
  const from = correction ? correction.from.year : firstYear(p)
  if (from === null) {
    undated++
    continue
  }
  if (from > CUTOFF) {
    late++
    continue
  }
  const cls = p.Type === 'Main Road' ? 0 : 1
  const certainty = p.Segment_s === 'Certain' ? 0 : p.Segment_s === 'Hypothetical' ? 2 : 1
  for (const part of f.geometry.coordinates) {
    const plane = part.map(([x, y]) => projection.forward(xToLon(x), yToLat(y)))
    if (!plane.some(([x, y]) => x >= DATA_RECT.minX && x <= DATA_RECT.maxX && y >= DATA_RECT.minY && y <= DATA_RECT.maxY))
      continue
    const pts = simplify(plane, TOLERANCE_M)
    if (pts.length < 2) continue
    lines.push({
      pts,
      from,
      cls,
      certainty,
      meta: {
        name: p.Name,
        builder: p.Cons_per_e,
        from: formatYear(from),
        type: p.Type,
        certainty: p.Segment_s,
        bibliography: p.Bibliograp,
        ...(correction && { corrected: correction.id }),
      },
    })
  }
  const who = correction
    ? `corrected: ${correction.name}`
    : (p.Cons_per_e ?? `route attested ${formatYear(from)}`)
  km[who] = (km[who] ?? 0) + (p.Shape_Leng ?? 0) / 1000
}

let bytes = 4
for (const l of lines) bytes += 6 + l.pts.length * 8
const buf = Buffer.alloc(bytes)
let o = buf.writeUInt32LE(lines.length, 0)
for (const l of lines) {
  o = buf.writeUInt16LE(l.pts.length, o)
  o = buf.writeInt16LE(l.from, o)
  o = buf.writeUInt8(l.cls, o)
  o = buf.writeUInt8(l.certainty, o)
  for (const [x, y] of l.pts) {
    o = buf.writeFloatLE(x, o)
    o = buf.writeFloatLE(y, o)
  }
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'roads.bin'), buf)
writeFileSync(
  join(OUT, 'roads.json'),
  JSON.stringify({
    _comment:
      'Itiner-e static version 2024 (CC BY 4.0, doi:10.5281/zenodo.17122148), dated segments only. `lines[k]` describes line k of roads.bin; `from` is the first year it is drawn.',
    cutoff: CUTOFF,
    lines: lines.map((l) => l.meta),
  }),
)
const vertices = lines.reduce((n, l) => n + l.pts.length, 0)
console.log(
  `${lines.length} lines, ${vertices} vertices, ${(bytes / 1e3).toFixed(0)} KB; dropped ${undated} undated and ${late} built after ${formatYear(CUTOFF)}`,
)
for (const c of corrections.values()) {
  const n = corrected.get(c.id)
  if (!n)
    throw new Error(`road-corrections.yaml: no Itiner-e line "${c.itinere}" (${c.id})`)
  console.log(
    `  corrected: ${c.itinere} (${c.name}) from ${formatYear(c.from.year)}, ${n} segments`,
  )
}
console.log('by builder:')
for (const [who, k] of Object.entries(km).sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`  ${String(Math.round(k)).padStart(5)} km  ${who}`)
