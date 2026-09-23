/**
 * The two bathymetry sources behind the depth tiles, read into lon/lat rasters.
 *
 * - GEBCO_2026 (15″, ~460 m), everywhere. Two GeoTIFF quadrants of the ice-surface grid
 *   (the sub-ice grid differs only under ice sheets, none of which are in the frame).
 * - EMODnet Bathymetry DTM (1/16′, ~115 m), wherever it reaches: the Mediterranean, the
 *   Black Sea and the European Atlantic, i.e. every coast that matters most up close.
 *   Fetched in 2° chunks from EMODnet's WCS, since the bulk downloads are per-sea
 *   archives several times the size of what the frame needs.
 *
 * Both sources carry land heights as well as sea depths, and neither agrees with the
 * OSM coast the map draws — GEBCO's shore can sit half a kilometre off it. Where the
 * coast mask says sea but a source says land, the old runtime sampling read depth 0
 * and drew a turquoise fringe that had nothing to do with the sea floor. So each
 * source's sea is extended a short way under its land (`extendSea`): the renderer
 * then finds a real neighbouring depth wherever the mask puts water.
 *
 * Land and "no value" are both NaN in these rasters.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromArrayBuffer, fromFile } from 'geotiff'

export const LICENCES = {
  gebco: 'GEBCO Compilation Group (2026) GEBCO 2026 Grid; public domain with attribution',
  emodnet:
    'EMODnet Bathymetry Consortium (2024) EMODnet Digital Bathymetry (DTM 2024), CC BY 4.0',
}

export const GEBCO_PER_DEG = 240
export const GEBCO_FILES = [
  { file: 'gebco_2026_n90.0_s0.0_w-90.0_e0.0_geotiff.tif', west: -90, east: 0 },
  { file: 'gebco_2026_n90.0_s0.0_w0.0_e90.0_geotiff.tif', west: 0, east: 90 },
]
export const GEBCO_URL =
  'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/ice_surface_elevation/geotiff/'

export const EMODNET_PER_DEG = 960
export const EMODNET_CHUNK_DEG = 2
const EMODNET_CHUNK = EMODNET_PER_DEG * EMODNET_CHUNK_DEG
/** EMODnet's coverage (DescribeCoverage, 2026-09-23): 11°N–90°N, 70.5°W–43°E. */
export const EMODNET_EXTENT = { west: -70.5, east: 43, south: 11, north: 90 }
const EMODNET_WCS = 'https://ows.emodnet-bathymetry.eu/wcs'

/** How far each source's sea is carried under its land, in its own pixels (~1.8 km, ~3.7 km). */
const EMODNET_EXTEND = 16
const GEBCO_EXTEND = 8

/**
 * Water whose surface is not sea level. Depth there is measured from its own surface,
 * and anything above that surface is shore. Levels are modern, like the coast they sit
 * in: the Caspian at −28 m, the Dead Sea at −430 m.
 */
const SURFACES = [
  { name: 'Caspian', west: 46, east: 56, south: 36, north: 48, surface: -28 },
  { name: 'Dead Sea', west: 35.3, east: 35.7, south: 30.9, north: 31.9, surface: -430 },
]

/** Source height (m) at lon/lat → depth below the local water surface, or NaN on land. */
function toDepth(h: number, lon: number, lat: number) {
  if (!Number.isFinite(h) || h < -12000 || h > 10000) return NaN
  for (const s of SURFACES) {
    if (lon >= s.west && lon <= s.east && lat >= s.south && lat <= s.north) {
      return h < s.surface ? h - s.surface : NaN
    }
  }
  return h < 0 ? h : NaN
}

/** A lon/lat raster, pixel-is-area: pixel (0, 0) covers [west, west + 1/perDeg] × [north − 1/perDeg, north]. */
export interface LonLatRaster {
  west: number
  north: number
  perDeg: number
  width: number
  height: number
  data: Float32Array
}

/**
 * The GEBCO window over `box` (whole degrees), as depth with land NaN, sea extended
 * under the land. Backed by a SharedArrayBuffer so the bake workers share one copy.
 */
