/**
 * The model of Rome (DESIGN.md §7.7): what the engine needs to build the city as a
 * museum model when the map is zoomed right into it — build/rome/ground.png,
 * model.json and model.bin.
 *
 * The model is an illustration, and the one place the atlas draws what no source
 * records (DESIGN.md §1, the exception in §7.7). It keeps the two apart:
 *
 * - **What is known** is built from the records: each monument's outline raised by
 *   the type of building it is (MASSING), two landmarks OpenStreetMap has no
 *   outline for sized from Platner & Ashby's measurements (MEASURED), the bridges,
 *   and the Servian Wall on its circuit (servian.ts).
 * - **The city around them is generated** — houses and blocks of flats that nobody
 *   can map building by building for this period. Inside the wall city.ts lays out
 *   streets, blocks and the lots round them; the recorded streets, the monuments and
 *   the open squares are kept clear. Outside the wall a thinner suburb of detached
 *   houses.
 *   Where a monument was built within the window (Caesar's forum on the houses he
 *   bought up), houses stand on its site until the year it was begun.
 *   Trees stand on the hills beyond. All of it is seeded, so every build is the same.
 *
 * The ground under the model is the plate's smoothed relief with the river cut into
 * it (ground.png, heights in centimetres over two bytes), so the terrain can be laid
 * smooth there and everything sits on it exactly.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'
import { excavatedPieces, type StreetLine } from './streets.ts'
import { layCity, LOT_KIND, ROOF } from './city.ts'
import { COURSES, layCourse } from './aqueducts.ts'

type Pt = [number, number]

export interface ModelInput {
  out: string
  grid: { x0: number; y1: number; width: number; height: number; texel: number }
  raw: Float32Array
  smooth: Float32Array
  circuit: Pt[]
  wall: { a: Pt; b: Pt; known: boolean }[]
  gates: Pt[]
  streets: StreetLine[]
  riverRings: Pt[][]
  /** Signed distance to the river, metres, clamped (plate.ts). */
  water: Float32Array
  /** Signed distance to the hull of the plan, metres (plate.ts). */
  reach: Float32Array
  reachM: number
  outlines: { id: string; kind: string; polys: Pt[][][] }[]
  places: Map<string, Place>
}

/**
 * How each kind of monument is raised: the body's height and roof over it, metres,
 * and a podium under it. Typical heights for the type, not measurements — the
 * model's one liberty with the known buildings.
 */
const MASSING: Record<
  string,
  { body: number; roof: 'gable' | 'hip' | 'flat'; podium?: number }
> = {
  temple: { body: 12, roof: 'gable', podium: 4 },
  basilica: { body: 14, roof: 'hip' },
  curia: { body: 18, roof: 'gable' },
  archive: { body: 16, roof: 'flat' },
  house: { body: 8, roof: 'hip' },
  prison: { body: 5, roof: 'flat' },
  portico: { body: 8, roof: 'hip' },
  sanctuary: { body: 2, roof: 'flat' },
  fountain: { body: 1.2, roof: 'flat' },
  rostra: { body: 3.5, roof: 'flat' },
  tomb: { body: 12, roof: 'flat' },
  warehouse: { body: 9, roof: 'hip' },
  'city-wall': { body: 8, roof: 'flat' },
}

/**
 * Landmarks OpenStreetMap has no outline for, built from Platner & Ashby's
 * measurements at the record's location, lon/lat. Their placing is approximate and
 * the model says so only here and in the record's note.
 */
const MEASURED: {
  id: string
  shape: 'rect' | 'theatre'
  w: number
  d: number
  angle: number
  what: string
}[] = [
  {
    id: 'aedes-iovis-capitolini',
    shape: 'rect',
    w: 55,
    d: 60,
    angle: 0,
    what: 'the stylobate "about 55 metres" by "about 60", on a podium "from 4 to 5 metres" high (Platner & Ashby, pp. 297–302), its long side north–south',
  },
  {
    id: 'theatrum-pompei',
    shape: 'theatre',
    w: 155,
    d: 95,
    angle: 0,
    what: 'a diameter of "150‑160 metres" and a stage "about 95 metres" long (Platner & Ashby, pp. 515–517), the stage facing east to its portico',
  },
]

/**
 * Temples placed by a point (the records with no outline): their size, width by
 * length in metres — a typical mid-Republican temple on its podium, or what
 * Platner & Ashby give.
 */
