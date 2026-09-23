/**
 * Builds one terrain tile in the Albers plane out of its sources.
 *
 * Elevation (Mapterhorn) lives in Web Mercator; the map lives in Albers. Rather than
 * teach the GPU two projections, every plane tile is resampled here once: each texel is
 * inverse-projected to lon/lat, located in the Mercator pyramid and sampled bilinearly.
 * The coast mask and sea depth are already baked on this tile grid (pipeline/src/water,
 * pipeline/src/depth), so they are only windowed and rescaled. The GPU only ever sees
 * plane-space tiles.
 *
 * Output is three textures. The first carries height and its gradient rather than a
 * normal, so the shader can choose how much to exaggerate relief without the tile
 * being rebuilt. The second carries the water: signed distance to the shore, depth,
 * and distance to the nearest river with that river's discharge. The third carries
 * the political field: which atoms meet at the nearest boundary and how far away it
 * is. It says nothing about who held them — that changes with the year, and lives in
 * small tables the shader reads (politics/PoliticalLayer.ts), so the timeline never
 * rebuilds a tile.
 *
 * Rivers are painted into the terrain rather than drawn as lines over it — the way
 * Imperator's rivers bitmap works — so they sit in their valleys at any tilt and
 * never fight the terrain for depth. The shader decides their width and visibility per
 * pixel from the distance and discharge stored here, which keeps a river the same
 * width where tiles of different levels meet.
 */

import {
  ROOT,
  TILE_TEXELS,
  decodeDepthTile,
  projection,
  tileRect,
  type TileAddress,
} from '@roman-map/world'
import { toHalf } from './half.ts'
import { alignDistance } from '../politics/field.ts'
import { riverHalfWidth, riverMinDischarge } from './rivers.ts'
import { TileStore } from './tileStore.ts'

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
  /**
   * RGBA half floats, n×n: the lower and higher atom label either side of the nearest
   * political boundary, the signed distance to it (km, positive on the higher label's
   * side), and 0. See pipeline/src/politics.
   */
  politics: Uint16Array
  /**
   * RG half floats, n×n: distance to the nearest dated Roman road (m), and that road's
   * packed code — see packRoad. Roads are drawn by the shader only from their year.
   */
  roads: Uint16Array
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
 * pixel is exactly 0, which is why depth is baked separately.
 */
const ELEVATION: MercatorSource = {
  url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  tileSize: 512,
  maxZoom: 12,
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
  return decodeImage(await res.blob())
}

