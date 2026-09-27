/**
 * npm run derive-coasts -w pipeline
 *
 * Derives the ancient water of data/geometry/landscape-changes.geojson: silted bays,
 * deltas that had not yet built out, and lakes drained since. Run offline whenever a
 * shore in coasts.ts changes; the output is committed and validated like any other
 * geometry, and the coast build (npm run water) applies it. The records that own
 * these shapes — dates, sources, confidence, reasoning — are in
 * data/landscape-changes.yaml.
 *
 * For each shore in coasts.ts:
 *
 *  1. Mosaic Mapterhorn terrain (Terrarium) over the hull's box.
 *  2. `sea`: flood from the modern sea through ground no higher than `maxHeight`,
 *     inside the hull. The hull's landward side is the ancient shore, authored from
 *     the cited reconstructions; the valley sides come from the terrain. So a gulf
 *     that has silted up is drawn as far as the sediment now stands low, and no
 *     further than the delta front stood in the map's window.
 *     `lake`: flood from a seed through ground below the lake's `level`, inside the
 *     hull — for lakes drained since, whose beds are now fields.
 *     `polygon`: the hull itself is the shape (ancient land where there is now sea,
 *     or a shore too uncertain for the terrain to add anything).
 *  3. Clean: majority smoothing, enclosed land under `minIslandKm2` drowned (towns
 *     and levees stand up on the surface model; real islands are rock), specks
 *     dropped.
 *  4. Vectorise (features/vectorise.ts) and write, keeping the other generators'
 *     shapes (shapes.ts).
 *
 * It prints the area of every shape and whether each check site fell where the
 * sources put it — on the water, on land, or on the shore. Previews go to
 * --preview <dir> (default COAST_PREVIEW_DIR, else none).
 *
 *   npm run derive-coasts -w pipeline               every shore
 *   npm run derive-coasts -w pipeline -- latmian    shores whose id contains it
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { projection } from '@roma-cognita/world'
import type { AreaGeometry } from '@roma-cognita/schema'
import { rewindRFC7946, ringProblems } from '../geo.ts'
import { type Bbox, type Raster, isSea, lonLatToPixel, pixelMetres, readDem } from '../features/dem.ts'
import { type Pt, blur, components, fillRings, nearestSeed } from '../features/grid.ts'
import { renderPreview } from '../features/preview.ts'
import { geometryArea, vectorise } from '../features/vectorise.ts'
import { SHORES, type Shore } from './coasts.ts'
import { type LandscapeShape, writeLandscapeShapes } from './shapes.ts'

const SIMPLIFY_M = 30
/** Water specks and islands smaller than this are dropped from the polygons outright. */
const MIN_RING_KM2 = 0.02
/** A check site this close to the shore counts as on it, km. */
const SHORE_KM = 1

const argv = process.argv.slice(2)
const previewFlag = argv.indexOf('--preview')
const PREVIEW_DIR = previewFlag >= 0 ? argv[previewFlag + 1] : process.env.COAST_PREVIEW_DIR
const filters = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--preview')

const doubts: string[] = []
const doubt = (s: string) => {
  doubts.push(s)
  console.log(`  DOUBT: ${s}`)
}

const bboxOf = (pts: Pt[], margin = 0): Bbox => ({
  west: Math.min(...pts.map((p) => p[0])) - margin,
  east: Math.max(...pts.map((p) => p[0])) + margin,
  south: Math.min(...pts.map((p) => p[1])) - margin,
  north: Math.max(...pts.map((p) => p[1])) + margin,
})

const toPx = (dem: Raster, [lon, lat]: Pt): Pt => {
  const [x, y] = lonLatToPixel(dem.z, lon, lat)
  return [x - dem.x0, y - dem.y0]
}

const rowAreas = (dem: Raster) =>
  Float64Array.from({ length: dem.height }, (_, j) => (pixelMetres(dem.z, dem.y0 + j + 0.5) / 1000) ** 2)

/** Flood from `seeds` through `open` pixels, 4-connected. */
function flood(open: Uint8Array, seeds: number[], width: number): Uint8Array {
  const out = new Uint8Array(open.length)
  const stack: number[] = []
  for (const s of seeds) if (open[s] && !out[s]) (out[s] = 1), stack.push(s)
  while (stack.length) {
    const p = stack.pop()!
    const i = p % width
    for (const q of [p - width, p + width, i > 0 ? p - 1 : -1, i < width - 1 ? p + 1 : -1]) {
      if (q >= 0 && q < open.length && open[q] && !out[q]) (out[q] = 1), stack.push(q)
    }
  }
  return out
}

