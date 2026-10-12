/**
 * The coast mask's third channel: where the water is ancient sea. Split out of the bake
 * worker so it can be tested without one.
 */
import { TILE_TEXELS } from '@roma-cognita/world'
import { fillPolygons, signedDistance, type Grid, type Ring } from './raster.ts'

/** A tile's rings for channel 2, from `reach` metres round it (see water/build.ts). */
export interface AncientJob {
  reach: number
  /** The add-water shapes whose surface was the sea. */
  sea: Ring[]
  land: Ring[]
  lakes: Ring[]
  removeWater: Ring[]
  addWater: Ring[]
}

/**
 * Channel 2: inside ancient sea — an add-water shape whose surface was the sea, where
 * the finished mask is water — 1 + 254 × the distance to the nearest edge of that
 * water (the ancient shore, or where the shape ends in open sea), clamped at `reach`;
 * 0 elsewhere. The engine lays the ground there at sea level and gives it a depth from
 * the distance, so an old bay reads as sea and not as a lake on today's plain. Texels
 * within one grid cell outside it read 1, so the flattening reaches the drawn shore
 * even where the two grids disagree; the engine applies it only where channel 0 says
 * water.
 *
 * A shape may shelve more gently than `reach` (its rings' `shelf`, m): an uncertain
 * shore drawn across a belt of tidal flats, like the head of the Gulf. Its distance is
 * scaled so that `shelf` encodes as `reach`, and the engine's ramp, unchanged, runs
 * over the longer distance: broad pale shallows where the sources describe flats, and
 * not a crisp coast falling straight into the sea.
 *
 * Measured on its own grid over the tile plus the widest shelf: exact to a grid cell
 * (at most that / 64, ~60 m for the usual 4 km), which is ample for a depth ramp.
 */
export function ancientChannel(a: AncientJob, x0: number, y0: number, step: number, out: Uint8Array) {
  const widest = Math.max(a.reach, ...a.sea.map((r) => r.shelf ?? a.reach))
  const cell = Math.max(step, widest / 64)
  const margin = Math.ceil(widest / cell) + 2
  const span = (TILE_TEXELS - 1) * step
  const w = Math.ceil(span / cell) + 1 + 2 * margin
  const g: Grid = { x0: x0 - margin * cell, y0: y0 - margin * cell, step: cell, width: w, height: w }
  const water = new Uint8Array(w * w)
  const land = new Uint8Array(w * w)
  const scratch = new Uint8Array(w * w)
  fillPolygons(a.land, g, land)
  fillPolygons(a.lakes, g, scratch)
  for (let k = 0; k < land.length; k++) if (scratch[k]) land[k] = 0
  scratch.fill(0)
  fillPolygons(a.removeWater, g, scratch)
  for (let k = 0; k < land.length; k++) if (scratch[k]) land[k] = 1
  scratch.fill(0)
  fillPolygons(a.addWater, g, scratch)
  for (let k = 0; k < land.length; k++) if (scratch[k]) land[k] = 0
  scratch.fill(0)
  fillPolygons(a.sea, g, scratch)
  for (let k = 0; k < water.length; k++) water[k] = scratch[k] && !land[k] ? 1 : 0
  // Metres of encoded distance per metre of ground, by grid cell: 1 but where a shape shelves more gently.
  const scale = new Float32Array(w * w).fill(1)
  for (const shelf of new Set(a.sea.map((r) => r.shelf).filter((s) => s && s > a.reach))) {
    scratch.fill(0)
    fillPolygons(
      a.sea.filter((r) => r.shelf === shelf),
      g,
      scratch,
    )
    for (let k = 0; k < scale.length; k++) if (scratch[k]) scale[k] = Math.min(scale[k], a.reach / shelf!)
  }
  const d = signedDistance(water, w, w)
  for (let r = 0; r < TILE_TEXELS; r++) {
    const fy = (r * step) / cell + margin
    const y = Math.min(w - 2, Math.floor(fy))
    const ty = fy - y
    for (let c = 0; c < TILE_TEXELS; c++) {
      const fx = (c * step) / cell + margin
      const x = Math.min(w - 2, Math.floor(fx))
      const tx = fx - x
      const v =
        (d[y * w + x] * (1 - tx) + d[y * w + x + 1] * tx) * (1 - ty) +
        (d[(y + 1) * w + x] * (1 - tx) + d[(y + 1) * w + x + 1] * tx) * ty
      const o = ((TILE_TEXELS - 1 - r) * TILE_TEXELS + c) * 3 + 2
      const k = Math.round(fy) * w + Math.round(fx)
      out[o] = v < -1 ? 0 : 1 + Math.round((254 * Math.min(Math.max(v, 0) * cell * scale[k], a.reach)) / a.reach)
    }
  }
}