async function decodeImage(blob: Blob): Promise<{ rgba: Uint8ClampedArray; width: number }> {
  // These images are data, not pictures: any colour management or premultiplication
  // corrupts them — the same class of bug as the PNG colour profiles that shift
  // province ids by one or two in the EU4 web map.
  const bitmap = await createImageBitmap(blob, {
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
  /** Levels with tile codes; below it the pack head says whether a tile was written. */
  codeLevel: number
  distanceTexels: number
  codes: Uint8Array[]
  store: TileStore
}

let waterIndex: Promise<WaterIndex | null> | null = null

function loadWaterIndex() {
  waterIndex ??= fetch('/water/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) =>
      j
        ? {
            maxLevel: j.maxLevel,
            // Masks from before the packs: every level has codes, and tiles are loose.
            codeLevel: j.codeLevel ?? j.maxLevel,
            distanceTexels: j.distanceTexels,
            codes: (j.codes as string[]).map((b) =>
              Uint8Array.from(atob(b), (c) => c.charCodeAt(0)),
            ),
            store: new TileStore('/water', 'webp', j.packLevel ?? Infinity),
          }
        : null,
    )
    .catch(() => null)
  return waterIndex
}

/**
 * Signed distance to shore in metres for every texel of the tile, from the deepest
 * mask tile written at or above it — the tile itself where it has shore, otherwise a
 * window of its nearest ancestor that does, bilinearly, the same thing the GPU would
 * do. Without a mask (the pipeline has not been run) height decides, as in the first
 * spike.
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
      for (let c = 0; c < N; c++)
        shore[r * N + c] = heights[(r + 1) * m + c + 1] > 0 ? 1e4 : -1e4
    }
    return { shore, floodplain: floodplain.fill(-1e4) }
  }

  // Below the code level, a tile that was not written has no shore within reach: its
  // parent's field says everything there is to say.
  const at = (l: number) => ({
    level: l,
    i: job.i >> (job.level - l),
    j: job.j >> (job.level - l),
  })
  let level = Math.min(job.level, idx.maxLevel)
  while (level > idx.codeLevel && !(await idx.store.has(at(level)))) level--
  const { i: si, j: sj } = at(level)
  const src = tileRect({ level, i: si, j: sj })
  const sstep = src.size / (N - 1)
  const reach = idx.distanceTexels * sstep
  const code = level > idx.codeLevel ? 2 : (idx.codes[level]?.[sj * 2 ** level + si] ?? 0)

  // Codes: 0 all sea, 1 all land outside any floodplain, 2 mixed (tile written),
  // 3 all land inside a floodplain.
  if (code !== 2) {
    shore.fill(code === 0 ? -reach : reach)
    floodplain.fill(code === 3 ? reach : -reach)
    return { shore, floodplain }
  }

  const fields = await cachedMask(idx.store, { level, i: si, j: sj })
  if (!fields) {
    shore.fill(-reach)
    floodplain.fill(-reach)
    return { shore, floodplain }
  }
  const [sField, fField] = fields

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
        out[o] =
          ((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty) * reach
      }
    }
  }
  return { shore, floodplain }
}

const masks = new Map<string, Promise<[Float32Array, Float32Array] | null>>()

/** A mask tile's two channels as −1…1: 0 the shore distance, 1 the floodplain distance. */
function cachedMask(store: TileStore, address: TileAddress) {
  const key = `${address.level}/${address.i}/${address.j}`
  let p = masks.get(key)
  if (p) masks.delete(key)
  else {
    p = store
      .get(address)
      .then(async (bytes) => {
        const img =
          bytes &&
          (await decodeImage(new Blob([bytes as BlobPart], { type: 'image/webp' })))
        if (!img) return null
        const channel = (ch: number) => {
          const f = new Float32Array(N * N)
          for (let k = 0; k < f.length; k++) f[k] = (img.rgba[k * 4 + ch] / 255) * 2 - 1
          return f
        }
        return [channel(0), channel(1)] as [Float32Array, Float32Array]
      })
      .catch(() => null)
    if (masks.size >= CACHE_LIMIT / 2) masks.delete(masks.keys().next().value!)
  }
  masks.set(key, p)
  return p
}

// --- sea depth ----------------------------------------------------------------------

interface DepthIndex {
  maxLevel: number
  packLevel: number
  written: Uint8Array[]
  store: TileStore
}

let depthIndex: Promise<DepthIndex | null> | null = null

function loadDepthIndex() {
  depthIndex ??= fetch('/depth/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) =>
      j
        ? {
            maxLevel: j.maxLevel,
            packLevel: j.packLevel,
            written: (j.written as string[]).map((b) =>
              Uint8Array.from(atob(b), (c) => c.charCodeAt(0)),
            ),
            store: new TileStore('/depth', 'bin', j.packLevel),
          }
        : null,
    )
    .catch(() => null)
  return depthIndex
}

/**
 * Where no depth has been baked (`npm run depth -w pipeline` not run), the sea reads as
 * deep: an honest navy rather than shallows invented everywhere.
 */
const DEPTH_UNKNOWN = -1000

/**
 * Sea depth in metres (≤ 0) for every texel of the tile, row 0 south, from the deepest
 * depth tile written at or above it (pipeline/src/depth), windowed bilinearly. Fine
 * tiles are only written where they add detail, so most of the open sea reads a window
 * of level 6.
 */
async function depthField(job: TileJob): Promise<Float32Array> {
  const out = new Float32Array(N * N)
  const idx = await loadDepthIndex()
  if (!idx) return out.fill(DEPTH_UNKNOWN)

  const at = (l: number) => ({
    level: l,
    i: job.i >> (job.level - l),
    j: job.j >> (job.level - l),
  })
  let level = Math.min(job.level, idx.maxLevel)
  for (; level >= 0; level--) {
    const a = at(level)
    if (level <= idx.packLevel) {
      if (idx.written[level]?.[a.j * 2 ** level + a.i]) break
    } else if (await idx.store.has(a)) break
  }
  // A dry tile under dry ancestors: nothing will read its depth.
  if (level < 0) return out
  const address = at(level)
  const tile = await cached(`/depth/${level}/${address.i}/${address.j}`, () =>
    loadDepthTile(idx.store, address),
  )
  if (!tile) return out.fill(DEPTH_UNKNOWN)

  const src = tileRect(address)
  const sstep = src.size / (N - 1)
  const me = tileRect(job)
  const step = me.size / (N - 1)
  for (let r = 0; r < N; r++) {
    const sy = (me.y0 + r * step - src.y0) / sstep
    const y = Math.min(N - 2, Math.max(0, Math.floor(sy)))
    const ty = sy - y
    for (let c = 0; c < N; c++) {
      const sx = (me.x0 + c * step - src.x0) / sstep
      const x = Math.min(N - 2, Math.max(0, Math.floor(sx)))
      const tx = sx - x
      out[r * N + c] =
        (tile[y * N + x] * (1 - tx) + tile[y * N + x + 1] * tx) * (1 - ty) +
        (tile[(y + 1) * N + x] * (1 - tx) + tile[(y + 1) * N + x + 1] * tx) * ty
    }
  }
  return out
}

async function loadDepthTile(store: TileStore, address: TileAddress) {
  const bytes = await store.get(address)
  if (!bytes) return null
  const inflated = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return decodeDepthTile(new Uint8Array(await new Response(inflated).arrayBuffer()))
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

// --- political field ----------------------------------------------------------------

interface PoliticsIndex {
  maxLevel: number
  distanceTexels: number
  sea: number
  levels: Uint16Array[]
  palettes: Record<string, number[]>
}

let politicsIndex: Promise<PoliticsIndex | null> | null = null

function loadPoliticsIndex() {
  politicsIndex ??= fetch('/politics/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) =>
      j
        ? {
            maxLevel: j.maxLevel,
            distanceTexels: j.distanceTexels,
            sea: j.sea,
            palettes: j.palettes,
            levels: (j.levels as string[]).map((b) => {
              const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
              return new Uint16Array(bytes.buffer)
            }),
          }
        : null,
    )
    .catch(() => null)
  return politicsIndex
}

/** A decoded political tile: labels per texel and signed distance in texels, rows north. */
interface PoliticsTile {
  lo: Uint16Array
  hi: Uint16Array
  d: Float32Array
}

const politicsTiles = new Map<string, Promise<PoliticsTile | null>>()

function loadPoliticsTile(idx: PoliticsIndex, key: string): Promise<PoliticsTile | null> {
  let p = politicsTiles.get(key)
  if (!p) {
    p = pixels(`/politics/${key}.webp`)
      .then((img) => {
        if (!img) return null
        const pal = idx.palettes[key]
        const lo = new Uint16Array(N * N)
        const hi = new Uint16Array(N * N)
        const d = new Float32Array(N * N)
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            // Image row 0 is the north edge; ours runs north.
            const k = ((N - 1 - r) * N + c) * 4
            const o = r * N + c
            lo[o] = pal[img.rgba[k]]
            hi[o] = pal[img.rgba[k + 1]]
            // Square-root scale (encodeDistance in pipeline/src/politics/bake-worker.ts).
            const u = img.rgba[k + 2] / 127.5 - 1
            d[o] = Math.sign(u) * u * u * idx.distanceTexels
          }
        }
        return { lo, hi, d }
      })
      .catch(() => null)
    politicsTiles.set(key, p)
    if (politicsTiles.size > 64) politicsTiles.delete(politicsTiles.keys().next().value!)
  }
  return p
}

/**
 * The political field for every texel of the tile. Tiles at or above the bake's
 * deepest level read their own tile; deeper ones read a window of their ancestor,
 * labels from the nearest texel and distance bilinearly. Distances stay in the
 * ancestor's reach (48 of its texels, ~21 km), not the tile's own, so a glow can be
 * wider than a few of these fine texels.
 */
async function politicsField(job: TileJob): Promise<Uint16Array> {
  const out = new Uint16Array(N * N * 4)
  const idx = await loadPoliticsIndex()
  const fill = (label: number, dKm: number) => {
    const l = toHalf(label)
    const d = toHalf(dKm)
    for (let o = 0; o < N * N; o++) {
      out[o * 4] = l
      out[o * 4 + 1] = l
      out[o * 4 + 2] = d
    }
    return out
  }
  if (!idx) return fill(0, 1)

  const level = Math.min(job.level, idx.maxLevel)
  const shift = job.level - level
  const si = job.i >> shift
  const sj = job.j >> shift
  const src = tileRect({ level, i: si, j: sj })
  const sstep = src.size / (N - 1)
  const km = sstep / 1000
  const code = idx.levels[level]?.[sj * 2 ** level + si] ?? idx.sea
  if (code !== 0xffff) return fill(code, idx.distanceTexels * km)
  const tile = await loadPoliticsTile(idx, `${level}/${si}/${sj}`)
  if (!tile) return fill(idx.sea, idx.distanceTexels * km)

  const me = tileRect(job)
  const step = me.size / (N - 1)
  for (let r = 0; r < N; r++) {
    const sy = (me.y0 + r * step - src.y0) / sstep
    const y = Math.min(N - 2, Math.max(0, Math.floor(sy)))
    const ty = sy - y
    for (let c = 0; c < N; c++) {
      const sx = (me.x0 + c * step - src.x0) / sstep
      const x = Math.min(N - 2, Math.max(0, Math.floor(sx)))
      const tx = sx - x
      const k00 = y * N + x
      const near = k00 + (ty > 0.5 ? N : 0) + (tx > 0.5 ? 1 : 0)
      const lo = tile.lo[near]
      const hi = tile.hi[near]
      const at = (k: number) => alignDistance(lo, hi, tile.lo[k], tile.hi[k], tile.d[k])
      const d =
        (at(k00) * (1 - tx) + at(k00 + 1) * tx) * (1 - ty) +
        (at(k00 + N) * (1 - tx) + at(k00 + N + 1) * tx) * ty
      const o = (r * N + c) * 4
      out[o] = toHalf(lo)
      out[o + 1] = toHalf(hi)
      out[o + 2] = toHalf(d * km)
    }
  }
  return out
}

// --- roads --------------------------------------------------------------------------

/**
 * First year, class and certainty in one integer that half floats hold exactly (≤ 2048):
 * (max(year, −300) + 300) · 6 + class · 3 + certainty. Roads older than 300 BCE are all
 * "always there" to a map that starts in 133.
 */
export function packRoad(year: number, cls: number, certainty: number) {
  return (Math.max(-300, Math.min(-26, year)) + 300) * 6 + cls * 3 + certainty
}

interface RoadIndex {
  /** Segments as ax, ay, bx, by, code. */
  segs: Float32Array
  /** Grid of segment indices, by cell. */
  cells: Map<number, number[]>
}

const ROAD_CELL = 50000
const ROAD_FAR = 60000
let roadIndex: Promise<RoadIndex | null> | null = null

function loadRoads() {
  roadIndex ??= fetch('/roads/roads.bin')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (!buf) return null
      const v = new DataView(buf)
      const lines = v.getUint32(0, true)
      const segs: number[] = []
      let o = 4
      for (let l = 0; l < lines; l++) {
        const n = v.getUint16(o, true)
        const code = packRoad(v.getInt16(o + 2, true), v.getUint8(o + 4), v.getUint8(o + 5))
        o += 6
        let px = 0
        let py = 0
        for (let k = 0; k < n; k++) {
          const x = v.getFloat32(o, true)
          const y = v.getFloat32(o + 4, true)
          o += 8
          if (k > 0) segs.push(px, py, x, y, code)
          px = x
          py = y
        }
      }
      const arr = new Float32Array(segs)
      const cells = new Map<number, number[]>()
      for (let s = 0; s < arr.length / 5; s++) {
        const [ax, ay, bx, by] = [arr[s * 5], arr[s * 5 + 1], arr[s * 5 + 2], arr[s * 5 + 3]]
        const c0 = Math.floor(Math.min(ax, bx) / ROAD_CELL)
        const c1 = Math.floor(Math.max(ax, bx) / ROAD_CELL)
        const r0 = Math.floor(Math.min(ay, by) / ROAD_CELL)
        const r1 = Math.floor(Math.max(ay, by) / ROAD_CELL)
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const key = r * 100000 + c
            let list = cells.get(key)
            if (!list) cells.set(key, (list = []))
            list.push(s)
          }
      }
      return { segs: arr, cells }
    })
    .catch(() => null)
  return roadIndex
}

