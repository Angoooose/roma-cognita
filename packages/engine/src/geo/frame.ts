import { albers, type AlbersParams } from './albers.ts'

/**
 * The fixed geometry of the world: projection, frame and the quadtree root.
 *
 * These are frozen once the pipeline ships (DESIGN.md §4) — every baked output is in
 * this plane, so changing a number here means rebuilding every file. 30°/50° keeps
 * the Mediterranean core within 1.5% scale error and lets Scotland pay 5%.
 */
export const PROJECTION: AlbersParams = { parallels: [30, 50], lon0: 20, lat0: 40 }

/** What the map is about, in degrees. */
export const FRAME = { west: -10, east: 50, south: 22, north: 58 }

/** How far data carries past the frame, so nothing is cut off at its edge. */
export const DATA_MARGIN_DEG = 3

export const projection = albers(PROJECTION)

export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The frame's bounds in the plane. A lon/lat box is not a box on a conic — parallels
 * are arcs and meridians converge — so the edges are walked, not just the corners.
 */
export function frameRect(marginDeg = 0): Rect {
  const w = FRAME.west - marginDeg
  const e = FRAME.east + marginDeg
  const s = FRAME.south - marginDeg
  const n = FRAME.north + marginDeg
  const r: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const steps = 64
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    for (const [lon, lat] of [
      [w + (e - w) * t, s],
      [w + (e - w) * t, n],
      [w, s + (n - s) * t],
      [e, s + (n - s) * t],
    ]) {
      const [x, y] = projection.forward(lon, lat)
      r.minX = Math.min(r.minX, x)
      r.minY = Math.min(r.minY, y)
      r.maxX = Math.max(r.maxX, x)
      r.maxY = Math.max(r.maxY, y)
    }
  }
  return r
}

/**
 * The quadtree root: the smallest square, centred on the data rect, that covers it.
 * Square so every level halves cleanly; tiles past the data rect are simply never
 * selected.
 */
export const DATA_RECT = frameRect(DATA_MARGIN_DEG)
export const ROOT = (() => {
  const cx = (DATA_RECT.minX + DATA_RECT.maxX) / 2
  const cy = (DATA_RECT.minY + DATA_RECT.maxY) / 2
  const size = Math.max(DATA_RECT.maxX - DATA_RECT.minX, DATA_RECT.maxY - DATA_RECT.minY)
  return { x: cx - size / 2, y: cy - size / 2, size }
})()
