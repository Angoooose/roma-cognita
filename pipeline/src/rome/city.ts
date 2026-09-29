/**
 * The generated city inside the Servian Wall (DESIGN.md §7.7): its streets, its blocks
 * and the lots round them. None of it is a claim about any building; it follows how
 * pre-modern cities are modelled and what Rome's fabric is known to have been like.
 *
 * 1. **Streets, in a hierarchy.** The recorded streets are kept. Main streets run from
 *    each gate to the Forum by the easiest way over the ground (a cheapest path that
 *    shuns slopes and prefers the recorded streets, after Emilien et al. 2012 and
 *    Galin et al. 2011), so they bend along the valleys and merge as they near the
 *    centre; where one runs along a recorded street, that street is the street. The
 *    local streets are grown off them, out from the Forum, one lane off another,
 *    following the contours and lining up with their neighbours (growth.ts). Blocks
 *    are what is left between: some 30–40 m by 55–80 m in the crowded valleys
 *    (Cosa, Pompeii), larger on the hills. Rome was "casually built upon … rather
 *    than regularly planned" (Livy 5.55), with "narrow, twisting lanes" (Tacitus,
 *    *Annals* 15.38).
 * 2. **Plots from the street to the middle.** Every cell of a block belongs to the
 *    street frontage nearest it, so a plot runs from its street to the middle of the
 *    block and the block is built solid (the straight-skeleton split of Vanegas et
 *    al. 2012, "Procedural Generation of Parcels in Urban Modeling", done cell by
 *    cell so any outline will do). A corner plot is one plot, fronting both streets,
 *    and belongs to the one that matters more (Conzen; Emilien et al. 2012). Along a
 *    street the plots come in series of one width. A shallow plot is built to its
 *    back; a deep one fills its front and leaves its back as yard, so the yards of
 *    plots back to back make one yard in the middle of the block, and a few large
 *    buildings stand round a court of their own (the Marble Plan's courtyard
 *    blocks), all built wall to wall.
 * 3. **Buildings, not lots.** A run of one to five neighbouring lots along a street
 *    is one building, as the blocks of flats on the Marble Plan take several shops'
 *    frontage: one height, one render, and one low roof along the street, hipped at
 *    the block's corners. Heights change smoothly across the city — a pattern some
 *    200 m across, a storey more on the main and recorded streets, a storey less on
 *    the ranges behind — and step a storey up or down only between buildings. A
 *    lone narrow deep one turns its gable to the street, a few have a flat terrace, and an atrium house's
 *    ranges fall inward to its court (the houses of Pompeii; the Marble Plan).
 * 4. **Quarters.** The valleys (the Subura, the Velabrum) are crowded with blocks of
 *    flats of three to five storeys on narrow lots; the hills are lower. Round the
 *    Palatine, the Carinae, the Velia, the Quirinal and the Caelian, atrium houses on
 *    wide deep lots stand among the flats, as rich and poor stood side by side on the
 *    Marble Plan; near the river, warehouses on long lots.
 *
 * Everything is on a 2 m grid, and seeded, so every build is the same. The works
 * followed are catalogued in data/sources.yaml (vanegas-2012, emilien-2012,
 * galin-2011, weber-2009, chen-2008, courtat-2011, dylla-2009, forma-urbis-stanford,
 * reynolds-expedition, poehler-2017, pecs-cosa, livy, tacitus-ann, varro-ll,
 * cicero-agr, vitruvius).
 */
import type { StreetLine } from './streets.ts'
import { growStreets } from './growth.ts'

type Pt = [number, number]

export interface CityInput {
  circuit: Pt[]
  gates: Pt[]
  streets: StreetLine[]
  /** The Forum's square: where the main streets lead. */
  forum: Pt[]
  /** Other squares no house stands in: the Capitol's precinct. */
  squares: Pt[][]
  /** Excavated pieces of street (SITAR) on no recorded street, as short lines, for the generated streets to pass along. */
  pieces: Pt[][]
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
  /** The Palatine's top, where there were great houses and no flats. */
  palatine?: Pt
  rand: () => number
}

/**
 * What a generated lot is: flats over shops, an atrium house, a warehouse, a suburban
 * house, or open ground walled round (the suburb's yards and gardens: a floor and a
 * low wall, not a building).
 */
export const LOT_KIND = {
  flats: 0,
  house: 1,
  warehouse: 2,
  suburb: 3,
  yard: 4,
  garden: 5,
} as const

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
/**
 * Half-widths, metres: recorded roads and streets, the main streets, the local
 * streets, alleys and stairs. The main streets are 7 m wide, the lanes 3–4.4 m, a
 * flight of steps 2 m: Pompeii's streets run from some 9 m down to 2–4 m (Poehler
 * 2017), and no Roman city street was much wider than 10 m.
 */