const POINT_TEMPLE: {
  size: [number, number]
  sizes: Record<string, [number, number]>
  /** Temples whose remains fix how they lie: the direction their fronts face, radians from east. */
  facing: Record<string, number>
} = {
  size: [14, 24],
  sizes: {
    // "22 × 45 m" on the Marble Plan (Platner & Ashby, Minerva, aedes, p. 342).
    'aedes-minervae-aventinensis': [22, 45],
    // About 30 by 10 m, the middle temple under S. Nicola in Carcere (Spes, pp. 493–494).
    'aedes-spei-foro-holitorio': [12, 30],
    // The other two under S. Nicola in Carcere, narrower, so the three stand in a
    // row about 20 m apart as their remains do.
    'aedes-iani-foro-holitorio': [11, 26],
    'aedes-iunonis-sospitae': [10, 22],
  },
  // The three stand side by side, their long sides together; which way they fronted
  // is taken as east, towards the Forum Holitorium and the Capitol.
  facing: {
    'aedes-iani-foro-holitorio': 0,
    'aedes-spei-foro-holitorio': 0,
    'aedes-iunonis-sospitae': 0,
  },
}

/**
 * What the known buildings were faced with in the window, where Platner & Ashby say
 * (checked against each article, September 2026), from the year given, astronomical.
 * A building not listed, or before its first entry, is drawn in white stucco over
 * tufa or peperino, the Republic's usual finish: Rome's first marble temple was
 * Metellus's of 146 BCE (Iuppiter Stator, p. 304), and marble only became the rule
 * under Augustus. Where the article's marble is of a later rebuilding (Castor,
 * Concord, Vesta, the Basilica Aemilia, the Curia), it is not taken.
 */
const STONE_OF: Record<
  string,
  { from: number; stone: 'stucco' | 'marble' | 'travertine'; why: string }[]
> = {
  'aedes-saturni': [
    {
      from: -41,
      stone: 'marble',
      why: 'rebuilt from 42 BCE by Plancus; "the existing podium belongs to the temple of Plancus … covered with marble facing" (Aedes Saturni, p. 464)',
    },
  ],
  regia: [
    {
      from: -35,
      stone: 'marble',
      why: 'rebuilt by Domitius Calvinus in 36 BCE "of solid blocks of white marble", its walls before of cappellaccio (Regia, pp. 441–442)',
    },
  ],
  'aedes-veneris-genetricis': [
    {
      from: -100000,
      stone: 'marble',
      why: '"pycnostyle … and built of solid marble" (Forum Iulium, p. 226)',
    },
  ],
  'basilica-iulia': [
    {
      from: -100000,
      stone: 'marble',
      why: '"the entire outside of the building was constructed originally of white marble" (Basilica Julia, pp. 79–80); the description is mostly of Augustus\' rebuilding, so Caesar\'s may have differed',
    },
  ],
  'aedes-iovis-statoris-metelli': [
    {
      from: -100000,
      stone: 'marble',
      why: 'Metellus was "the first to build a temple in Rome entirely of marble" (Iuppiter Stator, p. 304)',
    },
  ],
  'aedes-apollinis-palatini': [
    {
      from: -100000,
      stone: 'marble',
      why: '"constructed of solid blocks of white Luna marble" (Aedes Apollinis Palatini, p. 17)',
    },
  ],
  'mausoleum-augusti': [
    {
      from: -100000,
      stone: 'travertine',
      why: '"faced with travertine, or, as some think, marble" (Mausoleum Augusti, p. 332)',
    },
  ],
}

/**
 * The Forum's paving: Monte Verde tufa at the Sullan level, and travertine slabs at
 * Caesar's, on which the altar of the Divus Julius was set (Forum Romanum, pp.
 * 232–233; Aedes Divi Juli, p. 287). The year of Caesar's relaying is not recorded;
 * it is taken as 44 BCE, when his works in the Forum (the Rostra, the Curia) began.
 * The travertine that survives is Augustan, Surdinus's (Forum Romanum, p. 234).
 */
const FORUM_PAVING = [
  { from: -100000, stone: 'tufa' },
  { from: -43, stone: 'travertine' },
]

/** The suburb's detached houses: their spacing, the gap between them, and where they may stand. */
const FABRIC = { spacing: 9.5, gap: 1.4, streetClear: 4, monumentClear: 5, maxSlope: 0.45 }
/**
 * The sun the model is lit by (ModelLayer: north-west, 45° up), as the offset of a
 * shadow per metre of height, and the terrain's vertical exaggeration it is seen at.
 */
const SHADOW = { dx: 0.707, dy: -0.707, vex: 1.5 }
/**
 * Floats per generated building in model.bin: its lot's four corners (front left,
 * front right, back right, back left), wall height, ground, the last year it
 * stands, its kind (city.ts `LOT_KIND`), its roof (`ROOF`) and its building's tone
 * (city.ts `Lot.tone`), shared by the lots of one building.
 */
const FABRIC_STRIDE = 14
/** The quarters where atrium houses gather among the flats (city.ts). */
const RICH_QUARTERS = [
  'mons-palatinus',
  'velia-roma',
  'carinae',
  'collis-quirinalis',
  'mons-caelius',
]
/** The atlas's window, astronomical: 133 to 27 BCE. */
const WINDOW = [-132, -26]
/**
 * The suburb beyond the wall: houses along the roads out of the gates, as far as
 * `reach` metres from the wall and within `road` of the road, and a few against the
 * wall itself, within `wall`; and how much of each is built.
 */
