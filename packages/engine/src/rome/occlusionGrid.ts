/**
 * The grid the model of Rome's soft shading is read from (ModelLayer `Occlusion`):
 * the height of whatever stands in each cell, over its ground, blurred at two reaches.
 * Pure, so it can be built off the main thread (occlusionWorker.ts).
 */

/** The grid's cell, metres, the reach of its two blurs, cells, and its height step, metres. */
export const OCC_CELL_M = 2
export const OCC_BLUR = [2, 6]
export const OCC_STEP_M = 0.2

export interface GridFrame {
  nx: number
  ny: number
  x0: number
  y0: number
}

/**
 * The grid for a year, from the tops (Builder `tops`: triangles as x, y, height ×3,
 * then their years): `raw`, the height in each cell, and `data`, the two blurs as
 * bytes of OCC_STEP_M, interleaved.
 */
export function shadeGrid(tops: ArrayLike<number>, f: GridFrame, year: number) {
  const { nx, ny, x0, y0 } = f
  const grid = new Float32Array(nx * ny)
  const mark = (x: number, y: number, h: number) => {
    const k = Math.floor(y) * nx + Math.floor(x)
    if (grid[k] < h) grid[k] = h
  }
  for (let i = 0; i < tops.length; i += 11) {
    if (year < tops[i + 9] || year > tops[i + 10]) continue
    const ax = (tops[i] - x0) / OCC_CELL_M
    const ay = (tops[i + 1] - y0) / OCC_CELL_M
    const bx = (tops[i + 3] - x0) / OCC_CELL_M
    const by = (tops[i + 4] - y0) / OCC_CELL_M
    const qx = (tops[i + 6] - x0) / OCC_CELL_M
    const qy = (tops[i + 7] - y0) / OCC_CELL_M
    const h = Math.max(tops[i + 2], tops[i + 5], tops[i + 8])
    if (h <= 0) continue
    mark(ax, ay, h)
    mark(bx, by, h)
    mark(qx, qy, h)
    const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
    if (Math.abs(area) < 1e-6) continue
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, qx)))
    const i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, qx)))
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, qy)))
    const j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by, qy)))
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5
      for (let ii = i0; ii <= i1; ii++) {
        const px = ii + 0.5
        const w0 = ((bx - px) * (qy - py) - (by - py) * (qx - px)) / area
        const w1 = ((qx - px) * (ay - py) - (qy - py) * (ax - px)) / area
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue
        const k = j * nx + ii
        if (grid[k] < h) grid[k] = h
      }
    }
  }
  const data = new Uint8Array(nx * ny * 2)
  const [out, tmp] = [new Float32Array(grid.length), new Float32Array(grid.length)]
  for (const [c, r] of OCC_BLUR.entries()) {
    blur(grid, tmp, out, nx, ny, r)
    blur(out, tmp, out, nx, ny, r)
    for (let k = 0; k < out.length; k++)
      data[k * 2 + c] = Math.min(255, Math.round(out[k] / OCC_STEP_M))
  }
  return { raw: grid, data }
}

/**
 * A box blur of a grid, `r` cells either way, across into `tmp` and then down into
 * `out` (which may be `src`). Down the columns it goes a row at a time, keeping each
 * column's running sum, so it reads the grid in order.
 */
function blur(
  src: Float32Array,
  tmp: Float32Array,
  out: Float32Array,
  nx: number,
  ny: number,
  r: number,
) {
  const n = 2 * r + 1
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    const last = row + nx - 1
    let sum = 0
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(nx - 1, Math.max(0, i))]
    // Clamped to the row's ends only near them.
    let i = 0
    for (; i < nx && i - r <= 0; i++) {
      tmp[row + i] = sum / n
      sum += src[Math.min(last, row + i + r + 1)] - src[row]
    }
    for (; i + r + 1 <= nx - 1; i++) {
      tmp[row + i] = sum / n
      sum += src[row + i + r + 1] - src[row + i - r]
    }
    for (; i < nx; i++) {
      tmp[row + i] = sum / n
      sum += src[last] - src[row + i - r]
    }
  }
  const sums = new Float64Array(nx)
  for (let j = -r; j <= r; j++) {
    const row = Math.min(ny - 1, Math.max(0, j)) * nx
    for (let i = 0; i < nx; i++) sums[i] += tmp[row + i]
  }
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    const add = Math.min(ny - 1, j + r + 1) * nx
    const drop = Math.max(0, j - r) * nx
    for (let i = 0; i < nx; i++) {
      out[row + i] = sums[i] / n
      sums[i] += tmp[add + i] - tmp[drop + i]
    }
  }
}
