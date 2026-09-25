/**
 * The generated city's local streets, grown out from the streets that are known
 * (DESIGN.md §7.7; city.ts lays the blocks and lots between them).
 *
 * A town that grew was not cut up from above: each lane was laid off one already
 * there, and each new block took its line from its neighbours. So the network
 * grows by accretion, from the Forum outward, and every street is one continuous
 * line from junction to junction:
 *
 * - **Branches.** Along every street, at the spacing of a block's side, a lane may
 *   leave it on either side, square to it. Those nearest the Forum are laid first,
 *   and every lane laid may branch in its turn (Weber et al. 2009; Emilien et al.
 *   2012).
 * - **One direction over the city.** A lane follows a field of directions that its
 *   neighbours set: along the contours where the ground slopes, and elsewhere
 *   square or parallel to the streets round it, older ones weighing more (the
 *   tensor fields of Chen et al. 2008). So the blocks of a quarter line up, and
 *   the quarters turn with the ground.
 * - **Junctions.** A lane that comes near a street runs on to meet it; one that
 *   comes near a junction ends in it; and a lane leaving a street opposite one on
 *   its other side carries it on, so streets cross and continue rather than meeting
 *   in staggered ends (Weber et al. 2009; Courtat et al. 2011).
 * - **Room.** No lane is laid alongside another nearer than a block's depth, nor
 *   leaves a street right by another junction.
 * - **Dead ends.** A lane that ends in the open goes on to the nearest street if one
 *   is close; a short stub is taken away; a few are left, as the alleys Varro calls
 *   *fundula* were.
 *
 * The excavated pieces of street (SITAR, rome-sitar.geojson) that belong to no
 * recorded street are laid first, and grown out from along their line, so the
 * generated streets pass where streets were found.
 */

type Pt = [number, number]

export interface GrowthInput {
  /** The recorded and main streets, which the lanes grow from and never cross. */
  fixed: Pt[][]
  /** Excavated pieces of street, as short lines: the network is made to pass along them. */
  pieces: Pt[][]
  /** Whether a lane may run over a point: inside the wall, off the monuments, squares, river and cliffs. */
  open: (p: Pt) => boolean
  height: (x: number, y: number) => number
  /** A block's depth (between parallel lanes) and length (along them) at a point, metres. */
  block: (p: Pt) => { depth: number; length: number }
  /** Where the city grew out from. */
  centre: Pt
  rand: () => number
}

export interface Lane {
  pts: Pt[]
  /** A lane straight up a slope is a narrow flight of steps. */
  stair: boolean
}

/** How far a lane runs in one step, metres. */
const STEP = 10
/** A lane ending this near a junction ends in it, metres. */
const SNAP = 7
/** A lane looks this far ahead for a street to meet, in steps. */
const REACH = 1.8
/** The longest lane, metres. */
const MAX_RUN = 320
/** Slope (rise over run) from which lanes follow the contours. */
const CONTOUR_FROM = 0.04
/** A lane rising more than this along its line is a flight of steps. */
const STAIR_SLOPE = 0.12
/** A dead end this near a street is run on to it, metres. */
const CONNECT = 30
/** A dead end shorter than this is taken away, metres. */
const STUB = 28
/** Of the dead ends that would be kept, this share is left as blind alleys. */
const BLIND = 0.35

interface Seg {
  a: Pt
  b: Pt
  chain: number
  fixed: boolean
}

interface Proposal {
  at: Pt
  /** The unit direction to leave in. */
  dir: Pt
  gen: number
  parent: number
  priority: number
}