const SUBURB = { reach: 450, road: 38, wall: 70, density: [0.55, 0.25] }

export function bakeModel(m: ModelInput) {
  const { grid: g } = m
  const rand = mulberry32(1753)
  const idx = (x: number, y: number) => {
    const c = Math.floor((x - g.x0) / g.texel)
    const r = Math.floor((g.y1 - y) / g.texel)
    return c < 0 || r < 0 || c >= g.width || r >= g.height ? -1 : r * g.width + c
  }
  const sample = (f: Float32Array, x: number, y: number, fallback = 0) => {
    const i = idx(x, y)
    return i < 0 ? fallback : f[i]
  }

  // --- the ground -------------------------------------------------------------------
  // The water surface is the river's lowest tenth under the surface model, which
  // records the water itself; the bed is laid 3 m below it so the terrain never
  // shows through, with a light blur so the banks are not cliffs.
  const onRiver: number[] = []
  for (let i = 0; i < m.water.length; i++) if (m.water[i] < -4) onRiver.push(m.raw[i])
  onRiver.sort((a, b) => a - b)
  const waterLevel = onRiver[Math.floor(onRiver.length * 0.1)] ?? 8
  const cut = new Float32Array(m.smooth)
  for (let i = 0; i < cut.length; i++) {
    const t = Math.min(1, Math.max(0, (6 - m.water[i]) / 10))
    cut[i] = cut[i] * (1 - t) + Math.min(cut[i], waterLevel - 3) * t
  }
  const ground = blur(cut, g.width, g.height, 2)
  const at = (x: number, y: number) => sample(ground, x, y, waterLevel)
  const slopeAt = (x: number, y: number) =>
    Math.hypot(at(x + 4, y) - at(x - 4, y), at(x, y + 4) - at(x, y - 4)) / 8

  const png = new Uint8Array(g.width * g.height * 4)
  for (let i = 0; i < ground.length; i++) {
    const cm = Math.max(0, Math.min(65535, Math.round(ground[i] * 100)))
    png[i * 4] = cm >> 8
    png[i * 4 + 1] = cm & 255
    png[i * 4 + 3] = 255
  }

  // --- the known buildings ------------------------------------------------------------
  const monuments: {
    id: string
    kind: string
    rings: Pt[][]
    base: number
    body: number
    roof: string
    podium: number
    approx?: boolean
  }[] = []
  const lowest = (rings: Pt[][]) => Math.min(...rings[0].map(([x, y]) => at(x, y)))
  for (const o of m.outlines) {
    const mass = MASSING[o.kind]
    if (
      !mass &&
      o.kind !== 'bridge' &&
      o.kind !== 'forum' &&
      o.kind !== 'circus' &&
      o.kind !== 'island'
    )
      continue
    for (const rings of o.polys) {
      if (o.kind === 'island') continue
      if (o.kind === 'bridge') {
        // A deck at the height of its banks over the water.
        const bank = Math.max(
          ...rings[0].map(([x, y]) => (sample(m.water, x, y, 99) > 0 ? at(x, y) : 0)),
        )
        monuments.push({
          id: o.id,
          kind: 'bridge',
          rings,
          base: waterLevel - 2,
          body: Math.max(bank, waterLevel + 8) - waterLevel + 2,
          roof: 'flat',
          podium: 0,
        })
        continue
      }
      const base = lowest(rings)
      if (o.kind === 'forum')
        monuments.push({
          id: o.id,
          kind: 'forum',
          rings,
          base,
          body: 9,
          roof: 'hip',
          podium: 0,
        })
      else if (o.kind === 'circus')
        monuments.push({
          id: o.id,
          kind: 'circus',
          rings,
          base,
          body: 11,
          roof: 'flat',
          podium: 0,
        })
      else
        monuments.push({
          id: o.id,
          kind: o.kind,
          rings,
          base,
          body: mass.body,
          roof: mass.roof,
          podium: mass.podium ?? 0,
        })
    }
  }
  for (const s of MEASURED) {
    const p = m.places.get(s.id)
    if (!p) continue
    const [cx, cy] = projection.forward(...p.location)
    const rings: Pt[][] =
      s.shape === 'rect'
        ? [rect(cx, cy, s.w, s.d, s.angle)]
        : [theatre(cx, cy, s.w / 2, s.d)]
    const kind = s.shape === 'rect' ? 'temple' : 'theatre'
    monuments.push({
      id: s.id,
      kind,
      rings,
      base: lowest(rings),
      body: kind === 'temple' ? 14 : 24,
      roof: kind === 'temple' ? 'gable' : 'flat',
      podium: kind === 'temple' ? 4.5 : 0,
      approx: true,
    })
  }

  // Temples the records place by a point only: a temple of a standard size (or the
  // size Platner & Ashby give) at the point, its long axis down the slope and its
  // front facing downhill, as a temple on a hillside faced out over the valley.
  // One that would stand on a surveyed monument, or in the river, is left out.
  const pointFacing = new Map<string, Pt>()
  const outlined = new Set(m.outlines.map((o) => o.id))
  const doubts: string[] = []
  for (const p of m.places.values()) {
    if (p.kind !== 'temple' || p.within !== 'roma' || outlined.has(p.id)) continue
    if (MEASURED.some((s) => s.id === p.id)) continue
    const [cx, cy] = projection.forward(...p.location)
    const [w, d] = POINT_TEMPLE.sizes[p.id] ?? POINT_TEMPLE.size
    const gx = at(cx + 15, cy) - at(cx - 15, cy)
    const gy = at(cx, cy + 15) - at(cx, cy - 15)
    const fixed = POINT_TEMPLE.facing[p.id]
    const down: Pt =
      fixed !== undefined
        ? [Math.cos(fixed), Math.sin(fixed)]
        : Math.hypot(gx, gy) > 0.3
          ? [-gx, -gy]
          : [0, -1]
    const angle = Math.atan2(down[1], down[0]) - Math.PI / 2
    const ring = rect(cx, cy, w, d, angle)
    const clash = monuments.find((mo) => ring.some((q) => inRing(q, mo.rings[0])))
    if (clash) {
      doubts.push(`${p.id} would stand on ${clash.id}: left out`)
      continue
    }
    if (ring.some(([x, y]) => sample(m.water, x, y, 99) < 4)) {
      doubts.push(`${p.id} would stand in the river: left out`)
      continue
    }
    const l = Math.hypot(down[0], down[1])
    pointFacing.set(p.id, [cx + (down[0] / l) * 100, cy + (down[1] / l) * 100])
    monuments.push({
      id: p.id,
      kind: 'temple',
      rings: [ring],
      base: lowest([ring]),
      body: MASSING.temple.body,
      roof: 'gable',
      podium: MASSING.temple.podium ?? 3,
      approx: true,
    })
  }
  for (const d of doubts) console.log(`model: ${d}`)

  // --- the wall ------------------------------------------------------------------------
  // Every join but the river bank's, stepped every 8 m so it rides the ground.
  const wall = m.wall.map(({ a, b, known }) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8))
    const pts: [number, number, number][] = []
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n
      const y = a[1] + ((b[1] - a[1]) * k) / n
      pts.push([round(x), round(y), round(at(x, y))])
    }
    return { pts, known }
  })
  const gates = m.gates.map(([x, y]) => [round(x), round(y), round(at(x, y))])

  // --- where the generated city may stand ------------------------------------------------
  const inCircuit = (x: number, y: number) => inRing([x, y], m.circuit)
  const streetGrid = new SegmentGrid(
    m.streets.flatMap((l) => l.pts.slice(1).map((q, i) => [l.pts[i], q] as [Pt, Pt])),
    40,
  )
  // Monuments standing from before the window keep houses off their sites for good;
  // later ones take their site from the houses in the year they were begun.
  const yearsOf = (id: string) => dates(m.places.get(id)).years
  const early = monuments.filter((mo) => yearsOf(mo.id)[0] <= WINDOW[0])
  const late = monuments.filter((mo) => yearsOf(mo.id)[0] > WINDOW[0])
  const inside = (p: Pt, mo: (typeof monuments)[number]) =>
    inRing(p, mo.rings[0]) && !mo.rings.slice(1).some((h) => inRing(p, h))
  const monumentGrid = new SegmentGrid(
    early
      .flatMap((mo) => mo.rings)
      .flatMap((r) => r.slice(1).map((q, i) => [r[i], q] as [Pt, Pt])),
    40,
  )
  const insideMonument = (p: Pt) => early.some((mo) => inside(p, mo))
  /** The last year a house at `p` stands: the year before a later monument took its site. */
  const until = (pts: Pt[]) =>
    Math.min(
      100000,
      ...late
        .filter((mo) => pts.some((q) => inside(q, mo)))
        .map((mo) => yearsOf(mo.id)[0] - 1),
    )
  // Squares no house stands in: the Forum between its buildings, the Capitol's
  // precinct round its temple, and the Circus' arena (inside its outline already).
  const open: { c: Pt; r: number }[] = []
  const forum = [
    'aedes-saturni',
    'aedes-castoris',
    'basilica-iulia',
    'basilica-aemilia',
    'curia-iulia',
    'regia',
    'aedes-vestae',
    'aedes-divi-iulii',
  ]
    .map((id) => m.places.get(id))
    .filter((p): p is Place => !!p)
    .map((p) => projection.forward(...p.location))
  const forumHull = forum.length > 2 ? hull(forum) : []
  const capitol = m.places.get('aedes-iovis-capitolini')
  if (capitol) open.push({ c: projection.forward(...capitol.location), r: 75 })
  /**
   * The point a building faces: a temple in a forum faces into it, one on the Forum's
   * edge faces the Forum, and the Capitol's temple faces south, down to the city.
   */
  const forumMiddle: Pt | null = forumHull.length
    ? [
        forumHull.reduce((s, q) => s + q[0], 0) / forumHull.length,
        forumHull.reduce((s, q) => s + q[1], 0) / forumHull.length,
      ]
    : null
  const courts = monuments.filter((mo) => mo.kind === 'forum')
  const facing = (mo: (typeof monuments)[number]): Pt => {
    const c = mo.rings[0]
      .reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0])
      .map((v) => v / mo.rings[0].length) as Pt
    if (mo.id === 'aedes-iovis-capitolini') return [c[0], c[1] - 500]
    const own = pointFacing.get(mo.id)
    if (own) return own
    const court = courts.find((f) => f !== mo && inRing(c, f.rings[0]))
    if (court) {
      const r = court.rings[0]
      return [
        r.reduce((s, q) => s + q[0], 0) / r.length,
        r.reduce((s, q) => s + q[1], 0) / r.length,
      ]
    }
    return forumMiddle ?? [c[0], c[1] - 100]
  }
  const isOpen = (p: Pt) =>
    (forumHull.length && inRing(p, [...forumHull, forumHull[0]])) ||
    open.some((o) => Math.hypot(p[0] - o.c[0], p[1] - o.c[1]) < o.r)

  // The aqueducts (aqueducts.ts): their arcades and walls keep houses and trees off
  // their line.
  const aqueducts = COURSES.map((c) => ({ course: c, runs: layCourse(c, at) }))
  const aqueductGrid = new SegmentGrid(
    aqueducts.flatMap(({ runs }) =>
      runs
        .filter((r) => r.kind !== 'shafts')
        .flatMap((r) =>
          r.pts.slice(1).map((q, i) => [r.pts[i].slice(0, 2), q.slice(0, 2)] as [Pt, Pt]),
        ),
    ),
    40,
  )
  const bandOf: number[] = []
  const aqueductBands: Pt[][] = aqueducts.flatMap(({ course, runs }, n) =>
    runs
      .filter((r) => r.kind !== 'shafts')
      .flatMap((r) =>
        r.pts.slice(1).map((q, i) => {
          const [a, b] = [r.pts[i], q]
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          bandOf.push(n)
          return rect(
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
            course.size.width + 6,
            L + 1,
            Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2,
          )
        }),
      ),
  )

  const allowed = (p: Pt, suburb: boolean) => {
    if (aqueductGrid.nearest(p).d < 5) return false
    if (sample(m.water, p[0], p[1], -1) < 6) return false
    if (streetGrid.nearest(p).d < FABRIC.streetClear) return false
    if (monumentGrid.nearest(p).d < FABRIC.monumentClear || insideMonument(p)) return false
    if (isOpen(p)) return false
    if (slopeAt(p[0], p[1]) > FABRIC.maxSlope) return false
    return suburb ? !inCircuit(p[0], p[1]) : inCircuit(p[0], p[1])
  }

  // --- the generated city ------------------------------------------------------------------
  const fabric: number[] = []
  const courtyardTrees: Pt[] = []
  const placed = new SpatialHash(30)
  const [bx0, by0, bx1, by1] = bounds(m.circuit, SUBURB.reach + 20)
  const lot = (pts: Pt[], h: number, kind: number, roof: number, tone: number) => {
    fabric.push(
      ...pts.slice(0, 4).flatMap(([x, y]) => [round(x), round(y)]),
      round(h),
      round(Math.min(...pts.map((c) => at(c[0], c[1])))),
      until(pts),
      kind,
      roof,
      Math.round(tone * 1000) / 1000,
    )
  }

  // Inside the wall: streets, blocks and lots (city.ts).
  const city = layCity({
    circuit: m.circuit,
    gates: m.gates,
    streets: m.streets,
    pieces: excavatedPieces(),
    forum: forumHull,
    squares: open.map(
      (o) =>
        Array.from({ length: 24 }, (_, k) => [
          o.c[0] + Math.cos((k / 24) * Math.PI * 2) * o.r,
          o.c[1] + Math.sin((k / 24) * Math.PI * 2) * o.r,
        ]) as Pt[],
    ),
    monuments: [...early.map((mo) => mo.rings[0]), ...aqueductBands],
    at,
    slopeAt,
    wet: (x, y) => sample(m.water, x, y, -1) < 6,
    toRiver: (x, y) => Math.min(...m.riverRings.map((r) => distToRing([x, y], r))),
    richQuarters: RICH_QUARTERS.map((id) => m.places.get(id))
      .filter((p): p is Place => !!p)
      .map((p) => projection.forward(...p.location)),
    rand,
  })
  for (const l of city.lots) lot(l.pts, l.h, l.kind, l.roof, l.tone)
  courtyardTrees.push(...city.gardens)

  // Outside it: a thinner suburb of detached houses, along the roads.
  const s0 = FABRIC.spacing
  for (let y = by0; y < by1; y += s0)
    for (let x = bx0; x < bx1; x += s0) {
      const p: Pt = [x + (rand() - 0.5) * s0 * 0.8, y + (rand() - 0.5) * s0 * 0.8]
      if (inCircuit(p[0], p[1])) continue
      const near = streetGrid.nearest(p)
      const fromWall = distToRing(p, m.circuit)
      const byRoad = near.d < SUBURB.road && fromWall < SUBURB.reach
      if (!byRoad && fromWall > SUBURB.wall) continue
      if (rand() > SUBURB.density[byRoad ? 0 : 1]) continue
      const gx = at(p[0] + 4, p[1]) - at(p[0] - 4, p[1])
      const gy = at(p[0], p[1] + 4) - at(p[0], p[1] - 4)
      const angle =
        near.d < 45 && near.seg
          ? Math.atan2(near.seg[1][1] - near.seg[0][1], near.seg[1][0] - near.seg[0][0])
          : Math.hypot(gx, gy) > 0.4
            ? Math.atan2(gx, -gy)
            : Math.floor(x / 400) * 0.37 + Math.floor(y / 400) * 0.61
      const w = 8 + rand() * 8
      const d = 10 + rand() * 12
      const h = 4.5 + rand() * 3
      const corners = rect(p[0], p[1], w + FABRIC.gap, d + FABRIC.gap, angle)
      if (!corners.every((c) => allowed(c, true)) || !allowed(p, true)) continue
      const r = Math.hypot(w, d) / 2
      if (placed.near(p, r + FABRIC.gap)) continue
      placed.add(p, r)
      lot(rect(p[0], p[1], w, d, angle), h, LOT_KIND.suburb, ROOF.along, rand())
    }

  // --- trees -------------------------------------------------------------------------------
  const trees: number[] = []
  const treePlaced = new SpatialHash(20)
  for (let y = by0 - 900; y < by1 + 900; y += 9)
    for (let x = bx0 - 900; x < bx1 + 900; x += 9) {
      const p: Pt = [x + (rand() - 0.5) * 8, y + (rand() - 0.5) * 8]
      if (sample(m.reach, p[0], p[1], 1e9) > m.reachM - 150) continue
      if (inCircuit(p[0], p[1]) || sample(m.water, p[0], p[1], -1) < 10) continue
      if (
        placed.near(p, 10) ||
        aqueductGrid.nearest(p).d < 8 ||
        streetGrid.nearest(p).d < 6 ||
        monumentGrid.nearest(p).d < 10 ||
        insideMonument(p)
      )
        continue
      // Groves where a slow noise says so, thicker on the slopes.
      const grove = valueNoise(p[0] / 260, p[1] / 260, 7) + slopeAt(p[0], p[1]) * 1.2
      if (grove < 0.66 || rand() > 0.5) continue
      const rr = 3 + rand() * 3
      if (treePlaced.near(p, rr * 1.2)) continue
      treePlaced.add(p, rr)
      trees.push(round(p[0]), round(p[1]), round(rr), round(at(p[0], p[1])))
    }

  // --- shadows on the board ------------------------------------------------------------------
  // Each footprint swept away from the sun by its height, filled on the plate's grid
  // with 2×2 samples a texel and softened, so the board carries the model's shadows.
  const shadow = new Float32Array(g.width * g.height)
  const cast = (foot: Pt[], h: number) => {
    const L = h * SHADOW.vex
    const swept = hull([
      ...foot,
      ...foot.map(([x, y]) => [x + SHADOW.dx * L, y + SHADOW.dy * L] as Pt),
    ])
    fill(shadow, g, [...swept, swept[0]])
  }
  // Only what stands through the whole window casts one: the shadow is baked, and
  // would outlast a house or come before a monument.
  for (let i = 0; i < fabric.length; i += FABRIC_STRIDE) {
    if (fabric[i + 10] < WINDOW[1]) continue
    const f = fabric.slice(i, i + 8)
    cast(
      [0, 2, 4, 6].map((k) => [f[k], f[k + 1]] as Pt),
      fabric[i + 8] + 2,
    )
  }
  for (const mo of early)
    if (yearsOf(mo.id)[1] >= WINDOW[1]) cast(mo.rings[0].slice(0, -1), mo.podium + mo.body)
  for (const w of wall)
    for (let k = 0; k + 1 < w.pts.length; k++)
      cast([w.pts[k].slice(0, 2) as Pt, w.pts[k + 1].slice(0, 2) as Pt], 10)
  for (let i = 0; i < trees.length; i += 4) {
    const [x, y, r] = trees.slice(i, i + 3)
    cast(
      [0, 1, 2, 3, 4, 5].map(
        (k) => [x + Math.cos(k * 1.047) * r, y + Math.sin(k * 1.047) * r] as Pt,
      ),
      r * 2.6,
    )
  }
  const soft = blur(shadow, g.width, g.height, 0.8)

  const fab = new Float32Array(fabric)
  for (const [x, y] of courtyardTrees)
    trees.push(round(x), round(y), round(2.5 + rand() * 1.5), round(at(x, y)))
  const tre = new Float32Array(trees)
  const bin = Buffer.concat([Buffer.from(fab.buffer), Buffer.from(tre.buffer)])
  writeFileSync(join(m.out, 'model.bin'), bin)
  writeFileSync(
    join(m.out, 'model.json'),
    JSON.stringify({
      _comment:
        'The model of Rome (pipeline/src/rome/model.ts). Plane metres; heights are ground metres above sea level, before the terrain’s vertical exaggeration. model.bin: fabric (its lot’s corners: front left, front right, back right, back left, x and y each; wall height; base; the last year it stands; kind; roof; its building’s tone) × fabricCount, then trees (x, y, radius, base) × treeCount, float32.',
      waterLevel: round(waterLevel),
      fabricCount: fab.length / FABRIC_STRIDE,
      treeCount: tre.length / 4,
      river: m.riverRings.map((r) => r.map(([x, y]) => [round(x), round(y)])),
      monuments: monuments.map((mo) => ({
        ...mo,
        rings: mo.rings.map((r) => r.map(([x, y]) => [round(x), round(y)])),
        base: round(mo.base),
        faces: facing(mo).map((v) => round(v)),
        ...dates(m.places.get(mo.id)),
        stone: STONE_OF[mo.id]?.map(({ from, stone }) => ({ from, stone })),
      })),
      // The open squares, paved: the Forum between its buildings.
      squares: forumHull.length
        ? [
            {
              ring: [...forumHull, forumHull[0]].map(([x, y]) => [round(x), round(y)]),
              base: round(Math.min(...forumHull.map(([x, y]) => at(x, y)))),
              paving: FORUM_PAVING,
            },
          ]
        : [],
      wall,
      gates,
      // The aqueducts, laid out (aqueducts.ts): each channel's years, bottom to top,
      // and the course in runs of arcade, wall and shafts.
      aqueducts: aqueducts.map(({ course, runs }) => ({
        id: course.id,
        size: course.size,
        channels: course.channels.map((ch) => {
          const d = dates(m.places.get(ch.id))
          const from = Math.max(d.years[0], ch.from ?? -Infinity)
          return { id: ch.id, h: ch.h, years: [from, d.years[1]], unfinished: d.unfinished }
        }),
        runs: runs.map((r) => ({
          kind: r.kind,
          pts: r.pts.map((q) => q.map((v) => round(v))),
        })),
      })),
      // The generated streets, for reference: the main streets and the local ones.
      streets: {
        main: city.mains.map((l) => l.map(([x, y]) => [round(x), round(y)])),
        local: city.locals.map((l) => l.map(([x, y]) => [round(x), round(y)])),
      },
    }),
  )
  console.log(
    `model: ${monuments.length} buildings known, ${city.mains.length} main streets and ${city.locals.length} local ones generated, ${city.blocks} blocks, ${fab.length / FABRIC_STRIDE} buildings, ${tre.length / 4} trees, ${wall.length} wall stretches, water at ${waterLevel.toFixed(1)} m`,
  )
  // The footprints drawn for monuments with no surveyed outline, for picking.
  const drawn = [
    ...monuments.filter((mo) => mo.approx).map((mo) => ({ id: mo.id, ring: mo.rings[0] })),
    // An aqueduct's arcade opens the aqueduct it was built for.
    ...aqueducts.flatMap(({ course }, n) =>
      aqueductBands
        .filter((_, k) => bandOf[k] === n)
        .map((ring) => ({ id: course.id, ring })),
    ),
  ]
  return { png, waterLevel, shadow: soft, drawn }
}

