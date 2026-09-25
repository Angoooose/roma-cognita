/**
 * The generated city inside the Servian Wall (DESIGN.md §7.7): its streets, its blocks
 * and the lots round them. None of it is a claim about any building; it follows how
 * pre-modern cities are modelled and what Rome's fabric is known to have been like.
 *
 * 1. **Streets, in a hierarchy.** The recorded streets are kept. Main streets run from
 *    each gate to the Forum by the easiest way over the ground (a cheapest path that
 *    shuns slopes and prefers the recorded streets, after Emilien et al. 2012 and
 *    Galin et al. 2011), so they bend along the valleys and merge as they near the
 *    centre. The big blocks between them are then cut by local streets, each across a
 *    block's long axis with a slight bend, until the blocks are the size of Rome's
 *    comparanda: some 30–40 m by 50–90 m in the crowded valleys (Cosa, Pompeii),
 *    larger on the hills. A few blocks keep a dead-end alley (Varro's *fundula*).
 *    Rome was "casually built upon … rather than regularly planned" (Livy 5.55), with
 *    "narrow, twisting lanes" (Tacitus, *Annals* 15.38).
 * 2. **Lots round each block.** Each block is lined with lots along its edges, a strip
 *    of one depth with the corners mitred, so every lot fronts a street, the lots
 *    share their side and back walls, and the middle is left as courtyards (the
 *    straight-skeleton strips of Vanegas et al. 2012, "Procedural Generation of
 *    Parcels in Urban Modeling"). The Marble Plan shows exactly this: rows of shops on
 *    the streets and blocks of flats round small courtyards, built wall to wall.
 * 3. **Buildings, not lots.** A run of one to five neighbouring lots along a street
 *    is one building, as the blocks of flats on the Marble Plan take several shops'
 *    frontage: one height, one render, and one low roof along the street, hipped at
 *    the block's corners. Heights change smoothly across the city — a pattern some
 *    200 m across, a storey more on the main and recorded streets, a storey less on
 *    the ranges behind — and step a storey up or down only between buildings. A
 *    building may stop short of the strip's back line, a lone narrow deep one turns
 *    its gable to the street, a few have a flat terrace, and an atrium house's
 *    ranges fall inward to its court (the houses of Pompeii; the Marble Plan).
 *    On a slope the local streets follow the contours, with narrow stepped lanes
 *    straight up and down, and the blocks are smaller, shallower terraces; on the
 *    flat they leave the nearest major street square.
 * 4. **Quarters.** The valleys (the Subura, the Velabrum) are crowded with blocks of
 *    flats of three to five storeys on narrow lots; the hills are lower. Round the
 *    Palatine, the Carinae, the Velia, the Quirinal and the Caelian, atrium houses on
 *    wide deep lots stand among the flats, as rich and poor stood side by side on the
 *    Marble Plan; near the river, warehouses on long lots.
 *
 * Everything is on a 2 m grid, and seeded, so every build is the same. The works
 * followed are catalogued in data/sources.yaml (vanegas-2012, emilien-2012,
 * galin-2011, dylla-2009, forma-urbis-stanford, reynolds-expedition, poehler-2017,
 * pecs-cosa, livy, tacitus-ann, varro-ll, cicero-agr, vitruvius).
 */
import type { StreetLine } from './streets.ts'

type Pt = [number, number]

export interface CityInput {
  circuit: Pt[]
  gates: Pt[]
  streets: StreetLine[]
  /** The Forum's square: where the main streets lead. */
  forum: Pt[]
  /** Other squares no house stands in: the Capitol's precinct. */
  squares: Pt[][]
  /** Footprints of the monuments standing from before the window, which nothing crosses. */
  monuments: Pt[][]
  /** The ground's height and slope, and whether a point is in the river. */
  at: (x: number, y: number) => number
  slopeAt: (x: number, y: number) => number
  wet: (x: number, y: number) => boolean
  /** Metres to the river. */
  toRiver: (x: number, y: number) => number
  /** Where the atrium houses gather: the hills and quarters of the rich. */
  richQuarters: Pt[]
  rand: () => number
}

export const LOT_KIND = { flats: 0, house: 1, warehouse: 2, suburb: 3 } as const

/**
 * How a lot is roofed: a ridge along the street (a row makes one long roof), a
 * ridge across it (the gable to the street, as on a narrow deep lot), a flat
 * terrace, or a single slope falling to the back (an atrium's roof, falling to its
 * court).
 */
export const ROOF = { along: 0, across: 1, flat: 2, lean: 3 } as const

export interface Lot {
  /** Front left, front right (on the street), back right, back left: counter-clockwise. */
  pts: [Pt, Pt, Pt, Pt]
  /** Wall height, metres. */
  h: number
  kind: number
  roof: number
  /** A seed shared by the lots of one building: its render and its roof's weathering. */
  tone: number
}

const CELL = 2
/** Too steep to build on: rise over run. */
const MAX_SLOPE = 0.45
/** Clearance round the monuments, cells. */
const MONUMENT_CLEAR = 2
/** Half-widths, metres: recorded roads and streets, the main streets, the local streets, alleys. */
const HALF = { road: 4.5, street: 3.5, main: 3, local: [1.7, 2.4], alley: 1.1 }
/** Storey heights: a tall ground floor of shops, then upper floors. */
const GROUND_FLOOR = 3.8
/** The light-well between a block's street ranges and its back buildings, metres. */
const WELL = 2.5
const FLOOR = 3.0
/** The size of the pattern the city's heights follow, metres. */
const HEIGHT_PATTERN_M = 200
/** How many lots a building of flats takes along its street, drawn from these. */
const BUILDING_LOTS = [1, 2, 2, 2, 3, 3, 3, 4, 4, 5]
/** The shallowest building, metres front to back: a room and its walls. */
const MIN_DEPTH_M = 6
/** A building turns with its street through a bend up to 35°, but not round a corner. */
const BEND_COS = Math.cos((35 * Math.PI) / 180)

type Quarter = 'valley' | 'hill' | 'rich' | 'river'

/** How each quarter is built: block area to split down to (m²), strip depth, frontage, storeys. */
const QUARTER: Record<
  Quarter,
  {
    area: [number, number]
    depth: [number, number]
    frontage: [number, number]
    storeys: [number, number]
  }