/** Distance from every texel to the nearest road, and that road's code. */
async function roadField(job: TileJob): Promise<Uint16Array> {
  const out = new Uint16Array(N * N * 2)
  const far = toHalf(ROAD_FAR)
  for (let o = 0; o < N * N; o++) out[o * 2] = far
  const idx = await loadRoads()
  if (!idx) return out
  const { x0, y0, size } = tileRect(job)
  const step = size / (N - 1)
  // Enough reach for a line a few pixels wide, on this tile or magnified as a stand-in.
  const reach = Math.max(8 * step, 400)
  const seen = new Set<number>()
  const c0 = Math.floor((x0 - reach) / ROAD_CELL)
  const c1 = Math.floor((x0 + size + reach) / ROAD_CELL)
  const r0 = Math.floor((y0 - reach) / ROAD_CELL)
  const r1 = Math.floor((y0 + size + reach) / ROAD_CELL)
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const s of idx.cells.get(r * 100000 + c) ?? []) seen.add(s)
  if (!seen.size) return out
  const dist = new Float32Array(N * N).fill(ROAD_FAR)
  const code = new Float32Array(N * N)
  const g = idx.segs
  for (const s of seen) {
    const ax = g[s * 5]
    const ay = g[s * 5 + 1]
    const bx = g[s * 5 + 2]
    const by = g[s * 5 + 3]
    const cc0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step))
    const cc1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step))
    const rr0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - y0) / step))
    const rr1 = Math.min(N - 1, Math.ceil((Math.max(ay, by) + reach - y0) / step))
    if (cc0 > cc1 || rr0 > rr1) continue
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    for (let rr = rr0; rr <= rr1; rr++) {
      const py = y0 + rr * step
      for (let cc = cc0; cc <= cc1; cc++) {
        const px = x0 + cc * step
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        const d = Math.hypot(ax + t * dx - px, ay + t * dy - py)
        const o = rr * N + cc
        // Nearest wins; at a tie the older road, so a junction never waits on the newer.
        if (d < dist[o] - 1 || (Math.abs(d - dist[o]) <= 1 && g[s * 5 + 4] < code[o])) {
          dist[o] = d
          code[o] = g[s * 5 + 4]
        }
      }
    }
  }
  for (let o = 0; o < N * N; o++) {
    out[o * 2] = toHalf(Math.min(dist[o], ROAD_FAR))
    out[o * 2 + 1] = toHalf(code[o])
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

  const [heights, depths, river, politics] = await Promise.all([
    sampleMercator(ELEVATION, lonlat, m * m, zoomFor(ELEVATION, step, lat)),
    depthField(job),
    riverField(job),
    politicsField(job),
  ])
  const roads = await roadField(job)
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
      // Depth as baked. It is not tied to the shore distance: that distance is clamped
      // at 16 mask texels, a reach that differs between tiles with coast and without,
      // and a slope limit built on it capped whole coastal tiles at ~215 m — lighter
      // rectangles round every island.
      water[o * 4 + 1] = toHalf(Math.min(0, depths[o]))
      water[o * 4 + 2] = toHalf(river.dist[o])
      water[o * 4 + 3] = toHalf(river.q[o])
      if (h < minHeight) minHeight = h
      if (h > maxHeight) maxHeight = h
    }
  }

  return { id: job.id, terrain, water, politics, roads, minHeight, maxHeight }
}

self.onmessage = async (e: MessageEvent<TileJob>) => {
  const result = await build(e.data)
  ;(self as unknown as Worker).postMessage(result, [
    result.terrain.buffer,
    result.water.buffer,
    result.politics.buffer,
    result.roads.buffer,
  ])
}
