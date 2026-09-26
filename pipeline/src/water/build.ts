/**
 * Bakes the coast mask: a pyramid of signed-distance tiles on the terrain quadtree.
 *
 * One texel holds the distance to the nearest shore, positive on land, clamped to
 * DISTANCE_TEXELS texels either way and quantised to 8 bits. From that one field the
 * shader gets a crisp, antialiased coast at any zoom (the edge is where the field
 * crosses zero, found to a fraction of a texel), the shallow-water band and shore foam
 * — and land below sea level stops being drawn as sea, because the mask, not height,
 * now decides what is water (DESIGN.md §7.2).
 *
 * Tiles are addressed exactly like terrain nodes and share their texel grid, so a
 * terrain tile at level ≤ MAX_LEVEL reads its own mask tile and deeper ones read a
 * window of their MAX_LEVEL ancestor. Tiles with no shore within the clamp distance
 * are not written at all; index.json says whether each is all land or all water.
 *
 *   npm run water -w pipeline
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  DATA_RECT,
  PACK_LEVEL,
  ROOT,
  TILE_TEXELS,
  packOf,
  tileRect,
  writePack,
  type TileAddress,
} from '@roma-cognita/world'
import type { BakeJob, BakeResult } from './bake-worker.ts'
import { edgesTouch, inside, type Ring } from './raster.ts'
import { RingIndex } from './ring-index.ts'
import { SOURCES, ensureUnzipped, keepLake, keepLand, lakeArea, projectRing, readRings } from './sources.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CACHE = join(ROOT_DIR, '.cache/sources')
const OUT = join(ROOT_DIR, 'build/water')

/**
 * Deepest baked level: 27 m texels, with the shore placed to a quarter of that by the
 * supersampling. Terrain goes one level deeper (13.5 m) and samples a window of it; at
 * 2× a distance field still draws a clean edge. Level 8 (108 m) was the limit before,
 * and at full zoom it rounded every harbour mole and spit into a blob.
 */
const MAX_LEVEL = 10
/**
 * Deepest level whose tile codes go in index.json. Deeper grids would make the index
 * megabytes; below it, a tile is written or not, and the pack head says which. An
 * unwritten deep tile has no shore within reach, so its ancestor's field is right there.
 */
const CODE_LEVEL = 8
/** Clamp distance, in texels of the tile's own level. */
const DISTANCE_TEXELS = 16
/** Samples per texel side when rasterising, so the shore lands between texel centres. */
const SUPERSAMPLE = 4

/** 3 is land wholly inside a floodplain; the engine reads it like 1 plus a full second channel. */
const Code = { Water: 0, Land: 1, Mixed: 2, Floodplain: 3 } as const

/**
 * The smallest lake a level draws: about 3×3 of its texels. Below that a lake is a
 * speck, and across the steppe — thousands of small, largely modern ponds — specks
 * read as noise rather than as water. 108 m texels at level 8 give 0.1 km², the
 * source floor; level 5 (863 m) needs 6.7 km².
 */
function minLakeKm2(level: number) {
  const texelKm = ROOT.size / (TILE_TEXELS - 1) / 2 ** level / 1000
  return (3 * texelKm) ** 2
}

/**
 * Floodplain polygons from data/: every `kind: floodplain` feature with geometry in
 * data/geometry/features.geojson. Read directly rather than through the dataset loader
 * so the coast build does not depend on the rest of the data validating.
 */