> = {
  valley: { area: [2200, 4000], depth: [11, 15], frontage: [6, 11], storeys: [3, 5] },
  hill: { area: [3200, 5500], depth: [12, 16], frontage: [7, 13], storeys: [2, 3] },
  rich: { area: [4500, 8000], depth: [22, 30], frontage: [7, 12], storeys: [2, 3] },
  river: { area: [3500, 6500], depth: [12, 15], frontage: [30, 60], storeys: [2, 2] },
}

export function layCity(c: CityInput) {
  const rand = c.rand
  const pick = ([a, b]: [number, number]) => a + rand() * (b - a)

  // --- the grid -------------------------------------------------------------------------
  const xs = c.circuit.map((p) => p[0])
  const ys = c.circuit.map((p) => p[1])
  const x0 = Math.min(...xs) - 40
  const y0 = Math.min(...ys) - 40
  const nx = Math.ceil((Math.max(...xs) + 40 - x0) / CELL)
  const ny = Math.ceil((Math.max(...ys) + 40 - y0) / CELL)
  const N = nx * ny
  const cx = (i: number) => x0 + (i + 0.5) * CELL
  const cy = (j: number) => y0 + (j + 0.5) * CELL
  const cellOf = (p: Pt) => {
    const i = Math.floor((p[0] - x0) / CELL)
    const j = Math.floor((p[1] - y0) / CELL)
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i
  }

  const inside = new Uint8Array(N)
  fillRing(c.circuit, x0, y0, nx, ny, (k) => (inside[k] = 1))
  const monument = new Uint8Array(N)
  for (const r of c.monuments) fillRing(r, x0, y0, nx, ny, (k) => (monument[k] = 1))
  for (let pass = 0; pass < MONUMENT_CLEAR; pass++) dilate(monument, nx, ny)
  const square = new Uint8Array(N)
  for (const r of [c.forum, ...c.squares])
    if (r.length > 2) fillRing(r, x0, y0, nx, ny, (k) => (square[k] = 1))

  /** 0 nothing may stand, 1 a building may, 2 a street. */
  const st = new Uint8Array(N)
  const wet = new Uint8Array(N)
  const slope = new Float32Array(N)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (!inside[k]) continue
      const [x, y] = [cx(i), cy(j)]
      wet[k] = c.wet(x, y) ? 1 : 0
      slope[k] = c.slopeAt(x, y)
      st[k] = wet[k] || monument[k] || square[k] || slope[k] > MAX_SLOPE ? 0 : 1
    }

  const paint = (line: Pt[], half: number, only?: (k: number) => boolean) => {
    for (let s = 0; s + 1 < line.length; s++) {
      const [a, b] = [line[s], line[s + 1]]
      const i0 = Math.floor((Math.min(a[0], b[0]) - half - x0) / CELL)
      const i1 = Math.ceil((Math.max(a[0], b[0]) + half - x0) / CELL)
      const j0 = Math.floor((Math.min(a[1], b[1]) - half - y0) / CELL)
      const j1 = Math.ceil((Math.max(a[1], b[1]) + half - y0) / CELL)
      for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
          const k = j * nx + i
          if (st[k] !== 1 || (only && !only(k))) continue
          if (segDist([cx(i), cy(j)], a, b) <= half) st[k] = 2
        }
    }
  }

  // --- 1. streets -------------------------------------------------------------------------
  for (const s of c.streets) paint(s.pts, s.road ? HALF.road : HALF.street)
  const mains = mainStreets(c, { x0, y0, nx, ny, inside, monument, wet, slope, square })
  for (const m of mains) paint(m, HALF.main)

  // Blocks: what is left between the streets, cut down by local streets.
  const label = new Int32Array(N).fill(-1)
  let nextLabel = 0
  const flood = (seed: number, within: (k: number) => boolean) => {
    const id = nextLabel++
    const cells: number[] = [seed]
    label[seed] = id
    for (let h = 0; h < cells.length; h++) {
      const k = cells[h]
      const i = k % nx
      for (const q of [k - 1, k + 1, k - nx, k + nx]) {
        if (q < 0 || q >= N) continue
        if ((q === k - 1 && i === 0) || (q === k + 1 && i === nx - 1)) continue
        if (label[q] === id || st[q] !== 1 || !within(q)) continue
        label[q] = id
        cells.push(q)
      }
    }
    return { id, cells }
  }
  const queue: { id: number; cells: number[] }[] = []
  for (let k = 0; k < N; k++)
    if (st[k] === 1 && label[k] < 0) queue.push(flood(k, () => true))

  const quarterAt = (p: Pt): Quarter => {
    const low = c.at(p[0], p[1]) < 28
    if (low && c.toRiver(p[0], p[1]) < 220) return 'river'
    if (low) return 'valley'
    const rich = c.richQuarters.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 300)
    return rich ? 'rich' : 'hill'
  }

  // The frame a local street follows. On a slope, the contours: the streets on
  // Rome's hills ran along them, with steep lanes and stairs straight up and down.
  // On the flat, the nearest recorded or main street, so side streets leave it
  // square and the blocks along it line up.
  const majors: [Pt, Pt][] = [...c.streets.map((s) => s.pts), ...mains].flatMap((l) =>
    l.slice(1).map((q, i) => [l[i], q] as [Pt, Pt]),
  )
  const frameAt = (p: Pt): { dir: Pt; slope: number } | null => {
    const gx = (c.at(p[0] + 12, p[1]) - c.at(p[0] - 12, p[1])) / 24
    const gy = (c.at(p[0], p[1] + 12) - c.at(p[0], p[1] - 12)) / 24
    const slope = Math.hypot(gx, gy)
    if (slope > 0.05) return { dir: [-gy / slope, gx / slope], slope }
    let best: [Pt, Pt] | null = null
    let bd = 200
    for (const sg of majors) {
      const d = segDist(p, sg[0], sg[1])
      if (d < bd) [best, bd] = [sg, d]
    }
    if (!best) return null
    const l = Math.hypot(best[1][0] - best[0][0], best[1][1] - best[0][1]) || 1
    return { dir: [(best[1][0] - best[0][0]) / l, (best[1][1] - best[0][1]) / l], slope }
  }
  /** A street from `mid` both ways along `dir`, wandering a little as it goes, out to `reach`. */
  const wander = (mid: Pt, dir: Pt, reach: number): Pt[] => {
    const side = (sign: number) => {
      const pts: Pt[] = []
      let p = mid
      let a = Math.atan2(dir[1], dir[0])
      const base = a
      for (let run = 0; run < reach;) {
        const step = 12 + rand() * 10
        a = base + Math.max(-0.35, Math.min(0.35, a - base + (rand() - 0.5) * 0.3))
        p = [p[0] + Math.cos(a) * step * sign, p[1] + Math.sin(a) * step * sign]
        pts.push(p)
        run += step
      }
      return pts
    }
    return [...side(-1).reverse(), mid, ...side(1)]
  }

  // How tall the city stands: a smooth pattern over it, some 200 m across, so a
  // stretch of street is of a height and the change comes between stretches.
  const seed = Math.floor(rand() * 2 ** 31)
  const lattice = (i: number, j: number) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) ^ seed
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1
  }
  const ease = (t: number) => t * t * (3 - 2 * t)
  const pattern = ([x, y]: Pt) => {
    const [fx, fy] = [x / HEIGHT_PATTERN_M, y / HEIGHT_PATTERN_M]
    const [i, j] = [Math.floor(fx), Math.floor(fy)]
    const [u, v] = [ease(fx - i), ease(fy - j)]
    const top = lattice(i, j) * (1 - u) + lattice(i + 1, j) * u
    const bottom = lattice(i, j + 1) * (1 - u) + lattice(i + 1, j + 1) * u
    return top * (1 - v) + bottom * v
  }
  /** Storeys at a point, before a building's own step: the quarter's range, by the pattern. */
  const storeysAt = (p: Pt, lo: number, hi: number) =>
    (lo + hi) / 2 + pattern(p) * ((hi - lo) / 2 + 0.5)
  /** Whether a point fronts a main or recorded street. */
  const onMajor = (p: Pt) => majors.some((sg) => segDist(p, sg[0], sg[1]) < 6.5)

  const blocks: { cells: number[]; quarter: Quarter; slope: number }[] = []
  const locals: Pt[][] = []
  while (queue.length) {
    const comp = queue.pop()!
    const cells = comp.cells.filter((k) => st[k] === 1)
    if (cells.length * CELL * CELL < 120) continue
    const shape = pca(cells, nx, cx, cy)
    const quarter = quarterAt(shape.c)
    const frame = frameAt(shape.c)
    const slope = frame?.slope ?? 0
    // Blocks on a slope are terraces, smaller than on the flat.
    const target = pick(QUARTER[quarter].area) * (slope > 0.08 ? 0.7 : 1)
    const area = cells.length * CELL * CELL
    if (area < target || shape.long < 56 || shape.short < 24) {
      blocks.push({ cells, quarter, slope })
      continue
    }
    // A local street across the block, a little off the middle, in the local frame:
    // of the frame's two directions, the one nearer to across the block's long axis.
    const along = (rand() - 0.5) * 0.3 * shape.long
    const mid: Pt = [shape.c[0] + shape.axis[0] * along, shape.c[1] + shape.axis[1] * along]
    const across: Pt = [-shape.axis[1], shape.axis[0]]
    let dir = across
    let stair = false
    if (frame) {
      const a = frame.dir
      const b: Pt = [-a[1], a[0]]
      const da = Math.abs(a[0] * across[0] + a[1] * across[1])
      const db = Math.abs(b[0] * across[0] + b[1] * across[1])
      // On a real slope the contour wins unless it would run nearly along the block.
      const contour = frame.slope > 0.05
      dir = (contour ? da > 0.5 || da >= db : da >= db) ? a : b
      // A street straight up a slope is a narrow lane of steps.
      stair = contour && dir === b && frame.slope > 0.1
    }
    // If the cut does not divide the block (it ran along it, or into a bay), it stays
    // as a dead end, and the next goes straight across the long axis.
    const reach = Math.max(shape.long, shape.short) / 2 + 30
    let id = comp.id
    let parts: { id: number; cells: number[] }[] = []
    const tries: { at: Pt; dir: Pt; half: number }[] = [
      {
        at: mid,
        dir,
        half: stair ? HALF.alley * 1.2 : pick(HALF.local as [number, number]),
      },
      { at: shape.c, dir: across, half: pick(HALF.local as [number, number]) },
    ]
    for (const t of tries) {
      const line = wander(t.at, t.dir, reach)
      const own = (k: number) => label[k] === id
      paint(line, t.half, own)
      locals.push(line)
      parts = []
      for (const k of cells) if (st[k] === 1 && label[k] === id) parts.push(flood(k, own))
      if (parts.length >= 2) break
      id = parts[0]?.id ?? id
    }
    if (parts.length < 2) {
      blocks.push({
        cells: parts[0]?.cells ?? cells.filter((k) => st[k] === 1),
        quarter,
        slope,
      })
      continue
    }
    queue.push(...parts)
  }

  // A few blocks keep a dead-end alley into their middle.
  for (const b of blocks) {
    if (b.cells.length * CELL * CELL < 2500 || rand() > 0.15) continue
    const shape = pca(b.cells, nx, cx, cy)
    const across: Pt = [-shape.axis[1], shape.axis[0]]
    const side = rand() < 0.5 ? 1 : -1
    const from: Pt = [
      shape.c[0] + across[0] * side * (shape.short / 2 + 10),
      shape.c[1] + across[1] * side * (shape.short / 2 + 10),
    ]
    const set = new Set(b.cells)
    paint([from, shape.c], HALF.alley, (k) => set.has(k))
    b.cells = b.cells.filter((k) => st[k] === 1)
  }

  // --- 2–4. lots round each block ----------------------------------------------------------
  const lots: Lot[] = []
  const gardens: Pt[] = []
  const blockMask = new Int32Array(N).fill(-1)
  blocks.forEach((b, n) => b.cells.forEach((k) => (blockMask[k] = n)))
  for (const [n, b] of blocks.entries()) {
    const own = (k: number) => k >= 0 && blockMask[k] === n
    const dist = distanceField(b.cells, own, nx)
    const distAt = (p: Pt) => {
      const k = cellOf(p)
      return k >= 0 && own(k) ? dist.get(k)! * CELL : 0
    }
    /** How deep a strip may go from `p` along `dir` before it meets the strip opposite. */
    // Going in from the street, the distance to the block's edge rises until the
    // middle of the block and then falls: the strip may reach the ridge. (Near a
    // corner it holds level, the other street being as near: that is not the ridge.)
    const room = (p: Pt, dir: Pt, want: number) => {
      let [top, at] = [0, 0]
      for (let s = 1; s <= want; s += 1) {
        const q: Pt = [p[0] + dir[0] * s, p[1] + dir[1] * s]
        const d = distAt(q)
        // The simplified outline may lie a little outside the block: until the strip
        // is in it, the street under it is not its far side.
        if (d === 0 && top === 0) continue
        if (d === 0) return Math.max(3, s - 1)
        if (d >= top) [top, at] = [d, s]
        else if (d < top - 1.5) return Math.max(3, at)
      }
      return want
    }
    const q = QUARTER[b.quarter]
    const firstLot = lots.length
    const depth = pick(q.depth) * (1 - Math.min(0.3, b.slope * 1.5))
    const frontage =
      (kinds: () => { w: number; kind: number }) =>
      (front: [Pt, Pt], first: number, last: number) =>
        splitFrontage(
          Math.hypot(front[1][0] - front[0][0], front[1][1] - front[0][1]),
          first,
          last,
          kinds,
        )
    /** A lone lot's roof: along the street, the gable to it on a narrow deep lot. */
    const loneRoof = (quad: [Pt, Pt, Pt, Pt]) => {
      const w = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])
      const d = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1])
      return w < d * 0.8 && rand() < 0.2 ? ROOF.across : ROOF.along
    }
    /**
     * The lots of a strip, built: runs of neighbouring flats along one edge become
     * buildings, each of one height (the city's pattern, `storeysAt`, `level` storeys
     * down for a range behind), one render and one roof. `deep`: only the front 14 m
     * is built, the rest yard (the quarters of the rich); `ragged`: a building now and
     * then stops short of the strip's back line.
     */
    const build = (strip: StripLot[], level: number, deep: boolean, ragged: boolean) => {
      let run: StripLot[] = []
      let size = 0
      const flush = () => {
        if (!run.length) return
        const front: Pt = [
          (run[0].quad[0][0] + run[run.length - 1].quad[1][0]) / 2,
          (run[0].quad[0][1] + run[run.length - 1].quad[1][1]) / 2,
        ]
        const [lo, hi] = q.storeys
        const major = onMajor(front)
        let st = Math.round(storeysAt(front, lo, hi) + (major ? 1 : 0) - level)
        if (rand() < 0.25) st += rand() < 0.5 ? -1 : 1
        st = Math.max(1, Math.min(Math.min(5, hi + 1), st))
        const h = GROUND_FLOOR + (st - 1) * FLOOR + rand() * 0.3
        const tone = rand()
        const terrace = rand() < 0.06
        const short = ragged && !deep && !run.some((e) => e.corner) && rand() < 0.3
        const keep = short ? 0.68 + rand() * 0.2 : 1
        for (const e of run) {
          let pts = deep ? truncate(e.quad, 14) : e.quad
          if (keep < 1) pts = shallower(pts, keep)
          const roof = terrace ? ROOF.flat : run.length === 1 ? loneRoof(pts) : ROOF.along
          lots.push({ pts, h, kind: LOT_KIND.flats, roof, tone })
        }
        run = []
      }
      for (const e of strip) {
        if (e.kind !== LOT_KIND.flats) {
          flush()
          if (e.kind === LOT_KIND.house) lots.push(...atriumHouse(e.quad, rand, gardens))
          else
            lots.push({
              pts: e.quad,
              h: 7.5 + rand() * 1.5,
              kind: e.kind,
              roof: ROOF.along,
              tone: rand(),
            })
          continue
        }
        // A building runs on round a gentle bend in the street, not round a corner,
        // and not across a gap where a lot was too small to build.
        const prev = run[run.length - 1]
        const bends =
          prev && prev.edge !== e.edge && prev.u[0] * e.u[0] + prev.u[1] * e.u[1] < BEND_COS
        const gap =
          prev &&
          Math.hypot(prev.quad[1][0] - e.quad[0][0], prev.quad[1][1] - e.quad[0][1]) > 0.5
        if (run.length && (bends || gap || run.length >= size)) flush()
        if (!run.length) size = BUILDING_LOTS[Math.floor(rand() * BUILDING_LOTS.length)]
        run.push(e)
      }
      flush()
    }
    const crowded = b.quarter === 'valley' || b.quarter === 'hill'
    for (const ring of traceRings(b.cells, own, nx, x0, y0)) {
      const pts = simplifyRing(ring, 3)
      if (pts.length < 3 || Math.abs(polygonArea(pts)) < 100) continue
      // A lot along the strip: frontages by quarter; in the quarters of the rich an
      // atrium house on a wide lot among the flats.
      const outer = laneLots(
        pts,
        depth,
        room,
        frontage(() => {
          if (b.quarter === 'rich' && rand() < 0.5) return { w: pick([16, 26]), kind: 1 }
          if (b.quarter === 'river') return { w: pick(q.frontage), kind: 2 }
          return { w: pick(q.frontage), kind: 0 }
        }),
      )
      build(outer.lots, 0, b.quarter === 'rich', crowded)
    }
    // In the crowded quarters a big courtyard is built up too: a ring of back
    // buildings behind the street ranges, across a light-well, round a smaller court
    // — and in a very big block, a second.
    let builtTo = depth
    if (crowded)
      for (let level = 0; level < 2; level++) {
        const reach = builtTo + WELL
        const deep = pick([8, 11])
        const court = (k: number) => own(k) && dist.get(k)! * CELL > reach
        const cells = b.cells.filter(court)
        if (cells.length * CELL * CELL < 400) break
        for (const ring of traceRings(cells, court, nx, x0, y0)) {
          const pts = simplifyRing(ring, 3)
          if (pts.length < 3 || polygonArea(pts) < 400) continue
          const back = laneLots(
            pts,
            deep,
            room,
            frontage(() => ({ w: pick([8, 14]), kind: 0 })),
          )
          build(back.lots, 1 + level, false, true)
        }
        builtTo = reach + deep
      }
    // What is left in the middle is yard and garden: a tree or two in a courtyard,
    // more in the gardens of the rich.
    // Wherever the block is open: clear of the street ranges and of every building.
    const built = lots.slice(firstLot)
    const open = b.cells.filter((k) => dist.get(k)! * CELL > 12)
    const planted: Pt[] = []
    const want = b.quarter === 'rich' ? 0.7 : 0.35
    for (let t = 0; t < open.length / 8; t++) {
      const k = open[Math.floor(rand() * open.length)]
      const p: Pt = [cx(k % nx), cy(Math.floor(k / nx))]
      if (rand() > want || planted.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 9))
        continue
      if (built.some((l) => inRing(p, l.pts) || nearRing(p, l.pts, 3))) continue
      planted.push(p)
    }
    gardens.push(...planted)
  }

  // The slopes too steep to build on are left to scrub and trees.
  const taken = new Set<number>()
  for (let k = 0; k < N; k++) {
    if (!inside[k] || monument[k] || square[k] || wet[k] || slope[k] <= MAX_SLOPE) continue
    if (rand() > 0.06) continue
    const [i, j] = [k % nx, Math.floor(k / nx)]
    const coarse = Math.floor(j / 4) * nx + Math.floor(i / 4)
    if (taken.has(coarse)) continue
    taken.add(coarse)
    gardens.push([cx(i), cy(j)])
  }

  return { lots, gardens, mains, locals, blocks: blocks.length }
}