/** ground.png: heights in centimetres, high byte red, low byte green. */
export async function writeGround(
  out: string,
  png: Uint8Array,
  width: number,
  height: number,
) {
  await sharp(png, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(out, 'ground.png'))
}

/**
 * When a monument stands in the model: its years, and the span within them when it
 * was building or lay burnt (the conditions that are not `standing`, run together),
 * which the model shows part-built. Astronomical years.
 */
function dates(p: Place | undefined) {
  if (!p) return { years: [-10000, 10000], unfinished: null }
  const weak = p.condition.filter((c) => c.value !== 'standing')
  return {
    years: [p.from.year, p.to.year],
    unfinished: weak.length
      ? [Math.min(...weak.map((c) => c.from.year)), Math.max(...weak.map((c) => c.to.year))]
      : null,
  }
}

// --- geometry helpers ---------------------------------------------------------------------

const round = (v: number, k = 10) => Math.round(v * k) / k

function rect(cx: number, cy: number, w: number, d: number, angle: number): Pt[] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  const pts: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
  return [...pts, pts[0]]
}

/** A theatre's plan: a half-circle of `r` behind a straight stage on its east side. */
function theatre(cx: number, cy: number, r: number, stage: number): Pt[] {
  const pts: Pt[] = []
  for (let k = 0; k <= 24; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 24
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  pts.push([cx + 12, cy - stage / 2], [cx + 12, cy + stage / 2])
  return [...pts, pts[0]]
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

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

function distToRing(p: Pt, ring: Pt[]) {
  let d = Infinity
  for (let i = 0; i + 1 < ring.length; i++)
    d = Math.min(d, segDist(p, ring[i], ring[i + 1]))
  return d
}

function bounds(ring: Pt[], pad: number): [number, number, number, number] {
  return [
    Math.min(...ring.map((p) => p[0])) - pad,
    Math.min(...ring.map((p) => p[1])) - pad,
    Math.max(...ring.map((p) => p[0])) + pad,
    Math.max(...ring.map((p) => p[1])) + pad,
  ]
}

function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Pt[]) => {
    const out: Pt[] = []
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop()
      out.push(q)
    }
    return out.slice(0, -1)
  }
  return [...half(p), ...half([...p].reverse())]
}

