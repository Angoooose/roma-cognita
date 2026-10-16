/**
 * Bakes sea depth onto the terrain quadtree (DESIGN.md §7.2).
 *
 * Depth is baked rather than fetched at run time because the runtime source, AWS
 * Terrain Tiles, is ~1–2 km a pixel at sea and merges two sources, which draws blocky,
 * mottled shallows and tilted turquoise slabs in the Caspian. This bakes GEBCO_2026
 * everywhere and EMODnet's ~115 m DTM over the European seas, on the terrain's own
 * texel grid, so the worker only windows it:
 *
 * - Levels 0–5: every tile with any water, sampled from the GEBCO halving that matches
 *   the texel. Loose files.
 * - Level 6 (431 m): every tile with water. Levels 7 and 8 (216 m, 108 m): only where
 *   they differ from what the tile above already says, in water shallower than 600 m.
 *   These go in one pack per level-6 tile (packages/world/src/pack.ts). Terrain deeper
 *   than a written tile reads a window of it.
 *
 * Needs the coast mask first (`npm run water`): its tile codes say which tiles are dry.
 *
 *   npm run depth -w pipeline
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  DATA_RECT,
  DEPTH_K,
  PACK_LEVEL,
  TILE_TEXELS,
  projection,
  tileRect,
  writePack,
  type TileAddress,
} from '@roma-cognita/world'
import { BBOX } from '../water/sources.ts'
import type { DepthJob, DepthResult, DepthWorkerData } from './bake-worker.ts'
import {
  EMODNET_CHUNK_DEG,
  EMODNET_EXTENT,
  LICENCES,
  emodnetChunkPath,
  fetchEmodnetChunk,
  halve,
  readGebco,
  type LonLatRaster,
} from './sources.ts'
import { ROOT_DIR, CACHE_DIR } from '../load.ts'

const OUT = join(ROOT_DIR, 'build/depth')
const WATER_INDEX = join(ROOT_DIR, 'build/water/index.json')

/** Deepest baked level: 108 m texels, the resolution of EMODnet. */
const MAX_LEVEL = 8
/** GEBCO halvings: level 0's 27 km texels want the sixth (~30 km). */
const GEBCO_MIPS = 6
/** Concurrent WCS requests; EMODnet is a public service. */
const FETCH_CONCURRENCY = 4