// --- main streets ---------------------------------------------------------------------------

/**
 * From every gate to the Forum by the cheapest way over a 6 m grid: a step costs its
 * length, more on a slope, less along a recorded street; monuments and the river
 * cannot be crossed. One search from the Forum outward serves every gate, so the
 * streets merge as they near it, as roads into a city do.
 */
function mainStreets(
  c: CityInput,
  g: {
    x0: number
    y0: number
    nx: number
    ny: number
    inside: Uint8Array
    monument: Uint8Array
    wet: Uint8Array
    slope: Float32Array
    square: Uint8Array
  },
) {
  const S = 6
  const f = S / CELL
  const mx = Math.ceil(g.nx / f)
  const my = Math.ceil(g.ny / f)
  const M = mx * my
  const fine = (i: number, j: number) =>
    Math.min(g.ny - 1, Math.floor(j * f + f / 2)) * g.nx +
    Math.min(g.nx - 1, Math.floor(i * f + f / 2))
  const px = (i: number) => g.x0 + (i + 0.5) * S
  const py = (j: number) => g.y0 + (j + 0.5) * S
  const known = new Uint8Array(M)
  for (const s of c.streets)
    for (let n = 0; n + 1 < s.pts.length; n++) {
      const [a, b] = [s.pts[n], s.pts[n + 1]]
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)
      for (let t = 0; t <= steps; t++) {
        const i = Math.floor((a[0] + ((b[0] - a[0]) * t) / steps - g.x0) / S)
        const j = Math.floor((a[1] + ((b[1] - a[1]) * t) / steps - g.y0) / S)
        if (i >= 0 && j >= 0 && i < mx && j < my) known[j * mx + i] = 1
      }
    }
  const cost = new Float32Array(M)
  const source: number[] = []
  for (let j = 0; j < my; j++)
    for (let i = 0; i < mx; i++) {
      const k = j * mx + i
      const q = fine(i, j)
      if (!g.inside[q] || g.monument[q] || g.wet[q]) {
        cost[k] = Infinity
        continue
      }
      cost[k] = (1 + 40 * g.slope[q] ** 2) * (known[k] ? 0.35 : 1)
      if (g.square[q] && inRing([px(i), py(j)], c.forum)) source.push(k)
    }
  const dist = new Float32Array(M).fill(Infinity)
  const prev = new Int32Array(M).fill(-1)
  const heap = new Heap()
  for (const k of source) {
    dist[k] = 0
    heap.push(k, 0)
  }
  const steps = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ]
  while (heap.size) {
    const [k, d] = heap.pop()
    if (d > dist[k]) continue
    const i = k % mx
    const j = Math.floor(k / mx)
    for (const [di, dj, len] of steps) {
      const [a, b] = [i + di, j + dj]
      if (a < 0 || b < 0 || a >= mx || b >= my) continue
      const q = b * mx + a
      const nd = d + len * S * (cost[k] + cost[q]) * 0.5
      if (nd < dist[q]) {
        dist[q] = nd
        prev[q] = k
        heap.push(q, nd)
      }
    }
  }
  // From each gate, a little inside the wall, back along the cheapest way.
  const mid: Pt = [
    c.circuit.reduce((s, p) => s + p[0], 0) / c.circuit.length,
    c.circuit.reduce((s, p) => s + p[1], 0) / c.circuit.length,
  ]
  const lines: Pt[][] = []
  for (const gate of c.gates) {
    const l = Math.hypot(mid[0] - gate[0], mid[1] - gate[1])
    let start = -1
    for (let s = 8; s < 60 && start < 0; s += 4) {
      const i = Math.floor((gate[0] + ((mid[0] - gate[0]) * s) / l - g.x0) / S)
      const j = Math.floor((gate[1] + ((mid[1] - gate[1]) * s) / l - g.y0) / S)
      if (i >= 0 && j >= 0 && i < mx && j < my && Number.isFinite(dist[j * mx + i]))
        start = j * mx + i
    }
    if (start < 0) continue
    const path: Pt[] = [gate]
    for (let k = start; k >= 0 && dist[k] > 0; k = prev[k])
      path.push([px(k % mx), py(Math.floor(k / mx))])
    if (path.length < 3) continue
    lines.push(chaikin(simplifyLine(path, 5), 2))
  }
  return lines
}

