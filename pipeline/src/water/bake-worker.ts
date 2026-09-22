/**
 * One shore tile: rasterise, distance-transform, sample, encode. The expensive part of
 * the coast build, run in a pool so it uses every core. The main thread keeps the ring
 * index and sends each job only the rings near its tile.
 */
import { parentPort } from 'node:worker_threads'
import sharp from 'sharp'
import { TILE_TEXELS } from '@roman-map/world'
import { fillPolygons, signedDistance, type Grid, type Ring } from './raster.ts'

export interface BakeJob {
  id: number
  x0: number
  y0: number
  step: number
  land: Ring[]
  lakes: Ring[]
  distanceTexels: number
  supersample: number
}

export interface BakeResult {
  id: number
  image: Uint8Array
}

async function bake(job: BakeJob): Promise<Uint8Array<ArrayBuffer>> {
  const { x0, y0, step, distanceTexels, supersample: S } = job
  const margin = distanceTexels + 1
  const fstep = step / S
  const w = (TILE_TEXELS - 1 + 2 * margin) * S
  // Fine sample q sits at x0 − margin·step + (q + ½)·fstep, so the grid covers the tile
  // plus the margin exactly and texel centres fall midway between fine samples.
  const g: Grid = {
    x0: x0 - margin * step + fstep / 2,
    y0: y0 - margin * step + fstep / 2,
    step: fstep,
    width: w,
    height: w,
  }
  const landMask = new Uint8Array(w * w)
  const lakeMask = new Uint8Array(w * w)
  fillPolygons(job.land, g, landMask)
  fillPolygons(job.lakes, g, lakeMask)
  for (let k = 0; k < landMask.length; k++) if (lakeMask[k]) landMask[k] = 0
  const sdf = signedDistance(landMask, w, w)

  const out = new Uint8Array(TILE_TEXELS * TILE_TEXELS)
  const scale = 127.5 / (distanceTexels * S)
  for (let r = 0; r < TILE_TEXELS; r++) {
    // Texel (c, r) sits at fine coordinate (margin + c)·S − ½: bilinear between two
    // samples in each axis, which is the sub-texel placement the supersampling paid for.
    const fy = (margin + r) * S - 0.5
    const y = Math.floor(fy)
    const ty = fy - y
    for (let c = 0; c < TILE_TEXELS; c++) {
      const fx = (margin + c) * S - 0.5
      const x = Math.floor(fx)
      const tx = fx - x
      const a = sdf[y * w + x]
      const b = sdf[y * w + x + 1]
      const cc = sdf[(y + 1) * w + x]
      const d = sdf[(y + 1) * w + x + 1]
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty
      // Rows run north in the plane but south in an image. Image row 0 is the north
      // edge, so a tile opened in any viewer is the right way up; the engine's reader
      // knows the convention.
      out[(TILE_TEXELS - 1 - r) * TILE_TEXELS + c] = Math.round(
        Math.max(0, Math.min(255, 127.5 + v * scale)),
      )
    }
  }
  // Lossless WebP: a quarter the size of PNG on these smooth ramps (4.8 KB against
  // 18.6 KB a tile, measured on level 5), and every value survives exactly. Effort 4,
  // not 6: measured on level 6, effort 6 is 3.91 KB at 95 ms a tile against 3.77 KB at
  // 9.7 ms — it was most of the build's time and bought nothing.
  const buf = await sharp(out, { raw: { width: TILE_TEXELS, height: TILE_TEXELS, channels: 1 } })
    .webp({ lossless: true, effort: 4 })
    .toBuffer()
  // Copied out of sharp's Buffer, which may be a slice of a shared pool and so cannot
  // be transferred to the main thread.
  const copy = new Uint8Array(buf.length)
  copy.set(buf)
  return copy
}

parentPort!.on('message', async (job: BakeJob) => {
  const image = await bake(job)
  parentPort!.postMessage({ id: job.id, image } satisfies BakeResult, [image.buffer])
})
