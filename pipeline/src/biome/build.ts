/**
 * Bakes the climate texture that decides what the ground looks like: how much of each
 * texel is desert, steppe, Mediterranean, or cold/alpine, with humid temperate as the
 * remainder.
 *
 * Source: Beck et al. 2023, Köppen–Geiger 1991–2020 at 1 km (CC BY 4.0). Modern climate
 * as a proxy for ancient ground. That is a known compromise, and it is why this texture
 * only ever blends broad colour families — never draws fields, forests or anything a
 * reader could take for evidence (DESIGN.md §7.1). The Roman climate optimum was, if
 * anything, a little wetter; at a 3.5 km texel and with a ~9 km blur, the frontier of
 * the Sahara is not where that difference would show.
 *
 * Output: build/biome/biome.png, 2048² RGBA over the quadtree root —
 *   R desert (BW), G steppe (BS), B dry-summer (Cs, Ds), A cold (D, E except Ds);
 *   humid temperate (Cf, Cw) is 1 − R − G − B − A.
 *
 *   npm run biome -w pipeline
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromFile } from 'geotiff'
import sharp from 'sharp'
import { DATA_RECT, ROOT, projection } from '@roman-map/world'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(ROOT_DIR, '.cache/sources/koppen/1991_2020/koppen_geiger_0p00833333.tif')
const OUT = join(ROOT_DIR, 'build/biome/biome.png')

const SIZE = 2048
/** Sub-samples per texel side: the 1 km source is averaged, not point-sampled. */
const SUB = 4
/** Gaussian blur, texels (~3.5 km each), so climate zones meet as gradients. */
const BLUR_SIGMA = 2.5

/** Köppen class (legend.txt) → channel, or -1 for humid temperate, which is implicit. */
function channelOf(k: number): number {
  if (k === 4 || k === 5) return 0 // BWh, BWk
  if (k === 6 || k === 7) return 1 // BSh, BSk
  if ((k >= 8 && k <= 10) || (k >= 17 && k <= 20)) return 2 // Cs*, Ds*
  if (k >= 21) return 3 // Dw*, Df*, ET, EF
  return -1 // A (none in frame), Cw*, Cf*
}

async function main() {
  if (!existsSync(SRC)) {
    throw new Error(
      `missing ${SRC}: download koppen_geiger_tif.zip from figshare article 21789074 into .cache/sources and unzip 1991_2020/koppen_geiger_0p00833333.tif into .cache/sources/koppen/`,
    )
  }
  const t0 = Date.now()
  const tiff = await fromFile(SRC)
  const image = await tiff.getImage()
  const [west, south, east, north] = image.getBoundingBox()
  const W = image.getWidth()
  const H = image.getHeight()
  const dx = (east - west) / W
  const dy = (north - south) / H

  // Read only the window the plane rectangle needs, found by walking its edges back
  // to lon/lat (a conic's corners reach past the frame's own meridians).
  let lonMin = Infinity
  let lonMax = -Infinity
  let latMin = Infinity
  let latMax = -Infinity
  for (let k = 0; k <= 256; k++) {
    const t = k / 256
    const { minX, minY, maxX, maxY } = DATA_RECT
    for (const [x, y] of [
      [minX + (maxX - minX) * t, minY],
      [minX + (maxX - minX) * t, maxY],
      [minX, minY + (maxY - minY) * t],
      [maxX, minY + (maxY - minY) * t],
    ]) {
      const [lon, lat] = projection.inverse(x, y)
      lonMin = Math.min(lonMin, lon)
      lonMax = Math.max(lonMax, lon)
      latMin = Math.min(latMin, lat)
      latMax = Math.max(latMax, lat)
    }
  }
  const c0 = Math.max(0, Math.floor((lonMin - 1 - west) / dx))
  const c1 = Math.min(W, Math.ceil((lonMax + 1 - west) / dx))
  const r0 = Math.max(0, Math.floor((north - (latMax + 1)) / dy))
  const r1 = Math.min(H, Math.ceil((north - (latMin - 1)) / dy))
  const [raster] = (await image.readRasters({ window: [c0, r0, c1, r1] })) as unknown as [Uint8Array]
  const ww = c1 - c0
  console.log(`read ${ww}×${r1 - r0} Köppen pixels in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

  // Normalised convolution: accumulate class weights and a validity count separately,
  // blur both, divide. Sea and no-data pixels then take the climate of the nearest
  // land instead of dragging the average towards "temperate", which matters for the
  // coasts — the very places the map is looked at hardest.
  const weights = [0, 1, 2, 3].map(() => new Float32Array(SIZE * SIZE))
  const valid = new Float32Array(SIZE * SIZE)
  const step = ROOT.size / SIZE
  const ll = new Float64Array(2)
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const o = j * SIZE + i
      for (let sj = 0; sj < SUB; sj++) {
        for (let si = 0; si < SUB; si++) {
          const x = ROOT.x + (i + (si + 0.5) / SUB) * step
          const y = ROOT.y + (j + (sj + 0.5) / SUB) * step
          projection.inverseInto(x, y, ll, 0)
          const c = Math.floor((ll[0] - west) / dx) - c0
          const r = Math.floor((north - ll[1]) / dy) - r0
          if (c < 0 || c >= ww || r < 0 || r >= r1 - r0) continue
          const k = raster[r * ww + c]
          if (k === 0) continue
          valid[o]++
          const ch = channelOf(k)
          if (ch >= 0) weights[ch][o]++
        }
      }
    }
  }
  console.log(`sampled in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

  const blurredValid = blur(valid)
  const out = new Uint8Array(SIZE * SIZE * 4)
  const blurred = weights.map(blur)
  for (let o = 0; o < SIZE * SIZE; o++) {
    const v = blurredValid[o]
    for (let ch = 0; ch < 4; ch++) {
      out[o * 4 + ch] = v > 1e-6 ? Math.round(Math.min(1, blurred[ch][o] / v) * 255) : 0
    }
  }
  // Image row 0 is the north edge, as for the coast mask.
  const flipped = new Uint8Array(out.length)
  for (let j = 0; j < SIZE; j++) {
    flipped.set(out.subarray(j * SIZE * 4, (j + 1) * SIZE * 4), (SIZE - 1 - j) * SIZE * 4)
  }
  mkdirSync(dirname(OUT), { recursive: true })
  await sharp(flipped, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT)
  console.log(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

/** Separable Gaussian, clamped at the edges. */
function blur(src: Float32Array): Float32Array {
  const r = Math.ceil(BLUR_SIGMA * 3)
  const kernel = new Float32Array(2 * r + 1)
  let sum = 0
  for (let k = -r; k <= r; k++) sum += kernel[k + r] = Math.exp(-(k * k) / (2 * BLUR_SIGMA ** 2))
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const ii = Math.min(SIZE - 1, Math.max(0, i + k))
        acc += src[j * SIZE + ii] * kernel[k + r]
      }
      tmp[j * SIZE + i] = acc
    }
  }
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const jj = Math.min(SIZE - 1, Math.max(0, j + k))
        acc += tmp[jj * SIZE + i] * kernel[k + r]
      }
      out[j * SIZE + i] = acc
    }
  }
  return out
}

await main()
