/**
 * Where each territory's name goes (DESIGN.md §7.5): a gentle curve through the
 * thick middle of the shape, with the size and letter-spacing that fill it.
 *
 * A polity's territory changes only when a claim starts or ends, so this runs once per
 * distinct territory — polity plus the set of atoms it holds — not per year, and the
 * engine picks the placements in force for the year shown.
 *
 * The method, per territory:
 *
 * 1. Rasterise the atoms' union, keep the largest piece (a name goes on the mainland,
 *    not across the sea to its islands), and distance-transform it: every cell knows
 *    how far it is from the edge.
 * 2. Take the principal axis of the shape, weighting each cell by its depth squared,
 *    so the axis follows the body of the territory rather than its spurs. Names
 *    never tilt more than 35° from horizontal: the axis is clamped, every angle in
 *    range is tried, and the one giving the largest letters wins.
 * 3. Walk along the axis; in each slice the deepest cell is the ridge — the medial
 *    axis, approximately (after Barrault 2001; Krumpe & Mendel 2020).
 * 4. Keep the longest run of the ridge at least a quarter as deep as the deepest
 *    point, fit a parabola to it weighted by depth, and flatten the parabola until it
 *    stays inside. A name bends with its land but never snakes.
 * 5. Take the largest capitals that fit: the text, centred on the curve, no longer
 *    than 85% of it and nowhere on ground thinner than the letters need. Then open
 *    the tracking towards filling 72% of the curve, as far as the ground allows.
 *
 * Output is in plane metres. The engine lays glyphs along the curve at run time.
 */
import { edt, fillPolygons, type Grid, type Ring } from '../water/raster.ts'

export interface FontMetrics {
  /** Em size of the atlas in its own pixels. */
  size: number
  /** Advance of each code point, px at `size`. */
  advance: Map<number, number>
  /** Kerning by `first,second`, px at `size`. */
  kerning: Map<string, number>
  /** Cap height as a fraction of the em. */
  capHeight: number
}

export interface Placement {
  /** Polyline the text's cap-height middle follows, plane metres, left to right. */
  path: [number, number][]
  /** Cap height, metres. */
  capHeight: number
  /** Extra space between letters, em. */
  tracking: number
  /** Depth of the ground under the text, as a fraction of cap height; for diagnostics. */
  fit: number
}

const MAX_CELLS = 360
/** Tracking bounds, em: set tight at the lower bound, never looser than airy capitals. */
const TRACK_MIN = 0.08
const TRACK_MAX = 0.9
/** How much of the fitted curve the text fills when it can, and at most. */
const FILL = 0.72
const MAX_FILL = 0.85
/** Cap height at most this fraction of the full thickness under it. */
const THICKNESS_SHARE = 0.62
/** How far from horizontal a name may tilt, and the step the angles are tried at. */
const MAX_TILT = (35 * Math.PI) / 180
const TILT_STEP = (5 * Math.PI) / 180
/** How much further the curve may turn the ends of a name. */
const MAX_BEND = (10 * Math.PI) / 180
/** The ridge a name may run along: slices at least this share of the deepest point. */
const RIDGE_SHARE = 0.25

/** The width of `text` at an em of 1, with `tracking` em between letters. */
export function textWidth(text: string, m: FontMetrics, tracking: number) {
  let w = 0
  let prev = -1
  const cps = [...text].map((c) => c.codePointAt(0)!)
  for (const cp of cps) {
    w += (m.advance.get(cp) ?? m.size * 0.6) / m.size
    if (prev >= 0) w += (m.kerning.get(`${prev},${cp}`) ?? 0) / m.size
    prev = cp
  }
  return w + tracking * Math.max(0, cps.length - 1)
}

