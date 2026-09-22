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
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { DATA_RECT, ROOT, TILE_TEXELS, tileRect } from '@roman-map/world'
import type { BakeJob, BakeResult } from './bake-worker.ts'
import { edgesTouch, inside, type Ring } from './raster.ts'
import { SOURCES, ensureUnzipped, keepLake, keepLand, lakeArea, readRings } from './sources.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CACHE = join(ROOT_DIR, '.cache/sources')
const OUT = join(ROOT_DIR, 'build/water')

/** Deepest baked level: 108 m texels. Deeper terrain samples a window of it. */
const MAX_LEVEL = 8
/** Clamp distance, in texels of the tile's own level. */
const DISTANCE_TEXELS = 16
/** Samples per texel side when rasterising, so the shore lands between texel centres. */
const SUPERSAMPLE = 4

const Code = { Water: 0, Land: 1, Mixed: 2 } as const

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

/** Rings bucketed on a coarse grid so a tile only looks at rings near it. */
class RingIndex {
  private cells = new Map<number, Ring[]>()
  private readonly n = 64
  private readonly cell = ROOT.size / this.n

  constructor(rings: Ring[]) {
    for (const r of rings) {
      const [c0, r0] = this.cellOf(r.minX, r.minY)
      const [c1, r1] = this.cellOf(r.maxX, r.maxY)
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const k = row * this.n + col
          let list = this.cells.get(k)
          if (!list) this.cells.set(k, (list = []))
          list.push(r)
        }
      }
    }
  }

  private cellOf(x: number, y: number): [number, number] {
    const c = Math.floor((x - ROOT.x) / this.cell)
    const r = Math.floor((y - ROOT.y) / this.cell)
    return [Math.max(0, Math.min(this.n - 1, c)), Math.max(0, Math.min(this.n - 1, r))]
  }

  query(minX: number, minY: number, maxX: number, maxY: number): Ring[] {
    const [c0, r0] = this.cellOf(minX, minY)
    const [c1, r1] = this.cellOf(maxX, maxY)
    const seen = new Set<Ring>()
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (const r of this.cells.get(row * this.n + col) ?? []) {
          if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) continue
          seen.add(r)
        }
      }
    }
    return [...seen]
  }
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

  const landIndex = new RingIndex(land.rings)
  const lakeIndex = new RingIndex(lakes.rings)

  const pool = new BakePool(Math.max(1, availableParallelism() - 2))
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
        // A uniform parent has uniform children, with one exception: lakes too small
        // for the parent's level can appear in its children, so an all-land parent only
        // settles a child that no lake at the child's level reaches.
        if (parent) {
          const p = parent[(j >> 1) * (n >> 1) + (i >> 1)]
          if (p === Code.Water || (p === Code.Land && !edgesTouch(lakesHere(), ...rect))) {
            grid[j * n + i] = p
            continue
          }
        }
        const landRings = landIndex.query(...rect)
        const lakeRings = lakesHere()
        if (!edgesTouch(landRings, ...rect) && !edgesTouch(lakeRings, ...rect)) {
          const cx = x0 + size / 2
          const cy = y0 + size / 2
          const isLand = inside(landRings, cx, cy) && !inside(lakeRings, cx, cy)
          grid[j * n + i] = isLand ? Code.Land : Code.Water
          continue
        }
        grid[j * n + i] = Code.Mixed
        mixed++
        const file = join(OUT, `${level}/${i}/${j}.webp`)
        const job = {
          x0,
          y0,
          step,
          land: landRings,
          lakes: lakeRings,
          distanceTexels: DISTANCE_TEXELS,
          supersample: SUPERSAMPLE,
        }
        writes.push(
          pool.bake(job).then((img) => {
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, img)
            written++
            bytes += img.length
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

  const index = {
    _comment:
      'Coast mask tiles. codes[level] is base64 of a 2^level × 2^level byte grid, row j north from the root, column i east: 0 all water, 1 all land, 2 shore (tile written as {level}/{i}/{j}.webp). Texel value v decodes to metres as (v / 255 * 2 - 1) * distanceTexels * texelSize, positive on land.',
    texels: TILE_TEXELS,
    maxLevel: MAX_LEVEL,
    distanceTexels: DISTANCE_TEXELS,
    sources: [SOURCES.land.licence, SOURCES.lakes.licence],
    codes: codes.map((c) => Buffer.from(c).toString('base64')),
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
