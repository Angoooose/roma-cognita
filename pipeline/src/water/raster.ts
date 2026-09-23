/**
 * Polygon rasterisation and signed distance, for the coast mask.
 *
 * Each polygon is filled by even-odd scanline over its own rings, which needs no ring
 * orientation: holes and islands-in-lakes come out right as long as every ring is
 * closed. Polygons are then unioned, not XORed — OSM's split land pieces overlap their
 * neighbours by ~0.0005° past every cut, and a single even-odd pass over all of them
 * turns each overlap into a 100 m strip of sea along every whole-degree meridian and
 * parallel. Distance is an exact Euclidean distance transform
 * (Felzenszwalb & Huttenlocher) on a supersampled grid, so the coast lands to a
 * fraction of a texel rather than on texel boundaries.
 */

export interface Ring {
  /** Plane metres, interleaved x,y; closed (first point repeated or implied). */
  xy: Float64Array
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Which polygon the ring belongs to; rings of one polygon are filled together. */
  polygon: number
  /** Area of that polygon, km² — Infinity where the source does not say (land). */
  areaKm2: number
}

export interface Grid {
  /** World x/y of sample (0, 0)'s centre, and the spacing between samples. */
  x0: number
  y0: number
  step: number
  width: number
  height: number
}

/** Fills `rings` into `out` (1 = inside), which must be width×height: even-odd within each polygon, union across polygons. */
export function fillPolygons(rings: Ring[], g: Grid, out: Uint8Array) {
  const byPolygon = new Map<number, Ring[]>()
  for (const r of rings) {
    let list = byPolygon.get(r.polygon)
    if (!list) byPolygon.set(r.polygon, (list = []))
    list.push(r)
  }
  for (const group of byPolygon.values()) fillEvenOdd(group, g, out)
}

/** Even-odd fill of `rings` into `out`, OR-ed with whatever is already there. */
export function fillEvenOdd(rings: Ring[], g: Grid, out: Uint8Array) {
  const rows: number[][] = Array.from({ length: g.height }, () => [])
  const yMax = g.y0 + (g.height - 1) * g.step
  for (const r of rings) {
    if (r.maxY < g.y0 || r.minY > yMax) continue
    const p = r.xy
    const n = p.length / 2
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2]
      const ay = p[k * 2 + 1]
      const k2 = (k + 1) % n
      const bx = p[k2 * 2]
      const by = p[k2 * 2 + 1]
      if (ay === by) continue
      // Half-open in y so a vertex exactly on a sample row is counted once.
      const lo = Math.min(ay, by)
      const hi = Math.max(ay, by)
      let r0 = Math.ceil((lo - g.y0) / g.step)
      let r1 = Math.ceil((hi - g.y0) / g.step) - 1
      if (r0 < 0) r0 = 0
      if (r1 > g.height - 1) r1 = g.height - 1
      const dxdy = (bx - ax) / (by - ay)
      for (let row = r0; row <= r1; row++) {
        const y = g.y0 + row * g.step
        rows[row].push(ax + (y - ay) * dxdy)
      }
    }
  }
  for (let row = 0; row < g.height; row++) {
    const xs = rows[row]
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    const base = row * g.width
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let c0 = Math.ceil((xs[k] - g.x0) / g.step)
      let c1 = Math.ceil((xs[k + 1] - g.x0) / g.step) - 1
      if (c0 < 0) c0 = 0
      if (c1 > g.width - 1) c1 = g.width - 1
      for (let c = c0; c <= c1; c++) out[base + c] = 1
    }
  }
}

const INF = 1e20

/** 1-D squared distance transform of f (length n) into d, using scratch v and z. */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Squared distance (in samples) from every sample to the nearest one where mask == target. */
export function edt(mask: Uint8Array, w: number, h: number, target: number): Float64Array {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] === target ? 0 : INF
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    dt1(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    dt1(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]
  }
  return grid
}

/**
 * Signed distance in samples: positive on land (distance to the nearest water sample),
 * negative on water. The half-sample offset puts zero on the boundary between a land
 * sample and its water neighbour rather than on either of them.
 */
export function signedDistance(land: Uint8Array, w: number, h: number): Float32Array {
  const toWater = edt(land, w, h, 0)
  const toLand = edt(land, w, h, 1)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    out[i] = land[i] ? Math.sqrt(toWater[i]) - 0.5 : -(Math.sqrt(toLand[i]) - 0.5)
  }
  return out
}

/** Does any edge of `rings` touch the rectangle? Used to find tiles with coast in them. */
export function edgesTouch(rings: Ring[], minX: number, minY: number, maxX: number, maxY: number) {
  for (const r of rings) {
    if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) continue
    const p = r.xy
    const n = p.length / 2
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2]
      const ay = p[k * 2 + 1]
      const k2 = (k + 1) % n
      const bx = p[k2 * 2]
      const by = p[k2 * 2 + 1]
      if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX) continue
      if (Math.max(ay, by) < minY || Math.min(ay, by) > maxY) continue
      if (segmentHitsRect(ax, ay, bx, by, minX, minY, maxX, maxY)) return true
    }
  }
  return false
}

/** Liang–Barsky clip: does the segment enter the rectangle at all? */
function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return (
    clip(-dx, ax - minX) && clip(dx, maxX - ax) && clip(-dy, ay - minY) && clip(dy, maxY - ay)
  )
}

/** Point in any polygon (even-odd within each), for tiles no edge touches. */
export function inside(rings: Ring[], x: number, y: number) {
  const odd = new Map<number, boolean>()
  for (const r of rings) {
    if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue
    const p = r.xy
    const n = p.length / 2
    for (let k = 0, j = n - 1; k < n; j = k++) {
      const xi = p[k * 2]
      const yi = p[k * 2 + 1]
      const xj = p[j * 2]
      const yj = p[j * 2 + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        odd.set(r.polygon, !odd.get(r.polygon))
      }
    }
  }
  for (const v of odd.values()) if (v) return true
  return false
}
