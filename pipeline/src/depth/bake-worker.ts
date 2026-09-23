/**
 * Bakes depth tiles: one loose overview tile, or one level-6 pack with the level 7 and
 * 8 tiles under it that are worth writing. Run in a pool; the GEBCO rasters are shared
 * memory, and each worker keeps its own few EMODnet chunks.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { deflateSync } from 'node:zlib'
import {
  PACK_LEVEL,
  TILE_TEXELS,
  encodeDepthTile,
  projection,
  tileRect,
  type TileAddress,
} from '@roman-map/world'
import {
  EMODNET_CHUNK_DEG,
  EMODNET_CHUNK_TEXELS,
  EMODNET_PER_DEG,
  readEmodnetChunk,
  type LonLatRaster,
} from './sources.ts'

export type DepthJob = { id: number } & (
  { kind: 'loose'; address: TileAddress } | { kind: 'pack'; i: number; j: number }
)

export interface DepthResult {
  id: number
  tiles: { address: TileAddress; bytes: Uint8Array }[]
  /** Tiles considered at levels 7–8, and how many of them were written. */
  considered: number
}

export interface DepthWorkerData {
  cache: string
  /** GEBCO, then each halving of it. */
  gebco: LonLatRaster[]
  /** Coast mask codes per level (0 water, 1 land, 2 shore, 3 floodplain land), to skip dry tiles. */
  codes: Uint8Array[]
  maxLevel: number
}

const { cache, gebco, codes, maxLevel } = workerData as DepthWorkerData
const N = TILE_TEXELS
/** GEBCO's pixel along a meridian, m. */
const GEBCO_M = 111_195 / gebco[0].perDeg

/**
 * Only texels shallower than this decide whether a fine tile is worth writing: the
 * shading reads depth for the shallows, and the abyss at 108 m is not worth shipping.
 */
const DECIDE_DEPTH = 600

// --- sampling ----------------------------------------------------------------------

/** NaN-aware bilinear sample of a raster at lon/lat: the mean of whichever corners are valid. */
function sampleRaster(src: LonLatRaster, lon: number, lat: number) {
  const gx = (lon - src.west) * src.perDeg - 0.5
  const gy = (src.north - lat) * src.perDeg - 0.5
  const x = Math.floor(gx)
  const y = Math.floor(gy)
  const tx = gx - x
  const ty = gy - y
  let sum = 0
  let wsum = 0
  for (let dy = 0; dy < 2; dy++) {
    const yy = y + dy
    if (yy < 0 || yy >= src.height) continue
    for (let dx = 0; dx < 2; dx++) {
      const xx = x + dx
      if (xx < 0 || xx >= src.width) continue
      const v = src.data[yy * src.width + xx]
      if (v !== v) continue
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty)
      sum += v * w
      wsum += w
    }
  }
  return wsum > 1e-6 ? sum / wsum : NaN
}

const chunks = new Map<string, Float32Array | null>()
const CHUNK_LIMIT = 24

function chunk(cx: number, cy: number) {
  const key = `${cx}/${cy}`
  let c = chunks.get(key)
  if (c === undefined) {
    c = readEmodnetChunk(
      cache,
      cx * EMODNET_CHUNK_DEG - 180,
      90 - (cy + 1) * EMODNET_CHUNK_DEG,
    )
    if (chunks.size >= CHUNK_LIMIT) chunks.delete(chunks.keys().next().value!)
  } else chunks.delete(key)
  chunks.set(key, c)
  return c
}

/** One EMODnet pixel on the global grid (column from 180°W, row from 90°N), or NaN. */
function emodnetPixel(gx: number, gy: number) {
  const cx = Math.floor(gx / EMODNET_CHUNK_TEXELS)
  const cy = Math.floor(gy / EMODNET_CHUNK_TEXELS)
  const c = chunk(cx, cy)
  if (!c) return NaN
  return c[
    (gy - cy * EMODNET_CHUNK_TEXELS) * EMODNET_CHUNK_TEXELS +
      (gx - cx * EMODNET_CHUNK_TEXELS)
  ]
}

function sampleEmodnet(lon: number, lat: number) {
  const gx = (lon + 180) * EMODNET_PER_DEG - 0.5
  const gy = (90 - lat) * EMODNET_PER_DEG - 0.5
  const x = Math.floor(gx)
  const y = Math.floor(gy)
  const tx = gx - x
  const ty = gy - y
  let sum = 0
  let wsum = 0
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const v = emodnetPixel(x + dx, y + dy)
      if (v !== v) continue
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty)
      sum += v * w
      wsum += w
    }
  }
  return wsum > 1e-6 ? sum / wsum : NaN
}