export function growStreets(g: GrowthInput): Lane[] {
  const rand = g.rand
  const grid = new SegmentGrid(24)
  const junctions = new PointGrid(16)
  const chains: {
    pts: Pt[]
    fixed: boolean
    gen: number
    ends: [boolean, boolean]
    kids: number
  }[] = []

  const add = (pts: Pt[], fixed: boolean, gen: number, ends: [boolean, boolean]) => {
    const id = chains.length
    chains.push({ pts, fixed, gen, ends, kids: 0 })
    for (let i = 0; i + 1 < pts.length; i++)
      grid.add({ a: pts[i], b: pts[i + 1], chain: id, fixed })
    return id
  }
  for (const f of g.fixed) if (f.length > 1) add(f, true, 0, [true, true])

  // --- the direction field ---------------------------------------------------------
  /** The direction lanes take at a point, as an angle modulo 90°: the field's cross. */
  const field = (p: Pt): number | null => {
    let [c4, s4, w] = [0, 0, 0]
    const e = 10
    const gx = (g.height(p[0] + e, p[1]) - g.height(p[0] - e, p[1])) / (2 * e)
    const gy = (g.height(p[0], p[1] + e) - g.height(p[0], p[1] - e)) / (2 * e)
    const slope = Math.hypot(gx, gy)
    if (slope > CONTOUR_FROM) {
      const k = 6 * smoothstep(CONTOUR_FROM, 0.14, slope)
      const t = Math.atan2(gy, gx) + Math.PI / 2
      c4 += k * Math.cos(4 * t)
      s4 += k * Math.sin(4 * t)
      w += k
    }
    for (const s of grid.near(p, 90)) {
      const d = segDist(p, s.a, s.b)
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
      const k = ((s.fixed ? 2 : 1) * len * 60) / (d + 12) ** 2
      const t = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0])
      c4 += k * Math.cos(4 * t)
      s4 += k * Math.sin(4 * t)
      w += k
    }
    return w > 1e-3 ? Math.atan2(s4, c4) / 4 : null
  }
  /** Of the field's four directions at a point, the one nearest `h`. */
  const along = (p: Pt, h: number) => {
    const t = field(p)
    if (t === null) return h
    let best = h
    let bd = Infinity
    for (let k = 0; k < 4; k++) {
      const a = t + (k * Math.PI) / 2
      const d = Math.abs(angleDiff(a, h))
      if (d < bd) [best, bd] = [a, d]
    }
    return best
  }

  // --- tracing a lane ----------------------------------------------------------------
  /** A lane from `start` heading `h`, until it meets a street, a junction, the edge of what is open, or its length. */
  const trace = (start: Pt, h0: number, own: number) => {
    const pts: Pt[] = [start]
    let h = h0
    let drift = 0
    let run = 0
    for (;;) {
      const p = pts[pts.length - 1]
      const want = along(p, h)
      drift = drift * 0.7 + (rand() - 0.5) * 0.06
      h += Math.max(-0.22, Math.min(0.22, angleDiff(want, h) * 0.5)) + drift
      const u: Pt = [Math.cos(h), Math.sin(h)]
      const q: Pt = [p[0] + u[0] * STEP, p[1] + u[1] * STEP]
      // A street ahead: run on to meet it.
      const probe: Pt = [p[0] + u[0] * STEP * REACH, p[1] + u[1] * STEP * REACH]
      const hit = grid.firstHit(p, probe, own, run < 1 ? 1.5 : 0.01)
      if (hit) {
        const j = junctions.nearest(hit.at, SNAP)
        pts.push(j ?? hit.at)
        return { pts, joined: true }
      }
      const j = junctions.nearest(q, SNAP)
      if (j && run > 0) {
        pts.push(j)
        return { pts, joined: true }
      }
      if (!g.open(q) || !g.open([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]))
        return { pts, joined: false }
      pts.push(q)
      run += STEP
      if (run >= MAX_RUN) return { pts, joined: false }
    }
  }

  // --- proposals -----------------------------------------------------------------------
  const queue = new Heap<Proposal>()
  /** Branches along a chain, both sides, a block's side apart: its length, or its depth on alternate generations. */
  const propose = (id: number) => {
    const c = chains[id]
    const gen = c.gen + 1
    let s = 0
    let next = (0.35 + rand() * 0.3) * g.block(c.pts[0]).length
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const [a, b] = [c.pts[i], c.pts[i + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1e-6) continue
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      while (next <= s + L) {
        const t = next - s
        const p: Pt = [a[0] + u[0] * t, a[1] + u[1] * t]
        const blk = g.block(p)
        for (const side of [1, -1]) {
          const dir: Pt = [-u[1] * side, u[0] * side]
          const d = Math.hypot(p[0] - g.centre[0], p[1] - g.centre[1])
          queue.push({ at: p, dir, gen, parent: id, priority: d + gen * 40 + rand() * 30 })
        }
        const span = gen % 2 ? blk.length : blk.depth
        next += span * (0.85 + rand() * 0.3)
      }
      s += L
    }
  }

  // The excavated pieces first: each laid as a lane and run on both ways along its line.
  for (const piece of g.pieces) {
    const [a, b] = [piece[0], piece[piece.length - 1]]
    if (!g.open(a) || !g.open(b)) continue
    if (grid.near(a, 6).length || grid.near(b, 6).length) continue
    const h = Math.atan2(b[1] - a[1], b[0] - a[0])
    const back = trace(a, h + Math.PI, chains.length)
    const on = trace(b, h, chains.length)
    const pts = [...back.pts.reverse(), ...on.pts]
    if (pts.length < 3) continue
    const id = add(pts, false, 1, [back.joined, on.joined])
    for (const e of [pts[0], pts[pts.length - 1]]) junctions.add(e)
    propose(id)
  }
  for (let id = 0; id < chains.length; id++) if (chains[id].fixed) propose(id)

  const MAX_CHAINS = 6000
  while (queue.size && chains.length < MAX_CHAINS) {
    const pr = queue.pop()
    const blk = g.block(pr.at)
    // Carry on a lane that leaves the other side of the street just here.
    let start = pr.at
    let h = Math.atan2(pr.dir[1], pr.dir[0])
    const opposite = junctions.nearest(start, 14)
    if (opposite) {
      const across = junctions.heading(opposite)
      if (across !== null && Math.abs(angleDiff(across, h)) < 0.6) {
        start = opposite
        h = across
      } else continue // another lane already leaves the street here
    }
    h = along([start[0] + Math.cos(h) * 6, start[1] + Math.sin(h) * 6], h)
    const u: Pt = [Math.cos(h), Math.sin(h)]
    const ahead: Pt = [start[0] + u[0] * 8, start[1] + u[1] * 8]
    if (!g.open(ahead)) continue
    // Room: no lane alongside nearer than a block's depth.
    const probe: Pt = [start[0] + u[0] * 18, start[1] + u[1] * 18]
    const crowded = grid
      .near(probe, blk.depth * 0.6)
      .some(
        (s) =>
          s.chain !== pr.parent &&
          Math.abs(angleDiff2(Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]), h)) < 0.45 &&
          segDist(probe, s.a, s.b) < blk.depth * 0.6,
      )
    if (crowded) continue
    const id = chains.length
    const t = trace(start, h, id)
    const len = length(t.pts)
    if (len < 12 || (!t.joined && len < STUB)) continue
    add(t.pts, false, pr.gen, [true, t.joined])
    chains[pr.parent].kids++
    junctions.add(t.pts[0], h)
    if (t.joined) {
      const [p, q] = [t.pts[t.pts.length - 2], t.pts[t.pts.length - 1]]
      junctions.add(q, Math.atan2(p[1] - q[1], p[0] - q[0]))
    }
    propose(id)
  }

  // --- dead ends -------------------------------------------------------------------------
  for (const [id, c] of chains.entries()) {
    if (c.fixed || c.ends.every(Boolean)) continue
    for (const end of [0, 1] as const) {
      if (c.ends[end]) continue
      const pts = end === 1 ? c.pts : [...c.pts].reverse()
      const [p, q] = [pts[pts.length - 2], pts[pts.length - 1]]
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const u: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]
      const far: Pt = [q[0] + u[0] * CONNECT, q[1] + u[1] * CONNECT]
      const hit = grid.firstHit(q, far, id, 0.5)
      if (hit && g.open([(q[0] + hit.at[0]) / 2, (q[1] + hit.at[1]) / 2])) {
        pts.push(hit.at)
        c.ends[end] = true
      }
      c.pts = end === 1 ? pts : pts.reverse()
    }
  }
  const keep = chains.filter(
    (c) =>
      !c.fixed &&
      (c.ends.every(Boolean) || c.kids > 0 || (length(c.pts) >= STUB && rand() < BLIND)),
  )

  return keep.map((c) => {
    let [rise, run] = [0, 0]
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const [a, b] = [c.pts[i], c.pts[i + 1]]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      rise += Math.abs(g.height(b[0], b[1]) - g.height(a[0], a[1]))
      run += l
    }
    return { pts: c.pts, stair: run > 0 && rise / run > STAIR_SLOPE }
  })
}