const HALF = { road: 4.5, street: 3.5, main: 3.5, local: [1.5, 2.2], alley: 1 }
/** Storey heights: a tall ground floor of shops, then upper floors. */
const GROUND_FLOOR = 3.8
/** The furthest a plot reaches in from its street, metres: less where it meets the plots opposite. */
const PLOT_MAX_M = 26
/** The rise front to back over which a building is cut into steps, metres. */
const STEP_M = 2.2
/** Of the ground a step rises or falls, the share its storeys take up: the rest it is cut into the slope. */
const STEP_STOREYS = 0.6
/** A plot this deep or less, one or two rooms lit from the street, is built to its back, metres. */
const SOLID_TO_M = 17
/** How deep a building of flats on a deeper plot runs back from the street, metres; the rest is its yard. */
const FRONT_M: [number, number] = [12, 17]
/** The shallowest yard worth leaving behind a building, metres; less is built over. */
const YARD_MIN_M = 5
/** Of the runs of three deep plots or more, the share built as one building round a court. */
const COURTYARD = 0.3
/** How deep every plot of a courtyard building must be, metres. */
const COURTYARD_MIN_M = 20
/** A courtyard building's range on the street, and its court, front to back, metres. */
const RANGE_M: [number, number] = [9, 12]
const COURT_M: [number, number] = [6, 9]
/** Open ground inside a block smaller than this has no tree, m²: a light-well is not a garden. */
const TREE_YARD_M2 = 150
/** The atrium's opening, as a share of the house's width: a quarter to a third of an atrium two thirds as wide. */
const OPENING = 0.2
/** The deepest atrium house, front to back, metres; its plot beyond is garden. */
const HOUSE_MAX_M = 26
/** A corner takes a plot of its own when it turns between 55° and 125°. */
const CORNER_COS = Math.cos((55 * Math.PI) / 180)
const FLOOR = 3.0
/** The size of the pattern the city's heights follow, metres. */
const HEIGHT_PATTERN_M = 200
/** How many lots a building of flats takes along its street, drawn from these. */
const BUILDING_LOTS = [1, 2, 2, 2, 3, 3, 3, 4, 4, 5]
/** The shallowest building, metres front to back: a room and its walls. */
const MIN_DEPTH_M = 6
/** A building turns with its street through a bend up to 35°, but not round a corner. */
const BEND_COS = Math.cos((35 * Math.PI) / 180)

type Quarter = 'valley' | 'hill' | 'rich' | 'river' | 'palatine'

/**
 * How each quarter is built: its blocks' depth between parallel streets and length
 * along them (m), the lots' frontage, storeys.
 */
const QUARTER: Record<
  Quarter,
  {
    block: { depth: [number, number]; length: [number, number] }
    frontage: [number, number]
    storeys: [number, number]
  }
