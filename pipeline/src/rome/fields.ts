/**
 * The country round the model of Rome (DESIGN.md §7.7): the farmland, meadows and
 * gardens outside the wall, as a land-use field on the plate's grid for the terrain
 * to paint (plate-2.png), and the trees that stand in it for the model to raise.
 *
 * Like the houses, the farmland is illustrative. No survey maps the plots round Rome
 * in the late Republic, so they are generated, following what the sources say the
 * land near the city was used for (data/sources.yaml, cited in `COUNTRY_SOURCES`):
 *
 * - **Market gardens and orchards close in**, on the watered low ground and along
 *   the roads: Varro's suburban farm that grows "gardens of violets and roses" and
 *   what the city buys (Varro, _On Agriculture_ 1.16.3; Cato, _On Agriculture_
 *   7–8).
 * - **Vines and olives on the slopes**, vines best turned to the sun.
 * - **Grain, stubble and fallow further out**, with pasture; in summer, when the
 *   model is set, the grain stands ripe or cut, and the fallow is being ploughed
 *   (Varro, _On Agriculture_ 1.29, 1.32).
 * - **Meadow on the Tiber's flats**, which flood.
 * - **Rough grazing and scrub** on the slopes too steep to plough.
 *
 * The land is laid out as a country of lanes and plots: blocks between lanes
 * (a Voronoi of jittered points) face the nearest road, and are cut into strips
 * running back from it, narrow near the city and broader further out, as land along
 * a road is divided so each plot has a frontage. The recorded gardens, groves and
 * burial ground (data/places/rome.yaml, kinds `garden`, `grove` and `cemetery`) are
 * drawn from their outlines (data/geometry/rome-grounds.geojson) instead, and the Campus Martius and the ground round the monuments
 * are left open.
 *
 * plate-2: R the land's use × 16 plus a tone (for a recorded ground, its index in
 * `grounds`), G the direction its rows run (0–255 over half a turn; for a recorded
 * ground, the use of the farmland it was laid out over × 16 plus the direction in 16
 * steps), B the distance to the plot's edge, A the distance to a lane, both clamped
 * (`EDGE_CLAMP_M`, `LANE_CLAMP_M`). All of it is seeded, so every build is the same.
 */
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'

type Pt = [number, number]

export interface Grid {
  x0: number
  y1: number
  width: number
  height: number
  texel: number
}

/** What the land is used for: plate-2's red channel over 16. */
export const LAND = {
  none: 0,
  garden: 1,
  vines: 2,
  olives: 3,
  orchard: 4,
  grain: 5,
  stubble: 6,
  fallow: 7,
  pasture: 8,
  meadow: 9,
  scrub: 10,
  open: 11,
  recorded: 12,
} as const

/** The farmland the weights below choose between, in order. */
const CROPS = [
  LAND.garden,
  LAND.vines,
  LAND.olives,
  LAND.orchard,
  LAND.grain,
  LAND.stubble,
  LAND.fallow,
  LAND.pasture,
] as const

/**
 * How the plots are shared out with distance from the wall, metres: market gardens
 * and orchards crowd the city, vines and olives take the middle ground, grain and
 * pasture the country beyond. Interpolated between.
 */
const ZONES: { at: number; weights: number[] }[] = [
  { at: 300, weights: [0.5, 0.12, 0.05, 0.15, 0.06, 0.03, 0.03, 0.06] },
  { at: 1400, weights: [0.12, 0.22, 0.15, 0.1, 0.18, 0.08, 0.05, 0.1] },
  { at: 3000, weights: [0.03, 0.14, 0.14, 0.04, 0.28, 0.14, 0.1, 0.13] },
]

/** Lanes run between blocks this far apart, metres, jittered. */
const BLOCK_M = 230
const JITTER = 0.42
/**
 * The lanes wander: the ground is pushed about by a slow noise this many metres
 * before the blocks are found, so they bend as country lanes do.
 */