// --- helpers ---------------------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** a − b, in (−π, π]. */
const angleDiff = (a: number, b: number) => {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d <= -Math.PI) d += 2 * Math.PI
  return d
}
/** a − b for undirected lines, in (−π/2, π/2]. */
const angleDiff2 = (a: number, b: number) => {
  let d = (a - b) % Math.PI
  if (d > Math.PI / 2) d -= Math.PI
  if (d <= -Math.PI / 2) d += Math.PI
  return d
}
const length = (pts: Pt[]) =>
  pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0)

function segDist(p: Pt, a: Pt, b: Pt) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

/** Where segment p→q crosses a→b, as a fraction along p→q, if it does. */
function cross(p: Pt, q: Pt, a: Pt, b: Pt): number | null {
  const [rx, ry] = [q[0] - p[0], q[1] - p[1]]
  const [sx, sy] = [b[0] - a[0], b[1] - a[1]]
  const d = rx * sy - ry * sx
  if (Math.abs(d) < 1e-9) return null
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / d
  const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

/** Segments bucketed on a grid, for what is near a point and what a segment crosses. */
class SegmentGrid {
  private cells = new Map<string, Seg[]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  private key(i: number, j: number) {
    return `${i},${j}`
  }
  add(s: Seg) {
    const S = this.size
    const [i0, i1] = [
      Math.floor(Math.min(s.a[0], s.b[0]) / S),
      Math.floor(Math.max(s.a[0], s.b[0]) / S),
    ]
    const [j0, j1] = [
      Math.floor(Math.min(s.a[1], s.b[1]) / S),
      Math.floor(Math.max(s.a[1], s.b[1]) / S),
    ]
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j)
        const l = this.cells.get(k)
        if (l) l.push(s)
        else this.cells.set(k, [s])
      }
  }
  near(p: Pt, r: number): Seg[] {
    const S = this.size
    const out = new Set<Seg>()
    for (let i = Math.floor((p[0] - r) / S); i <= Math.floor((p[0] + r) / S); i++)
      for (let j = Math.floor((p[1] - r) / S); j <= Math.floor((p[1] + r) / S); j++)
        for (const s of this.cells.get(this.key(i, j)) ?? []) out.add(s)
    return [...out].filter((s) => segDist(p, s.a, s.b) <= r)
  }
  /** The first segment p→q crosses, not of chain `own`, past `skip` metres from p. */
  firstHit(p: Pt, q: Pt, own: number, skip: number) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    let best: { at: Pt; chain: number } | null = null
    let bt = Infinity
    for (const s of this.near(mid, L / 2 + 1)) {
      if (s.chain === own) continue
      const t = cross(p, q, s.a, s.b)
      if (t === null || t * L < skip || t >= bt) continue
      bt = t
      best = { at: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], chain: s.chain }
    }
    return best
  }
}

