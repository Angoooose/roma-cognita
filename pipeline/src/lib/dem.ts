/**
 * Terrain for the offline feature derivations: Mapterhorn Terrarium tiles, fetched
 * once and cached on disk, mosaicked into a Web Mercator raster over a lon/lat box.
 *
 * Mapterhorn (https://mapterhorn.com) serves 512 px WebP tiles to z12, built mostly
 * from Copernicus GLO-30 in the regions this project derives from. Terrarium
 * encoding: h = R·256 + G + B/256 − 32768 metres. It is land-only: the sea reads
 * exactly 0, which is how `isSea` below tells sea from land.
 *
 * The raster stays in Web Mercator pixel space. Mercator is conformal, so nearest-
 * neighbour distances in pixels are true distances locally, scaled by cos φ — which
 * `pixelMetres` accounts for when a threshold or an area is in metres.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { ROOT_DIR } from '../load.ts'

export const DEM_CACHE = join(ROOT_DIR, '.cache/mapterhorn')
const URL = (z: number, x: number, y: number) =>
  `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`
export const TILE = 512
const EARTH_CIRCUMFERENCE = 40075016.686

export interface Bbox {
  west: number
  south: number
  east: number
  north: number
}

/** A Web Mercator raster: global pixel (x0 + i, y0 + j) at zoom z holds data[j·width + i]. */
export interface Raster {
  z: number
  x0: number
  y0: number
  width: number
  height: number
  data: Float32Array
}

const worldPx = (z: number) => TILE * 2 ** z

export function lonLatToPixel(z: number, lon: number, lat: number): [number, number] {
  const n = worldPx(z)
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}

export function pixelToLonLat(z: number, px: number, py: number): [number, number] {
  const n = worldPx(z)
  const lon = (px / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI
  return [lon, lat]
}

/** Ground size of one pixel, in metres, at a global pixel row. */
export function pixelMetres(z: number, py: number): number {
  const [, lat] = pixelToLonLat(z, 0, py)
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / worldPx(z)
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const path = join(DEM_CACHE, `${z}/${x}/${y}.webp`)
  const missing = `${path}.404`
  if (existsSync(path)) return readFileSync(path)
  if (existsSync(missing)) return null
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(URL(z, x, y))
      if (res.status === 404) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(missing, '')
        return null
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, buf)
      return buf
    } catch (err) {
      if (attempt >= 4) throw new Error(`tile ${z}/${x}/${y}: ${(err as Error).message}`)
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

async function decodeTile(buf: Buffer): Promise<Float32Array> {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== TILE || info.height !== TILE)
    throw new Error(`expected ${TILE}px tiles, got ${info.width}×${info.height}`)
  const out = new Float32Array(TILE * TILE)
  for (let i = 0; i < out.length; i++) {
    out[i] = data[i * 3] * 256 + data[i * 3 + 1] + data[i * 3 + 2] / 256 - 32768
  }
  return out
}

/** Mosaics every tile touching `bbox` at zoom `z`. Absent tiles (open sea) read 0. */
export async function readDem(
  bbox: Bbox,
  z: number,
  log: (s: string) => void = () => {},
): Promise<Raster> {
  const [px0, py0] = lonLatToPixel(z, bbox.west, bbox.north)
  const [px1, py1] = lonLatToPixel(z, bbox.east, bbox.south)
  const tx0 = Math.floor(px0 / TILE)
  const ty0 = Math.floor(py0 / TILE)
  const tx1 = Math.floor(px1 / TILE)
  const ty1 = Math.floor(py1 / TILE)
  const tw = tx1 - tx0 + 1
  const th = ty1 - ty0 + 1
  const r: Raster = {
    z,
    x0: tx0 * TILE,
    y0: ty0 * TILE,
    width: tw * TILE,
    height: th * TILE,
    data: new Float32Array(tw * TILE * th * TILE),
  }
  const jobs: [number, number][] = []
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty])
  log(`  DEM z${z}: ${jobs.length} tiles (${r.width}×${r.height} px)`)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const [tx, ty] = jobs[next++]
      const buf = await fetchTile(z, tx, ty)
      if (!buf) continue
      const tile = await decodeTile(buf)
      const ox = (tx - tx0) * TILE
      const oy = (ty - ty0) * TILE
      for (let j = 0; j < TILE; j++) {
        r.data.set(tile.subarray(j * TILE, (j + 1) * TILE), (oy + j) * r.width + ox)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return r
}

/** Mapterhorn writes the sea as exactly 0 m; real land essentially never is. */
export const isSea = (h: number) => h === 0