export async function readGebco(
  cache: string,
  box: { west: number; east: number; south: number; north: number },
): Promise<LonLatRaster> {
  const west = Math.floor(box.west)
  const east = Math.ceil(box.east)
  const south = Math.floor(box.south)
  const north = Math.ceil(box.north)
  const width = (east - west) * GEBCO_PER_DEG
  const height = (north - south) * GEBCO_PER_DEG
  const data = new Float32Array(new SharedArrayBuffer(width * height * 4)).fill(NaN)
  for (const q of GEBCO_FILES) {
    const w = Math.max(west, q.west)
    const e = Math.min(east, q.east)
    if (w >= e) continue
    const path = join(cache, 'gebco', q.file)
    if (!existsSync(path))
      throw new Error(`missing ${path} — download it from ${GEBCO_URL}`)
    const tiff = await fromFile(path)
    const img = await tiff.getImage()
    // Quadrants span 90°N–0°, their west edge to their east edge.
    const x0 = (w - q.west) * GEBCO_PER_DEG
    const x1 = (e - q.west) * GEBCO_PER_DEG
    const y0 = (90 - north) * GEBCO_PER_DEG
    const y1 = (90 - south) * GEBCO_PER_DEG
    const [band] = (await img.readRasters({
      window: [x0, y0, x1, y1],
    })) as unknown as ArrayLike<number>[]
    const bw = x1 - x0
    const ox = (w - west) * GEBCO_PER_DEG
    for (let r = 0; r < height; r++) {
      const lat = north - (r + 0.5) / GEBCO_PER_DEG
      for (let c = 0; c < bw; c++) {
        const lon = w + (c + 0.5) / GEBCO_PER_DEG
        data[r * width + ox + c] = toDepth(band[r * bw + c], lon, lat)
      }
    }
  }
  extendSea(data, width, height, GEBCO_EXTEND)
  return { west, north, perDeg: GEBCO_PER_DEG, width, height, data }
}

/**
 * Halves a raster: each pixel the mean of the valid pixels of its 2×2 block, NaN only
 * where all four are. The overview levels sample these rather than the full grid, so a
 * 7 km texel is the mean of the sea under it, not one arbitrary point of it.
 */
export function halve(src: LonLatRaster): LonLatRaster {
  const width = Math.ceil(src.width / 2)
  const height = Math.ceil(src.height / 2)
  const data = new Float32Array(new SharedArrayBuffer(width * height * 4))
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let sum = 0
      let n = 0
      for (let dy = 0; dy < 2; dy++) {
        const y = r * 2 + dy
        if (y >= src.height) continue
        for (let dx = 0; dx < 2; dx++) {
          const x = c * 2 + dx
          if (x >= src.width) continue
          const v = src.data[y * src.width + x]
          if (v === v) {
            sum += v
            n++
          }
        }
      }
      data[r * width + c] = n ? sum / n : NaN
    }
  }
  return { west: src.west, north: src.north, perDeg: src.perDeg / 2, width, height, data }
}

/**
 * Carries valid values `steps` pixels into the NaN around them, one ring at a time,
 * each new pixel the mean of its valid 8-neighbours. Only the frontier is visited, so
 * the cost is the length of the coast, not the area of the raster.
 */
export function extendSea(
  data: Float32Array,
  width: number,
  height: number,
  steps: number,
) {
  let frontier: number[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const k = r * width + c
      if (data[k] === data[k]) continue
      if (hasValidNeighbour(data, width, height, r, c)) frontier.push(k)
    }
  }
  for (let s = 0; s < steps && frontier.length; s++) {
    const values = new Float32Array(frontier.length)
    frontier.forEach((k, n) => {
      const r = (k / width) | 0
      const c = k - r * width
      let sum = 0
      let cnt = 0
      for (let dy = -1; dy <= 1; dy++) {
        const y = r + dy
        if (y < 0 || y >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const x = c + dx
          if (x < 0 || x >= width || (dx === 0 && dy === 0)) continue
          const v = data[y * width + x]
          if (v === v) {
            sum += v
            cnt++
          }
        }
      }
      values[n] = sum / cnt
    })
    frontier.forEach((k, n) => (data[k] = values[n]))
    const next = new Set<number>()
    for (const k of frontier) {
      const r = (k / width) | 0
      const c = k - r * width
      for (let dy = -1; dy <= 1; dy++) {
        const y = r + dy
        if (y < 0 || y >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const x = c + dx
          if (x < 0 || x >= width) continue
          const q = y * width + x
          if (data[q] !== data[q]) next.add(q)
        }
      }
    }
    frontier = [...next]
  }
}

