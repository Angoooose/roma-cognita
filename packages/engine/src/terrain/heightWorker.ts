/**
 * Builds one terrain tile in the Albers plane out of its sources.
 *
 * Elevation (Mapterhorn) and sea depth (AWS Terrain Tiles) both live in Web Mercator;
 * the map lives in Albers. Rather than teach the GPU two projections, every plane tile
 * is resampled here once: each texel is inverse-projected to lon/lat, located in the
 * Mercator pyramid and sampled bilinearly. The coast mask is already baked on this
 * tile grid (pipeline/src/water), so it is only windowed and rescaled. The GPU only
 * ever sees plane-space tiles.
 *
 * Output is two textures. The first carries height and its gradient rather than a
 * normal, so the shader can choose how much to exaggerate relief without the tile
 * being rebuilt. The second carries the water: signed distance to the shore and depth.
 */

import { TILE_TEXELS, projection, tileRect } from '@roman-map/world'
import { toHalf } from './half.ts'

export interface TileJob {
  id: number
  level: number
  i: number
  j: number
}

export interface TileResult {
  id: number
  /** RGBA half floats, n×n: height (m), dh/dx, dh/dy, unused. */
  terrain: Uint16Array
  /** RG half floats, n×n: signed distance to shore (m, positive on land), sea depth (m). */
  water: Uint16Array
  minHeight: number
  maxHeight: number
}

interface MercatorSource {
  url: string
  tileSize: number
  maxZoom: number
}

/**
 * Mapterhorn: Terrarium WebP, 512 px, to z12 (~15 m in Italy). Land only — every sea
 * pixel is exactly 0, which is why depth needs a second source.
 */
const ELEVATION: MercatorSource = {
  url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  tileSize: 512,
  maxZoom: 12,
}

/**
 * AWS Terrain Tiles (Tilezen/Joerd): Terrarium PNG, 256 px, with ETOPO/GEBCO-derived
 * bathymetry. Depth only drives the shallows colour ramp, so z8 (~450 m) is plenty and
 * keeps the request count down.
 */
const DEPTH: MercatorSource = {
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  tileSize: 256,
  maxZoom: 8,
}

const EQUATOR = 40075016.686
const N = TILE_TEXELS

// --- source tiles -------------------------------------------------------------------

const cache = new Map<string, Promise<Float32Array | null>>()
const CACHE_LIMIT = 200

function cached(key: string, load: () => Promise<Float32Array | null>) {
  const hit = cache.get(key)
  if (hit) {
    // Re-insert so the Map's insertion order doubles as recency.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const p = load().catch(() => null)
  cache.set(key, p)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return p
}

async function pixels(url: string): Promise<{ rgba: Uint8ClampedArray; width: number } | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  // These images are data, not pictures: any colour management or premultiplication
  // corrupts them — the same class of bug as the PNG colour profiles that shift
  // province ids by one or two in the EU4 web map.
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  return { rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width }
}

async function terrarium(url: string): Promise<Float32Array | null> {
  const img = await pixels(url)
  if (!img) return null
  const out = new Float32Array(img.width * img.width)
  const p = img.rgba
  for (let i = 0, k = 0; i < out.length; i++, k += 4) {
    out[i] = p[k] * 256 + p[k + 1] + p[k + 2] / 256 - 32768
  }
  return out
}

/** The coarsest source zoom whose pixels are no larger than our texels. */
function zoomFor(src: MercatorSource, texelMetres: number, lat: number) {
  const z = Math.ceil(
    Math.log2((EQUATOR * Math.cos((lat * Math.PI) / 180)) / (src.tileSize * texelMetres)),
  )
  return Math.max(0, Math.min(src.maxZoom, z))
}

/** Bilinear samples of a Mercator source at every lon/lat in the grid. */
async function sampleMercator(
  src: MercatorSource,
  lonlat: Float64Array,
  count: number,
  z: number,
): Promise<Float32Array> {
  const T = src.tileSize
  const world = T * 2 ** z
  const tiles = 2 ** z
  const px = new Float64Array(count)
  const py = new Float64Array(count)
  const needed = new Map<string, [number, number]>()
  for (let i = 0; i < count; i++) {
    const lon = lonlat[i * 2]
    const lat = Math.max(-85, Math.min(85, lonlat[i * 2 + 1])) * (Math.PI / 180)
    // Global pixel coordinates with pixel centres at integers.
    const gx = ((lon + 180) / 360) * world - 0.5
    const gy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * world - 0.5
    px[i] = gx
    py[i] = gy
    for (const tx of [Math.floor(gx / T), Math.floor((gx + 1) / T)]) {
      for (const ty of [Math.floor(gy / T), Math.floor((gy + 1) / T)]) {
        if (ty < 0 || ty >= tiles) continue
        const wx = ((tx % tiles) + tiles) % tiles
        needed.set(`${wx}/${ty}`, [wx, ty])
      }
    }
  }

  const loaded = new Map<string, Float32Array | null>()
  await Promise.all(
    [...needed].map(async ([key, [tx, ty]]) => {
      const url = src.url.replace('{z}', `${z}`).replace('{x}', `${tx}`).replace('{y}', `${ty}`)
      loaded.set(key, await cached(url, () => terrarium(url)))
    }),
  )

  const pixel = (gx: number, gy: number) => {
    gy = Math.max(0, Math.min(world - 1, gy))
    gx = ((gx % world) + world) % world
    const tx = Math.floor(gx / T)
    const ty = Math.floor(gy / T)
    const data = loaded.get(`${tx}/${ty}`)
    return data ? data[(gy - ty * T) * T + (gx - tx * T)] : 0
  }

  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const fx = Math.floor(px[i])
    const fy = Math.floor(py[i])
    const tx = px[i] - fx
    const ty = py[i] - fy
    const a = pixel(fx, fy)
    const b = pixel(fx + 1, fy)
    const c = pixel(fx, fy + 1)
    const d = pixel(fx + 1, fy + 1)
    out[i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
  return out
}

// --- coast mask ---------------------------------------------------------------------

interface WaterIndex {
  maxLevel: number
  distanceTexels: number
  codes: Uint8Array[]
}

let waterIndex: Promise<WaterIndex | null> | null = null

function loadWaterIndex() {
  waterIndex ??= fetch('/water/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) =>
      j
        ? {
            maxLevel: j.maxLevel,
            distanceTexels: j.distanceTexels,
            codes: (j.codes as string[]).map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))),
          }
        : null,
    )
    .catch(() => null)
  return waterIndex
}