> = {
  valley: {
    block: { depth: [32, 42], length: [55, 80] },
    frontage: [6, 11],
    storeys: [3, 5],
  },
  hill: {
    block: { depth: [40, 52], length: [65, 95] },
    frontage: [7, 13],
    storeys: [2, 3],
  },
  rich: {
    block: { depth: [48, 62], length: [70, 105] },
    frontage: [7, 12],
    storeys: [2, 3],
  },
  river: {
    block: { depth: [36, 46], length: [70, 100] },
    frontage: [30, 60],
    storeys: [2, 2],
  },
  // The top of the Palatine: the great houses "sprang up all over the hill", and no
  // Republican source puts a block of flats on it (Platner & Ashby, Palatinus, p.
  // 378) — Cicero's, Crassus's, Catulus's, Hortensius's, Clodius's, Antony's.
  palatine: {
    block: { depth: [55, 70], length: [75, 110] },
    frontage: [10, 16],
    storeys: [1, 2],
  },
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
  const mains = offRecorded(
    mainStreets(c, { x0, y0, nx, ny, inside, monument, wet, slope, square }),
    c.streets.map((s) => s.pts),
  )
  for (const m of mains) paint(m, HALF.main)

  const quarterAt = (p: Pt): Quarter => {
    const low = c.at(p[0], p[1]) < 28
    if (low && c.toRiver(p[0], p[1]) < 220) return 'river'
    if (low) return 'valley'
    if (c.palatine && Math.hypot(c.palatine[0] - p[0], c.palatine[1] - p[1]) < 240)
      return 'palatine'
    const rich = c.richQuarters.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 300)
    return rich ? 'rich' : 'hill'
  }
  const slopeOf = (p: Pt) => {
    const gx = (c.at(p[0] + 12, p[1]) - c.at(p[0] - 12, p[1])) / 24
    const gy = (c.at(p[0], p[1] + 12) - c.at(p[0], p[1] - 12)) / 24
    return Math.hypot(gx, gy)
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

  // The recorded and main streets, which the generated ones grow from.
  const majors: [Pt, Pt][] = [...c.streets.map((s) => s.pts), ...mains].flatMap((l) =>
    l.slice(1).map((q, i) => [l[i], q] as [Pt, Pt]),
  )
  /** Whether a point fronts a main or recorded street. */
  const onMajor = (p: Pt) => majors.some((sg) => segDist(p, sg[0], sg[1]) < 6.5)

  // Local streets, grown out from them (growth.ts). A block's size is the quarter's,
  // varying smoothly over the city by a pattern of its own; on a slope the blocks
  // are shallower terraces.
  const blockAt = (p: Pt) => {
    const q = QUARTER[quarterAt(p)].block
    const t = (pattern([p[0] + 5000, p[1] - 3000]) + 1) / 2
    const terrace = slopeOf(p) > 0.08 ? 0.75 : 1
    return {
      depth: (q.depth[0] + (q.depth[1] - q.depth[0]) * t) * terrace,
      length: q.length[0] + (q.length[1] - q.length[0]) * (1 - t),
    }
  }
  const circle = c.forum
  const centre: Pt = [
    circle.reduce((s, q) => s + q[0], 0) / circle.length,
    circle.reduce((s, q) => s + q[1], 0) / circle.length,
  ]
  const lanes = growStreets({
    fixed: [...c.streets.map((s) => s.pts), ...mains],
    pieces: c.pieces,
    open: (p) => {
      const k = cellOf(p)
      return k >= 0 && inside[k] === 1 && st[k] !== 0
    },
    height: c.at,
    block: blockAt,
    centre,
    rand,
  })
  const locals: Pt[][] = []
  for (const l of lanes) {
    paint(l.pts, l.stair ? HALF.alley : pick(HALF.local as [number, number]))
    locals.push(l.pts)
  }

  // Blocks: what is left between the streets.
  const findBlocks = () => {
    const seen = new Uint8Array(N)
    const found: { cells: number[]; quarter: Quarter; slope: number }[] = []
    for (let k0 = 0; k0 < N; k0++) {
      if (st[k0] !== 1 || seen[k0]) continue
      const cells: number[] = [k0]
      seen[k0] = 1
      for (let h = 0; h < cells.length; h++) {
        const k = cells[h]
        const i = k % nx
        for (const q of [k - 1, k + 1, k - nx, k + nx]) {
          if (q < 0 || q >= N) continue
          if ((q === k - 1 && i === 0) || (q === k + 1 && i === nx - 1)) continue
          if (seen[q] || st[q] !== 1) continue
          seen[q] = 1
          cells.push(q)
        }
      }
      if (cells.length * CELL * CELL < 120) continue
      const shape = pca(cells, nx, cx, cy)
      found.push({ cells, quarter: quarterAt(shape.c), slope: slopeOf(shape.c) })
    }
    return found
  }
  let blocks = findBlocks()

  // A block the lanes left much longer than the quarter's is cut across its middle,
  // straight, from street to street — through a junction on one of its long sides
  // where there is one near, so the street crosses on.
  const ends = locals.flatMap((l) => [l[0], l[l.length - 1]])
  for (let round = 0; round < 2; round++) {
    let cut = false
    for (const b of blocks) {
      const shape = pca(b.cells, nx, cx, cy)
      if (shape.long < LONG_BLOCK * blockAt(shape.c).length || shape.short < 16) continue
      const across: Pt = [-shape.axis[1], shape.axis[0]]
      const alongOf = (p: Pt) =>
        (p[0] - shape.c[0]) * shape.axis[0] + (p[1] - shape.c[1]) * shape.axis[1]
      const acrossOf = (p: Pt) =>
        (p[0] - shape.c[0]) * across[0] + (p[1] - shape.c[1]) * across[1]
      let offset = (rand() - 0.5) * 0.2 * shape.long
      const aligned = ends
        .filter(
          (p) =>
            Math.abs(alongOf(p)) < shape.long * 0.25 &&
            Math.abs(Math.abs(acrossOf(p)) - shape.short / 2) < 10,
        )
        .sort((p, q) => Math.abs(alongOf(p)) - Math.abs(alongOf(q)))[0]
      if (aligned) offset = alongOf(aligned)
      const mid: Pt = [
        shape.c[0] + shape.axis[0] * offset,
        shape.c[1] + shape.axis[1] * offset,
      ]
      const reach = shape.short / 2 + 10
      const line: Pt[] = [
        [mid[0] - across[0] * reach, mid[1] - across[1] * reach],
        [mid[0] + across[0] * reach, mid[1] + across[1] * reach],
      ]
      const set = new Set(b.cells)
      paint(line, pick(HALF.local as [number, number]), (k) => set.has(k))
      locals.push(line)
      cut = true
    }
    if (!cut) break
    blocks = findBlocks()
  }

  // --- 2–4. lots round each block ----------------------------------------------------------
  const lots: Lot[] = []
  const gardens: Pt[] = []
  const blockMask = new Int32Array(N).fill(-1)
  blocks.forEach((b, n) => b.cells.forEach((k) => (blockMask[k] = n)))
  for (const [n, b] of blocks.entries()) {
    const own = (k: number) => k >= 0 && blockMask[k] === n
    const q = QUARTER[b.quarter]
    const firstLot = lots.length
    /** A lone lot's roof: along the street, the gable to it on a narrow deep lot. */
    const loneRoof = (quad: [Pt, Pt, Pt, Pt]) => {
      const w = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])
      const d = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1])
      return w < d * 0.8 && rand() < 0.2 ? ROOF.across : ROOF.along
    }
    /**
     * The plots of a strip, built. Runs of neighbouring flats along one street become
     * buildings, each of one height (the city's pattern, `storeysAt`), one render and
     * one roof. A plot reaches to the middle of its block; on a deep one the building
     * is a range on the street, a small court, and a range behind it a storey lower,
     * as the blocks of flats round their light-wells on the Marble Plan; the court
     * falls at a different depth building by building, and some fill their plot. In
     * the quarters of the rich (`yard`) a plot of flats is built only 14 m deep, its
     * back a yard; an atrium house takes the front of its plot, its garden behind.
     */
    const build = (strip: StripLot[], yard: boolean) => {
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
        let st = Math.round(storeysAt(front, lo, hi) + (major ? 1 : 0))
        // On a main or recorded street every building stands the storey higher.
        if (!major && rand() < 0.25) st += rand() < 0.5 ? -1 : 1
        st = Math.max(1, Math.min(Math.min(5, hi + 1), st))
        const h = GROUND_FLOOR + (st - 1) * FLOOR + rand() * 0.3
        const tone = rand()
        const terrace = !major && rand() < 0.06
        // A large building of flats — three plots or more, all deep — may be built
        // round one court: its end plots are its wings, its middle ones a range on
        // the street, the court, and a range behind (the courtyard blocks of the
        // Marble Plan). Otherwise a deep plot's building fills its front, lit from the
        // street, and the back of the plot is its yard; the yards of plots back to back
        // make an open yard in the middle of the block.
        const courtyard =
          !yard &&
          run.length >= 3 &&
          run.every((e) => depthOf(e.quad) >= COURTYARD_MIN_M) &&
          rand() < COURTYARD
        const range = pick(RANGE_M)
        const court = pick(COURT_M)
        run.forEach((e, i) => {
          const roof = terrace
            ? ROOF.flat
            : run.length === 1
              ? loneRoof(e.quad)
              : ROOF.along
          const flats = (pts: [Pt, Pt, Pt, Pt], hh = h, r = roof) =>
            lots.push({ pts, h: hh, kind: LOT_KIND.flats, roof: r, tone })
          if (yard) return flats(truncate(e.quad, 14))
          const d = depthOf(e.quad)
          if (courtyard) {
            const wing = i === 0 || i === run.length - 1
            if (wing || d < range + court + MIN_DEPTH_M) return flats(e.quad)
            flats(truncate(e.quad, range))
            flats(
              behind(e.quad, range + court),
              Math.max(GROUND_FLOOR, h - FLOOR),
              ROOF.along,
            )
            return
          }
          // One or two rooms deep is lit from the street: the plot is built to its back.
          if (e.corner || d <= SOLID_TO_M) return flats(e.quad)
          const front = Math.min(d, pick(FRONT_M))
          // A yard too shallow to use is built over.
          if (d - front < YARD_MIN_M) return flats(e.quad)
          flats(truncate(e.quad, front))
        })
        run = []
      }
      for (const e of strip) {
        if (e.kind !== LOT_KIND.flats) {
          flush()
          if (e.kind === LOT_KIND.house) {
            // The house on the front of its plot, about as deep as it is wide; behind
            // it, its garden (a peristyle in the houses of the rich).
            const d = depthOf(e.quad)
            const w = Math.hypot(e.quad[1][0] - e.quad[0][0], e.quad[1][1] - e.quad[0][1])
            const houseD = Math.min(d, Math.max(17, w * 1.05), HOUSE_MAX_M)
            lots.push(...atriumHouse(truncate(e.quad, houseD), rand))
            if (d - houseD > 8) {
              const g = behind(e.quad, houseD + 2)
              gardens.push(centroid(g))
              if (d - houseD > 16 && rand() < 0.6)
                gardens.push(centroid([g[0], g[1], centroid(g)]))
            }
          } else
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
        // Along a main street the buildings run longer, so its frontage reads as one.
        if (!run.length)
          size =
            BUILDING_LOTS[Math.floor(rand() * BUILDING_LOTS.length)] +
            (onMajor(e.quad[0]) ? 2 : 0)
        run.push(e)
      }
      flush()
    }
    // Plots come in series along a street, laid out together: a run of lots of one
    // width, now and then a double one, then another run (Conzen). In the quarters
    // of the rich, atrium houses on wide lots among the flats; by the river,
    // warehouses on long ones.
    let series = 0
    let module = 0
    const next = () => {
      if (
        (b.quarter === 'palatine' && rand() < 0.8) ||
        (b.quarter === 'rich' && rand() < 0.35) ||
        (b.quarter === 'hill' && rand() < 0.03)
      )
        return { w: pick([16, 26]), kind: LOT_KIND.house }
      if (b.quarter === 'river') return { w: pick(q.frontage), kind: LOT_KIND.warehouse }
      if (series-- <= 0) {
        module = pick(q.frontage)
        series = 2 + Math.floor(rand() * 6)
      }
      return {
        w: module * (rand() < 0.15 ? 2 : 1) * (0.94 + rand() * 0.12),
        kind: LOT_KIND.flats,
      }
    }
    /** How much a street matters, for which of two a corner plot fronts. */
    const rank = (a: Pt, e: Pt) => {
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1
      const mid: Pt = [
        (a[0] + e[0]) / 2 + ((e[1] - a[1]) / L) * 4,
        (a[1] + e[1]) / 2 - ((e[0] - a[0]) / L) * 4,
      ]
      return onMajor(mid) ? 2 : 1
    }
    const rings = traceRings(b.cells, own, nx, x0, y0)
      .map((r) => simplifyRing(r, 3))
      .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) >= 100)
    const cellPts = b.cells.map((k): Pt => [cx(k % nx), cy(Math.floor(k / nx))])
    const plots = frontagePlots(cellPts, rings, (L) => splitFrontage(L, next), rank)
    if (b.quarter === 'river')
      for (const e of plots) if (e.corner) e.kind = LOT_KIND.warehouse
    build(plots, b.quarter === 'rich' || b.quarter === 'palatine')
    // What is left open is yard and garden. A tree stands only in open ground big
    // enough to be a yard, more in the gardens of the rich: a light-well is not a
    // garden, and the crowded quarters had little ground to plant.
    const built = lots.slice(firstLot)
    const covered = new Set<number>()
    for (const l of built) {
      const xs = l.pts.map((p) => p[0])
      const ys = l.pts.map((p) => p[1])
      const [i0, i1] = [
        Math.floor((Math.min(...xs) - x0) / CELL),
        Math.floor((Math.max(...xs) - x0) / CELL),
      ]
      const [j0, j1] = [
        Math.floor((Math.min(...ys) - y0) / CELL),
        Math.floor((Math.max(...ys) - y0) / CELL),
      ]
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++)
          if (inRing([cx(i), cy(j)], l.pts)) covered.add(j * nx + i)
    }
    const want = b.quarter === 'rich' || b.quarter === 'palatine' ? 0.7 : 0.15
    const seen = new Set<number>()
    const planted: Pt[] = []
    for (const k0 of b.cells) {
      if (covered.has(k0) || seen.has(k0)) continue
      const yardCells = [k0]
      seen.add(k0)
      for (let h = 0; h < yardCells.length; h++) {
        const k = yardCells[h]
        for (const q of [k - 1, k + 1, k - nx, k + nx])
          if (own(q) && !covered.has(q) && !seen.has(q)) {
            seen.add(q)
            yardCells.push(q)
          }
      }
      if (yardCells.length * CELL * CELL < TREE_YARD_M2) continue
      for (let t = 0; t < yardCells.length / 8; t++) {
        const k = yardCells[Math.floor(rand() * yardCells.length)]
        const p: Pt = [cx(k % nx), cy(Math.floor(k / nx))]
        if (rand() > want || planted.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 9))
          continue
        if (built.some((l) => nearRing(p, l.pts, 3))) continue
        planted.push(p)
      }
    }
    gardens.push(...planted)
  }

  // On a slope a building steps with the ground it stands on. Where the ground
  // rises more than STEP_M from a plot's street front to its back, its building is
  // cut front to back into two or three parts, each on its own ground: going up the
  // slope from the street, fewer storeys over each step; going down, more. Its shops
  // stay on its street front.
  const steppedLots = lots.flatMap((l) =>
    l.kind === LOT_KIND.house ? [l] : stepped(l, c.at),
  )
  lots.length = 0
  lots.push(...steppedLots)

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

