/**
 * Raster operations for the floodplain derivation, on a grid of width × height
 * pixels indexed j·width + i. Everything is typed arrays and linear passes; the
 * largest region (Mesopotamia at z10) is ~70 M pixels.
 */

export type Pt = [number, number]

/**
 * Even–odd scanline fill of `rings` (pixel coordinates) into `out`, sampling
 * pixel centres (i + 0.5, j + 0.5). Rings of one polygon and its holes can be
 * passed together; even–odd makes holes holes.
 */
export function fillRings(
  out: Uint8Array,
  width: number,
  height: number,
  rings: Pt[][],
  value = 1,
) {
  let ymin = Infinity
  let ymax = -Infinity
  for (const r of rings)
    for (const [, y] of r) ((ymin = Math.min(ymin, y)), (ymax = Math.max(ymax, y)))
  const j0 = Math.max(0, Math.floor(ymin - 0.5))
  const j1 = Math.min(height - 1, Math.ceil(ymax - 0.5))
  const edges: [number, number, number, number][] = []
  for (const r of rings) {
    for (let k = 0; k < r.length; k++) {
      const a = r[k]
      const b = r[(k + 1) % r.length]
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]])
    }
  }
  const xs: number[] = []
  for (let j = j0; j <= j1; j++) {
    const y = j + 0.5
    xs.length = 0
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const i1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5))
      for (let i = i0; i <= i1; i++) out[j * width + i] = value
    }
  }
}

/** The pixels a polyline passes through, in order, with no repeats in a row. */
export function linePixels(line: Pt[], width: number, height: number): number[] {
  const out: number[] = []
  let last = -1
  for (let k = 0; k + 1 < line.length; k++) {
    const [x0, y0] = line[k]
    const [x1, y1] = line[k + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2))
    for (let s = 0; s <= n; s++) {
      const i = Math.floor(x0 + ((x1 - x0) * s) / n)
      const j = Math.floor(y0 + ((y1 - y0) * s) / n)
      if (i < 0 || j < 0 || i >= width || j >= height) continue
      const p = j * width + i
      if (p !== last) (out.push(p), (last = p))
    }
  }
  return out
}

/**
 * For every pixel, the index of its nearest seed (−1 if none), by two-pass
 * propagation of nearest-seed coordinates (Danielsson/Grevera "dead
 * reckoning"). Near-exact Euclidean; the error is a fraction of a pixel.
 */
export function nearestSeed(
  width: number,
  height: number,
  seedPixels: Int32Array,
): { nearest: Int32Array; dist2: Float32Array } {
  const n = width * height
  const nearest = new Int32Array(n).fill(-1)
  const dist2 = new Float32Array(n).fill(Infinity)
  const sx = new Int32Array(seedPixels.length)
  const sy = new Int32Array(seedPixels.length)
  for (let s = 0; s < seedPixels.length; s++) {
    const p = seedPixels[s]
    sx[s] = p % width
    sy[s] = (p / width) | 0
    nearest[p] = s
    dist2[p] = 0
  }
  const relax = (p: number, i: number, j: number, q: number) => {
    const s = nearest[q]
    if (s < 0) return
    const dx = i - sx[s]
    const dy = j - sy[s]
    const d = dx * dx + dy * dy
    if (d < dist2[p]) ((dist2[p] = d), (nearest[p] = s))
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = j * width + i
      if (j > 0) {
        if (i > 0) relax(p, i, j, p - width - 1)
        relax(p, i, j, p - width)
        if (i < width - 1) relax(p, i, j, p - width + 1)
      }
      if (i > 0) relax(p, i, j, p - 1)
    }
    for (let i = width - 2; i >= 0; i--) relax(j * width + i, i, j, j * width + i + 1)
  }
  for (let j = height - 1; j >= 0; j--) {
    for (let i = width - 1; i >= 0; i--) {
      const p = j * width + i
      if (j < height - 1) {
        if (i < width - 1) relax(p, i, j, p + width + 1)
        relax(p, i, j, p + width)
        if (i > 0) relax(p, i, j, p + width - 1)
      }
      if (i < width - 1) relax(p, i, j, p + 1)
    }
    for (let i = 1; i < width; i++) relax(j * width + i, i, j, j * width + i - 1)
  }
  return { nearest, dist2 }
}

/**
 * Connected components of pixels where `mask[p] === value`. Calls `visit` with
 * each component's pixel list and whether it touches the grid edge. 8-connected
 * for foreground (value 1), 4-connected for background, the usual pairing that
 * keeps a diagonal gap from being both a bridge and a gap.
 */
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
  value: 0 | 1,
  visit: (pixels: Int32Array, count: number, touchesEdge: boolean) => void,
) {
  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  // Every pixel is visited once, so each component is a contiguous run of `order`.
  const order = new Int32Array(mask.length)
  let filled = 0
  const eight = value === 1
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== value) continue
    let top = 0
    let count = 0
    let edge = false
    stack[top++] = start
    seen[start] = 1
    const first = filled
    while (top) {
      const p = stack[--top]
      order[filled++] = p
      count++
      const i = p % width
      const j = (p / width) | 0
      if (i === 0 || j === 0 || i === width - 1 || j === height - 1) edge = true
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          if (!eight && di && dj) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= width || jj >= height) continue
          const q = jj * width + ii
          if (!seen[q] && mask[q] === value) ((seen[q] = 1), (stack[top++] = q))
        }
      }
    }
    visit(order.subarray(first, filled), count, edge)
  }
}