/**
 * Signed distance to shore in metres for every texel of the tile. Tiles at or above
 * the mask's deepest level read their own mask tile; deeper tiles read a window of
 * their ancestor at that level, bilinearly — the same thing the GPU would do.
 * Without a mask (the pipeline has not been run) height decides, as in the first spike.
 */
async function coastDistance(job: TileJob, heights: Float32Array, m: number): Promise<Float32Array> {
  const out = new Float32Array(N * N)
  const idx = await loadWaterIndex()
  if (!idx) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) out[r * N + c] = heights[(r + 1) * m + c + 1] > 0 ? 1e4 : -1e4
    }
    return out
  }

  const level = Math.min(job.level, idx.maxLevel)
  const shift = job.level - level
  const si = job.i >> shift
  const sj = job.j >> shift
  const src = tileRect({ level, i: si, j: sj })
  const sstep = src.size / (N - 1)
  const reach = idx.distanceTexels * sstep
  const code = idx.codes[level]?.[sj * 2 ** level + si] ?? 0

  if (code !== 2) {
    out.fill(code === 1 ? reach : -reach)
    return out
  }

  const cacheKey = `/water/${level}/${si}/${sj}.webp`
  const field = await cached(cacheKey, async () => {
    const img = await pixels(cacheKey)
    if (!img) return null
    const f = new Float32Array(N * N)
    for (let k = 0; k < f.length; k++) f[k] = (img.rgba[k * 4] / 255) * 2 - 1
    return f
  })
  if (!field) return out.fill(-reach)

  const me = tileRect(job)
  const step = me.size / (N - 1)
  for (let r = 0; r < N; r++) {
    // Source image row 0 is the tile's north edge.
    const sy = N - 1 - (me.y0 + r * step - src.y0) / sstep
    const y = Math.min(N - 2, Math.max(0, Math.floor(sy)))
    const ty = sy - y
    for (let c = 0; c < N; c++) {
      const sx = (me.x0 + c * step - src.x0) / sstep
      const x = Math.min(N - 2, Math.max(0, Math.floor(sx)))
      const tx = sx - x
      const a = field[y * N + x]
      const b = field[y * N + x + 1]
      const cc = field[(y + 1) * N + x]
      const d = field[(y + 1) * N + x + 1]
      out[r * N + c] = ((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty) * reach
    }
  }
  return out
}

// --- the tile -----------------------------------------------------------------------

async function build(job: TileJob): Promise<TileResult> {
  const { x0, y0, size } = tileRect(job)
  const step = size / (N - 1)
  // One texel of border on every side so gradients at the edge use real neighbours.
  const m = N + 2
  const lonlat = new Float64Array(m * m * 2)
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      projection.inverseInto(x0 + (c - 1) * step, y0 + (r - 1) * step, lonlat, (r * m + c) * 2)
    }
  }
  const lat = projection.inverse(x0 + size / 2, y0 + size / 2)[1]

  const [heights, depths] = await Promise.all([
    sampleMercator(ELEVATION, lonlat, m * m, zoomFor(ELEVATION, step, lat)),
    sampleMercator(DEPTH, lonlat, m * m, zoomFor(DEPTH, step, lat)),
  ])
  const shore = await coastDistance(job, heights, m)

  const terrain = new Uint16Array(N * N * 4)
  const water = new Uint16Array(N * N * 2)
  let minHeight = Infinity
  let maxHeight = -Infinity
  const inv2 = 1 / (2 * step)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = (r + 1) * m + (c + 1)
      const h = heights[i]
      const o = r * N + c
      terrain[o * 4] = toHalf(h)
      terrain[o * 4 + 1] = toHalf((heights[i + 1] - heights[i - 1]) * inv2)
      terrain[o * 4 + 2] = toHalf((heights[i + m] - heights[i - m]) * inv2)
      water[o * 2] = toHalf(shore[o])
      water[o * 2 + 1] = toHalf(Math.min(0, depths[i]))
      if (h < minHeight) minHeight = h
      if (h > maxHeight) maxHeight = h
    }
  }

  return { id: job.id, terrain, water, minHeight, maxHeight }
}

self.onmessage = async (e: MessageEvent<TileJob>) => {
  const result = await build(e.data)
  ;(self as unknown as Worker).postMessage(result, [result.terrain.buffer, result.water.buffer])
}