const WANDER_M = 45
/** Of the edges between two blocks, this share are lanes; the rest a plot's hedge. */
const LANE_SHARE = 0.6
/**
 * The plots, width along the road by depth back from it, metres, near the city and
 * far out (ZONES' first and last `at`), interpolated between.
 */
const PLOT = {
  near: { w: [12, 26], d: [28, 60] },
  far: { w: [34, 80], d: [90, 180] },
}
/** A plot takes its block's main use this often, so a farm reads as one. */
const FARM_SHARE = 0.45
/** Steeper than this (rise over run) is left to scrub. */
const SCRUB_SLOPE = 0.2
/** Within this of the river (its field's clamp, plate.ts), a steep slope is its bank. */
const RIVER_BANK_M = 15.5
/** Meadow: ground this little over the river's level, within this of it, metres. */
const MEADOW = { over: 5, within: 500 }
/** The land is drawn this far beyond everything on the plan; the shader fades it out before. */
export const FIELDS_REACH_M = 1350
/** plate-2's distances are clamped at these, metres. */
export const EDGE_CLAMP_M = 6
export const LANE_CLAMP_M = 10
/** Monuments standing in the country keep this much open ground round them, metres. */
const MONUMENT_CLEAR_M = 14

/** A recorded ground: a garden, a grove or a burial ground, from its record. */
export interface RecordedGround {
  id: string
  /** The record's location, plane metres: the side of the river it is on. */
  at: Pt
  kind: 'garden' | 'grove' | 'burial'
  ring: Pt[]
  /** Astronomical years, inclusive. */
  years: [number, number]
  /**
   * What the land was before the record's first year: the index (from 1) of a
   * recorded ground it was laid out over, or 0 for the farmland it replaced.
   */
  prior: number
}

export interface FieldsInput {
  grid: Grid
  smooth: Float32Array
  /** Signed distance to the river, metres, clamped (plate.ts). */
  water: Float32Array
  /** Signed distance to the circuit, metres, clamped. */
  city: Float32Array
  /** Signed distance to the hull of the plan, metres, clamped. */
  reach: Float32Array
  /** Distance to the nearest road, metres, clamped. */
  roadDist: Float32Array
  roads: Pt[][]
  circuit: Pt[]
  riverRings: Pt[][]
  waterLevel: number
  /** Monuments' footprints, left open. */
  monuments: Pt[][]
  /** Open ground: the Campus Martius. */
  open: Pt[][]
  grounds: RecordedGround[]
}

export interface Fields {
  rgba: Uint8Array
  /** The land's use at each texel (`LAND`). */
  use: Uint8Array
  /** The direction the rows run, radians, as the shader has it (quantised). */
  angle: (i: number) => number
  /** Distance to the plot's edge, metres, clamped. */
  edge: Float32Array
  /** The recorded ground at each texel: its index in `grounds` plus 1, or 0. */
  recorded: Uint8Array
}