function hasValidNeighbour(
  data: Float32Array,
  width: number,
  height: number,
  r: number,
  c: number,
) {
  for (let dy = -1; dy <= 1; dy++) {
    const y = r + dy
    if (y < 0 || y >= height) continue
    for (let dx = -1; dx <= 1; dx++) {
      const x = c + dx
      if (x < 0 || x >= width) continue
      const v = data[y * width + x]
      if (v === v) return true
    }
  }
  return false
}

/** South-west corner of the EMODnet chunk holding lon/lat. */
export function emodnetChunkOf(lon: number, lat: number) {
  return {
    west: Math.floor(lon / EMODNET_CHUNK_DEG) * EMODNET_CHUNK_DEG,
    south: Math.floor(lat / EMODNET_CHUNK_DEG) * EMODNET_CHUNK_DEG,
  }
}

export function emodnetChunkPath(cache: string, west: number, south: number) {
  return join(cache, 'emodnet', `${south}_${west}.f32`)
}

/**
 * Fetches one chunk, converts it to depth with land NaN, extends the sea under the land
 * and saves the 2° core as raw little-endian float32 (row 0 north). A margin is
 * fetched so the extension near the chunk edge sees its neighbours' sea. A chunk with
 * no sea at all is saved empty, so it is never fetched again. False if the service
 * failed every attempt.
 */
export async function fetchEmodnetChunk(
  cache: string,
  west: number,
  south: number,
): Promise<boolean> {
  const path = emodnetChunkPath(cache, west, south)
  if (existsSync(path)) return true
  mkdirSync(join(cache, 'emodnet'), { recursive: true })
  const m = EMODNET_EXTEND / EMODNET_PER_DEG
  const url =
    `${EMODNET_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=emodnet__mean&format=image/tiff` +
    `&subset=Lat(${south - m},${south + EMODNET_CHUNK_DEG + m})&subset=Long(${west - m},${west + EMODNET_CHUNK_DEG + m})`
  let buf: ArrayBuffer | null = null
  for (let attempt = 0; attempt < 6 && !buf; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('tiff'))
        buf = await res.arrayBuffer()
    } catch {
      // retried below
    }
    if (!buf) await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
  }
  // Nothing is saved, so the next build tries again; until then GEBCO stands in.
  if (!buf) return false
  const img = await (await fromArrayBuffer(buf)).getImage()
  const [bw0, bs0, be0, bn0] = img.getBoundingBox()
  const width = img.getWidth()
  const height = img.getHeight()
  const [band] = (await img.readRasters()) as unknown as ArrayLike<number>[]
  const data = new Float32Array(width * height)
  const px = (be0 - bw0) / width
  const py = (bn0 - bs0) / height
  let sea = 0
  for (let r = 0; r < height; r++) {
    const lat = bn0 - (r + 0.5) * py
    for (let c = 0; c < width; c++) {
      const v = toDepth(band[r * width + c], bw0 + (c + 0.5) * px, lat)
      data[r * width + c] = v
      if (v === v) sea++
    }
  }
  if (!sea) {
    writeFileSync(path, new Uint8Array(0))
    return true
  }
  extendSea(data, width, height, EMODNET_EXTEND)
  // Crop the margin: the core starts where the chunk's own north-west corner falls.
  const cx = Math.round((west - bw0) / px)
  const cy = Math.round((bn0 - (south + EMODNET_CHUNK_DEG)) / py)
  const core = new Float32Array(EMODNET_CHUNK * EMODNET_CHUNK)
  for (let r = 0; r < EMODNET_CHUNK; r++) {
    for (let c = 0; c < EMODNET_CHUNK; c++) {
      const y = cy + r
      const x = cx + c
      core[r * EMODNET_CHUNK + c] =
        y >= 0 && y < height && x >= 0 && x < width ? data[y * width + x] : NaN
    }
  }
  writeFileSync(path, new Uint8Array(core.buffer))
  return true
}

/** A saved chunk, or null where it has no sea (or was never fetched). */
export function readEmodnetChunk(
  cache: string,
  west: number,
  south: number,
): Float32Array | null {
  const path = emodnetChunkPath(cache, west, south)
  if (!existsSync(path)) return null
  const b = readFileSync(path)
  if (!b.length) return null
  // Copied: a Buffer's byteOffset need not be float-aligned.
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
}

export const EMODNET_CHUNK_TEXELS = EMODNET_CHUNK
