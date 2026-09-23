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
 * being rebuilt. The second carries the water: signed distance to the shore, depth,
 * and distance to the nearest river with that river's discharge.
 *
 * Rivers are painted into the terrain rather than drawn as lines over it — the way
 * Imperator's rivers bitmap works — so they sit in their valleys at any tilt and
 * never fight the terrain for depth. The shader decides their width and visibility per
 * pixel from the distance and discharge stored here, which keeps a river the same
 * width where tiles of different levels meet.
 */

import { ROOT, TILE_TEXELS, projection, tileRect } from '@roman-map/world'
import { toHalf } from './half.ts'
import { riverHalfWidth, riverMinDischarge } from './rivers.ts'

export interface TileJob {
  id: number
  level: number
  i: number
  j: number
}

export interface TileResult {
  id: number
  /** RGBA half floats, n×n: height (m), dh/dx, dh/dy, signed distance to floodplain edge (m, positive inside). */
  terrain: Uint16Array
  /**
   * RGBA half floats, n×n: signed distance to shore (m, positive on land), sea depth
   * (m), distance to the nearest river centreline (m), that river's discharge (m³/s).
   */
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
const ROOT_X = ROOT.x
const ROOT_Y = ROOT.y
const ROOT_SIZE = ROOT.size

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
async function coastDistance(
  job: TileJob,
  heights: Float32Array,
  m: number,
): Promise<{ shore: Float32Array; floodplain: Float32Array }> {
  const shore = new Float32Array(N * N)
  const floodplain = new Float32Array(N * N)
  const idx = await loadWaterIndex()
  if (!idx) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) shore[r * N + c] = heights[(r + 1) * m + c + 1] > 0 ? 1e4 : -1e4
    }
    return { shore, floodplain: floodplain.fill(-1e4) }
  }

  const level = Math.min(job.level, idx.maxLevel)
  const shift = job.level - level
  const si = job.i >> shift
  const sj = job.j >> shift
  const src = tileRect({ level, i: si, j: sj })
  const sstep = src.size / (N - 1)
  const reach = idx.distanceTexels * sstep
  const code = idx.codes[level]?.[sj * 2 ** level + si] ?? 0

  // Codes: 0 all sea, 1 all land outside any floodplain, 2 mixed (tile written),
  // 3 all land inside a floodplain.
  if (code !== 2) {
    shore.fill(code === 0 ? -reach : reach)
    floodplain.fill(code === 3 ? reach : -reach)
    return { shore, floodplain }
  }

  const url = `/water/${level}/${si}/${sj}.webp`
  const [sField, fField] = await Promise.all([
    cached(`${url}#shore`, () => maskChannel(url, 0)),
    cached(`${url}#floodplain`, () => maskChannel(url, 1)),
  ])
  if (!sField || !fField) {
    shore.fill(-reach)
    floodplain.fill(-reach)
    return { shore, floodplain }
  }

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
      const o = r * N + c
      for (const [field, out] of [
        [sField, shore],
        [fField, floodplain],
      ] as const) {
        const a = field[y * N + x]
        const b = field[y * N + x + 1]
        const cc = field[(y + 1) * N + x]
        const d = field[(y + 1) * N + x + 1]
        out[o] = ((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty) * reach
      }
    }
  }
  return { shore, floodplain }
}

/** One channel of a mask tile as −1…1: 0 the shore distance, 1 the floodplain distance. */
async function maskChannel(url: string, channel: number): Promise<Float32Array | null> {
  const img = await pixels(url)
  if (!img) return null
  const f = new Float32Array(N * N)
  for (let k = 0; k < f.length; k++) f[k] = (img.rgba[k * 4 + channel] / 255) * 2 - 1
  return f
}

// --- rivers -------------------------------------------------------------------------

interface RiverTier {
  minQ: number
  level: number
  tiles: Set<string>
}

let riverIndex: Promise<RiverTier[] | null> | null = null

function loadRiverIndex() {
  riverIndex ??= fetch('/rivers/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) =>
      j
        ? (j.tiers as { minQ: number; level: number; tiles: number[][] }[]).map((t) => ({
            minQ: t.minQ,
            level: t.level,
            tiles: new Set(t.tiles.map(([i, j]) => `${i}/${j}`)),
          }))
        : null,
    )
    .catch(() => null)
  return riverIndex
}

const riverTiles = new Map<string, Promise<Float32Array>>()

/**
 * Decodes one river tile (format: encodeTile in pipeline/src/rivers/build.ts) into
 * segments [ax, ay, bx, by, q], q negative for a reconstructed course.
 */