/** Separable box blur of radius r, three times: a cheap Gaussian of σ ≈ r. */
export function blur(
  src: Float32Array,
  width: number,
  height: number,
  r: number,
): Float32Array {
  let a = Float32Array.from(src)
  let b = new Float32Array(src.length)
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? height : width
    const len = horizontal ? width : height
    const stride = horizontal ? 1 : width
    for (let l = 0; l < lines; l++) {
      const base = horizontal ? l * width : l
      let sum = 0
      for (let k = -r; k <= r; k++)
        sum += from[base + Math.min(len - 1, Math.max(0, k)) * stride]
      for (let k = 0; k < len; k++) {
        to[base + k * stride] = sum / (2 * r + 1)
        const add = Math.min(len - 1, k + r + 1)
        const sub = Math.max(0, k - r)
        sum += from[base + add * stride] - from[base + sub * stride]
      }
    }
  }
  for (let it = 0; it < 3; it++) {
    pass(a, b, true)
    pass(b, a, false)
  }
  b = a
  return b
}

/** Minimum over a (2r+1)² window, separably. */
export function minFilter(
  src: Float32Array,
  width: number,
  height: number,
  r: number,
): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let m = Infinity
      for (let k = Math.max(0, i - r); k <= Math.min(width - 1, i + r); k++)
        m = Math.min(m, src[j * width + k])
      tmp[j * width + i] = m
    }
  }
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      let m = Infinity
      for (let k = Math.max(0, j - r); k <= Math.min(height - 1, j + r); k++)
        m = Math.min(m, tmp[k * width + i])
      out[j * width + i] = m
    }
  }
  return out
}

/**
 * Least-cost path between two pixels over `cost` (per-pixel, > 0), 8-connected,
 * restricted to the box [i0, i1] × [j0, j1]. Dijkstra with a binary heap.
 */
export function leastCostPath(
  cost: Float32Array,
  width: number,
  from: number,
  to: number,
  box: [number, number, number, number],
): number[] {
  const [i0, j0, i1, j1] = box
  const bw = i1 - i0 + 1
  const bh = j1 - j0 + 1
  const local = (p: number) => (((p / width) | 0) - j0) * bw + ((p % width) - i0)
  const global = (q: number) => (j0 + ((q / bw) | 0)) * width + i0 + (q % bw)
  const dist = new Float64Array(bw * bh).fill(Infinity)
  const prev = new Int32Array(bw * bh).fill(-1)
  const heap: number[] = []
  const hd: number[] = []
  const push = (q: number, d: number) => {
    heap.push(q)
    hd.push(d)
    let k = heap.length - 1
    while (k > 0) {
      const par = (k - 1) >> 1
      if (hd[par] <= hd[k]) break
      ;[heap[par], heap[k]] = [heap[k], heap[par]]
      ;[hd[par], hd[k]] = [hd[k], hd[par]]
      k = par
    }
  }
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0], hd[0]]
    const lq = heap.pop()!
    const ld = hd.pop()!
    if (heap.length) {
      heap[0] = lq
      hd[0] = ld
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < heap.length && hd[l] < hd[m]) m = l
        if (r < heap.length && hd[r] < hd[m]) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        ;[hd[m], hd[k]] = [hd[k], hd[m]]
        k = m
      }
    }
    return top
  }
  const s = local(from)
  const t = local(to)
  dist[s] = 0
  push(s, 0)
  while (heap.length) {
    const [q, d] = pop()
    if (d > dist[q]) continue
    if (q === t) break
    const qi = q % bw
    const qj = (q / bw) | 0
    const cq = cost[global(q)]
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = qi + di
        const nj = qj + dj
        if (ni < 0 || nj < 0 || ni >= bw || nj >= bh) continue
        const nq = nj * bw + ni
        const step = (di && dj ? Math.SQRT2 : 1) * 0.5 * (cq + cost[global(nq)])
        if (d + step < dist[nq]) {
          dist[nq] = d + step
          prev[nq] = q
          push(nq, d + step)
        }
      }
    }
  }
  if (prev[t] < 0 && s !== t) throw new Error('least-cost path: target unreachable')
  const path: number[] = []
  for (let q = t; q !== -1; q = prev[q]) path.push(global(q))
  return path.reverse()
}

/** Douglas–Peucker on planar points; returns the indices kept. */
export function simplifyIndices(pts: Pt[], tolerance: number): number[] {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  const t2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let wd = t2
    for (let k = a + 1; k < b; k++) {
      const [px, py] = pts[k]
      let d
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
      }
      if (d > wd) ((wd = d), (worst = k))
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/** Centripetal Catmull–Rom through `pts`, `per` samples per span; passes through every point. */
export function catmullRom(pts: Pt[], per = 12): Pt[] {
  if (pts.length < 3) return pts
  const P = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]] as Pt,
    ...pts,
    [
      2 * pts[pts.length - 1][0] - pts[pts.length - 2][0],
      2 * pts[pts.length - 1][1] - pts[pts.length - 2][1],
    ] as Pt,
  ]
  const out: Pt[] = []
  const tj = (ti: number, a: Pt, b: Pt) =>
    ti + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || ti + 1e-9
  for (let k = 1; k + 2 < P.length; k++) {
    const [p0, p1, p2, p3] = [P[k - 1], P[k], P[k + 1], P[k + 2]]
    const t0 = 0
    const t1 = tj(t0, p0, p1)
    const t2 = tj(t1, p1, p2)
    const t3 = tj(t2, p2, p3)
    for (let s = 0; s < per; s++) {
      const t = t1 + ((t2 - t1) * s) / per
      const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => [
        ((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta),
        ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta),
      ]
      const a1 = lerp(p0, p1, t0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, t0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      out.push(lerp(b1, b2, t1, t2))
    }
  }
  out.push(pts[pts.length - 1])
  return out
}