export function placeLabel(
  rings: Ring[],
  text: string,
  font: FontMetrics,
): Placement | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rings) {
    minX = Math.min(minX, r.minX)
    minY = Math.min(minY, r.minY)
    maxX = Math.max(maxX, r.maxX)
    maxY = Math.max(maxY, r.maxY)
  }
  const cell = Math.max(maxX - minX, maxY - minY) / MAX_CELLS
  const pad = 2
  const w = Math.ceil((maxX - minX) / cell) + 2 * pad
  const h = Math.ceil((maxY - minY) / cell) + 2 * pad
  const g: Grid = {
    x0: minX - pad * cell,
    y0: minY - pad * cell,
    step: cell,
    width: w,
    height: h,
  }
  const mask = new Uint8Array(w * h)
  fillPolygons(rings, g, mask)
  keepLargestComponent(mask, w, h)

  // Depth of every cell: distance to the nearest outside cell, in metres.
  const d2 = edt(mask, w, h, 0)
  const depth = new Float32Array(w * h)
  let deepest = 0
  for (let k = 0; k < w * h; k++) {
    depth[k] = mask[k] ? Math.sqrt(d2[k]) * cell : 0
    deepest = Math.max(deepest, depth[k])
  }
  if (deepest === 0) return null

  // Principal axis, weighted by depth².
  let sw = 0
  let mx = 0
  let my = 0
  for (let k = 0; k < w * h; k++) {
    if (!mask[k]) continue
    const wt = depth[k] ** 2
    sw += wt
    mx += wt * (k % w)
    my += wt * Math.floor(k / w)
  }
  mx /= sw
  my /= sw
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let k = 0; k < w * h; k++) {
    if (!mask[k]) continue
    const wt = depth[k] ** 2
    const dx = (k % w) - mx
    const dy = Math.floor(k / w) - my
    sxx += wt * dx * dx
    syy += wt * dy * dy
    sxy += wt * dx * dy
  }
  // The shape's own axis, folded to read left to right.
  let axis = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  if (Math.cos(axis) < 0) axis += Math.PI
  if (axis > Math.PI) axis -= 2 * Math.PI
  // A name never tilts past MAX_TILT: a tall, narrow land (Egypt, Syria) gets a name
  // across it rather than one the reader has to turn their head for. Every angle in
  // range is tried and the one that lets the letters be largest wins, with a slight
  // preference for following the shape's own axis.
  const clamped = Math.max(-MAX_TILT, Math.min(MAX_TILT, axis))
  let best: Placement | null = null
  let bestScore = 0
  for (let a = -MAX_TILT; a <= MAX_TILT + 1e-9; a += TILT_STEP) {
    for (const angle of a === -MAX_TILT ? [clamped, a] : [a]) {
      const p = along(angle)
      if (!p) continue
      const score = p.capHeight * (1 - 0.15 * (Math.abs(angle - clamped) / (2 * MAX_TILT)))
      if (score > bestScore) {
        best = p
        bestScore = score
      }
    }
  }
  return best

  function along(angle: number): Placement | null {
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)

    // The ridge: the deepest cell in each one-cell slice across the axis.
    const slices = new Map<number, { u: number; v: number; depth: number }>()
    for (let k = 0; k < w * h; k++) {
      if (!mask[k]) continue
      const dx = (k % w) - mx
      const dy = Math.floor(k / w) - my
      const u = dx * ux + dy * uy
      const v = -dx * uy + dy * ux
      const s = Math.round(u)
      const cur = slices.get(s)
      // Ties (a slice along a strip is deep all the way) go to the cell nearest the
      // shape's centre line, or the ridge zigzags between equally deep cells.
      if (
        !cur ||
        depth[k] > cur.depth + cell * 0.5 ||
        (depth[k] >= cur.depth - cell * 0.5 && Math.abs(v) < Math.abs(cur.v))
      )
        slices.set(s, { u, v, depth: Math.max(depth[k], cur?.depth ?? 0) })
    }
    const keys = [...slices.keys()].sort((a, b) => a - b)
    // Longest run of slices deep enough to carry letters.
    let best: number[] = []
    let run: number[] = []
    for (let i = 0; i < keys.length; i++) {
      const s = slices.get(keys[i])!
      const contiguous = run.length === 0 || keys[i] === keys[i - 1] + 1
      if (s.depth >= deepest * RIDGE_SHARE && contiguous) run.push(keys[i])
      else run = s.depth >= deepest * RIDGE_SHARE ? [keys[i]] : []
      if (run.length > best.length) best = [...run]
    }
    if (best.length < 3)
      best = keys.filter((k) => slices.get(k)!.depth >= deepest * RIDGE_SHARE)
    const ridge = best.map((k) => slices.get(k)!)

    // Weighted least squares for v = a·u² + b·u + c.
    const fit = fitParabola(ridge)
    const u0 = ridge[0].u
    const u1 = ridge[ridge.length - 1].u
    const toCell = (u: number, a: number, b: number, c: number) => {
      const v = a * u * u + b * u + c
      return [mx + u * ux - v * uy, my + u * uy + v * ux] as const
    }
    const depthAt = (x: number, y: number) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : depth[yi * w + xi]
    }
    // Flatten until the curve stays in ground at least a fifth as deep as the deepest.
    let [a, b, c] = fit
    const line = fitParabola(ridge, true)
    for (let t = 0; t <= 1.001; t += 0.1) {
      const ok = sampleCurve(u0, u1, 24).every(
        (u) => depthAt(...toCell(u, a, b, c)) >= deepest / 5,
      )
      if (ok) break
      a = fit[0] * (1 - t)
      b = fit[1] * (1 - t) + line[1] * t
      c = fit[2] * (1 - t) + line[2] * t
    }

    // The curve's own slope turns the text too: anywhere steeper than the tilt limit
    // plus a gentle bend, it gives way to a straight line at this angle through the
    // ridge's weighted middle.
    if (
      sampleCurve(u0, u1, 16).some(
        (u) => Math.abs(angle + Math.atan(2 * a * u + b)) > MAX_TILT + MAX_BEND,
      )
    ) {
      let sw = 0
      let sv = 0
      for (const r of ridge) {
        sw += r.depth
        sv += r.depth * r.v
      }
      ;[a, b, c] = [0, 0, sv / (sw || 1)]
    }

    // Size: the largest cap height whose text, centred on the curve, fits the curve's
    // length and never stands on ground thinner than the letters need.
    const us = sampleCurve(u0, u1, 96)
    const pts = us.map((u) => toCell(u, a, b, c))
    const depths = pts.map(([x, y]) => depthAt(x, y))
    const cum = [0]
    for (let i = 1; i < pts.length; i++)
      cum.push(
        cum[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * cell,
      )
    const length = cum[cum.length - 1]
    const thinnestUnder = (len: number) => {
      const s0 = (length - len) / 2
      let thin = Infinity
      for (let i = 0; i < cum.length; i++)
        if (cum[i] >= s0 && cum[i] <= s0 + len) thin = Math.min(thin, depths[i])
      return thin
    }
    const n = [...text].length
    const fits = (cap: number, tracking: number) => {
      const len = (textWidth(text, font, tracking) * cap) / font.capHeight
      return len <= MAX_FILL * length && cap <= 2 * THICKNESS_SHARE * thinnestUnder(len)
    }
    let lo = 0
    let hi = 2 * THICKNESS_SHARE * deepest
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      if (fits(mid, TRACK_MIN)) lo = mid
      else hi = mid
    }
    const capHeight = lo
    if (capHeight <= 0) return null
    const em = capHeight / font.capHeight
    // Open the tracking towards filling the curve, as far as the ground allows.
    let tracking = TRACK_MIN
    if (n > 1) {
      const want = Math.min(
        TRACK_MAX,
        Math.max(TRACK_MIN, ((FILL * length) / em - textWidth(text, font, 0)) / (n - 1)),
      )
      for (let t = want; t > TRACK_MIN; t -= 0.02) {
        if (fits(capHeight, t)) {
          tracking = t
          break
        }
      }
    }
    const textLen = textWidth(text, font, tracking) * em
    const path = trimToLength(
      pts.map(([x, y]) => [g.x0 + x * cell, g.y0 + y * cell] as [number, number]),
      textLen * 1.1,
    )
    return { path, capHeight, tracking, fit: (2 * thinnestUnder(textLen)) / capHeight }
  }
}

