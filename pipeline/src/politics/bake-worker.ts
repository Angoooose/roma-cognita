/**
 * One tile of the political field: which atom every texel belongs to, which atom lies
 * across the nearest boundary, and how far away that boundary is. Run in a pool, like
 * the coast bake; the main thread sends each job only the atom rings near its tile and
 * the paths of the nine coast-mask tiles around it.
 *
 * The labels, in order of precedence:
 *
 * 1. Inside an atom's outline: that atom.
 * 2. Land just outside every outline, within `SLIVER_M` of both an atom and the sea:
 *    the nearest atom. Atom outlines were clipped to Natural Earth's coast, ours is
 *    OSM's; without this every headland the two disagree on would be a strip of
 *    unclaimed ground with a border round it.
 * 3. A small piece of land no outline covers, within `ISLAND_M` of an atom: the
 *    nearest atom. That is islands, which OSM has far more of than any outline
 *    names, and slivers left between neighbouring outlines, which would otherwise
 *    each draw as a speck of unclaimed land ringed with border.
 * 4. Any other land: unclaimed (label 0). A frontier between an atom and unclaimed
 *    land is a border like any other.
 * 5. Sea within the clamp distance of land: the nearest land's label, so a fill runs
 *    right up to the coast the shader draws from the coast mask, however coarse the
 *    texel. Further out: the sea label, which draws nothing.
 */
import { parentPort } from 'node:worker_threads'
import sharp from 'sharp'
import { TILE_TEXELS } from '@roma-cognita/world'
import { edt, fillPolygons, type Grid, type Ring } from '../water/raster.ts'
import { readTile, type TileSource } from '../water/tiles.ts'
import { encodeDistance } from './encoding.ts'

const N = TILE_TEXELS

export interface AtomRings {
  label: number
  rings: Ring[]
}

/** One of the nine coast-mask tiles around the job: its index code, and where it is if it was written. */
export interface ShoreTile {
  code: number
  source?: TileSource
}

export interface PoliticsJob {
  id: number
  x0: number
  y0: number
  step: number
  atoms: AtomRings[]
  /** Row-major from the south-west, [dj + 1][di + 1]. */
  shore: ShoreTile[]
  /** The coast mask's clamp, in texels. */
  shoreTexels: number
  distanceTexels: number
  supersample: number
  unclaimed: number
  sea: number
}

export type PoliticsResult =
  { id: number; uniform: number } | { id: number; image: Uint8Array; palette: number[] }

const SLIVER_M = 3000
const ISLAND_M = 30000

/** The coast mask around the tile, stitched: signed shore distance in texels, positive on land. */
function stitchShore(job: PoliticsJob): { field: Float32Array; width: number } {
  const width = 3 * (N - 1) + 1
  const field = new Float32Array(width * width)
  const reach = job.shoreTexels
  for (let dj = 0; dj < 3; dj++) {
    for (let di = 0; di < 3; di++) {
      const t = job.shore[dj * 3 + di]
      const data = decoded[dj * 3 + di]
      const uniform = t.code === 0 ? -reach : reach
      for (let r = 0; r < N; r++) {
        // Mask images are stored north-up; the stitched field runs north with its row.
        const src = (N - 1 - r) * N
        const row = (dj * (N - 1) + r) * width + di * (N - 1)
        for (let c = 0; c < N; c++) {
          field[row + c] = data ? (data[src + c] / 255) * 2 * reach - reach : uniform
        }
      }
    }
  }
  return { field, width }
}

/** Channel 0 of each of the job's nine coast tiles, decoded up front (sharp is asynchronous); null where none was written. */
let decoded: (Uint8Array | null)[] = []

async function predecode(job: PoliticsJob) {
  decoded = await Promise.all(
    job.shore.map(async (t) => {
      if (!t.source) return null
      const { data, info } = await sharp(readTile(t.source))
        .raw()
        .toBuffer({ resolveWithObject: true })
      const ch = new Uint8Array(N * N)
      for (let k = 0; k < N * N; k++) ch[k] = data[k * info.channels]
      return ch
    }),
  )
}