/** A block longer than this many times its quarter's block length is cut across. */
const LONG_BLOCK = 1.7
/** A main street this near a recorded one is running along it, metres. */
const ALONG_RECORDED = 12
/** The shortest stretch of main street kept off the recorded ones, metres. */
const MIN_MAIN = 30

/**
 * The main streets where they are not the recorded streets over again: a main
 * street's way to the Forum often follows a recorded street a few metres off its
 * line, and there the recorded street is the street. What is left of it is joined
 * on to the recorded street it leaves or meets.
 */
function offRecorded(mains: Pt[][], recorded: Pt[][]): Pt[][] {
  const segs = recorded.flatMap((l) => l.slice(1).map((q, i) => [l[i], q] as [Pt, Pt]))
  const nearest = (p: Pt) => {
    let [best, bd]: [Pt, number] = [p, Infinity]
    for (const [a, b] of segs) {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      )
      const q: Pt = [a[0] + dx * t, a[1] + dy * t]
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < bd) [best, bd] = [q, d]
    }
    return { at: best, d: bd }
  }
  const out: Pt[][] = []
  for (const line of mains) {
    // Resampled every 3 m, so a stretch along a recorded street is found wherever it starts.
    const pts: Pt[] = [line[0]]
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i], line[i + 1]]
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3))
      for (let k = 1; k <= n; k++)
        pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
    let run: Pt[] = []
    const flush = (joinEnd: boolean) => {
      if (run.length > 1) {
        const joined = [...run]
        if (joinEnd) joined.push(nearest(run[run.length - 1]).at)
        const len = joined
          .slice(1)
          .reduce((s, q, i) => s + Math.hypot(q[0] - joined[i][0], q[1] - joined[i][1]), 0)
        if (len >= MIN_MAIN) out.push(simplifyLine(joined, 1))
      }
      run = []
    }
    for (const p of pts) {
      const n = nearest(p)
      if (n.d < ALONG_RECORDED) {
        flush(true)
        continue
      }
      // Leaving a recorded street: start from it.
      if (!run.length && p !== pts[0]) run.push(n.at)
      run.push(p)
    }
    flush(false)
  }
  return out
}