// --- lots -------------------------------------------------------------------------------------

type Room = (p: Pt, dir: Pt, want: number) => number
/** A lot of a strip: its quad, its kind, the edge of the ring it fronts, and whether it turns a corner. */
type StripLot = {
  quad: [Pt, Pt, Pt, Pt]
  kind: number
  edge: number
  /** The direction of the edge it fronts. */
  u: Pt
  corner: boolean
}
type Frontage = { t: number[]; kinds: number[] }

/**
 * Lots along every edge of a ring whose inside is on its left: a strip of `depth`
 * (less where the block is narrower), mitred at the corners so neighbouring strips
 * meet on the bisector, cut along the edge where `split` says.
 */
function laneLots(
  ring: Pt[],
  depth: number,
  room: Room,
  split: (front: [Pt, Pt], first: number, last: number) => Frontage | null,
) {
  const n = ring.length
  const out: StripLot[] = []
  const edge = (k: number) => {
    const [a, b] = [ring[k], ring[(k + 1) % n]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    return { a, b, L, u, nrm: [-u[1], u[0]] as Pt }
  }
  // Each edge's strip is one depth — as deep as asked, or as the block has room for
  // along it — so its back line is straight and its roofs' ridge level. Neighbouring
  // strips meet where their back lines cross: the mitre.
  const D: number[] = []
  for (let k = 0; k < n; k++) {
    const { a, L, u, nrm } = edge(k)
    let d = depth
    for (const f of [0.2, 0.5, 0.8]) {
      const p: Pt = [a[0] + u[0] * L * f + nrm[0] * 0.5, a[1] + u[1] * L * f + nrm[1] * 0.5]
      d = Math.min(d, room(p, nrm, depth))
    }
    D.push(d)
  }
  const mitre: Pt[] = []
  for (let k = 0; k < n; k++) {
    const e0 = edge((k - 1 + n) % n)
    const e1 = edge(k)
    const [d0, d1] = [D[(k - 1 + n) % n], D[k]]
    const p0: Pt = [e0.a[0] + e0.nrm[0] * d0, e0.a[1] + e0.nrm[1] * d0]
    const p1: Pt = [e1.a[0] + e1.nrm[0] * d1, e1.a[1] + e1.nrm[1] * d1]
    const cross = e0.u[0] * e1.u[1] - e0.u[1] * e1.u[0]
    let m: Pt = p1
    if (Math.abs(cross) > 0.05) {
      const t = ((p1[0] - p0[0]) * e1.u[1] - (p1[1] - p0[1]) * e1.u[0]) / cross
      const q: Pt = [p0[0] + e0.u[0] * t, p0[1] + e0.u[1] * t]
      if (Math.hypot(q[0] - ring[k][0], q[1] - ring[k][1]) < Math.max(d0, d1) * 2.5) m = q
    }
    mitre.push(m)
  }
  for (let k = 0; k < n; k++) {
    const { a, L, u, nrm } = edge(k)
    if (L < 3) continue
    const [ma, mb] = [mitre[k], mitre[(k + 1) % n]]
    // How far along the edge each mitre lies: the first and last lots must reach past them.
    const first = Math.max(0, (ma[0] - a[0]) * u[0] + (ma[1] - a[1]) * u[1])
    const last = Math.min(L, (mb[0] - a[0]) * u[0] + (mb[1] - a[1]) * u[1])
    const f = split([a, ring[(k + 1) % n]], first, last)
    if (last - first < 2) {
      // Too short for a strip between its mitres: a hipped end, up to where they meet.
      const b = ring[(k + 1) % n]
      const x = meet(a, ma, b, mb)
      // Only where it is big enough to build: a small wedge is left to the street.
      if (f && x && L >= 8 && polygonArea([a, b, x]) > 40 && !slender([a, b, x]))
        out.push({ quad: [a, b, x, x], kind: f.kinds[0], edge: k, u, corner: true })
      continue
    }
    if (!f) continue
    const along = (t: number): Pt => [a[0] + u[0] * t, a[1] + u[1] * t]
    const backAt = (t: number, i: number, count: number): Pt => {
      if (i === 0) return ma
      if (i === count) return mb
      const p = along(t)
      return [p[0] + nrm[0] * D[k], p[1] + nrm[1] * D[k]]
    }
    const count = f.t.length - 1
    const backs = f.t.map((t, i) => backAt(t, i, count))
    for (let i = 0; i < count; i++) {
      const quad: [Pt, Pt, Pt, Pt] = [
        along(f.t[i]),
        along(f.t[i + 1]),
        backs[i + 1],
        backs[i],
      ]
      if (polygonArea(quad) < 12 || !convex(quad) || slender(quad)) continue
      // Nothing thinner than a room and a wall: a strip squeezed by a narrow block is
      // left as yard rather than built as a skinny range.
      if (depthOf(quad) < MIN_DEPTH_M) continue
      out.push({ quad, kind: f.kinds[i], edge: k, u, corner: i === 0 || i === count - 1 })
    }
  }
  return { lots: out, inner: mitre }
}

/**
 * Cuts an edge of length `L` into lots of the widths `next` draws, the first reaching
 * past `first` and the last starting before `last`, where the mitres lie.
 */
function splitFrontage(
  L: number,
  first: number,
  last: number,
  next: () => { w: number; kind: number },
): Frontage {
  const t = [0]
  const kinds: number[] = []
  let pos = 0
  for (;;) {
    const { w, kind } = next()
    let end = pos + w
    if (t.length === 1) end = Math.max(end, first + 3)
    // The last lot takes what is left when that is less than half a lot (or 4 m, the
    // narrowest shop), or when another would start past the last mitre.
    if (end > last - 3 || L - end < Math.max(4, w * 0.5)) end = L
    t.push(end)
    kinds.push(kind)
    pos = end
    if (end >= L) break
  }
  return { t, kinds }
}

/**
 * An atrium house on its lot: ranges round a central court, the front one of two
 * storeys with shops either side of the door, the others of one (Vitruvius 6.3;
 * the houses of Pompeii). Its court may hold a garden tree.
 */
function atriumHouse(quad: [Pt, Pt, Pt, Pt], rand: () => number, gardens: Pt[]): Lot[] {
  const tone = rand()
  const side = (i: number) =>
    Math.hypot(quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1])
  const shortest = Math.min(side(0), side(1), side(2), side(3))
  // Too small for ranges of rooms round a court: one house under one roof.
  if (shortest < 17)
    return [
      { pts: quad, h: GROUND_FLOOR + FLOOR, kind: LOT_KIND.house, roof: ROOF.along, tone },
    ]
  const d = Math.min(6.5, shortest * 0.3)
  // Four ranges, one per side, meeting at the corners.
  const c: Pt = [
    (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4,
    (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4,
  ]
  const inner = quad.map((p) => {
    const l = Math.hypot(c[0] - p[0], c[1] - p[1])
    const k = Math.min(0.45, (d * 1.3) / l)
    return [p[0] + (c[0] - p[0]) * k, p[1] + (c[1] - p[1]) * k] as Pt
  })
  const out: Lot[] = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    out.push({
      pts: [quad[i], quad[j], inner[j], inner[i]],
      h: i === 0 ? GROUND_FLOOR + FLOOR + rand() * 0.5 : 4.2 + rand() * 0.8,
      kind: LOT_KIND.house,
      roof: ROOF.lean,
      tone,
    })
  }
  if (rand() < 0.4) gardens.push(c)
  return out
}

/** How deep a lot quad is: the nearer of its back corners to the line of its front. */
function depthOf(q: [Pt, Pt, Pt, Pt]) {
  const L = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) || 1
  const n: Pt = [-(q[1][1] - q[0][1]) / L, (q[1][0] - q[0][0]) / L]
  const d = (p: Pt) => Math.abs((p[0] - q[0][0]) * n[0] + (p[1] - q[0][1]) * n[1])
  return Math.min(d(q[2]), d(q[3]))
}