/** Morphological opening by radius r px: erode, then dilate, by exact distance. */
function open(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const r2 = r * r
  const off: number[] = []
  for (let p = 0; p < mask.length; p++) if (!mask[p]) off.push(p)
  const d1 = nearestSeed(width, height, Int32Array.from(off)).dist2
  const core: number[] = []
  for (let p = 0; p < mask.length; p++) if (mask[p] && d1[p] > r2) core.push(p)
  const d2 = nearestSeed(width, height, Int32Array.from(core)).dist2
  return Uint8Array.from(mask, (v, p) => (v && d2[p] <= r2 ? 1 : 0))
}

function majority(mask: Uint8Array, dem: Raster): Uint8Array {
  const f = Float32Array.from(mask)
  const b = blur(f, dem.width, dem.height, 1)
  return Uint8Array.from(b, (v) => (v > 0.5 ? 1 : 0))
}

interface Result {
  shore: Shore
  geometry: AreaGeometry
  areaKm2: number
}

async function deriveShore(shore: Shore): Promise<Result> {
  console.log(`\n${shore.id} — ${shore.label}`)
  const hullRing = [...shore.hull, shore.hull[0]]
  if (shore.method.kind === 'polygon') {
    const geometry = rewindRFC7946({ type: 'Polygon', coordinates: [hullRing] } as AreaGeometry)
    const problems = ringProblems(geometry)
    if (problems.length) throw new Error(`${shore.id}: hull is unsound: ${JSON.stringify(problems)}`)
    const areaKm2 = geometryArea(geometry)
    console.log(`  polygon as authored: ${areaKm2.toFixed(1)} km²`)
    return { shore, geometry, areaKm2 }
  }

  const dem = await readDem(bboxOf(shore.hull, 0.03), shore.z, console.log)
  const { width, height } = dem
  const hull = new Uint8Array(width * height)
  fillRings(hull, width, height, [hullRing.map((p) => toPx(dem, p))])

  let water: Uint8Array
  const m = shore.method
  const reach = new Uint8Array(hull.length)
  const seeds: number[] = []
  if (m.kind === 'sea') {
    for (let p = 0; p < hull.length; p++) {
      if (!hull[p]) continue
      const h = dem.data[p]
      if (h <= m.maxHeight) reach[p] = 1
      if (isSea(h)) seeds.push(p)
    }
    if (!seeds.length) throw new Error(`${shore.id}: no modern sea inside the hull to flood from`)
  } else {
    for (let p = 0; p < hull.length; p++) if (hull[p] && dem.data[p] < m.level) reach[p] = 1
    const [x, y] = toPx(dem, m.seed)
    const seed = Math.floor(y) * width + Math.floor(x)
    if (!hull[seed]) throw new Error(`${shore.id}: the seed is outside the hull`)
    if (!reach[seed]) throw new Error(`${shore.id}: the seed stands ${dem.data[seed].toFixed(1)} m, above the lake level`)
    seeds.push(seed)
  }
  // Authored ancient land is closed to the flood before it starts.
  if (shore.land?.length) {
    const dry = new Uint8Array(hull.length)
    fillRings(dry, width, height, shore.land.map((r) => [...r, r[0]].map((p) => toPx(dem, p))))
    for (let p = 0; p < dry.length; p++) if (dry[p]) reach[p] = 0
  }
  water = flood(reach, seeds, width)
  if (shore.narrowestM) {
    // Modern drains and canals are cut below the old water level and would carry it
    // off across the country: take out every arm narrower than this, and keep only
    // what is still joined to where the flood began.
    const r = shore.narrowestM / 2 / pixelMetres(dem.z, dem.y0 + dem.height / 2)
    water = flood(open(water, width, height, r), seeds, width)
  }

  water = majority(water, dem)
  const rows = rowAreas(dem)
  const areaOf = (pixels: Int32Array) => {
    let a = 0
    for (const p of pixels) a += rows[(p / width) | 0]
    return a
  }
  let drowned = 0
  let islands = 0
  components(water, width, height, 0, (pixels, _n, edge) => {
    if (edge) return
    if (areaOf(pixels) < shore.minIslandKm2) {
      for (const p of pixels) water[p] = 1
      drowned++
    } else islands++
  })
  components(water, width, height, 1, (pixels) => {
    if (areaOf(pixels) < MIN_RING_KM2) for (const p of pixels) water[p] = 0
  })
  console.log(`  ${drowned} rises under ${shore.minIslandKm2} km² drowned, ${islands} islands kept`)

  const geometry = vectorise(water, dem, { simplifyM: SIMPLIFY_M, minRingKm2: MIN_RING_KM2 })
  // What the shape adds to the map is the water that is land today: report that, not the sea it overlaps.
  let addedKm2 = 0
  for (let p = 0; p < water.length; p++) if (water[p] && !isSea(dem.data[p])) addedKm2 += rows[(p / width) | 0]
  const areaKm2 = geometryArea(geometry)
  console.log(
    `  ${m.kind === 'sea' ? `ground ≤ ${m.maxHeight} m reached from the sea` : `ground < ${m.level} m reached from the seed`}: ${addedKm2.toFixed(0)} km² of water that is land today (${areaKm2.toFixed(0)} km² with the sea it overlaps)`,
  )
  if (shore.expectKm2) {
    const [lo, hi] = shore.expectKm2.range
    const verdict = addedKm2 < lo ? 'BELOW' : addedKm2 > hi ? 'ABOVE' : 'within'
    console.log(`    vs ${shore.expectKm2.label}: ${lo}–${hi} km² → ${verdict}`)
    if (verdict !== 'within') doubt(`${shore.id}: ${addedKm2.toFixed(0)} km² is ${verdict} ${shore.expectKm2.label}`)
  }

  // --- check sites ---
  const polys = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as Pt[][][]
  const verdicts = shore.sites.map((s) => {
    const wet = polys.some(([outer, ...holes]) => inRing(s.at, outer) && !holes.some((r) => inRing(s.at, r)))
    const dist = Math.min(...polys.flatMap((poly) => poly.map((r) => distToRing(s.at, r))))
    const got = dist <= SHORE_KM ? 'shore' : wet ? 'water' : 'land'
    const ok = got === s.expect || (s.expect === 'shore' && dist <= 2 * SHORE_KM)
    const [x, y] = toPx(dem, s.at)
    const h = dem.data[Math.floor(y) * width + Math.floor(x)]
    const line = `${s.name}: ${wet ? 'in the water' : 'on land'}, ${dist.toFixed(1)} km from the shore; ground ${h.toFixed(0)} m (expected ${s.expect})`
    console.log(`    site ${ok ? '  ' : '✗ '}${line}`)
    if (!ok) doubt(`${shore.id}: ${line}`)
    return { name: s.name, at: s.at, verdict: ok ? '✓' : `✗ ${got}` }
  })

  if (PREVIEW_DIR) {
    mkdirSync(PREVIEW_DIR, { recursive: true })
    const file = join(PREVIEW_DIR, `${shore.id}.png`)
    await renderPreview(
      dem,
      shore.view ?? bboxOf(shore.hull, 0.02),
      {
        polygons: polys,
        hull: hullRing,
        channels: [],
        sites: verdicts,
        caption: [shore.label, `${addedKm2.toFixed(0)} km² of water that is land today`],
        fill: '#2f6fbf',
      },
      file,
    )
    console.log(`  preview ${file}`)
  }
  return { shore, geometry, areaKm2 }
}