function fitParabola(
  pts: { u: number; v: number; depth: number }[],
  straight = false,
): [number, number, number] {
  // Normal equations; `straight` fits a line (a = 0).
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let t0 = 0
  let t1 = 0
  let t2 = 0
  for (const p of pts) {
    const wt = p.depth
    const u = p.u
    s0 += wt
    s1 += wt * u
    s2 += wt * u * u
    s3 += wt * u ** 3
    s4 += wt * u ** 4
    t0 += wt * p.v
    t1 += wt * u * p.v
    t2 += wt * u * u * p.v
  }
  if (straight || pts.length < 4) {
    const det = s0 * s2 - s1 * s1 || 1
    return [0, (s0 * t1 - s1 * t0) / det, (s2 * t0 - s1 * t1) / det]
  }
  const m = [
    [s4, s3, s2, t2],
    [s3, s2, s1, t1],
    [s2, s1, s0, t0],
  ]
  for (let i = 0; i < 3; i++) {
    let p = i
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r
    ;[m[i], m[p]] = [m[p], m[i]]
    if (Math.abs(m[i][i]) < 1e-12) return fitParabola(pts, true)
    for (let r = 0; r < 3; r++) {
      if (r === i) continue
      const f = m[r][i] / m[i][i]
      for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c]
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
}

const sampleCurve = (u0: number, u1: number, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => u0 + ((u1 - u0) * i) / n)

/** The middle `len` of a polyline, resampled to 24 points. */
function trimToLength(pts: [number, number][], len: number): [number, number][] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = cum[cum.length - 1]
  const s0 = Math.max(0, (total - len) / 2)
  const s1 = Math.min(total, s0 + len)
  const at = (s: number): [number, number] => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return [
      pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
      pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
    ]
  }
  return Array.from({ length: 24 }, (_, k) => at(s0 + ((s1 - s0) * k) / 23))
}

function keepLargestComponent(mask: Uint8Array, w: number, h: number) {
  const comp = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let k = 0; k < w * h; k++) {
    if (!mask[k] || comp[k] >= 0) continue
    const id = sizes.length
    let size = 0
    stack.push(k)
    comp[k] = id
    while (stack.length) {
      const q = stack.pop()!
      size++
      const x = q % w
      for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (n >= 0 && n < w * h && mask[n] && comp[n] < 0) {
          comp[n] = id
          stack.push(n)
        }
      }
    }
    sizes.push(size)
  }
  const largest = sizes.indexOf(Math.max(...sizes))
  for (let k = 0; k < w * h; k++) if (comp[k] !== largest) mask[k] = 0
}