/** Adds a ring's coverage to a grid, 2×2 samples a texel, capped at 1. */
function fill(f: Float32Array, g: ModelInput['grid'], ring: Pt[]) {
  const ys = ring.map((p) => p[1])
  const r0 = Math.max(0, Math.floor((g.y1 - Math.max(...ys)) / g.texel))
  const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - Math.min(...ys)) / g.texel))
  for (let r = r0; r <= r1; r++)
    for (const sy of [0.25, 0.75]) {
      const y = g.y1 - (r + sy) * g.texel
      const xs: number[] = []
      for (let i = 0; i + 1 < ring.length; i++) {
        const [a, b] = [ring[i], ring[i + 1]]
        if (a[1] > y !== b[1] > y)
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (const sx of [0.25, 0.75]) {
          const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.texel - sx))
          const c1 = Math.min(g.width - 1, Math.floor((xs[k + 1] - g.x0) / g.texel - sx))
          for (let c = c0; c <= c1; c++)
            f[r * g.width + c] = Math.min(1, f[r * g.width + c] + 0.25)
        }
    }
}

/** Segments bucketed on a grid, for the nearest one to a point. */
class SegmentGrid {
  private cells = new Map<string, [Pt, Pt][]>()
  private size: number
  constructor(segs: [Pt, Pt][], size: number) {
    this.size = size
    for (const s of segs) {
      const [x0, x1] = [Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0])]
      const [y0, y1] = [Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])]
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++)
        for (let j = Math.floor(y0 / size); j <= Math.floor(y1 / size); j++) {
          const k = `${i},${j}`
          const list = this.cells.get(k) ?? []
          list.push(s)
          this.cells.set(k, list)
        }
    }
  }
  nearest(p: Pt): { d: number; seg?: [Pt, Pt] } {
    let best: { d: number; seg?: [Pt, Pt] } = { d: Infinity }
    const [ci, cj] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)]
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const s of this.cells.get(`${i},${j}`) ?? []) {
          const d = segDist(p, s[0], s[1])
          if (d < best.d) best = { d, seg: s }
        }
    return best
  }
}