function inRing([x, y]: Pt, ring: Pt[]): boolean {
  let hit = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) hit = !hit
  }
  return hit
}

function distToRing(p: Pt, ring: Pt[]): number {
  const [px, py] = projection.forward(p[0], p[1])
  let best = Infinity
  const q = ring.map(([lon, lat]) => projection.forward(lon, lat))
  for (let k = 0; k + 1 < q.length; k++) {
    const [ax, ay] = q[k]
    const [bx, by] = q[k + 1]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy))
  }
  return best / 1000
}

async function main() {
  const selected = SHORES.filter((s) => !filters.length || filters.some((f) => s.id.includes(f)))
  const results: Result[] = []
  for (const shore of selected) results.push(await deriveShore(shore))
  const stamp = new Date().toISOString().slice(0, 10)
  const surfaceOf = (s: Shore) => s.surface ?? (s.method.kind === 'polygon' ? undefined : s.method.kind)
  const features: LandscapeShape[] = results.map(({ shore, geometry }) => ({
    type: 'Feature',
    id: shore.id,
    properties: {
      ...(surfaceOf(shore) && { surface: surfaceOf(shore) }),
      derivation:
        shore.method.kind === 'polygon'
          ? `derive-coasts ${stamp}: authored polygon (pipeline/src/landscape/coasts.ts)`
          : `derive-coasts ${stamp}: ${shore.method.kind === 'sea' ? `ground ≤ ${shore.method.maxHeight} m reached from the sea` : `ground < ${shore.method.level} m reached from the lake bed`} inside the authored shore, Mapterhorn z${shore.z}, simplified ${SIMPLIFY_M} m`,
    },
    geometry,
  }))
  writeLandscapeShapes(features)
  console.log(`\n${doubts.length ? `${doubts.length} doubts:\n  ${doubts.join('\n  ')}` : 'no doubts'}`)
}

await main()
