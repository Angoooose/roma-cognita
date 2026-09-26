/**
 * Bakes the river network: HydroRIVERS reaches, projected, simplified, smoothed and
 * split into tiers by discharge so the overview loads only the great rivers.
 *
 * Source: HydroRIVERS v1.0 (HydroSHEDS licence; free for non-commercial and commercial
 * use), Europe, Africa and Asia regions. Each reach carries its long-term mean discharge
 * (DIS_AV_CMS), which is what sizes it on the map: width follows discharge, as it
 * does on the ground, so the Nile and the Danube outrank every tributary without a
 * ranking having to be invented.
 *
 * These are modern courses derived from a 15″ DEM. Where Roman courses differed — the
 * Nile's seven delta branches, the Po, the Euphrates at Babylon, the Maeander into the
 * Latmian Gulf — the difference belongs in `landscape-change` records, not here.
 *
 * Output: build/rivers/{tier}/{i}/{j}.bin — each tier cut into quadtree tiles at its
 * own level so the finer tiers load only where the camera is — plus index.json listing
 * the tiles that exist. The format is in `encodeTile`.
 *
 *   npm run rivers -w pipeline
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shapefile from 'shapefile'
import { DATA_RECT, ROOT, projection } from '@roma-cognita/world'
import { RingIndex } from '../water/ring-index.ts'
import { BBOX, SOURCES, ensureUnzipped, keepLake, lakeArea, projectRing, readRings } from '../water/sources.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CACHE = join(ROOT_DIR, '.cache/sources')
const OUT = join(ROOT_DIR, 'build/rivers')
const REGIONS = ['eu', 'af', 'as']

/**
 * Discharge floors (m³/s), simplification tolerances (m) and tile levels per tier. Tier 0
 * is the great rivers, which show at every zoom, so it keeps full detail like the rest —
 * simplifying it for the overview left the Tiber angular at regional zoom. Tier 2 is
 * only fetched once the camera is close enough for a 1 m³/s stream to be worth a line.
 */
const TIERS = [
  { minQ: 100, tolerance: 60, level: 2, smoothing: 2 },
  { minQ: 10, tolerance: 200, level: 3, smoothing: 2 },
  { minQ: 1, tolerance: 60, level: 5, smoothing: 2 },
]

interface Line {
  q: number
  pts: [number, number][]
  /** Our interpolation between attested sites, not a channel on the ground: drawn fainter. */
  reconstructed?: boolean
}

/** Features whose area has its river network authored: modern reaches inside them are dropped. */
const AUTHORED_NETWORKS = ['nile-delta-floodplain']

/** Lakes this big swallow the reaches that cross them; smaller ones the river runs over. */
const LAKE_KM2 = 1