/** A lot quad cut back to `k` of its depth, measured along its sides. */
function shallower(q: [Pt, Pt, Pt, Pt], k: number): [Pt, Pt, Pt, Pt] {
  const at = (f: Pt, b: Pt): Pt => [f[0] + (b[0] - f[0]) * k, f[1] + (b[1] - f[1]) * k]
  return [q[0], q[1], at(q[1], q[2]), at(q[0], q[3])]
}

/** The front `d` metres of a lot quad. */
function truncate(q: [Pt, Pt, Pt, Pt], d: number): [Pt, Pt, Pt, Pt] {
  const cut = (f: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - f[0], b[1] - f[1])
    const k = Math.min(1, d / l)
    return [f[0] + (b[0] - f[0]) * k, f[1] + (b[1] - f[1]) * k]
  }
  return [q[0], q[1], cut(q[1], q[2]), cut(q[0], q[3])]
}

// --- raster helpers ---------------------------------------------------------------------------

/** Calls `set` with every cell whose centre is inside the ring (even-odd). */
function fillRing(
  ring: Pt[],
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  set: (k: number) => void,
) {
  const ys = ring.map((p) => p[1])
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / CELL))
  const j1 = Math.min(ny - 1, Math.ceil((Math.max(...ys) - y0) / CELL))
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * CELL
    const hits: number[] = []
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [p, q] = [ring[a], ring[b]]
      if (p[1] > y !== q[1] > y)
        hits.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]))
    }
    hits.sort((u, v) => u - v)
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const i0 = Math.max(0, Math.ceil((hits[h] - x0) / CELL - 0.5))
      const i1 = Math.min(nx - 1, Math.floor((hits[h + 1] - x0) / CELL - 0.5))
      for (let i = i0; i <= i1; i++) set(j * nx + i)
    }
  }
}