async function bake(job: PoliticsJob): Promise<PoliticsResult> {
  await predecode(job)
  const { x0, y0, step, distanceTexels: D, supersample: S, unclaimed: NONE, sea: SEA } = job
  const M = D + 1
  const fstep = step / S
  // Fine samples sit exactly on texel centres every S samples: sample q is at
  // x0 − M·step + q·fstep, and texel c is sample (M + c)·S.
  const w = (N - 1 + 2 * M) * S + 1
  const size = w * w
  const g: Grid = { x0: x0 - M * step, y0: y0 - M * step, step: fstep, width: w, height: w }

  // Shore distance at every fine sample, in metres, from the stitched coast mask.
  const { field, width: sw } = stitchShore(job)
  const shore = new Float32Array(size)
  for (let p = 0; p < w; p++) {
    const Y = N - 1 - M + p / S
    const y = Math.min(sw - 2, Math.max(0, Math.floor(Y)))
    const ty = Y - y
    for (let q = 0; q < w; q++) {
      const X = N - 1 - M + q / S
      const x = Math.min(sw - 2, Math.max(0, Math.floor(X)))
      const tx = X - x
      const a = field[y * sw + x]
      const b = field[y * sw + x + 1]
      const c = field[(y + 1) * sw + x]
      const d = field[(y + 1) * sw + x + 1]
      shore[p * w + q] =
        ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * step
    }
  }

  // 1. Atom outlines.
  const label = new Uint16Array(size)
  const present: number[] = []
  const tmp = new Uint8Array(size)
  for (const a of job.atoms) {
    tmp.fill(0)
    fillPolygons(a.rings, g, tmp)
    let any = false
    for (let k = 0; k < size; k++) {
      if (tmp[k] && !label[k]) {
        label[k] = a.label
        any = true
      }
    }
    if (any) present.push(a.label)
  }

  // Nearest atom, and its squared distance in fine samples, for every sample.
  const bestD2 = new Float64Array(size).fill(Infinity)
  const best = new Uint16Array(size)
  for (const l of present) {
    for (let k = 0; k < size; k++) tmp[k] = label[k] === l ? 1 : 0
    const d2 = edt(tmp, w, w, 1)
    for (let k = 0; k < size; k++) {
      if (d2[k] < bestD2[k]) {
        bestD2[k] = d2[k]
        best[k] = l
      }
    }
  }

  // 2. Slivers between the two coastlines.
  const sliver = (SLIVER_M / fstep) ** 2
  const land = new Uint8Array(size)
  for (let k = 0; k < size; k++) {
    if (shore[k] <= 0) continue
    land[k] = 1
    if (!label[k] && shore[k] < SLIVER_M && bestD2[k] <= sliver) label[k] = best[k]
  }

  // 3. Small islands and slivers no outline covers.
  if (present.length)
    claimSmallPieces(land, label, best, bestD2, w, M * S, (ISLAND_M / fstep) ** 2)

  // 4. Everything else on land stays 0, unclaimed. 5. The sea takes its nearest land.
  for (let k = 0; k < size; k++) tmp[k] = land[k] && !label[k] ? 1 : 0
  const toUnclaimed = edt(tmp, w, w, 1)
  const reach2 = (D * S) ** 2
  const final = new Uint16Array(size)
  for (let k = 0; k < size; k++) {
    if (land[k]) {
      final[k] = label[k] || NONE
      continue
    }
    const du = toUnclaimed[k]
    const da = bestD2[k]
    if (Math.min(du, da) > reach2) final[k] = SEA
    else final[k] = du < da ? NONE : best[k]
  }

  // Distance from every sample to each label's region.
  const labels = [...new Set(final)]
  const dist = new Map<number, Float64Array>()
  for (const l of labels) {
    for (let k = 0; k < size; k++) tmp[k] = final[k] === l ? 1 : 0
    dist.set(l, edt(tmp, w, w, 1))
  }

  // Sample at texel centres: own label, the nearest other (the sea never counts as a
  // neighbour of land — it draws nothing), and the signed distance to that boundary,
  // positive on the side of the larger label so it is continuous across the boundary.
  const palette: number[] = []
  const slot = new Map<number, number>()
  const idx = (l: number) => {
    let s = slot.get(l)
    if (s === undefined) {
      s = palette.length
      palette.push(l)
      slot.set(l, s)
    }
    return s
  }
  const out = new Uint8Array(N * N * 3)
  let uniform = true
  for (let r = 0; r < N; r++) {
    const p = (M + r) * S
    for (let c = 0; c < N; c++) {
      const k = p * w + (M + c) * S
      const own = final[k]
      let other = own
      let d2 = Infinity
      for (const l of labels) {
        if (l === own || (l === SEA && own !== SEA)) continue
        const v = dist.get(l)![k]
        if (v < d2) {
          d2 = v
          other = l
        }
      }
      const s = Math.min(D, Math.max(0, (Math.sqrt(d2) - 0.5) / S))
      let lo = own
      let hi = own
      let d = D
      if (other !== own && s < D) {
        lo = Math.min(own, other)
        hi = Math.max(own, other)
        d = own === hi ? s : -s
      }
      if (lo !== hi || lo !== final[M * S * w + M * S]) uniform = false
      const o = ((N - 1 - r) * N + c) * 3
      out[o] = idx(lo)
      out[o + 1] = idx(hi)
      out[o + 2] = encodeDistance(d, D)
    }
  }
  if (uniform) return { id: job.id, uniform: palette[0] }
  if (palette.length > 256)
    throw new Error(`more than 256 labels in one tile at ${x0}, ${y0}`)

  // Lossless WebP, three channels: no alpha, because browsers premultiply decoded
  // images and a transparent texel would lose its labels.
  const buf = await sharp(out, { raw: { width: N, height: N, channels: 3 } })
    .webp({ lossless: true, effort: 4 })
    .toBuffer()
  const image = new Uint8Array(buf.length)
  image.set(buf)
  return { id: job.id, image, palette }
}