async function main() {
  const t0 = Date.now()
  console.log('reading HydroLAKES (to cut reaches that cross lakes)…')
  const lakes = await readRings(ensureUnzipped(CACHE, SOURCES.lakes.zip), keepLake, lakeArea)
  const lakeIndex = new RingIndex(lakes.rings.filter((r) => r.areaKm2 >= LAKE_KM2))
  // Where authored ancient courses replace the modern network, the modern channels are
  // dropped: HydroRIVERS' Rosetta and Damietta would otherwise draw beside the
  // Bolbitine and Phatnitic that follow them, and cut across the reconstructed branches.
  const replacedIndex = new RingIndex(readAreas(AUTHORED_NETWORKS))

  // tier → tile key → lines
  const tiers = TIERS.map(() => new Map<string, Line[]>())
  let reaches = 0
  let kept = 0
  let inLakes = 0
  let replaced = 0
  for (const region of REGIONS) {
    const dir = join(CACHE, `HydroRIVERS_v10_${region}_shp`)
    if (!existsSync(dir)) throw new Error(`missing ${dir}: download and unzip HydroRIVERS_v10_${region}_shp.zip`)
    const source = await shapefile.open(findShp(dir), findShp(dir).replace(/\.shp$/, '.dbf'))
    for (;;) {
      const { done, value } = await source.read()
      if (done) break
      reaches++
      const q = Number((value.properties as Record<string, unknown>).DIS_AV_CMS)
      if (!(q >= TIERS[TIERS.length - 1].minQ)) continue
      const g = value.geometry
      if (g.type !== 'LineString') continue
      const coords = g.coordinates as number[][]
      if (!coords.some(([lon, lat]) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north)) continue

      const xy = coords.map(([lon, lat]) => projection.forward(lon, lat))
      if (!xy.some(([x, y]) => x >= DATA_RECT.minX && x <= DATA_RECT.maxX && y >= DATA_RECT.minY && y <= DATA_RECT.maxY)) continue
      const tier = TIERS.findIndex((t) => q >= t.minQ)
      const { tolerance, level, smoothing } = TIERS[tier]
      const line = chaikin(simplify(xy, tolerance), smoothing)
      // Split the reach wherever it crosses a lake, keeping the runs on land.
      let run: [number, number][] = []
      const flush = () => {
        if (run.length >= 2) {
          const [mx, my] = run[Math.floor(run.length / 2)]
          const size = ROOT.size / 2 ** level
          const key = `${Math.floor((mx - ROOT.x) / size)}/${Math.floor((my - ROOT.y) / size)}`
          let list = tiers[tier].get(key)
          if (!list) tiers[tier].set(key, (list = []))
          list.push({ q, pts: run })
        }
        run = []
      }
      for (let k = 0; k + 1 < line.length; k++) {
        const [ax, ay] = line[k]
        const [bx, by] = line[k + 1]
        if (lakeIndex.contains((ax + bx) / 2, (ay + by) / 2)) {
          inLakes++
          flush()
          continue
        }
        if (replacedIndex.contains((ax + bx) / 2, (ay + by) / 2)) {
          replaced++
          flush()
          continue
        }
        if (run.length === 0) run.push(line[k])
        run.push(line[k + 1])
      }
      flush()
      kept++
    }
    console.log(`  ${region}: ${reaches} reaches read so far, ${kept} kept`)
  }

  // Authored river courses from data/ — the ancient Nile delta branches first. They
  // go through the same smoothing and tiling as HydroRIVERS, sized by the discharge
  // their records estimate for display.
  const authored = readAuthoredRivers()
  for (const { id, q, coords, reconstructed } of authored) {
    const tier = TIERS.findIndex((t) => q >= t.minQ)
    if (tier < 0) continue
    const { level, smoothing } = TIERS[tier]
    const xy = coords.map(([lon, lat]) => projection.forward(lon, lat))
    const line = chaikin(xy, smoothing)
    const [mx, my] = line[Math.floor(line.length / 2)]
    const size = ROOT.size / 2 ** level
    const key = `${Math.floor((mx - ROOT.x) / size)}/${Math.floor((my - ROOT.y) / size)}`
    let list = tiers[tier].get(key)
    if (!list) tiers[tier].set(key, (list = []))
    list.push({ q, pts: line, reconstructed })
    console.log(`  authored: ${id} (${q} m³/s, ${coords.length} points${reconstructed ? ', reconstructed' : ''})`)
  }

  mkdirSync(OUT, { recursive: true })
  const index = {
    _comment:
      'River tiers, each cut into quadtree tiles at its own level; tiles lists [i, j] of the files that exist. Tile format: see encodeTile in pipeline/src/rivers/build.ts. Source: HydroRIVERS v1.0 (HydroSHEDS licence).',
    tiers: TIERS.map((t, i) => ({
      minQ: t.minQ,
      maxQ: i === 0 ? null : TIERS[i - 1].minQ,
      level: t.level,
      tiles: [...tiers[i].keys()].map((k) => k.split('/').map(Number)),
    })),
  }
  tiers.forEach((tiles, t) => {
    let bytes = 0
    let segments = 0
    for (const [key, lines] of tiles) {
      const [i, j] = key.split('/').map(Number)
      const buf = encodeTile(lines, TIERS[t].level, i, j)
      const file = join(OUT, `${t}/${key}.bin`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, buf)
      bytes += buf.length
      for (const l of lines) segments += l.pts.length - 1
    }
    console.log(
      `tier ${t} (Q ≥ ${TIERS[t].minQ}): ${segments} segments in ${tiles.size} tiles, ${(bytes / 1e6).toFixed(1)} MB`,
    )
  })
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`${replaced} modern segments replaced by authored networks`)
  console.log(`${inLakes} segments dropped inside lakes ≥ ${LAKE_KM2} km²; done in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

/**
 * One tile, little-endian:
 *   u32 line count
 *   per line: u16 point count, u16 discharge code, then points as i16 x, i16 y
 * Points are relative to the tile centre in units of (tile size × 1.5) / 32767, so a
 * reach that starts in the tile may run half a tile past its edge. That is ~5 m at
 * level 5 and ~40 m at level 3, well under a line's width. The discharge word holds a
 * log code in its low 14 bits, q = 10^(code / 2048 − 1) (0.1 to 10⁷ m³/s), and in its
 * top bit whether the course is reconstructed.
 */
function encodeTile(lines: Line[], level: number, i: number, j: number): Buffer {
  const size = ROOT.size / 2 ** level
  const cx = ROOT.x + (i + 0.5) * size
  const cy = ROOT.y + (j + 0.5) * size
  const unit = (size * 1.5) / 32767
  let bytes = 4
  for (const l of lines) bytes += 4 + l.pts.length * 4
  const buf = Buffer.alloc(bytes)
  let o = buf.writeUInt32LE(lines.length, 0)
  for (const l of lines) {
    o = buf.writeUInt16LE(l.pts.length, o)
    const code = Math.max(0, Math.min(16383, Math.round((Math.log10(l.q) + 1) * 2048)))
    o = buf.writeUInt16LE(code | (l.reconstructed ? 0x8000 : 0), o)
    for (const [x, y] of l.pts) {
      o = buf.writeInt16LE(clamp16((x - cx) / unit), o)
      o = buf.writeInt16LE(clamp16((y - cy) / unit), o)
    }
  }
  return buf
}

function clamp16(v: number) {
  return Math.max(-32767, Math.min(32767, Math.round(v)))
}

/**
 * `kind: river` features with LineString geometry in data/geometry/features.geojson.
 * `properties.discharge` (m³/s) is a display estimate the record documents; without
 * it a branch draws as a middling river.
 */
function readAuthoredRivers(): { id: string; q: number; coords: number[][]; reconstructed: boolean }[] {
  const recordsFile = join(ROOT_DIR, 'data/features.yaml')
  const geometryFile = join(ROOT_DIR, 'data/geometry/features.geojson')
  if (!existsSync(recordsFile) || !existsSync(geometryFile)) return []
  const records = (parseYaml(readFileSync(recordsFile, 'utf8')) ?? []) as { id: string; kind: string }[]
  const ids = new Set(records.filter((r) => r.kind === 'river').map((r) => r.id))
  const collection = JSON.parse(readFileSync(geometryFile, 'utf8')) as {
    features: {
      id: string
      properties?: { discharge?: number; reconstructed?: boolean[] }
      geometry: { type: string; coordinates: number[][] | number[][][] }
    }[]
  }
  const out: { id: string; q: number; coords: number[][]; reconstructed: boolean }[] = []
  for (const f of collection.features) {
    if (!ids.has(f.id)) continue
    const q = f.properties?.discharge ?? 100
    const lines =
      f.geometry.type === 'LineString'
        ? [f.geometry.coordinates as number[][]]
        : f.geometry.type === 'MultiLineString'
          ? (f.geometry.coordinates as number[][][])
          : []
    lines.forEach((coords, k) =>
      out.push({ id: f.id, q, coords, reconstructed: f.properties?.reconstructed?.[k] ?? false }),
    )
  }
  return out
}

/** Area features from data/geometry/features.geojson, projected, by id. */
function readAreas(ids: string[]) {
  const file = join(ROOT_DIR, 'data/geometry/features.geojson')
  if (!existsSync(file)) return []
  const collection = JSON.parse(readFileSync(file, 'utf8')) as {
    features: { id: string; geometry: { type: string; coordinates: unknown } }[]
  }
  const rings = []
  let polygon = 0
  for (const f of collection.features) {
    if (!ids.includes(f.id)) continue
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as number[][][]]
        : f.geometry.type === 'MultiPolygon'
          ? (f.geometry.coordinates as number[][][][])
          : []
    for (const poly of polys) {
      const id = polygon++
      for (const ring of poly) rings.push(projectRing(ring, id, Infinity))
    }
  }
  return rings
}

function findShp(dir: string): string {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const hit = findShp(p)
      if (hit) return hit
    } else if (e.name.endsWith('.shp')) return p
  }
  return ''
}

/** Douglas–Peucker, iterative, in plane metres. Endpoints always survive, so reaches still meet. */
function simplify(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  const t2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    let worst = -1
    let worstD = t2
    for (let k = a + 1; k < b; k++) {
      const [px, py] = pts[k]
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const ex = ax + t * dx - px
      const ey = ay + t * dy - py
      const d = ex * ex + ey * ey
      if (d > worstD) {
        worstD = d
        worst = k
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return pts.filter((_, k) => keep[k])
}

/**
 * Chaikin corner cutting. HydroRIVERS is traced on a 15″ grid, so its courses step in
 * ~450 m stairs that read as pixel art at regional zoom; two passes round them into
 * the curves a river actually makes. Endpoints are kept so reaches still join.
 */
function chaikin(pts: [number, number][], passes: number): [number, number][] {
  let out = pts
  for (let p = 0; p < passes && out.length > 2; p++) {
    const next: [number, number][] = [out[0]]
    for (let k = 0; k + 1 < out.length; k++) {
      const [ax, ay] = out[k]
      const [bx, by] = out[k + 1]
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by])
    }
    next.push(out[out.length - 1])
    out = next
  }
  return out
}

await main()