function dilate(m: Uint8Array, nx: number, ny: number) {
  const src = m.slice()
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (src[k]) continue
      if (
        (i > 0 && src[k - 1]) ||
        (i < nx - 1 && src[k + 1]) ||
        (j > 0 && src[k - nx]) ||
        (j < ny - 1 && src[k + nx])
      )
        m[k] = 1
    }
}

/** Centre, long axis and extents of a set of cells. */
function pca(
  cells: number[],
  nx: number,
  cx: (i: number) => number,
  cy: (j: number) => number,
) {
  let [sx, sy] = [0, 0]
  for (const k of cells) {
    sx += cx(k % nx)
    sy += cy(Math.floor(k / nx))
  }
  const c: Pt = [sx / cells.length, sy / cells.length]
  let [xx, xy, yy] = [0, 0, 0]
  for (const k of cells) {
    const dx = cx(k % nx) - c[0]
    const dy = cy(Math.floor(k / nx)) - c[1]
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const axis: Pt = [Math.cos(angle), Math.sin(angle)]
  let [lo, hi, lo2, hi2] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const k of cells) {
    const dx = cx(k % nx) - c[0]
    const dy = cy(Math.floor(k / nx)) - c[1]
    const s = dx * axis[0] + dy * axis[1]
    const t = -dx * axis[1] + dy * axis[0]
    lo = Math.min(lo, s)
    hi = Math.max(hi, s)
    lo2 = Math.min(lo2, t)
    hi2 = Math.max(hi2, t)
  }
  return { c, axis, long: hi - lo + CELL, short: hi2 - lo2 + CELL }
}