/**
 * Gives each small component of land no atom covers the label of the atom nearest to
 * it, if that is within `reach2`. "Small" means it fits in the margin and does not touch
 * the grid's edge, so every tile that sees the piece sees all of it and labels it the
 * same way.
 */
function claimSmallPieces(
  land: Uint8Array,
  label: Uint16Array,
  best: Uint16Array,
  bestD2: Float64Array,
  w: number,
  maxExtent: number,
  reach2: number,
) {
  const seen = new Uint8Array(land.length)
  const stack: number[] = []
  const members: number[] = []
  const free = (k: number) => land[k] === 1 && label[k] === 0
  for (let start = 0; start < land.length; start++) {
    if (!free(start) || seen[start]) continue
    stack.length = members.length = 0
    stack.push(start)
    seen[start] = 1
    let edge = false
    let minX = w
    let maxX = 0
    let minY = w
    let maxY = 0
    while (stack.length) {
      const k = stack.pop()!
      members.push(k)
      const x = k % w
      const y = (k - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === w - 1) edge = true
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (const n of [
        x > 0 ? k - 1 : -1,
        x < w - 1 ? k + 1 : -1,
        y > 0 ? k - w : -1,
        y < w - 1 ? k + w : -1,
      ]) {
        if (n >= 0 && free(n) && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (edge || maxX - minX > maxExtent || maxY - minY > maxExtent) continue
    let nearest = 0
    let d2 = Infinity
    for (const k of members) {
      if (bestD2[k] < d2) {
        d2 = bestD2[k]
        nearest = best[k]
      }
    }
    if (d2 <= reach2) for (const k of members) label[k] = nearest
  }
}

parentPort!.on('message', async (job: PoliticsJob) => {
  const result = await bake(job)
  const transfer = 'image' in result ? [result.image.buffer as ArrayBuffer] : []
  parentPort!.postMessage(result, transfer)
})