// --- lots -------------------------------------------------------------------------------------

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
 * The plots of a block, laid out from its streets. Every 2 m cell of the block
 * belongs to the street frontage nearest it, out to `PLOT_MAX_M`: so a plot runs
 * from its street to the middle of the block, where it meets the plots behind, and
 * the block is split between its streets as a straight skeleton splits it (Vanegas
 * et al. 2012), however ragged its outline. At a corner that turns between 55° and
 * 125° the corner plot is one and fronts both streets: it belongs to the street
 * `rank` puts higher, or the longer frontage, as a corner plot belongs to one
 * street (Conzen; the "corner conquest" of Emilien et al. 2012). Each frontage is
 * then cut into plots along it where `split` says, each as deep as its cells reach.
 */
function frontagePlots(
  cells: Pt[],
  rings: Pt[][],
  split: (length: number) => Frontage | null,
  rank: (a: Pt, b: Pt) => number,
): StripLot[] {
  type Edge = { a: Pt; b: Pt; L: number; u: Pt; nrm: Pt }
  const edges: Edge[] = []
  /** Each ring's edges, by index into `edges`. */
  const ringEdges: number[][] = []
  for (const r of rings) {
    const ids: number[] = []
    for (let i = 0; i < r.length; i++) {
      const [a, b] = [r[i], r[(i + 1) % r.length]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.5) continue
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      ids.push(edges.length)
      edges.push({ a, b, L, u, nrm: [-u[1], u[0]] })
    }
    ringEdges.push(ids)
  }
  const coords = (c: Pt, e: Edge) => {
    const [dx, dy] = [c[0] - e.a[0], c[1] - e.a[1]]
    return { t: dx * e.u[0] + dy * e.u[1], d: dx * e.nrm[0] + dy * e.nrm[1] }
  }
  // Each cell to its nearest frontage.
  const owner = new Int32Array(cells.length).fill(-1)
  const T = new Float32Array(cells.length)
  const Dp = new Float32Array(cells.length)
  cells.forEach((c, i) => {
    let bd = PLOT_MAX_M
    for (const [k, e] of edges.entries()) {
      const { t, d } = coords(c, e)
      if (d < -1) continue
      const tc = Math.max(0, Math.min(e.L, t))
      const dist = Math.hypot(c[0] - (e.a[0] + e.u[0] * tc), c[1] - (e.a[1] + e.u[1] * tc))
      if (dist < bd) [bd, owner[i], T[i], Dp[i]] = [dist, k, tc, Math.max(0, d)]
    }
  })
  // Corners: the corner plot to the street that owns it.
  for (const ids of ringEdges)
    for (let j = 0; j < ids.length; j++) {
      const [k0, k1] = [ids[(j - 1 + ids.length) % ids.length], ids[j]]
      const [e0, e1] = [edges[k0], edges[k1]]
      const turn = e0.u[0] * e1.u[1] - e0.u[1] * e1.u[0]
      const cos = -(e0.u[0] * e1.u[0] + e0.u[1] * e1.u[1])
      if (turn < 0.05 || Math.abs(cos) >= CORNER_COS) continue
      const [r0, r1] = [rank(e0.a, e0.b), rank(e1.a, e1.b)]
      const dom = r0 !== r1 ? (r0 > r1 ? k0 : k1) : e0.L >= e1.L ? k0 : k1
      const other = dom === k0 ? k1 : k0
      // How deep the owning street's plots run: the corner plot is as wide along the
      // other street.
      const depths: number[] = []
      owner.forEach((o, i) => o === dom && depths.push(Dp[i]))
      if (!depths.length) continue
      depths.sort((x, y) => x - y)
      const reach = depths[Math.floor(depths.length * 0.9)] + CELL / 2
      const E = edges[dom]
      cells.forEach((c, i) => {
        if (owner[i] !== other) return
        const along = other === k1 ? T[i] : edges[other].L - T[i]
        if (along >= reach) return
        const { t, d } = coords(c, E)
        if (d < 0) return
        owner[i] = dom
        T[i] = Math.max(0, Math.min(E.L, t))
        Dp[i] = d
      })
    }
  const out: StripLot[] = []
  /** Whether the street runs on round the join of two edges, with no more than a gentle bend. */
  const gentle = (a: number, b: number) => {
    const [u, v] = [edges[a].u, edges[b].u]
    return u[0] * v[0] + u[1] * v[1] > BEND_COS && u[0] * v[1] - u[1] * v[0] > -0.05
  }
  for (const ids of ringEdges)
    for (const [j, k] of ids.entries()) {
      const e = edges[k]
      const mine: number[] = []
      owner.forEach((o, i) => o === k && mine.push(i))
      if (!mine.length) continue
      // Round a gentle bend the plots run on to the bend, so the row does not break
      // where the street's outline turns.
      const [prev, nxt] = [
        ids[(j - 1 + ids.length) % ids.length],
        ids[(j + 1) % ids.length],
      ]
      const t0 = gentle(prev, k)
        ? 0
        : Math.max(0, Math.min(...mine.map((i) => T[i])) - CELL / 2)
      const t1 = gentle(k, nxt)
        ? e.L
        : Math.min(e.L, Math.max(...mine.map((i) => T[i])) + CELL / 2)
      if (t1 - t0 < 4) continue
      const f = split(t1 - t0)
      if (!f) continue
      const ts = f.t.map((v) => t0 + v)
      const P = (t: number, d: number): Pt => [
        e.a[0] + e.u[0] * t + e.nrm[0] * d,
        e.a[1] + e.u[1] * t + e.nrm[1] * d,
      ]
      const count = ts.length - 1
      for (let n = 0; n < count; n++) {
        const [ta, tb] = [ts[n], ts[n + 1]]
        const inLot = mine.filter((i) => T[i] >= ta - 0.01 && T[i] <= tb + 0.01)
        if (!inLot.length) continue
        const deepest = (near: (t: number) => boolean) => {
          const d = inLot.filter((i) => near(T[i])).map((i) => Dp[i])
          return (
            (d.length ? Math.max(...d) : Math.max(...inLot.map((i) => Dp[i]))) + CELL / 2
          )
        }
        const dA = deepest((t) => t <= ta + 2.5)
        const dB = deepest((t) => t >= tb - 2.5)
        const quad: [Pt, Pt, Pt, Pt] = [P(ta, 0), P(tb, 0), P(tb, dB), P(ta, dA)]
        if (polygonArea(quad) < 12 || !convex(quad) || slender(quad)) continue
        // Nothing thinner than a room and a wall: a plot squeezed by a narrow block is
        // left as yard rather than built as a skinny range.
        if (depthOf(quad) < MIN_DEPTH_M) continue
        out.push({
          quad,
          kind: f.kinds[n],
          edge: k,
          u: e.u,
          corner: n === 0 || n === count - 1,
        })
      }
    }
  // Where plots meet in the middle of the block or cross at a cramped corner, the
  // one laid first keeps the ground and the other is cut back from its street's
  // side until it clears; one that cannot keep a room's depth is yard.
  const kept: StripLot[] = []
  for (const e of out) {
    let quad = e.quad
    for (let k = 0.95; kept.some((o) => overlaps(o.quad, quad)); k -= 0.05) {
      quad = truncate(e.quad, depthOf(e.quad) * k)
      if (depthOf(quad) < MIN_DEPTH_M) {
        quad = null as never
        break
      }
    }
    if (quad) kept.push({ ...e, quad })
  }
  return kept
}