/** Each cell's distance in cells to the nearest cell outside the set (a 3-4 chamfer). */
function distanceField(cells: number[], own: (k: number) => boolean, nx: number) {
  const d = new Map<number, number>()
  for (const k of cells) d.set(k, Infinity)
  const at = (k: number) => (own(k) ? (d.get(k) ?? Infinity) : 0)
  const sorted = [...cells].sort((a, b) => a - b)
  const pass = (list: number[], nbrs: [number, number][]) => {
    for (const k of list) {
      let v = d.get(k)!
      for (const [o, w] of nbrs) v = Math.min(v, at(k + o) + w)
      d.set(k, v)
    }
  }
  pass(sorted, [
    [-1, 1],
    [-nx, 1],
    [-nx - 1, 1.4],
    [-nx + 1, 1.4],
  ])
  pass(sorted.reverse(), [
    [1, 1],
    [nx, 1],
    [nx + 1, 1.4],
    [nx - 1, 1.4],
  ])
  return d
}

/**
 * The boundary rings of a set of cells, in plane metres, each with the set on its
 * left: the outline counter-clockwise, holes clockwise. At a vertex where the set
 * touches only diagonally, the ring turns to keep hugging the cell it follows.
 */
function traceRings(
  cells: number[],
  own: (k: number) => boolean,
  nx: number,
  x0: number,
  y0: number,
) {
  // Directed edges between cell corners (i, j), keyed by their start.
  const out = new Map<number, number[]>()
  const W = nx + 1
  const key = (i: number, j: number) => j * W + i
  const add = (a: number, b: number) => {
    const l = out.get(a)
    if (l) l.push(b)
    else out.set(a, [b])
  }
  for (const k of cells) {
    const i = k % nx
    const j = Math.floor(k / nx)
    if (i === 0 || !own(k - 1)) add(key(i, j + 1), key(i, j))
    if (i === nx - 1 || !own(k + 1)) add(key(i + 1, j), key(i + 1, j + 1))
    if (!own(k - nx)) add(key(i, j), key(i + 1, j))
    if (!own(k + nx)) add(key(i + 1, j + 1), key(i, j + 1))
  }
  const dir = (a: number, b: number) => {
    const [di, dj] = [(b % W) - (a % W), Math.floor(b / W) - Math.floor(a / W)]
    return di === 1 ? 0 : dj === 1 ? 1 : di === -1 ? 2 : 3
  }
  const rings: Pt[][] = []
  for (const [start, ends] of out) {
    while (ends.length) {
      const ring: Pt[] = []
      let a = start
      let b = ends.pop()!
      const first = a
      for (let guard = 0; guard < 1e6; guard++) {
        ring.push([x0 + (a % W) * CELL, y0 + Math.floor(a / W) * CELL])
        if (b === first) break
        const d = dir(a, b)
        const next = out.get(b)
        if (!next?.length) break
        // Left, straight, right.
        let pickIdx = 0
        for (const want of [(d + 1) % 4, d, (d + 3) % 4]) {
          const idx = next.findIndex((e) => dir(b, e) === want)
          if (idx >= 0) {
            pickIdx = idx
            break
          }
        }
        const e = next.splice(pickIdx, 1)[0]
        a = b
        b = e
      }
      if (ring.length > 3) rings.push(ring)
    }
  }
  return rings
}

