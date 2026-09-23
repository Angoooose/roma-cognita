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
 * Depth smoothing, by depth. EMODnet is a patchwork of surveys, and each survey's
 * footprint and track lines leave straight-edged steps in the depth: coloured by depth,
 * the open sea read as a grid of boxes. Nobody needs that detail offshore; near the
 * coast the shelf, banks and channels are the point. So the smoothing radius (a
 * Gaussian's sigma, m) grows with depth, from SMOOTH_MIN_M in the shallows to
 * SMOOTH_MAX_M in deep water, reaching it at SMOOTH_FULL_DEPTH.
 */
const SMOOTH_MIN_M = 100
const SMOOTH_MAX_M = 1000
const SMOOTH_FULL_DEPTH = 400
/** The blurred versions blended between, as sigmas in metres (0 is the data as sampled). */
const SMOOTH_STEPS = [0, 250, 500, SMOOTH_MAX_M]

function smoothingFor(depth: number) {
  const t = Math.min(1, Math.max(0, -depth / SMOOTH_FULL_DEPTH))
  return SMOOTH_MIN_M + (SMOOTH_MAX_M - SMOOTH_MIN_M) * t
}

/**
 * Depths for one tile, row 0 south, 0 where no source knows, smoothed by depth (above).
 * The tile is sampled with an apron wide enough for the widest blur, so neighbouring
 * tiles agree along their shared edge, and every level blurs by the same metres, so a
 * coarse tile standing in for finer ones shows the same sea.
 */
function sampleTile(address: TileAddress): Float32Array {
  const step = tileRect(address).size / (N - 1)
  const apron = Math.ceil((3 * SMOOTH_MAX_M) / step) + 1
  const W = N + 2 * apron
  const raw = sampleGrid(address, apron)

  // Normalised convolution: land beyond the source's extended sea is 0 and must not
  // drag the sea shallower, so each blur also blurs a weight of where there is water.
  const weight = new Float32Array(W * W)
  for (let k = 0; k < raw.length; k++) weight[k] = raw[k] < 0 ? 1 : 0
  const versions = SMOOTH_STEPS.map((sigmaM) => {
    const sigma = sigmaM / step
    if (sigma < 0.35) return raw
    const num = new Float32Array(W * W)
    for (let k = 0; k < raw.length; k++) num[k] = raw[k] * weight[k]
    const den = weight.slice()
    gaussianBlur(num, W, sigma)
    gaussianBlur(den, W, sigma)
    const out = new Float32Array(W * W)
    for (let k = 0; k < out.length; k++) out[k] = den[k] > 1e-3 ? num[k] / den[k] : 0
    return out
  })

  // The depth that picks the radius comes from the smoothest version, so the choice
  // is itself smooth and never follows a survey seam.
  const smoothest = versions[versions.length - 1]
  const out = new Float32Array(N * N)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const k = (r + apron) * W + (c + apron)
      const sigma = smoothingFor(smoothest[k])
      let i = 1
      while (i < SMOOTH_STEPS.length - 1 && SMOOTH_STEPS[i] < sigma) i++
      const t = (sigma - SMOOTH_STEPS[i - 1]) / (SMOOTH_STEPS[i] - SMOOTH_STEPS[i - 1])
      const v = versions[i - 1][k] * (1 - t) + versions[i][k] * t
      out[r * N + c] = raw[k] < 0 ? Math.min(0, v) : 0
    }
  }
  return out
}

/**
 * Raw depths on the tile's texel grid plus `apron` texels each side. Fine levels
 * (PACK_LEVEL and deeper) average S×S fine samples over each texel, S = 2^(8 − level),
 * so every one of them is a box filter over the same ~110 m data; coarser levels sample
 * the GEBCO halving whose pixel is closest to their texel.
 */
function sampleGrid(address: TileAddress, apron: number): Float32Array {
  const { x0, y0, size } = tileRect(address)
  const step = size / (N - 1)
  const W = N + 2 * apron
  const out = new Float32Array(W * W)
  const fine = address.level >= PACK_LEVEL
  const S = fine ? 2 ** Math.max(0, maxLevel - address.level) : 1
  const mip =
    gebco[Math.max(0, Math.min(gebco.length - 1, Math.round(Math.log2(step / GEBCO_M))))]
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) {
      let sum = 0
      let n = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = x0 + (c - apron + (sx + 0.5) / S - 0.5) * step
          const y = y0 + (r - apron + (sy + 0.5) / S - 0.5) * step
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
      out[r * W + c] = n ? Math.min(0, sum / n) : 0
    }
  }
  return out
}

/**
 * In-place Gaussian blur of a W×W grid, approximated by three box blurs per axis
 * (Wells 1986): each pass is a running sum, so the cost does not grow with sigma.
 */
function gaussianBlur(a: Float32Array, W: number, sigma: number) {
  // Box widths whose three-fold convolution has variance sigma² (Kovesi 2010).
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1)
  let wl = Math.floor(ideal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4))
  const tmp = new Float32Array(W)
  for (let pass = 0; pass < 3; pass++) {
    const r = ((pass < m ? wl : wu) - 1) / 2
    for (let row = 0; row < W; row++) boxLine(a, row * W, 1, W, r, tmp)
    for (let col = 0; col < W; col++) boxLine(a, col, W, W, r, tmp)
  }
}

/** Box blur of radius r along one line of `a` (start, stride, length), edges clamped. */
function boxLine(
  a: Float32Array,
  start: number,
  stride: number,
  n: number,
  r: number,
  tmp: Float32Array,
) {
  for (let i = 0; i < n; i++) tmp[i] = a[start + i * stride]
  const at = (i: number) => tmp[Math.min(n - 1, Math.max(0, i))]
  let acc = 0
  for (let i = -r; i <= r; i++) acc += at(i)
  const inv = 1 / (2 * r + 1)
  for (let i = 0; i < n; i++) {
    a[start + i * stride] = acc * inv
    acc += at(i + r + 1) - at(i - r)
  }
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