/** Junctions bucketed on a grid, each with the heading of the lane that left it. */
class PointGrid {
  private cells = new Map<string, { p: Pt; h: number | null }[]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  add(p: Pt, h: number | null = null) {
    const k = `${Math.floor(p[0] / this.size)},${Math.floor(p[1] / this.size)}`
    const l = this.cells.get(k)
    if (l) l.push({ p, h })
    else this.cells.set(k, [{ p, h }])
  }
  private closest(p: Pt, r: number) {
    const S = this.size
    let best: { p: Pt; h: number | null } | null = null
    let bd = r
    for (let i = Math.floor((p[0] - r) / S); i <= Math.floor((p[0] + r) / S); i++)
      for (let j = Math.floor((p[1] - r) / S); j <= Math.floor((p[1] + r) / S); j++)
        for (const e of this.cells.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(e.p[0] - p[0], e.p[1] - p[1])
          if (d <= bd) [best, bd] = [e, d]
        }
    return best
  }
  nearest(p: Pt, r: number): Pt | null {
    return this.closest(p, r)?.p ?? null
  }
  /** The heading a lane left `p` by, carried on through it. */
  heading(p: Pt): number | null {
    const e = this.closest(p, 0.01)
    return e && e.h !== null ? e.h + Math.PI : null
  }
}

/** A binary min-heap. */
class Heap<T extends { priority: number }> {
  private items: T[] = []
  get size() {
    return this.items.length
  }
  push(t: T) {
    const a = this.items
    a.push(t)
    let i = a.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (a[up].priority <= a[i].priority) break
      ;[a[up], a[i]] = [a[i], a[up]]
      i = up
    }
  }
  pop(): T {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2]
        let m = i
        if (l < a.length && a[l].priority < a[m].priority) m = l
        if (r < a.length && a[r].priority < a[m].priority) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}