/** Whether two convex lots overlap by more than a wall's thickness (separating axes). */
function overlaps(a: Pt[], b: Pt[]) {
  const shrink = (q: Pt[]) => {
    const c = centroid(q)
    return q.map((p) => {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1
      const k = Math.max(0, (d - 0.6) / d)
      return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k] as Pt
    })
  }
  const [p, q] = [shrink(a), shrink(b)]
  for (const poly of [p, q])
    for (let i = 0; i < poly.length; i++) {
      const [u, v] = [poly[i], poly[(i + 1) % poly.length]]
      const ax: Pt = [-(v[1] - u[1]), v[0] - u[0]]
      const proj = (r: Pt[]) => r.map((w) => w[0] * ax[0] + w[1] * ax[1])
      const [pa, pb] = [proj(p), proj(q)]
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa))
        return false
    }
  return true
}

/**
 * Cuts a strip `L` long into lots of the widths `next` draws; the last takes what
 * is left when that is less than half a lot, or 4 m, the narrowest shop.
 */
function splitFrontage(L: number, next: () => { w: number; kind: number }): Frontage {
  const t = [0]
  const kinds: number[] = []
  let pos = 0
  while (pos < L) {
    const { w, kind } = next()
    let end = pos + w
    if (L - end < Math.max(4, w * 0.5)) end = L
    t.push(end)
    kinds.push(kind)
    pos = end
  }
  return { t, kinds }
}