export function layFields(f: FieldsInput): Fields {
  const { grid: g } = f
  const n = g.width * g.height
  const x0 = g.x0
  const y0 = g.y1 - g.height * g.texel
  const at = (i: number): Pt => [
    x0 + ((i % g.width) + 0.5) * g.texel,
    g.y1 - (Math.floor(i / g.width) + 0.5) * g.texel,
  ]

  // --- recorded and open ground ------------------------------------------------------
  const recorded = new Uint8Array(n)
  f.grounds.forEach((gr, k) => {
    // Only the ground on the record's side of the river: an outline drawn loosely
    // along a bank (Caesar's gardens) does not cross it.
    const within = new Uint8Array(n)
    rasterise(g, gr.ring, (i) => (within[i] = 1))
    const seed = texelAt(g, gr.at)
    const queue = seed >= 0 && within[seed] ? [seed] : []
    const reached = new Uint8Array(n)
    for (const i of queue) reached[i] = 1
    while (queue.length) {
      const i = queue.pop()!
      // A later ground laid out over an earlier one (Maecenas' gardens on the
      // Esquiline's burial ground) remembers it, for the years before its own.
      if (recorded[i] && !gr.prior) gr.prior = recorded[i]
      recorded[i] = k + 1
      const c = i % g.width
      for (const j of [i - 1, i + 1, i - g.width, i + g.width]) {
        if (j < 0 || j >= n || reached[j] || !within[j] || f.water[j] < 3) continue
        if ((j === i - 1 && c === 0) || (j === i + 1 && c === g.width - 1)) continue
        reached[j] = 1
        queue.push(j)
      }
    }
  })
  const open = new Uint8Array(n)
  for (const ring of f.open) rasterise(g, ring, (i) => (open[i] = 1))
  for (const ring of f.monuments)
    rasterise(g, grow(ring, MONUMENT_CLEAR_M), (i) => (open[i] = 1))

  // --- the blocks ------------------------------------------------------------------------
  const roadSegs = f.roads.flatMap((l) => l.slice(1).map((q, k) => [l[k], q] as [Pt, Pt]))
  const riverEdges = f.riverRings.flatMap((r) =>
    r.slice(0, -1).map((p, k) => [p, r[k + 1]] as [Pt, Pt]),
  )
  const circuitEdges = f.circuit
    .slice(0, -1)
    .map((p, k) => [p, f.circuit[k + 1]] as [Pt, Pt])
  const nx = Math.ceil((g.width * g.texel) / BLOCK_M) + 1
  const ny = Math.ceil((g.height * g.texel) / BLOCK_M) + 1
  interface Block {
    at: Pt
    /** Along the road it faces, and square to it. */
    dir: Pt
    foot: Pt
    side: number
    split: boolean
    fromWall: number
    fromRiver: number
  }
  const blocks: Block[] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const h = hash(i, j, 1)
      const p: Pt = [
        x0 + (i + 0.5 + (h - 0.5) * 2 * JITTER) * BLOCK_M,
        y0 + (j + 0.5 + (hash(i, j, 2) - 0.5) * 2 * JITTER) * BLOCK_M,
      ]
      const road = nearestSeg(roadSegs, p)
      let angle = Math.atan2(road.b[1] - road.a[1], road.b[0] - road.a[0])
      // Far from a road the blocks turn a little each their own way.
      const loose = Math.min(1, Math.max(0, (road.d - 500) / 1200))
      angle += (hash(i, j, 3) - 0.5) * 0.7 * loose
      const dir: Pt = [Math.cos(angle), Math.sin(angle)]
      blocks.push({
        at: p,
        dir,
        foot: road.foot,
        side: Math.sign(cross(dir, [p[0] - road.foot[0], p[1] - road.foot[1]])),
        split: road.d < BLOCK_M * 1.6,
        fromWall: nearestSeg(circuitEdges, p).d,
        fromRiver: nearestSeg(riverEdges, p).d,
      })
    }

  // --- each texel ----------------------------------------------------------------------
  const use = new Uint8Array(n)
  const tone = new Uint8Array(n)
  const dirByte = new Uint8Array(n)
  const edge = new Float32Array(n).fill(EDGE_CLAMP_M)
  const lane = new Float32Array(n).fill(LANE_CLAMP_M)
  const S = 3
  const slopeAt = (i: number) => {
    const c = i % g.width
    const r = Math.floor(i / g.width)
    const cl = Math.max(0, c - S)
    const cr = Math.min(g.width - 1, c + S)
    const ru = Math.max(0, r - S)
    const rd = Math.min(g.height - 1, r + S)
    const gx =
      (f.smooth[r * g.width + cr] - f.smooth[r * g.width + cl]) / ((cr - cl) * g.texel)
    // Rows run south, so up the grid is north.
    const gy =
      (f.smooth[ru * g.width + c] - f.smooth[rd * g.width + c]) / ((rd - ru) * g.texel)
    return { slope: Math.hypot(gx, gy), south: gy / (Math.hypot(gx, gy) || 1) }
  }
  for (let i = 0; i < n; i++) {
    // Inside the wall only a recorded ground (Maecenas', over the rampart) is drawn.
    if (f.reach[i] > FIELDS_REACH_M || (f.city[i] < 0 && !recorded[i]) || f.water[i] < 3)
      continue
    const p = at(i)
    if (open[i] && !recorded[i]) {
      use[i] = LAND.open
      tone[i] = Math.floor(hash(p[0] >> 5, p[1] >> 5, 9) * 16)
      continue
    }
    // The two nearest block points, to the ground pushed about a little (`WANDER_M`).
    const q: Pt = [
      p[0] + (noise(p[0] / 260, p[1] / 260, 41) - 0.5) * 2 * WANDER_M,
      p[1] + (noise(p[0] / 260, p[1] / 260, 42) - 0.5) * 2 * WANDER_M,
    ]
    const ci = Math.floor((q[0] - x0) / BLOCK_M)
    const cj = Math.floor((q[1] - y0) / BLOCK_M)
    let [b1, b2, d1, d2] = [-1, -1, Infinity, Infinity]
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const [ii, jj] = [ci + di, cj + dj]
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const k = jj * nx + ii
        const d = (blocks[k].at[0] - q[0]) ** 2 + (blocks[k].at[1] - q[1]) ** 2
        if (d < d1) [b2, d2, b1, d1] = [b1, d1, k, d]
        else if (d < d2) [b2, d2] = [k, d]
      }
    const b = blocks[b1]
    const o = blocks[b2]
    const sep = Math.hypot(o.at[0] - b.at[0], o.at[1] - b.at[1]) || 1
    // Some block edges are lanes, the rest only the hedge between two plots.
    const isLane = hash(Math.min(b1, b2), Math.max(b1, b2), 13) < LANE_SHARE
    const toBlock = (d2 - d1) / (2 * sep)
    const toLane = isLane ? toBlock : LANE_CLAMP_M
    // A block that reaches over its road is two, one each side.
    const rel: Pt = [p[0] - b.foot[0], p[1] - b.foot[1]]
    const across = b.split && Math.sign(cross(b.dir, rel)) !== b.side ? 1 : 0
    const key = b1 * 2 + across
    const t = smooth01(
      (b.fromWall - ZONES[0].at) / (ZONES[ZONES.length - 1].at - ZONES[0].at),
    )
    const w = lerp(
      lerp(PLOT.near.w[0], PLOT.far.w[0], t),
      lerp(PLOT.near.w[1], PLOT.far.w[1], t),
      hash(key, 0, 4),
    )
    const d = lerp(
      lerp(PLOT.near.d[0], PLOT.far.d[0], t),
      lerp(PLOT.near.d[1], PLOT.far.d[1], t),
      hash(key, 0, 5),
    )
    const u = rel[0] * b.dir[0] + rel[1] * b.dir[1] + hash(key, 0, 6) * w
    const v = Math.abs(rel[0] * -b.dir[1] + rel[1] * b.dir[0])
    const [iu, iv] = [Math.floor(u / w), Math.floor(v / d)]
    const fu = u / w - iu
    const fv = v / d - iv
    const toPlot = Math.min(Math.min(fu, 1 - fu) * w, Math.min(fv, 1 - fv) * d)
    edge[i] = Math.min(EDGE_CLAMP_M, toPlot, toBlock, Math.max(0, f.roadDist[i] - 4))
    lane[i] = Math.min(LANE_CLAMP_M, toLane)

    // What the plot grows.
    const { slope, south } = slopeAt(i)
    const low = f.smooth[i] < f.waterLevel + MEADOW.over && b.fromRiver < MEADOW.within
    let use_: number
    // The river's banks are steep where the model cuts its bed; they are meadow.
    if (slope > SCRUB_SLOPE && f.water[i] < RIVER_BANK_M) use_ = LAND.meadow
    else if (slope > SCRUB_SLOPE) use_ = LAND.scrub
    else if (low) use_ = LAND.meadow
    else {
      const weights = zoneWeights(b.fromWall).map((wt, k) => {
        const crop = CROPS[k]
        const hill = smooth01((slope - 0.04) / 0.12)
        if (crop === LAND.vines) return wt * (1 + hill * (1.5 + Math.max(0, south)))
        if (crop === LAND.olives) return wt * (1 + hill * 1.6)
        if (crop === LAND.grain || crop === LAND.stubble || crop === LAND.fallow)
          return wt * (1 - hill * 0.6)
        // Gardens want water and the city's roads.
        if (crop === LAND.garden)
          return wt * (1 - hill * 0.7) * (f.roadDist[i] < 12 || b.fromRiver < 400 ? 1.6 : 1)
        return wt
      })
      const farm = pick(weights, hash(key, 0, 7))
      use_ =
        hash(key * 131 + iu, iv, 8) < FARM_SHARE
          ? farm
          : pick(weights, hash(key * 131 + iu, iv, 10))
    }
    // Rows run along the road or back from it, plot by plot.
    const turn = hash(key * 131 + iu, iv, 12) < 0.5 ? Math.PI / 2 : 0
    const a = (Math.atan2(b.dir[1], b.dir[0]) + turn + Math.PI * 4) % Math.PI
    if (recorded[i]) {
      // A recorded ground keeps the farmland under it for the years before it was
      // laid out: its use in the direction's high bits, the direction in 16 steps.
      use[i] = LAND.recorded
      tone[i] = recorded[i]
      dirByte[i] = (use_ << 4) | (Math.round((a / Math.PI) * 16) % 16)
      lane[i] = LANE_CLAMP_M
      continue
    }
    use[i] = use_
    tone[i] = Math.floor(hash(key * 131 + iu, iv, 11) * 16)
    dirByte[i] = Math.round((a / Math.PI) * 256) % 256
  }

  // Where the land's use changes is an edge too (a garden's wall, the scrub's margin).
  const bound = new Float32Array(n).fill(EDGE_CLAMP_M)
  for (let r = 0; r < g.height; r++)
    for (let c = 0; c < g.width; c++) {
      const i = r * g.width + c
      const k = use[i] * 16 + (use[i] === LAND.recorded ? tone[i] : 0)
      const kr =
        c + 1 < g.width
          ? use[i + 1] * 16 + (use[i + 1] === LAND.recorded ? tone[i + 1] : 0)
          : k
      const kd =
        r + 1 < g.height
          ? use[i + g.width] * 16 +
            (use[i + g.width] === LAND.recorded ? tone[i + g.width] : 0)
          : k
      if (k !== kr)
        ((bound[i] = Math.min(bound[i], g.texel / 2)), (bound[i + 1] = g.texel / 2))
      if (k !== kd)
        ((bound[i] = Math.min(bound[i], g.texel / 2)), (bound[i + g.width] = g.texel / 2))
    }
  chamfer(bound, g.width, g.height, g.texel)
  // Inside a recorded ground only its own edge counts: the plots under it are gone.
  for (let i = 0; i < n; i++)
    edge[i] = use[i] === LAND.recorded ? bound[i] : Math.min(edge[i], bound[i])

  const rgba = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = use[i] * 16 + (tone[i] & 15)
    rgba[i * 4 + 1] = dirByte[i]
    rgba[i * 4 + 2] = Math.round((Math.min(edge[i], EDGE_CLAMP_M) / EDGE_CLAMP_M) * 255)
    rgba[i * 4 + 3] = Math.round((Math.min(lane[i], LANE_CLAMP_M) / LANE_CLAMP_M) * 255)
  }
  const counts = new Map<number, number>()
  for (let i = 0; i < n; i++) if (use[i]) counts.set(use[i], (counts.get(use[i]) ?? 0) + 1)
  const km2 = (k: number) => (((counts.get(k) ?? 0) * g.texel * g.texel) / 1e6).toFixed(1)
  console.log(
    `fields: ${Object.entries(LAND)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${km2(v)}`)
      .join(', ')} km²`,
  )
  return {
    rgba,
    use,
    angle: (i: number) => (dirByte[i] / 256) * Math.PI,
    edge,
    recorded,
  }
}

/** The recorded grounds among the places, with their outlines (build.ts). */
export function recordedGrounds(
  places: Map<string, Place>,
  outlines: Map<string, Pt[][][]>,
): RecordedGround[] {
  const out: RecordedGround[] = []
  for (const p of places.values()) {
    if (p.kind !== 'garden' && p.kind !== 'grove' && p.kind !== 'cemetery') continue
    // A garden no source locates (Pompey's) is a point, and not drawn.
    const polys = outlines.get(p.id)
    if (!polys) continue
    for (const poly of polys)
      out.push({
        id: p.id,
        at: projection.forward(...p.location),
        kind: p.kind === 'cemetery' ? 'burial' : p.kind,
        ring: poly[0],
        years: [p.from.year, p.to.year],
        prior: 0,
      })
  }
  // Earlier first, so a ground laid out over another comes after it (`prior`).
  out.sort((a, b) => a.years[0] - b.years[0])
  if (out.length > 15)
    throw new Error('fields: more than 15 recorded grounds (plate-2 has 4 bits)')
  return out
}

// --- trees ---------------------------------------------------------------------------------

/** What a tree is (model.bin's fifth value; ModelLayer builds each). */
export const TREE = { mixed: 0, olive: 1, fruit: 2, oak: 3, cypress: 4, pine: 5 } as const

/**
 * Trees stand on the rows of olive groves and orchards, the same rows the shader
 * paints (plate-2's direction, at `ROWS_M` apart, measured from the grid's north-west
 * corner); scattered on the scrub; and in the
 * recorded gardens and groves, planted as the record's kind.
 */
export const ROWS_M = { olives: 9, orchard: 7 }
/**
 * The groves and orchards are raised as trees this far from the wall, metres; beyond,
 * the shader's painted rows carry them, too small by then to stand out.
 */
const TREES_WITHIN_M = 1600

export interface Tree {
  x: number
  y: number
  r: number
  kind: number
  years: [number, number]
}

export function fieldTrees(
  f: Fields,
  grid: Grid,
  reach: Float32Array,
  maxReach: number,
  grounds: RecordedGround[],
  circuit: Pt[],
  /** Whether a tree may stand at a point; `inCity`, inside the wall too. */
  free: (p: Pt, inCity?: boolean) => boolean,
): Tree[] {
  const circuitEdges = circuit.slice(0, -1).map((p, k) => [p, circuit[k + 1]] as [Pt, Pt])
  const near = (p: Pt) => nearestSeg(circuitEdges, p).d < TREES_WITHIN_M
  const trees: Tree[] = []
  const g = grid
  const always: [number, number] = [-100000, 100000]
  for (let i = 0; i < f.use.length; i++) {
    if (reach[i] > maxReach) continue
    const u = f.use[i]
    const c = i % g.width
    const r = Math.floor(i / g.width)
    const cx = g.x0 + (c + 0.5) * g.texel
    const cy = g.y1 - (r + 0.5) * g.texel
    if (u === LAND.olives || u === LAND.orchard) {
      // The lattice cell this texel's centre is in; planted by the texel its centre falls in.
      // In metres from the grid's north-west corner, as the shader has them.
      const S = u === LAND.olives ? ROWS_M.olives : ROWS_M.orchard
      const a = f.angle(i)
      const [ca, sa] = [Math.cos(a), Math.sin(a)]
      const [rx, ry] = [cx - g.x0, cy - g.y1]
      const lu = Math.floor((rx * ca + ry * sa) / S)
      const lv = Math.floor((-rx * sa + ry * ca) / S)
      const [pu, pv] = [(lu + 0.5) * S, (lv + 0.5) * S]
      const x = g.x0 + pu * ca - pv * sa
      const y = g.y1 + pu * sa + pv * ca
      if (Math.floor((x - g.x0) / g.texel) !== c || Math.floor((g.y1 - y) / g.texel) !== r)
        continue
      if (f.edge[i] < 2 || !free([x, y]) || !near([x, y])) continue
      const h = hash(lu, lv, u)
      trees.push({
        x,
        y,
        r: u === LAND.olives ? 2.2 + h * 1.2 : 1.8 + h * 0.9,
        kind: u === LAND.olives ? TREE.olive : TREE.fruit,
        years: always,
      })
    } else if (u === LAND.scrub) {
      const h = hash(c, r, 21)
      if (h > 0.03 || !free([cx, cy]) || !near([cx, cy])) continue
      trees.push({
        x: cx + (hash(c, r, 22) - 0.5) * 3,
        y: cy + (hash(c, r, 23) - 0.5) * 3,
        r: 2.5 + hash(c, r, 24) * 2,
        kind: hash(c, r, 25) < 0.25 ? TREE.cypress : TREE.oak,
        years: always,
      })
    }
  }
  // The recorded grounds, planted on a looser grid of their own.
  const onGround = (p: Pt, k: number) => {
    const i = texelAt(g, p)
    return i >= 0 && f.recorded[i] === k + 1
  }
  grounds.forEach((gr, k) => {
    if (gr.kind === 'burial') return
    // A sacred grove a stand of trees with glades in it, a garden its trees along
    // walks and round lawns: neither a wood.
    const S = gr.kind === 'grove' ? 10 : 13
    const [bx0, by0, bx1, by1] = box(gr.ring)
    for (let y = by0; y < by1; y += S)
      for (let x = bx0; x < bx1; x += S) {
        const [li, lj] = [Math.round(x / S), Math.round(y / S)]
        const p: Pt = [
          x + (hash(li, lj, 31) - 0.5) * S * (gr.kind === 'grove' ? 0.8 : 0.3),
          y + (hash(li, lj, 32) - 0.5) * S * (gr.kind === 'grove' ? 0.8 : 0.3),
        ]
        if (!onGround(p, k) || !free(p, true)) continue
        const h = hash(li, lj, 33)
        if (h > (gr.kind === 'garden' ? 0.3 : 0.5)) continue
        const q = hash(li, lj, 34)
        trees.push({
          x: p[0],
          y: p[1],
          r: gr.kind === 'grove' ? 3.5 + q * 2.5 : 3 + q * 2.5,
          kind:
            gr.kind === 'grove'
              ? q < 0.85
                ? TREE.oak
                : TREE.cypress
              : q < 0.35
                ? TREE.cypress
                : q < 0.9
                  ? TREE.mixed
                  : TREE.pine,
          years: gr.years,
        })
      }
  })
  // A garden's walk round its edge is lined with cypresses.
  grounds.forEach((gr, k) => {
    if (gr.kind !== 'garden') return
    const inset = grow(gr.ring, -5)
    for (let e = 0; e + 1 < inset.length; e++) {
      const [a, b] = [inset[e], inset[e + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let t = 4; t < L - 4; t += 8) {
        const p: Pt = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]
        if (!onGround(p, k) || !free(p, true)) continue
        trees.push({ x: p[0], y: p[1], r: 3, kind: TREE.cypress, years: gr.years })
      }
    }
  })
  return trees
}

// --- helpers ---------------------------------------------------------------------------------

function zoneWeights(fromWall: number) {
  const z = ZONES
  if (fromWall <= z[0].at) return z[0].weights
  for (let k = 0; k + 1 < z.length; k++)
    if (fromWall <= z[k + 1].at) {
      const t = (fromWall - z[k].at) / (z[k + 1].at - z[k].at)
      return z[k].weights.map((w, m) => lerp(w, z[k + 1].weights[m], t))
    }
  return z[z.length - 1].weights
}

function pick(weights: number[], r: number) {
  const sum = weights.reduce((s, w) => s + w, 0)
  let acc = 0
  for (let k = 0; k < weights.length; k++) {
    acc += weights[k] / sum
    if (r < acc) return CROPS[k]
  }
  return CROPS[CROPS.length - 1]
}

/** Smooth value noise in [0, 1], seeded. */
function noise(x: number, y: number, seed: number) {
  const [i, j] = [Math.floor(x), Math.floor(y)]
  const [u, v] = [x - i, y - j].map((t) => t * t * (3 - 2 * t))
  const a = lerp(hash(i, j, seed), hash(i + 1, j, seed), u)
  const b = lerp(hash(i, j + 1, seed), hash(i + 1, j + 1, seed), u)
  return lerp(a, b, v)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]

/** A hash of two integers and a salt to [0, 1). */
export function hash(a: number, b: number, salt: number) {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^
    Math.imul(b | 0, 0x165667b1) ^
    Math.imul(salt, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function nearestSeg(segs: [Pt, Pt][], p: Pt) {
  let best = { d: Infinity, a: [0, 0] as Pt, b: [1, 0] as Pt, foot: p }
  for (const [a, b] of segs) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    const foot: Pt = [a[0] + t * dx, a[1] + t * dy]
    const d = Math.hypot(foot[0] - p[0], foot[1] - p[1])
    if (d < best.d) best = { d, a, b, foot }
  }
  return best
}

function box(ring: Pt[]): [number, number, number, number] {
  const xs = ring.map((q) => q[0])
  const ys = ring.map((q) => q[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
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

/** A ring pushed out from its centre by `m` metres: enough for a monument's margin. */
function grow(ring: Pt[], m: number): Pt[] {
  const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length
  const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length
  return ring.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1
    return [x + ((x - cx) / l) * m, y + ((y - cy) / l) * m]
  })
}

/** The texel a plane point falls in, or -1 off the grid. */
function texelAt(g: Grid, [x, y]: Pt) {
  const c = Math.floor((x - g.x0) / g.texel)
  const r = Math.floor((g.y1 - y) / g.texel)
  return c < 0 || r < 0 || c >= g.width || r >= g.height ? -1 : r * g.width + c
}

/** Calls `set` for each texel whose centre is inside a ring. */
function rasterise(g: Grid, ring: Pt[], set: (i: number) => void) {
  const [bx0, by0, bx1, by1] = box(ring)
  const c0 = Math.max(0, Math.floor((bx0 - g.x0) / g.texel))
  const c1 = Math.min(g.width - 1, Math.ceil((bx1 - g.x0) / g.texel))
  const r0 = Math.max(0, Math.floor((g.y1 - by1) / g.texel))
  const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - by0) / g.texel))
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (inRing([g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel], ring))
        set(r * g.width + c)
}

/** A two-pass chamfer distance transform in place: each value becomes the least over its neighbours plus the step. */
function chamfer(d: Float32Array, w: number, h: number, texel: number) {
  const [a, b] = [texel, texel * Math.SQRT2]
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c
      let v = d[i]
      if (c > 0) v = Math.min(v, d[i - 1] + a)
      if (r > 0) {
        v = Math.min(v, d[i - w] + a)
        if (c > 0) v = Math.min(v, d[i - w - 1] + b)
        if (c + 1 < w) v = Math.min(v, d[i - w + 1] + b)
      }
      d[i] = v
    }
  for (let r = h - 1; r >= 0; r--)
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c
      let v = d[i]
      if (c + 1 < w) v = Math.min(v, d[i + 1] + a)
      if (r + 1 < h) {
        v = Math.min(v, d[i + w] + a)
        if (c + 1 < w) v = Math.min(v, d[i + w + 1] + b)
        if (c > 0) v = Math.min(v, d[i + w - 1] + b)
      }
      d[i] = v
    }
}