function readFloodplains(): Ring[] {
  const recordsFile = join(ROOT_DIR, 'data/features.yaml')
  const geometryFile = join(ROOT_DIR, 'data/geometry/features.geojson')
  if (!existsSync(recordsFile) || !existsSync(geometryFile)) return []
  const records = (parseYaml(readFileSync(recordsFile, 'utf8')) ?? []) as { id: string; kind: string }[]
  const ids = new Set(records.filter((r) => r.kind === 'floodplain').map((r) => r.id))
  const collection = JSON.parse(readFileSync(geometryFile, 'utf8')) as {
    features: { id: string; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[]
  }
  const rings: Ring[] = []
  let polygon = 0
  for (const f of collection.features) {
    if (!ids.has(f.id)) continue
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

/**
 * `remove-water` and `add-water` records from data/landscape-changes.yaml that apply to
 * the map's window, with geometry from data/geometry/landscape-changes.geojson. Read
 * directly, like the floodplains. v1 bakes one landscape for 133–27 BCE, so every
 * correction that applies at any point in the window is applied; per-year variants
 * come when a correction ends inside it (the Latmian Gulf silting, for one).
 */
function readLandscapeChanges(): { removeWater: Ring[]; addWater: Ring[] } {
  const recordsFile = join(ROOT_DIR, 'data/landscape-changes.yaml')
  const geometryFile = join(ROOT_DIR, 'data/geometry/landscape-changes.geojson')
  const out = { removeWater: [] as Ring[], addWater: [] as Ring[] }
  if (!existsSync(recordsFile) || !existsSync(geometryFile)) return out
  const records = (parseYaml(readFileSync(recordsFile, 'utf8')) ?? []) as { id: string; op: string }[]
  const ops = new Map(records.map((r) => [r.id, r.op]))
  const collection = JSON.parse(readFileSync(geometryFile, 'utf8')) as {
    features: { id: string; geometry: { type: string; coordinates: unknown } }[]
  }
  let polygon = 0
  for (const f of collection.features) {
    const op = ops.get(f.id)
    const target = op === 'remove-water' ? out.removeWater : op === 'add-water' ? out.addWater : null
    if (!target) continue
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as number[][][]]
        : f.geometry.type === 'MultiPolygon'
          ? (f.geometry.coordinates as number[][][][])
          : []
    for (const poly of polys) {
      const id = polygon++
      for (const ring of poly) target.push(projectRing(ring, id, Infinity))
    }
  }
  return out
}

async function main() {
  const t0 = Date.now()
  console.log('reading OSM land polygons…')
  const land = await readRings(ensureUnzipped(CACHE, SOURCES.land.zip), keepLand)
  console.log(`  ${land.stats.kept} pieces, ${land.stats.rings} rings, ${fmt(land.stats.points)} points`)
  console.log('reading HydroLAKES…')
  const lakes = await readRings(ensureUnzipped(CACHE, SOURCES.lakes.zip), keepLake, lakeArea)
  console.log(`  ${lakes.stats.kept} lakes, ${fmt(lakes.stats.points)} points; dropped`, lakes.stats.dropped)
  console.log(`  read in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

  const floodplains = readFloodplains()
  console.log(`  ${floodplains.length} floodplain rings from data/`)
  const changes = readLandscapeChanges()
  console.log(
    `  landscape changes: ${changes.removeWater.length} remove-water rings, ${changes.addWater.length} add-water rings`,
  )
  const removeIndex = new RingIndex(changes.removeWater)
  const addIndex = new RingIndex(changes.addWater)

  const landIndex = new RingIndex(land.rings)
  const lakeIndex = new RingIndex(lakes.rings)
  const floodplainIndex = new RingIndex(floodplains)

  rmSync(OUT, { recursive: true, force: true })
  const pool = new BakePool(Math.max(1, availableParallelism() - 2))
  /** Tiles at or below PACK_LEVEL, grouped by pack; written once every level is done. */
  const packs = new Map<string, { address: TileAddress; bytes: Uint8Array }[]>()
  const writes: Promise<void>[] = []
  const codes: Uint8Array[] = []
  let written = 0
  let bytes = 0
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const n = 2 ** level
    const grid = new Uint8Array(n * n).fill(Code.Water)
    const parent = codes[level - 1]
    let mixed = 0
    const tl = Date.now()
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const { x0, y0, size } = tileRect({ level, i, j })
        if (x0 > DATA_RECT.maxX || x0 + size < DATA_RECT.minX) continue
        if (y0 > DATA_RECT.maxY || y0 + size < DATA_RECT.minY) continue
        const step = size / (TILE_TEXELS - 1)
        const m = (DISTANCE_TEXELS + 1) * step
        const rect = [x0 - m, y0 - m, x0 + size + m, y0 + size + m] as const
        const minArea = minLakeKm2(level)
        const lakesHere = () => lakeIndex.query(...rect).filter((r) => r.areaKm2 >= minArea)
        const floodplainsHere = floodplainIndex.query(...rect)
        // A uniform parent has uniform children, with one exception: lakes too small
        // for the parent's level can appear in its children, so an all-land parent only
        // settles a child that no lake at the child's level reaches. (Floodplain edges
        // are the same at every level, so a uniform parent already had none.)
        if (parent) {
          const p = parent[(j >> 1) * (n >> 1) + (i >> 1)]
          if (p === Code.Water || (p !== Code.Mixed && !edgesTouch(lakesHere(), ...rect))) {
            grid[j * n + i] = p
            continue
          }
        }
        const landRings = landIndex.query(...rect)
        const lakeRings = lakesHere()
        const removeHere = removeIndex.query(...rect)
        const addHere = addIndex.query(...rect)
        if (
          !edgesTouch(landRings, ...rect) &&
          !edgesTouch(lakeRings, ...rect) &&
          !edgesTouch(floodplainsHere, ...rect) &&
          !edgesTouch(removeHere, ...rect) &&
          !edgesTouch(addHere, ...rect)
        ) {
          const cx = x0 + size / 2
          const cy = y0 + size / 2
          const modern = inside(landRings, cx, cy) && !inside(lakeRings, cx, cy)
          const isLand = (modern || inside(removeHere, cx, cy)) && !inside(addHere, cx, cy)
          grid[j * n + i] = !isLand
            ? Code.Water
            : inside(floodplainsHere, cx, cy)
              ? Code.Floodplain
              : Code.Land
          continue
        }
        grid[j * n + i] = Code.Mixed
        mixed++
        const job = {
          x0,
          y0,
          step,
          land: landRings,
          lakes: lakeRings,
          floodplains: floodplainsHere,
          removeWater: removeHere,
          addWater: addHere,
          distanceTexels: DISTANCE_TEXELS,
          supersample: SUPERSAMPLE,
        }
        writes.push(
          pool.bake(job).then((img) => {
            written++
            bytes += img.length
            if (level < PACK_LEVEL) {
              const file = join(OUT, `${level}/${i}/${j}.webp`)
              mkdirSync(dirname(file), { recursive: true })
              writeFileSync(file, img)
              return
            }
            const p = packOf({ level, i, j })
            const key = `${p.i}/${p.j}`
            let list = packs.get(key)
            if (!list) packs.set(key, (list = []))
            list.push({ address: { level, i, j }, bytes: img })
          }),
        )
        // Keep the queue short: each queued job holds a copy of its rings.
        while (pool.backlog > 64) await new Promise((r) => setTimeout(r, 20))
      }
    }
    codes.push(grid)
    await Promise.all(writes)
    console.log(
      `level ${level}: ${mixed} shore tiles, ${((Date.now() - tl) / 1000).toFixed(1)} s, total ${fmt(bytes)} B`,
    )
  }
  await pool.close()

  let largest = 0
  for (const [key, tiles] of packs) {
    const [pi, pj] = key.split('/')
    const file = join(OUT, `pack/${pi}/${pj}.pack`)
    mkdirSync(dirname(file), { recursive: true })
    tiles.sort(
      (a, b) =>
        a.address.level - b.address.level || a.address.j - b.address.j || a.address.i - b.address.i,
    )
    const pack = writePack(tiles)
    largest = Math.max(largest, pack.length)
    writeFileSync(file, pack)
  }
  console.log(`${packs.size} packs, largest ${fmt(largest)} B`)

  const index = {
    _comment:
      'Coast mask tiles. codes[level] (levels 0 to codeLevel) is base64 of a 2^level × 2^level byte grid, row j north from the root, column i east: 0 all water, 1 all land, 2 shore or floodplain edge (tile written), 3 all land inside a floodplain. Below codeLevel a tile is written only if it has shore; the pack head lists which. Tiles above packLevel are {level}/{i}/{j}.webp; the rest are in pack/{i}/{j}.pack of their packLevel ancestor (packages/world/src/pack.ts). Channel 0 is the shore, channel 1 the floodplain edge; texel value v decodes to metres as (v / 255 * 2 - 1) * distanceTexels * texelSize, positive inside (land, floodplain).',
    texels: TILE_TEXELS,
    maxLevel: MAX_LEVEL,
    codeLevel: CODE_LEVEL,
    packLevel: PACK_LEVEL,
    distanceTexels: DISTANCE_TEXELS,
    sources: [SOURCES.land.licence, SOURCES.lakes.licence],
    codes: codes.slice(0, CODE_LEVEL + 1).map((c) => Buffer.from(c).toString('base64')),
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`wrote ${written} tiles, ${fmt(bytes)} B, in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

/**
 * A fixed pool of bake workers. Jobs queue when every worker is busy, so the main
 * thread can keep classifying tiles while the pool works through the shore ones.
 */
class BakePool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private waiting: [BakeJob, (r: Uint8Array) => void, (e: Error) => void][] = []
  private pending = new Map<number, [(r: Uint8Array) => void, (e: Error) => void]>()
  private nextId = 1

  constructor(size: number) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./bake-worker.ts', import.meta.url))
      w.on('message', (r: BakeResult) => {
        this.pending.get(r.id)![0](r.image)
        this.pending.delete(r.id)
        this.release(w)
      })
      w.on('error', (e) => {
        for (const [, reject] of this.pending.values()) reject(e)
      })
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  get backlog() {
    return this.waiting.length
  }

  bake(job: Omit<BakeJob, 'id'>): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const full = { ...job, id: this.nextId++ }
      const w = this.idle.pop()
      if (w) this.send(w, full, resolve, reject)
      else this.waiting.push([full, resolve, reject])
    })
  }

  private send(w: Worker, job: BakeJob, resolve: (r: Uint8Array) => void, reject: (e: Error) => void) {
    this.pending.set(job.id, [resolve, reject])
    w.postMessage(job)
  }

  private release(w: Worker) {
    const next = this.waiting.shift()
    if (next) this.send(w, ...next)
    else this.idle.push(w)
  }

  close() {
    return Promise.all(this.workers.map((w) => w.terminate()))
  }
}

function fmt(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${n}`
}

await main()