/**
 * An atrium house on its lot: its rooms in ranges round the atrium, roofed and
 * falling inward to the opening over its pool, the front range of two storeys
 * with shops either side of the door, the others of one. The opening is a quarter
 * to a third as wide as the atrium (Vitruvius 6.3.6), and the atrium about two
 * thirds as wide as the house, so the opening is about a fifth of the house's width.
 */
function atriumHouse(quad: [Pt, Pt, Pt, Pt], rand: () => number): Lot[] {
  const tone = rand()
  const side = (i: number) =>
    Math.hypot(quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1])
  const shortest = Math.min(side(0), side(1), side(2), side(3))
  // Too small for ranges of rooms round an atrium: one house under one roof.
  if (shortest < 14)
    return [
      { pts: quad, h: GROUND_FLOOR + FLOOR, kind: LOT_KIND.house, roof: ROOF.along, tone },
    ]
  // Each corner drawn in toward the middle, leaving the opening.
  const k = (1 - OPENING * (0.9 + rand() * 0.2)) / 2
  const c = centroid(quad)
  const inner = quad.map(
    (p) => [p[0] + (c[0] - p[0]) * 2 * k, p[1] + (c[1] - p[1]) * 2 * k] as Pt,
  )
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
  return out
}

/**
 * A building cut into steps up or down its slope (`STEP_M`): at most three, each
 * with the storeys the fall of the ground gives or takes, in whole storeys. A step
 * behind the first has its front on its back edge, so the shops the renderer paints
 * on a lot's front face its yard, not the roof below.
 */