function loadRiverTile(tier: number, level: number, i: number, j: number): Promise<Float32Array> {
  const key = `${tier}/${i}/${j}`
  let p = riverTiles.get(key)
  if (!p) {
    p = fetch(`/rivers/${key}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(4)))
      .then((buf) => {
        const v = new DataView(buf)
        const { x0, y0, size } = tileRect({ level, i, j })
        const cx = x0 + size / 2
        const cy = y0 + size / 2
        const unit = (size * 1.5) / 32767
        const lines = v.byteLength >= 4 ? v.getUint32(0, true) : 0
        const segs: number[] = []
        let o = 4
        for (let l = 0; l < lines; l++) {
          const n = v.getUint16(o, true)
          // Low 14 bits the log discharge, top bit "reconstructed" — carried as a negative
          // discharge from here to the shader, which draws those courses fainter.
          const word = v.getUint16(o + 2, true)
          const q = 10 ** ((word & 0x3fff) / 2048 - 1) * (word & 0x8000 ? -1 : 1)
          o += 4
          let px = 0
          let py = 0
          for (let k = 0; k < n; k++) {
            const x = cx + v.getInt16(o, true) * unit
            const y = cy + v.getInt16(o + 2, true) * unit
            o += 4
            if (k > 0) segs.push(px, py, x, y, q)
            px = x
            py = y
          }
        }
        return new Float32Array(segs)
      })
      .catch(() => new Float32Array(0))
    riverTiles.set(key, p)
  }
  return p
}

/**
 * Distance from every texel to the nearest river centreline, and that river's
 * discharge. Only rivers the tile could show, itself or standing in for its children,
 * are considered.
 */
interface RiverField {
  dist: Float32Array
  q: Float32Array
}

async function riverField(job: TileJob): Promise<RiverField> {
  const dist = new Float32Array(N * N).fill(RIVER_FAR)
  const q = new Float32Array(N * N)
  const tiers = await loadRiverIndex()
  if (!tiers) return { dist, q }

  const { x0, y0, size } = tileRect(job)
  const step = size / (N - 1)
  // A tile is drawn at one to two screen pixels per texel, but also stands in, stretched,
  // for its children while they load — at up to four. Carrying the rivers its children
  // would show keeps them on screen through that, instead of blinking out and back.
  const qFloor = riverMinDischarge(step / 4)
  const reachTexels = 6

  const segments: Float32Array[] = []
  await Promise.all(
    tiers.map(async (tier, t) => {
      // Tier t holds rivers from its minQ up to the next tier's; skip it if all of them
      // are below what this tile can show.
      const tierMaxQ = t === 0 ? Infinity : tiers[t - 1].minQ
      if (tierMaxQ < qFloor) return
      const tsize = ROOT_SIZE / 2 ** tier.level
      // Reaches are filed under the tile holding their midpoint and may run into the
      // neighbours, so take a one-tile ring around what the job covers.
      const i0 = Math.floor((x0 - ROOT_X) / tsize) - 1
      const i1 = Math.floor((x0 + size - ROOT_X) / tsize) + 1
      const j0 = Math.floor((y0 - ROOT_Y) / tsize) - 1
      const j1 = Math.floor((y0 + size - ROOT_Y) / tsize) + 1
      const loads: Promise<Float32Array>[] = []
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (tier.tiles.has(`${i}/${j}`)) loads.push(loadRiverTile(t, tier.level, i, j))
        }
      }
      segments.push(...(await Promise.all(loads)))
    }),
  )

  for (const segs of segments) {
    for (let s = 0; s < segs.length; s += 5) {
      const signed = segs[s + 4]
      const rq = Math.abs(signed)
      if (rq < qFloor) continue
      const ax = segs[s]
      const ay = segs[s + 1]
      const bx = segs[s + 2]
      const by = segs[s + 3]
      const reach = Math.max(riverHalfWidth(rq) * 2, reachTexels * step)
      // Texel window around the segment.
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step))
      const c1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step))
      const r0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - y0) / step))
      const r1 = Math.min(N - 1, Math.ceil((Math.max(ay, by) + reach - y0) / step))
      if (c0 > c1 || r0 > r1) continue
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy || 1
      for (let r = r0; r <= r1; r++) {
        const py = y0 + r * step
        for (let c = c0; c <= c1; c++) {
          const px = x0 + c * step
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
          const ex = ax + t * dx - px
          const ey = ay + t * dy - py
          const d = Math.sqrt(ex * ex + ey * ey)
          const o = r * N + c
          // Nearest edge rather than nearest centreline: where a big river and a
          // stream meet, the big one's bank wins.
          if (d - riverHalfWidth(rq) < dist[o] - riverHalfWidth(Math.abs(q[o]))) {
            dist[o] = d
            q[o] = signed
          }
        }
      }
    }
  }
  for (let o = 0; o < dist.length; o++) dist[o] = Math.min(dist[o], RIVER_FAR)
  return { dist, q }
}

/** "No river near": far enough that no width or fade reaches it, and exact in half float. */
const RIVER_FAR = 60000

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

  const [heights, depths, river] = await Promise.all([
    sampleMercator(ELEVATION, lonlat, m * m, zoomFor(ELEVATION, step, lat)),
    sampleMercator(DEPTH, lonlat, m * m, zoomFor(DEPTH, step, lat)),
    riverField(job),
  ])
  const { shore, floodplain } = await coastDistance(job, heights, m)

  const terrain = new Uint16Array(N * N * 4)
  const water = new Uint16Array(N * N * 4)
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
      terrain[o * 4 + 3] = toHalf(floodplain[o])
      water[o * 4] = toHalf(shore[o])
      water[o * 4 + 1] = toHalf(Math.min(0, depths[i]))
      water[o * 4 + 2] = toHalf(river.dist[o])
      water[o * 4 + 3] = toHalf(river.q[o])
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