/** Points with a radius, bucketed, for "is anything within r of here". */
class SpatialHash {
  private cells = new Map<string, [number, number, number][]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  add(p: Pt, r: number) {
    const k = `${Math.floor(p[0] / this.size)},${Math.floor(p[1] / this.size)}`
    const list = this.cells.get(k) ?? []
    list.push([p[0], p[1], r])
    this.cells.set(k, list)
  }
  near(p: Pt, r: number) {
    const [ci, cj] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)]
    for (let i = ci - 2; i <= ci + 2; i++)
      for (let j = cj - 2; j <= cj + 2; j++)
        for (const [x, y, rr] of this.cells.get(`${i},${j}`) ?? [])
          if (Math.hypot(x - p[0], y - p[1]) < r + rr) return true
    return false
  }
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise in [0, 1], seeded. */
function valueNoise(x: number, y: number, seed: number) {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
    return s - Math.floor(s)
  }
  const [i, j] = [Math.floor(x), Math.floor(y)]
  const [u, v] = [x - i, y - j]
  const f = (t: number) => t * t * (3 - 2 * t)
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * f(u)
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * f(u)
  return a + (b - a) * f(v)
}

/** A separable Gaussian blur, sigma in texels. */
function blur(src: Float32Array, w: number, hgt: number, sigma: number) {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const pass = (a: Float32Array, horizontal: boolean) => {
    const b = new Float32Array(a.length)
    for (let r = 0; r < hgt; r++)
      for (let c = 0; c < w; c++) {
        let s = 0
        let ws = 0
        for (let i = -rad; i <= rad; i++) {
          const cc = horizontal ? c + i : c
          const rr = horizontal ? r : r + i
          if (cc < 0 || rr < 0 || cc >= w || rr >= hgt) continue
          s += a[rr * w + cc] * k[i + rad]
          ws += k[i + rad]
        }
        b[r * w + c] = s / ws
      }
    return b
  }
  return pass(pass(src, true), false)
}