function stepped(l: Lot, at: (x: number, y: number) => number): Lot[] {
  const [f0, f1, b1, b0] = l.pts
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const front = at(...mid(f0, f1))
  const rise = at(...mid(b0, b1)) - front
  const k = Math.min(3, Math.ceil(Math.abs(rise) / STEP_M))
  if (k < 2) return [l]
  const lerp = (a: Pt, b: Pt, t: number): Pt => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ]
  const storeys = Math.round((l.h - GROUND_FLOOR) / FLOOR)
  const noise = l.h - GROUND_FLOOR - storeys * FLOOR
  const out: Lot[] = []
  for (let j = 0; j < k; j++) {
    const [t0, t1] = [j / k, (j + 1) / k]
    const band: [Pt, Pt, Pt, Pt] = [
      lerp(f0, b0, t0),
      lerp(f1, b1, t0),
      lerp(f1, b1, t1),
      lerp(f0, b0, t1),
    ]
    const ground = at(...centroid(band))
    const n = Math.max(
      0,
      Math.min(
        storeys + 2,
        Math.round(storeys - ((ground - front) * STEP_STOREYS) / FLOOR),
      ),
    )
    const pts: [Pt, Pt, Pt, Pt] = j === 0 ? band : [band[2], band[3], band[0], band[1]]
    out.push({ ...l, pts, h: GROUND_FLOOR + n * FLOOR + noise })
  }
  return out
}

/** How deep a lot quad is: the nearer of its back corners to the line of its front. */
function depthOf(q: [Pt, Pt, Pt, Pt]) {
  const L = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) || 1
  const n: Pt = [-(q[1][1] - q[0][1]) / L, (q[1][0] - q[0][0]) / L]
  const d = (p: Pt) => Math.abs((p[0] - q[0][0]) * n[0] + (p[1] - q[0][1]) * n[1])
  return Math.min(d(q[2]), d(q[3]))
}

/** What lies behind the front `d` metres of a lot quad, measured along its sides. */
function behind(q: [Pt, Pt, Pt, Pt], d: number): [Pt, Pt, Pt, Pt] {
  const cut = (f: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - f[0], b[1] - f[1])
    const k = Math.min(1, d / l)
    return [f[0] + (b[0] - f[0]) * k, f[1] + (b[1] - f[1]) * k]
  }
  return [cut(q[0], q[3]), cut(q[1], q[2]), q[2], q[3]]
}

function centroid(q: Pt[]): Pt {
  return [
    q.reduce((s, p) => s + p[0], 0) / q.length,
    q.reduce((s, p) => s + p[1], 0) / q.length,
  ]
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