/** The finest depth at lon/lat: EMODnet where it has a value, GEBCO elsewhere. */
function sampleFine(lon: number, lat: number) {
  const v = sampleEmodnet(lon, lat)
  return v === v ? v : sampleRaster(gebco[0], lon, lat)
}

const lonlat = new Float64Array(2)

/**
 * Depths for one tile, row 0 south, 0 where no source knows. Fine levels (PACK_LEVEL
 * and deeper) average S×S fine samples over each texel, S = 2^(8 − level), so every
 * one of them is a box filter over the same ~110 m data; coarser levels sample the
 * GEBCO halving whose pixel is closest to their texel.
 */
function sampleTile(address: TileAddress): Float32Array {
  const { x0, y0, size } = tileRect(address)
  const step = size / (N - 1)
  const out = new Float32Array(N * N)
  const fine = address.level >= PACK_LEVEL
  const S = fine ? 2 ** Math.max(0, maxLevel - address.level) : 1
  const mip =
    gebco[Math.max(0, Math.min(gebco.length - 1, Math.round(Math.log2(step / GEBCO_M))))]
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let sum = 0
      let n = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = x0 + (c + (sx + 0.5) / S - 0.5) * step
          const y = y0 + (r + (sy + 0.5) / S - 0.5) * step
          projection.inverseInto(x, y, lonlat, 0)
          const v = fine
            ? sampleFine(lonlat[0], lonlat[1])
            : sampleRaster(mip, lonlat[0], lonlat[1])
          if (v === v) {
            sum += v
            n++
          }
        }
      }
      out[r * N + c] = n ? Math.min(0, sum / n) : 0
    }
  }
  return out
}

// --- adaptive fine levels ------------------------------------------------------------

interface Written {
  address: TileAddress
  depths: Float32Array
}

/** Whether `depths` says anything its ancestor's window, bilinearly upsampled, does not. */
function addsDetail(address: TileAddress, depths: Float32Array, ancestor: Written) {
  const shift = address.level - ancestor.address.level
  const scale = 2 ** shift
  const offX = (address.i - (ancestor.address.i << shift)) * ((N - 1) / scale)
  const offY = (address.j - (ancestor.address.j << shift)) * ((N - 1) / scale)
  const a = ancestor.depths
  for (let r = 0; r < N; r++) {
    const sy = offY + r / scale
    const y = Math.min(N - 2, Math.floor(sy))
    const ty = sy - y
    for (let c = 0; c < N; c++) {
      const d = depths[r * N + c]
      const sx = offX + c / scale
      const x = Math.min(N - 2, Math.floor(sx))
      const tx = sx - x
      const up =
        (a[y * N + x] * (1 - tx) + a[y * N + x + 1] * tx) * (1 - ty) +
        (a[(y + 1) * N + x] * (1 - tx) + a[(y + 1) * N + x + 1] * tx) * ty
      if (Math.max(d, up) < -DECIDE_DEPTH) continue
      if (Math.abs(d - up) > 1 + 0.03 * Math.abs(d)) return true
    }
  }
  return false
}

function isDry(address: TileAddress) {
  const grid = codes[address.level]
  if (!grid) return false
  const code = grid[address.j * 2 ** address.level + address.i]
  return code === 1 || code === 3
}

function encode(depths: Float32Array) {
  return new Uint8Array(deflateSync(encodeDepthTile(depths), { level: 9 }))
}

function bakePack(i: number, j: number): Omit<DepthResult, 'id'> {
  const root: Written = {
    address: { level: PACK_LEVEL, i, j },
    depths: sampleTile({ level: PACK_LEVEL, i, j }),
  }
  const tiles = [{ address: root.address, bytes: encode(root.depths) }]
  let considered = 0
  const visit = (parent: TileAddress, ancestor: Written) => {
    if (parent.level >= maxLevel) return
    for (let dj = 0; dj < 2; dj++) {
      for (let di = 0; di < 2; di++) {
        const address = {
          level: parent.level + 1,
          i: parent.i * 2 + di,
          j: parent.j * 2 + dj,
        }
        if (isDry(address)) continue
        considered++
        const depths = sampleTile(address)
        if (addsDetail(address, depths, ancestor)) {
          tiles.push({ address, bytes: encode(depths) })
          visit(address, { address, depths })
        } else visit(address, ancestor)
      }
    }
  }
  visit(root.address, root)
  return { tiles, considered }
}

parentPort!.on('message', (job: DepthJob) => {
  let result: DepthResult
  if (job.kind === 'loose') {
    result = {
      id: job.id,
      tiles: [{ address: job.address, bytes: encode(sampleTile(job.address)) }],
      considered: 0,
    }
  } else {
    result = { id: job.id, ...bakePack(job.i, job.j) }
  }
  parentPort!.postMessage(
    result,
    result.tiles.map((t) => t.bytes.buffer as ArrayBuffer),
  )
})