async function main() {
  const t0 = Date.now()
  if (!existsSync(WATER_INDEX))
    throw new Error(`missing ${WATER_INDEX} — run \`npm run water -w pipeline\` first`)
  const water = JSON.parse(readFileSync(WATER_INDEX, 'utf8')) as { codes: string[] }
  const codes = water.codes.map((b) => new Uint8Array(Buffer.from(b, 'base64')))
  const code = ({ level, i, j }: TileAddress) => codes[level]?.[j * 2 ** level + i] ?? 0
  const wet = (a: TileAddress) => code(a) === 0 || code(a) === 2

  console.log('reading GEBCO…')
  const gebco: LonLatRaster[] = [await readGebco(CACHE_DIR, BBOX)]
  for (let m = 1; m <= GEBCO_MIPS; m++) gebco.push(halve(gebco[m - 1]))
  console.log(
    `  ${gebco[0].width}×${gebco[0].height}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  )

  // Every tile to bake, and the EMODnet chunks under the fine ones.
  const loose: TileAddress[] = []
  const packs: TileAddress[] = []
  const needed = new Map<string, [number, number]>()
  for (let level = 0; level <= PACK_LEVEL; level++) {
    const n = 2 ** level
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const { x0, y0, size } = tileRect({ level, i, j })
        if (x0 > DATA_RECT.maxX || x0 + size < DATA_RECT.minX) continue
        if (y0 > DATA_RECT.maxY || y0 + size < DATA_RECT.minY) continue
        if (!wet({ level, i, j })) continue
        if (level < PACK_LEVEL) {
          loose.push({ level, i, j })
          continue
        }
        packs.push({ level, i, j })
        for (const [w, s] of chunksUnder(x0, y0, size, gebco[0]))
          needed.set(`${s}_${w}`, [w, s])
      }
    }
  }
  const missing = [...needed.values()].filter(
    ([w, s]) => !existsSync(emodnetChunkPath(CACHE_DIR, w, s)),
  )
  console.log(
    `${loose.length} overview tiles, ${packs.length} packs; EMODnet ${needed.size} chunks, ${missing.length} to fetch`,
  )
  let fetched = 0
  const failed: string[] = []
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      for (let next = missing.pop(); next; next = missing.pop()) {
        if (!(await fetchEmodnetChunk(CACHE_DIR, next[0], next[1])))
          failed.push(`${next[1]}_${next[0]}`)
        if (++fetched % 20 === 0)
          console.log(
            `  fetched ${fetched} chunks, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
          )
      }
    }),
  )
  if (failed.length)
    console.warn(
      `  EMODnet failed for ${failed.join(', ')}: GEBCO stands in; run again to retry`,
    )

  rmSync(OUT, { recursive: true, force: true })
  const pool = new Pool(Math.max(1, availableParallelism() - 2), {
    cache: CACHE_DIR,
    gebco,
    codes,
    maxLevel: MAX_LEVEL,
  })
  const written = Array.from(
    { length: PACK_LEVEL + 1 },
    (_, level) => new Uint8Array(4 ** level),
  )
  let bytes = 0
  let fine = 0
  let considered = 0
  let largest = 0
  let done = 0
  const jobs: Promise<void>[] = []
  for (const address of loose) {
    jobs.push(
      pool.run({ kind: 'loose', address }).then(({ tiles }) => {
        const [{ bytes: b }] = tiles
        const file = join(OUT, `${address.level}/${address.i}/${address.j}.bin`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, b)
        written[address.level][address.j * 2 ** address.level + address.i] = 1
        bytes += b.length
      }),
    )
  }
  for (const { i, j } of packs) {
    jobs.push(
      pool.run({ kind: 'pack', i, j }).then((r) => {
        const pack = writePack(r.tiles)
        const file = join(OUT, `pack/${i}/${j}.pack`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, pack)
        written[PACK_LEVEL][j * 2 ** PACK_LEVEL + i] = 1
        bytes += pack.length
        largest = Math.max(largest, pack.length)
        fine += r.tiles.length - 1
        considered += r.considered
        if (++done % 200 === 0)
          console.log(`  ${done}/${packs.length} packs, ${fmt(bytes)} B`)
      }),
    )
  }
  await Promise.all(jobs)
  await pool.close()
  console.log(
    `levels 7–8: wrote ${fine} of ${considered} wet tiles; largest pack ${fmt(largest)} B`,
  )

  const index = {
    _comment:
      'Sea depth tiles. written[level] (levels 0 to packLevel) is base64 of a 2^level × 2^level byte grid, row j north from the root, column i east: 1 where the tile was written. Tiles above packLevel are {level}/{i}/{j}.bin; the packLevel tile and its written descendants to maxLevel are in pack/{i}/{j}.pack (packages/world/src/pack.ts). A tile is deflated predictor bytes (packages/world/src/depth.ts), depth in metres below the local water surface, row 0 south.',
    texels: TILE_TEXELS,
    maxLevel: MAX_LEVEL,
    packLevel: PACK_LEVEL,
    k: DEPTH_K,
    sources: [LICENCES.gebco, LICENCES.emodnet],
    written: written.map((w) => Buffer.from(w).toString('base64')),
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`wrote ${fmt(bytes)} B in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

/**
 * EMODnet chunks under a plane tile that GEBCO says have sea near them. The tile's
 * edges are walked, not just its corners, since a plane square is not a lon/lat box.
 */
function chunksUnder(
  x0: number,
  y0: number,
  size: number,
  g: LonLatRaster,
): [number, number][] {
  const box = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
  const steps = 16
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * size
    for (const [x, y] of [
      [x0 + t, y0],
      [x0 + t, y0 + size],
      [x0, y0 + t],
      [x0 + size, y0 + t],
    ]) {
      const [lon, lat] = projection.inverse(x, y)
      box.west = Math.min(box.west, lon)
      box.east = Math.max(box.east, lon)
      box.south = Math.min(box.south, lat)
      box.north = Math.max(box.north, lat)
    }
  }
  const out: [number, number][] = []
  const D = EMODNET_CHUNK_DEG
  for (let s = Math.floor(box.south / D) * D; s < box.north; s += D) {
    for (let w = Math.floor(box.west / D) * D; w < box.east; w += D) {
      if (w + D <= EMODNET_EXTENT.west || w >= EMODNET_EXTENT.east) continue
      if (s + D <= EMODNET_EXTENT.south || s >= EMODNET_EXTENT.north) continue
      if (gebcoHasSea(g, w, s, D)) out.push([w, s])
    }
  }
  return out
}

function gebcoHasSea(g: LonLatRaster, west: number, south: number, deg: number) {
  const c0 = Math.max(0, Math.floor((west - g.west) * g.perDeg))
  const c1 = Math.min(g.width, Math.ceil((west + deg - g.west) * g.perDeg))
  const r0 = Math.max(0, Math.floor((g.north - south - deg) * g.perDeg))
  const r1 = Math.min(g.height, Math.ceil((g.north - south) * g.perDeg))
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const v = g.data[r * g.width + c]
      if (v === v) return true
    }
  }
  return false
}

class Pool {
  private idle: Worker[] = []
  private workers: Worker[] = []
  private waiting: [DepthJob, (r: DepthResult) => void][] = []
  private pending = new Map<number, (r: DepthResult) => void>()
  private nextId = 1

  constructor(size: number, data: DepthWorkerData) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./bake-worker.ts', import.meta.url), {
        workerData: data,
      })
      w.on('message', (r: DepthResult) => {
        this.pending.get(r.id)!(r)
        this.pending.delete(r.id)
        const next = this.waiting.shift()
        if (next) this.send(w, ...next)
        else this.idle.push(w)
      })
      w.on('error', (e) => {
        console.error(e)
        process.exit(1)
      })
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  run(job: DistributiveOmit<DepthJob, 'id'>): Promise<DepthResult> {
    return new Promise((resolve) => {
      const full = { ...job, id: this.nextId++ } as DepthJob
      const w = this.idle.pop()
      if (w) this.send(w, full, resolve)
      else this.waiting.push([full, resolve])
    })
  }

  private send(w: Worker, job: DepthJob, resolve: (r: DepthResult) => void) {
    this.pending.set(job.id, resolve)
    w.postMessage(job)
  }

  close() {
    return Promise.all(this.workers.map((w) => w.terminate()))
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

function fmt(n: number) {
  return n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(0)}k`
      : `${n}`
}

await main()