// --- geometry helpers -------------------------------------------------------------------------

/** A closed ring simplified by Douglas–Peucker (no repeated last point). */
function simplifyRing(ring: Pt[], tol: number): Pt[] {
  let far = 0
  let fd = 0
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > fd) [far, fd] = [i, d]
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol)
  const b = simplifyLine([...ring.slice(far), ring[0]], tol)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

function simplifyLine(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  let idx = 0
  let md = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > md) [idx, md] = [i, d]
  }
  if (md <= tol) return [pts[0], pts[pts.length - 1]]
  return [
    ...simplifyLine(pts.slice(0, idx + 1), tol).slice(0, -1),
    ...simplifyLine(pts.slice(idx), tol),
  ]
}

function chaikin(pts: Pt[], iterations: number): Pt[] {
  let p = pts
  for (let n = 0; n < iterations; n++) {
    const q: Pt[] = [p[0]]
    for (let i = 0; i + 1 < p.length; i++) {
      const [a, b] = [p[i], p[i + 1]]
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    q.push(p[p.length - 1])
    p = q
  }
  return p
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

function polygonArea(r: Pt[]) {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const [p, q] = [r[i], r[(i + 1) % r.length]]
    s += p[0] * q[1] - q[0] * p[1]
  }
  return s / 2
}

/** Where the line from a through a2 meets the line from b through b2, if they do. */
function meet(a: Pt, a2: Pt, b: Pt, b2: Pt): Pt | null {
  const [ux, uy] = [a2[0] - a[0], a2[1] - a[1]]
  const [vx, vy] = [b2[0] - b[0], b2[1] - b[1]]
  const cross = ux * vy - uy * vx
  if (Math.abs(cross) < 1e-6) return null
  const t = ((b[0] - a[0]) * vy - (b[1] - a[1]) * vx) / cross
  return t > 0 && t < 1.2 ? [a[0] + ux * t, a[1] + uy * t] : null
}

/** A sliver: a lot with a corner sharper than 25°, which no one would build. */
function slender(q: Pt[]) {
  const p = q.filter(
    (v, i) => i === 0 || Math.hypot(v[0] - q[i - 1][0], v[1] - q[i - 1][1]) > 0.01,
  )
  for (let i = 0; i < p.length; i++) {
    const [a, b, c] = [p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]]
    const u = [a[0] - b[0], a[1] - b[1]]
    const v = [c[0] - b[0], c[1] - b[1]]
    const cos =
      (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1)
    if (cos > Math.cos((25 * Math.PI) / 180)) return true
  }
  return false
}

function convex(q: Pt[]) {
  for (let i = 0; i < q.length; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % q.length], q[(i + 2) % q.length]]
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) return false
  }
  return true
}

function nearRing(p: Pt, ring: Pt[], d: number) {
  for (let i = 0; i < ring.length; i++)
    if (segDist(p, ring[i], ring[(i + 1) % ring.length]) < d) return true
  return false
}

function inRing([x, y]: Pt, ring: Pt[]) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** A binary min-heap of (index, priority). */
class Heap {
  private k: number[] = []
  private p: number[] = []
  get size() {
    return this.k.length
  }
  push(k: number, p: number) {
    this.k.push(k)
    this.p.push(p)
    let i = this.k.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (this.p[up] <= this.p[i]) break
      this.swap(i, up)
      i = up
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.p[0]]
    const lk = this.k.pop()!
    const lp = this.p.pop()!
    if (this.k.length) {
      this.k[0] = lk
      this.p[0] = lp
      let i = 0
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2]
        let m = i
        if (l < this.k.length && this.p[l] < this.p[m]) m = l
        if (r < this.k.length && this.p[r] < this.p[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
  private swap(a: number, b: number) {
    ;[this.k[a], this.k[b]] = [this.k[b], this.k[a]]
    ;[this.p[a], this.p[b]] = [this.p[b], this.p[a]]
  }
}
