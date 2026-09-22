/**
 * Builds one terrain tile in the Albers plane out of Web Mercator source tiles.
 *
 * The source (Mapterhorn, Terrarium-encoded 512 px WebP) lives in Web Mercator; the map
 * lives in Albers. Rather than teach the GPU two projections, every plane tile is
 * resampled here once: each texel is inverse-projected to lon/lat, located in the
 * Mercator pyramid and sampled bilinearly. The GPU only ever sees plane-space tiles.
 *
 * The output texel carries height and its gradient rather than a normal, so the shader
 * can choose how much to exaggerate relief without the tile being rebuilt.
 */

import { projection } from '../geo/frame.ts'
import { toHalf } from './half.ts'

export interface TileJob {
  id: number
  x0: number
  y0: number
  size: number
  /** Vertices per side; texels are vertex-aligned so neighbours share their edges. */
  n: number
}

export interface TileResult {
  id: number
  /** RGBA half floats, n×n: height (m), dh/dx, dh/dy, unused. */
  texels: Uint16Array
  minHeight: number
  maxHeight: number
  sourceZoom: number
  sourceTiles: number
}

const SOURCE_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
const SOURCE_TILE = 512
const SOURCE_MAX_ZOOM = 12
const EQUATOR = 40075016.686

const cache = new Map<string, Promise<Float32Array | null>>()
const CACHE_LIMIT = 160

function loadSource(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) {
    // Re-insert so the Map's insertion order doubles as recency.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const p = decode(SOURCE_URL.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`))
  cache.set(key, p)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return p
}

async function decode(url: string): Promise<Float32Array | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  // Terrarium packs height into the colour bytes, so any colour management or
  // premultiplication corrupts it — the same class of bug as the PNG colour
  // profiles that shift province ids by one or two in the EU4 web map.
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
  const out = new Float32Array(bitmap.width * bitmap.height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768
  }
  return out
}

/**
 * The coarsest source zoom whose pixels are no larger than our texels. Finer would
 * alias under bilinear sampling; coarser would blur.
 */
function sourceZoomFor(texelMetres: number, lat: number) {
  const z = Math.ceil(Math.log2((EQUATOR * Math.cos((lat * Math.PI) / 180)) / (SOURCE_TILE * texelMetres)))
  return Math.max(0, Math.min(SOURCE_MAX_ZOOM, z))
}

async function build(job: TileJob): Promise<TileResult> {
  const { n, x0, y0, size } = job
  const step = size / (n - 1)
  // One texel of border on every side so gradients at the edge use real neighbours.
  const m = n + 2
  const lonlat = new Float64Array(m * m * 2)
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      projection.inverseInto(x0 + (c - 1) * step, y0 + (r - 1) * step, lonlat, (r * m + c) * 2)
    }
  }

  const centre = projection.inverse(x0 + size / 2, y0 + size / 2)
  const z = sourceZoomFor(step, centre[1])
  const world = SOURCE_TILE * 2 ** z

  // Global Mercator pixel coordinates, pixel centres at .5.
  const px = new Float64Array(m * m)
  const py = new Float64Array(m * m)
  const needed = new Map<string, [number, number]>()
  const tiles = 2 ** z
  for (let i = 0; i < m * m; i++) {
    const lon = lonlat[i * 2]
    const lat = Math.max(-85, Math.min(85, lonlat[i * 2 + 1])) * (Math.PI / 180)
    const gx = ((lon + 180) / 360) * world - 0.5
    const gy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * world - 0.5
    px[i] = gx
    py[i] = gy
    for (const tx of [Math.floor(gx / SOURCE_TILE), Math.floor((gx + 1) / SOURCE_TILE)]) {
      for (const ty of [Math.floor(gy / SOURCE_TILE), Math.floor((gy + 1) / SOURCE_TILE)]) {
        const wx = ((tx % tiles) + tiles) % tiles
        if (ty < 0 || ty >= tiles) continue
        needed.set(`${wx}/${ty}`, [wx, ty])
      }
    }
  }

  const loaded = new Map<string, Float32Array | null>()
  await Promise.all(
    [...needed].map(async ([key, [tx, ty]]) => loaded.set(key, await loadSource(z, tx, ty))),
  )

  const pixel = (gx: number, gy: number) => {
    gy = Math.max(0, Math.min(world - 1, gy))
    gx = ((gx % world) + world) % world
    const tx = Math.floor(gx / SOURCE_TILE)
    const ty = Math.floor(gy / SOURCE_TILE)
    const data = loaded.get(`${tx}/${ty}`)
    if (!data) return 0
    return data[(gy - ty * SOURCE_TILE) * SOURCE_TILE + (gx - tx * SOURCE_TILE)]
  }

  const heights = new Float32Array(m * m)
  for (let i = 0; i < m * m; i++) {
    const fx = Math.floor(px[i])
    const fy = Math.floor(py[i])
    const tx = px[i] - fx
    const ty = py[i] - fy
    const a = pixel(fx, fy)
    const b = pixel(fx + 1, fy)
    const c = pixel(fx, fy + 1)
    const d = pixel(fx + 1, fy + 1)
    heights[i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }

  const texels = new Uint16Array(n * n * 4)
  let minHeight = Infinity
  let maxHeight = -Infinity
  const inv2 = 1 / (2 * step)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = (r + 1) * m + (c + 1)
      const h = heights[i]
      const o = (r * n + c) * 4
      texels[o] = toHalf(h)
      texels[o + 1] = toHalf((heights[i + 1] - heights[i - 1]) * inv2)
      texels[o + 2] = toHalf((heights[i + m] - heights[i - m]) * inv2)
      texels[o + 3] = 0
      if (h < minHeight) minHeight = h
      if (h > maxHeight) maxHeight = h
    }
  }

  return { id: job.id, texels, minHeight, maxHeight, sourceZoom: z, sourceTiles: needed.size }
}

self.onmessage = async (e: MessageEvent<TileJob>) => {
  const result = await build(e.data)
  ;(self as unknown as Worker).postMessage(result, [result.texels.buffer])
}
