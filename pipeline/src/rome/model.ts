/**
 * The model of Rome (DESIGN.md §7.7): what the engine needs to build the city as a
 * museum model when the map is zoomed right into it — build/rome/ground.png,
 * model.json and model.bin.
 *
 * The model is an illustration, and the one place the atlas draws what no source
 * records (DESIGN.md §1, the exception in §7.7). It keeps the two apart:
 *
 * - **What is known** is built from the records: each monument's outline raised by
 *   its design (designs.ts: its type, size, columns and stairs, from its sources),
 *   the bridges, and the Servian Wall on its course (servian.ts, `WALL`). A temple with no
 *   design of its own is a typical one (`DEFAULT_TEMPLE`).
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
import polygonClipping from 'polygon-clipping'
import sharp from 'sharp'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'
import { excavatedPieces, type StreetLine } from './streets.ts'
import { layCity, LOT_KIND, ROOF } from './city.ts'
import { COURSES, layCourse } from './aqueducts.ts'
import { DEFAULT_TEMPLE, DESIGNS, type Design, planeBearing } from './designs.ts'
import { type Course, STEP_M } from './servian.ts'

type Pt = [number, number]

export interface ModelInput {
  out: string
  grid: { x0: number; y1: number; width: number; height: number; texel: number }
  raw: Float32Array
  smooth: Float32Array
  circuit: Pt[]
  /** The wall's course and gates (servian.ts). */
  course: Course
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
}

/**
 * Temples placed by a point (the records with no outline): the size of one, width by
 * length in metres, a typical mid-Republican temple on its podium, until its design
 * (designs.ts) gives its own. Its point and the slope place it.
 */
const POINT_TEMPLE: {
  size: [number, number]
  sizes: Record<string, [number, number]>
  /** Temples whose remains fix how they lie: the direction their fronts face, radians from east. */
  facing: Record<string, number>
} = {
  size: [14, 24],
  sizes: {},
  facing: {},
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
  'aedes-apollinis': [
    {
      from: -33,
      stone: 'marble',
      why: "Sosius's rebuilding from about 34 BCE: a superstructure of Luna marble, coloured marbles within (DAR, Apollo Medicus Sosianus)",
    },
  ],
  'aedes-herculis-olivarii': [
    {
      from: -100000,
      stone: 'marble',
      why: 'its colonnade and cella of Pentelic marble, "the blocks of the cella being solid" (Platner & Ashby, Portunium, p. 430)',
    },
  ],
  'sepulcrum-bibuli': [
    {
      from: -100000,
      stone: 'travertine',
      why: 'travertine for the visible parts, tufa behind (Platner & Ashby, Sepulcrum Bibuli, p. 477)',
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

/** The Arx's summit and the Asylum, lon/lat and radius, metres: open ground, no houses. */
const CAPITOL_OPEN: [[number, number], number][] = [
  [[12.4835, 41.8948], 60],
  [[12.48266, 41.8933], 38],
]
/** The Asylum's two groves, lon/lat: trees towards each summit. */
const ASYLUM_GROVES: [number, number][] = [
  [12.48238, 41.89352],
  [12.48288, 41.89308],
]

/**
 * A levelled site (`bakeModel`): the walk round a building at its level, how far
 * beyond it the ground eases back, and how deep a cut, metres, needs a retaining wall.
 */
const SITE = { walk: 3, ease: 10, cut: 1.2 }

/**
 * The Servian Wall as it was built (DESIGN.md §7.7), metres:
 * - `thick`: the curtain of squared Grotta Oscura tufa, 3.5–4 m thick where it stands
 *   free (Termini; the Via di Sant'Anselmo on the Aventine), laid dry in courses of two
 *   Roman feet (Platner & Ashby, Murus Servii Tullii; Middleton 1892).
 * - `walk`: its wall-walk over the ground, where it stands free or crowns a hill's
 *   brow; nothing of its top survives anywhere, but the Aventine's stands 13–15 m on
 *   its outer face and the stretches across the valleys 8–10 m (Lanciani 1897).
 * - `parapet` over the walk, with battlements `merlon` wide every `bay`: a reasonable
 *   reconstruction, not a survival. Strabo (5.3.7) has the agger carry "a wall with
 *   towers", and the city's walls and towers were repaired in 353, 217 and 212 BCE
 *   (Livy 7.20, 22.8, 25.7).
 * - `clear`: how far the generated houses keep from its inner face, and `clearOut`
 *   from its outer face, where the ground at its foot was kept open.
 * - `gate`: half a gatehouse's length along the wall, where the curtain stops.
 * - `tower`: the agger's towers, how far apart (the spacing is not recorded).
 */
const WALL = {
  thick: 3.8,
  walk: 7.5,
  parapet: 1.8,
  merlon: 1.6,
  bay: 2.8,
  clear: 3,
  clearOut: 12,
  gate: 8,
  tower: 36,
}
/**
 * The agger on the Esquiline plateau, from the Porta Collina to the Porta Esquilina,
 * metres: in front of the wall a `berm`, then a ditch `ditch` wide and `depth` deep
 * ("more than a hundred feet broad where it is narrowest, and thirty feet deep",
 * Dionysius 9.68; the section Lanciani saw cut in 1861–62 agrees); behind it a bank of
 * earth `bank` high with a flat top `top` wide, sloping down to the city over `run`
 * (Middleton 1892, fig. 18; Platner & Ashby, Agger). It runs out over `ends` at the
 * gates at its ends; each of its gates crosses the ditch on a causeway `causeway`
 * wide either side of its road, and cuts through the bank `cut` wide.
 */
const AGGER = {
  berm: 4,
  ditch: 30,
  depth: 9,
  bank: 10,
  top: 13,
  run: 16,
  ends: 40,
  causeway: 7,
  cut: 5,
}

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
    /** Its design (designs.ts), placed: centre, size across and along, and bearing once known. */
    design?: {
      d: Design
      centre: Pt
      size: Pt
      bearing: number | null
      axis: Pt
      drop: number
    }
    /** Whether it keeps the generated houses off its footprint (all but the island). */
    clear?: boolean
    /** More that its design needs from the ground: the island's shore, a bridge's banks. */
    extra?: Record<string, unknown>
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
  // Temples the records place by a point only: a temple of a standard size (or the
  // size Platner & Ashby give) at the point, its long axis down the slope and its
  // front facing downhill, as a temple on a hillside faced out over the valley.
  // One that would stand on a surveyed monument, or in the river, is left out.
  const pointFacing = new Map<string, Pt>()
  const outlined = new Set(m.outlines.map((o) => o.id))
  const doubts: string[] = []
  for (const p of m.places.values()) {
    if (p.kind !== 'temple' || p.within !== 'roma' || outlined.has(p.id)) continue
    // One whose design places and sizes it is built from that (below).
    if (DESIGNS[p.id]?.size) continue
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

  // Each building with a design (designs.ts) is built as itself: placed by its
  // outline's box unless the design gives its centre, size or bearing, and standing
  // on the footprint its design gives it, which keeps the houses off.
  const designed: [string, Design][] = [
    ...Object.entries(DESIGNS),
    // Every other temple of the plan is drawn as a typical one.
    ...monuments
      .filter((mo) => mo.kind === 'temple' && !DESIGNS[mo.id])
      .map((mo) => [mo.id, DEFAULT_TEMPLE] as [string, Design]),
  ]
  for (const [id, d] of designed) {
    const p = m.places.get(id)
    if (!p) throw new Error(`designs.ts: no place "${id}"`)
    const own = monuments.filter((mo) => mo.id === id)
    const largest = own
      .map((mo) => mo.rings[0])
      .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0]
    const box = largest ? orientedBox(largest) : null
    const centre: Pt = d.at
      ? projection.forward(...d.at)
      : box
        ? [box.cx, box.cy]
        : projection.forward(...p.location)
    const bearing =
      d.bearing !== undefined ? planeBearing(d.bearing, d.at ?? p.location) : null
    let size: Pt | undefined = d.size
    if (!size && box) {
      // The box's long side runs along the building unless its front is on it.
      const across =
        bearing !== null &&
        Math.abs(Math.sin(bearing - Math.atan2(box.axis[0], box.axis[1]))) > 0.7
      size = across ? [box.long, box.short] : [box.short, box.long]
    }
    if (!size) throw new Error(`designs.ts: ${id} has no outline, so needs a size`)
    // Its depth runs along the bearing, or the box's long axis until the front is known.
    const axis: Pt = bearing !== null ? [Math.sin(bearing), Math.cos(bearing)] : box!.axis
    if (d.atLocal) {
      // `at` is a point of it off its centre: across (to the right of its front) and along.
      const [du, dv] = d.atLocal
      centre[0] -= axis[1] * du + axis[0] * dv
      centre[1] -= -axis[0] * du + axis[1] * dv
    }
    const ring = rect(
      centre[0],
      centre[1],
      size[0],
      size[1],
      Math.atan2(axis[1], axis[0]) - Math.PI / 2,
    )
    const rings =
      d.at || d.size || !largest ? [ring] : own.find((mo) => mo.rings[0] === largest)!.rings
    const kind = own[0]?.kind ?? p.kind
    for (const mo of own) monuments.splice(monuments.indexOf(mo), 1)
    // The island's own shore, for its embankment: the hole in the river the island is
    // (OpenStreetMap's outline of it is the modern embankments, wider than its land).
    const shore =
      kind === 'island'
        ? m.riverRings
            .filter((r) => inRing(centre, r))
            .sort((a, b) => Math.abs(ringArea(a)) - Math.abs(ringArea(b)))[0]
        : undefined
    // A bridge runs from bank to bank along its axis: walked out from its centre until
    // the ground is dry, so it meets the ground at both ends whatever its design's
    // length (the river's line here is OpenStreetMap's, not the Republic's).
    let span: { a: Pt; b: Pt } | null = null
    if (kind === 'bridge') {
      // The water along its axis, 0.5 m at a time out to 250 m either side; runs of it
      // joined across dry gaps under 45 m (a pier, an islet in the river's line, or its line broken under a
      // bridge); the run nearest its centre is what it crosses.
      const pt = (t: number): Pt => [centre[0] + axis[0] * t, centre[1] + axis[1] * t]
      const runs: [number, number][] = []
      for (let t = -250; t <= 250; t += 0.5) {
        if (sample(m.water, ...pt(t), 99) >= 0) continue
        const last = runs[runs.length - 1]
        if (last && t - last[1] < 45) last[1] = t
        else runs.push([t, t])
      }
      const gap = (r: [number, number]) =>
        r[0] <= 0 && r[1] >= 0 ? 0 : Math.min(Math.abs(r[0]), Math.abs(r[1]))
      const run = runs.sort((a, b) => gap(a) - gap(b))[0] ?? [-size[1] / 2, size[1] / 2]
      span = { a: pt(run[0]), b: pt(run[1]) }
      const L = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1])
      const mid: Pt = [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2]
      if (Math.abs(L - size[1]) / size[1] > 0.25)
        console.log(
          `model: ${id}: the water here is ${L.toFixed(0)} m across, its design ${size[1].toFixed(0)} m; its arches are scaled to it`,
        )
      centre[0] = mid[0]
      centre[1] = mid[1]
      size = [size[0], L]
    }
    // A bridge stands on the water; the rest on the lowest ground under them, or, where
    // the design says it is a terrace built out on a slope, its highest or middle
    // ground, its foundations running down to the lowest.
    const wet = kind === 'bridge' || kind === 'island'
    const heights = rings[0].map(([x, y]) => at(x, y))
    const low = Math.min(...heights)
    const level =
      d.level === 'top'
        ? Math.max(...heights)
        : d.level === 'mean'
          ? heights.reduce((a, b) => a + b, 0) / heights.length
          : low
    monuments.push({
      id,
      kind,
      rings,
      base: wet ? waterLevel - 2 : level,
      body: 0,
      roof: 'flat',
      podium: 0,
      approx: !outlined.has(id) || own.some((mo) => mo.approx),
      design: { d, centre, size, bearing, axis, drop: wet ? 0 : level - low },
      // The island keeps no houses off: its embankment is round its shore.
      clear: kind !== 'island',
      extra: {
        ...(shore && {
          // Each shore point with the island's ground a few metres inland, over its base.
          outline: shore.map(([x, y]) => {
            const [dx, dy] = [centre[0] - x, centre[1] - y]
            const l = Math.hypot(dx, dy) || 1
            return [
              round(x),
              round(y),
              round(at(x + (dx / l) * 5, y + (dy / l) * 5) - (waterLevel - 2)),
            ]
          }),
        }),
        // A bridge's banks: the ground a few metres onto the land at each end, over its
        // base, where its deck comes down to meet it.
        ...(span && {
          banks: [-1, 1].map((s) => {
            const e = s < 0 ? span!.a : span!.b
            return round(
              at(e[0] + axis[0] * s * 8, e[1] + axis[1] * s * 8) - (waterLevel - 2),
            )
          }),
        }),
      },
    })
  }

  // --- the wall's course ----------------------------------------------------------------
  const ring = m.course.ring
  const N = ring.length - 1
  const pt = (i: number) => ring[((i % N) + N) % N]
  /** Outward, away from the city: the course runs counter-clockwise, the city on its left. */
  const outward = (i: number): Pt => {
    const [p, q] = [pt(i - 1), pt(i + 1)]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(q[1] - p[1]) / L, -(q[0] - p[0]) / L]
  }
  // A building placed only roughly (by its record's point, or a disputed site) that
  // would stand on the wall is moved in off it, the wall being the better known.
  for (const mo of monuments) {
    if (!mo.approx || mo.clear === false) continue
    const r0 = mo.rings[0]
    const hits = ring.map((q, i) => (inRing(q, r0) ? i : -1)).filter((i) => i >= 0)
    if (!hits.length) continue
    const n = outward(hits[Math.floor(hits.length / 2)])
    let shift = 0
    const moved = (d: number) =>
      mo.rings.map((r) => r.map(([x, y]) => [x - n[0] * d, y - n[1] * d] as Pt))
    while (
      shift < 60 &&
      ring.some(
        (q) =>
          inRing(q, moved(shift)[0]) ||
          distToRing(q, moved(shift)[0]) < WALL.thick / 2 + WALL.clear,
      )
    )
      shift += 1
    mo.rings = moved(shift)
    if (mo.design)
      mo.design.centre = [
        mo.design.centre[0] - n[0] * shift,
        mo.design.centre[1] - n[1] * shift,
      ]
    mo.base = lowest(mo.rings)
    console.log(`model: ${mo.id} moved ${shift} m in off the wall`)
  }

  // --- the sites, levelled -----------------------------------------------------------
  // A Roman building stood on ground cut and filled level for it — Caesar's forum cut
  // into the Capitol's slope behind a wall of peperino 12 m high (Platner & Ashby,
  // Forum Iulium, p. 227) — and the ground under the model is today's, smoothed. So
  // each designed building's site is levelled into the ground everything stands on
  // (DESIGN.md §7.7): the larger first, so a temple in a forum stands on the forum.
  // Round each, a walk `SITE.walk` wide at its level; beyond it, where the ground is
  // near the level it eases back over `SITE.ease`; where the site is cut deep into
  // rising ground a retaining wall of tufa holds it back, and where it is built out
  // over falling ground its own walls and podium stand on foundations to the ground.
  const yearsOf = (id: string) => dates(m.places.get(id)).years
  const retaining: { id: string; base: number; pts: number[][]; years: number[] }[] = []
  const sites = monuments
    .filter((mo) => mo.design && mo.clear !== false && mo.kind !== 'bridge')
    .sort((a, b) => Math.abs(ringArea(b.rings[0])) - Math.abs(ringArea(a.rings[0])))
  for (const mo of sites) {
    const ring = mo.rings[0]
    const d = mo.design!.d
    const [x0, y0, x1, y1] = bounds(ring, SITE.walk + SITE.ease + g.texel)
    // Its level: of the ground under it now (the larger sites round it already level).
    const under: number[] = []
    for (let y = y0; y <= y1; y += g.texel)
      for (let x = x0; x <= x1; x += g.texel) if (inRing([x, y], ring)) under.push(at(x, y))
    if (!under.length) under.push(...ring.map(([x, y]) => at(x, y)))
    const lowUnder = Math.min(...under)
    // Cut and fill balanced, unless the design says it was cut in (`low`) or built out
    // as a terrace (`top`).
    const level =
      d.level === 'top'
        ? Math.max(...under)
        : d.level === 'low'
          ? lowUnder
          : under.reduce((a, b) => a + b, 0) / under.length
    const before = new Float32Array(ground)
    const c0 = Math.max(0, Math.floor((x0 - g.x0) / g.texel))
    const c1 = Math.min(g.width - 1, Math.ceil((x1 - g.x0) / g.texel))
    const r0 = Math.max(0, Math.floor((g.y1 - y1) / g.texel))
    const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - y0) / g.texel))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p: Pt = [g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel]
        const k = r * g.width + c
        if (m.water[k] < 4) continue
        const dist = inRing(p, ring) ? 0 : distToRing(p, ring)
        if (dist <= SITE.walk) ground[k] = level
        else if (dist < SITE.walk + SITE.ease) {
          // Eased back where the ground is near the level; left where it is not, for the
          // wall or the building's own foundations to meet it.
          const off = before[k] - level
          const near = Math.min(1, Math.max(0, 1 - (Math.abs(off) - 1) / 2))
          const t = 1 - (dist - SITE.walk) / SITE.ease
          ground[k] = before[k] - off * t * near
        }
      }
    mo.base = level
    mo.design!.drop = Math.max(mo.design!.drop, level - lowUnder)
    // Retaining walls: along each edge, where the ground just beyond the walk stands
    // more than `SITE.cut` over the level.
    const outward = ringArea(ring) > 0 ? -1 : 1
    let run: number[][] = []
    const flush = () => {
      if (run.length > 1)
        retaining.push({ id: mo.id, base: round(level), pts: run, years: yearsOf(mo.id) })
      run = []
    }
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i], ring[i + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.5) continue
      const n: Pt = [((b[1] - a[1]) / L) * outward, (-(b[0] - a[0]) / L) * outward]
      const steps = Math.max(1, Math.round(L / 3))
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const w: Pt = [q[0] + n[0] * (SITE.walk - 0.6), q[1] + n[1] * (SITE.walk - 0.6)]
        const beyond = sample(
          before,
          q[0] + n[0] * (SITE.walk + 3),
          q[1] + n[1] * (SITE.walk + 3),
          level,
        )
        if (beyond - level > SITE.cut)
          run.push([round(w[0]), round(w[1]), round(beyond - level + 0.7)])
        else flush()
      }
      flush()
    }
  }

  // Known buildings standing on one another in the same years are a mistake in their
  // placing: the build says so.
  for (let i = 0; i < monuments.length; i++)
    for (let j = i + 1; j < monuments.length; j++) {
      const [a, b] = [monuments[i], monuments[j]]
      if (a.id === b.id || a.clear === false || b.clear === false) continue
      const [ya, yb] = [dates(m.places.get(a.id)).years, dates(m.places.get(b.id)).years]
      if (ya[1] < yb[0] || yb[1] < ya[0]) continue
      const inter = polygonClipping.intersection([a.rings[0]], [b.rings[0]])
      const area = inter.reduce((s, poly) => s + Math.abs(ringArea(poly[0] as Pt[])), 0)
      const least = Math.min(Math.abs(ringArea(a.rings[0])), Math.abs(ringArea(b.rings[0])))
      if (area > least * 0.04)
        console.log(
          `model: ${a.id} and ${b.id} overlap by ${Math.round((area / least) * 100)}%`,
        )
    }

  // --- the agger ---------------------------------------------------------------------
  // Where the wall crossed the flat plateau with no brow to stand on, its ditch was
  // dug in front of it and its earth heaped behind (`AGGER`): cut into the ground
  // everything stands on, and raised on it, so the houses and trees keep off them.
  const [a0, a1] = m.course.agger
  const aggerGates = m.course.gates.filter((gt) => gt.i >= a0 && gt.i <= a1)
  const g0 = ring.map(([x, y]) => at(x, y))
  {
    const pad = WALL.thick / 2 + AGGER.berm + AGGER.ditch + AGGER.top + AGGER.run + 8
    const span = ring.slice(a0, a1 + 1)
    const [bx0, by0, bx1, by1] = bounds(span, pad)
    const before = new Float32Array(ground)
    for (let y = by0; y <= by1; y += g.texel)
      for (let x = bx0; x <= bx1; x += g.texel) {
        const k = idx(x, y)
        if (k < 0) continue
        let best = { i: a0, d: Infinity }
        for (let i = a0; i <= a1; i++) {
          const d = Math.hypot(ring[i][0] - x, ring[i][1] - y)
          if (d < best.d) best = { i, d }
        }
        const i = best.i
        const n = outward(i)
        const across = (x - ring[i][0]) * n[0] + (y - ring[i][1]) * n[1]
        // Along the wall, whose direction is the outward normal turned left.
        const along = Math.abs(-(x - ring[i][0]) * n[1] + (y - ring[i][1]) * n[0])
        if (along > STEP_M) continue
        const fromEnd = Math.min(i - a0, a1 - i) * STEP_M
        const fromGate = Math.min(...aggerGates.map((gt) => Math.abs(i - gt.i) * STEP_M))
        const ends = smoothstep(0, AGGER.ends, fromEnd)
        const e = across - WALL.thick / 2 - AGGER.berm
        if (e > 0 && e < AGGER.ditch) {
          const w = ends * smoothstep(AGGER.causeway, AGGER.causeway + 10, fromGate)
          const depth = Math.min(AGGER.depth, e, AGGER.ditch - e)
          ground[k] = Math.min(before[k], before[k] - (before[k] - (g0[i] - depth)) * w)
        }
        const f = -across - WALL.thick / 2
        if (f > -1 && f < AGGER.top + AGGER.run) {
          const w = ends * smoothstep(AGGER.cut, AGGER.cut + 12, fromGate)
          const h =
            f < AGGER.top
              ? AGGER.bank
              : AGGER.bank * (1 - smoothstep(AGGER.top, AGGER.top + AGGER.run, f))
          ground[k] = Math.max(before[k], before[k] + (g0[i] + h - before[k]) * w)
        }
      }
  }

  const png = new Uint8Array(g.width * g.height * 4)
  for (let i = 0; i < ground.length; i++) {
    const cm = Math.max(0, Math.min(65535, Math.round(ground[i] * 100)))
    png[i * 4] = cm >> 8
    png[i * 4 + 1] = cm & 255
    png[i * 4 + 3] = 255
  }

  // --- the wall ------------------------------------------------------------------------
  // Along its course, every `STEP_M`: the ground just outside and just inside its
  // faces, which each face runs down to, and the height of its walk. It stands `walk`
  // over its ground where it stands free, and crowning a brow, at least a little over
  // the hill behind it; on the agger its walk is the bank's top. Smoothed along the
  // wall, so it rises and falls with the ground in long runs, not a step at a time.
  const face = WALL.thick / 2 + 1
  const sides = ring.slice(0, N).map((p, i) => {
    const n = outward(i)
    return {
      out: at(p[0] + n[0] * face, p[1] + n[1] * face),
      in: at(p[0] - n[0] * face, p[1] - n[1] * face),
      mid: at(p[0], p[1]),
    }
  })
  const rawWalk = sides.map((sd) => Math.max(sd.mid + WALL.walk, sd.in + 0.4))
  const walk = smoothCyclic(rawWalk, 3).map((v, i) => Math.max(v, sides[i].mid + 5.5))
  const nearGate = (i: number, half: number) =>
    m.course.gates.some((gt) => {
      const d = Math.min(Math.abs(i - gt.i), N - Math.abs(i - gt.i)) * STEP_M
      return d < half
    })
  // The curtain in runs between the gatehouses.
  const wall: { pts: number[][]; agger: boolean }[] = []
  {
    const start = m.course.gates[0].i
    let run: number[][] = []
    let runAgger = false
    for (let k = 0; k <= N; k++) {
      const i = (start + k) % N
      if (nearGate(i, WALL.gate) || k === N) {
        if (run.length > 1) wall.push({ pts: run, agger: runAgger })
        run = []
        runAgger = false
        continue
      }
      const p = ring[i]
      run.push([
        round(p[0]),
        round(p[1]),
        round(sides[i].out),
        round(sides[i].in),
        round(walk[i]),
      ])
      runAgger ||= i >= a0 && i <= a1
    }
  }
  const gates = m.course.gates.map((gt) => ({
    name: gt.name,
    at: gt.at.map((v) => round(v)),
    out: outward(gt.i).map((v) => Math.round(v * 1e4) / 1e4),
    ground: round(sides[gt.i % N].mid),
    walk: round(walk[gt.i % N]),
    surveyed: gt.surveyed,
  }))
  // Towers along the agger, clear of its gates.
  const towers: { at: number[]; out: number[]; ground: number; walk: number }[] = []
  for (let i = a0; i <= a1; i += Math.round(WALL.tower / STEP_M)) {
    if (nearGate(i, WALL.gate + 16)) continue
    towers.push({
      at: ring[i].map((v) => round(v)),
      out: outward(i).map((v) => Math.round(v * 1e4) / 1e4),
      ground: round(sides[i].out),
      walk: round(walk[i]),
    })
  }
  // Where the wall and its agger lie: no house, street or tree on them. Inside, the
  // wall's own width and, on the agger, the bank behind it; outside, its foot and the
  // agger's ditch.
  const wallGrid = new SegmentGrid(
    ring.slice(0, N).map((p, i) => [p, pt(i + 1)] as [Pt, Pt]),
    40,
  )
  const aggerGrid = new SegmentGrid(
    ring.slice(a0, a1).map((p, i) => [p, ring[a0 + i + 1]] as [Pt, Pt]),
    40,
  )
  const aggerBack = WALL.thick / 2 + AGGER.top + AGGER.run * 0.7
  const aggerFront = WALL.thick / 2 + AGGER.berm + AGGER.ditch + 4
  const onWall = (p: Pt) => {
    const inside = inRing(p, m.circuit)
    if (wallGrid.nearest(p).d < WALL.thick / 2 + (inside ? WALL.clear : WALL.clearOut))
      return true
    return aggerGrid.nearest(p).d < (inside ? aggerBack : aggerFront)
  }
  // The same, as outlines the generated city (city.ts) keeps off: the wall's width,
  // and on the agger the bank behind it.
  const wallBands: Pt[][] = ring.slice(0, N).map((p, i) => {
    const q = pt(i + 1)
    const n = outward(i)
    const back = i >= a0 && i < a1 ? aggerBack - WALL.clear : WALL.thick / 2
    const front = WALL.thick / 2
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const c: Pt = [
      mid[0] + (n[0] * (front - back)) / 2,
      mid[1] + (n[1] * (front - back)) / 2,
    ]
    return rect(
      c[0],
      c[1],
      front + back,
      Math.hypot(q[0] - p[0], q[1] - p[1]) + 1,
      Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.PI / 2,
    )
  })
  // Known buildings on the wall's line: the build says so.
  for (const mo of monuments) {
    if (mo.clear === false || mo.kind === 'bridge') continue
    const hit = ring.find((q) => inRing(q, mo.rings[0]))
    if (hit) console.log(`model: the wall runs through ${mo.id}`)
  }

  // --- where the generated city may stand ------------------------------------------------
  const inCircuit = (x: number, y: number) => inRing([x, y], m.circuit)
  const streetGrid = new SegmentGrid(
    m.streets.flatMap((l) => l.pts.slice(1).map((q, i) => [l.pts[i], q] as [Pt, Pt])),
    40,
  )
  // Monuments standing from before the window keep houses off their sites for good;
  // later ones take their site from the houses in the year they were begun.
  const clearing = monuments.filter((mo) => mo.clear !== false)
  const early = clearing.filter((mo) => yearsOf(mo.id)[0] <= WINDOW[0])
  const late = clearing.filter((mo) => yearsOf(mo.id)[0] > WINDOW[0])
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
  const open: Pt[][] = []
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
  // Nobody lived on the Capitol's summits: "ne quis patricius in arce aut Capitolio
  // habitaret" (Livy 6.20.13), and in practice both were sacred ground — the Area
  // Capitolina, the Arx with its Auguraculum and Juno Moneta — and so was the Asylum
  // between them, "inter duos lucos"; houses climbed the slopes only (Platner & Ashby,
  // Arx and Asylum, p. 55; Tacitus, Histories 3.71).
  // The Forum Boarium, the cattle market by the river: its limits are not known, so
  // only the ground between its temples and the Ara Maxima is kept open (Platner &
  // Ashby, Forum Boarium, pp. 224–225).
  const boarium = [
    'aedes-portuni',
    'aedes-herculis-olivarii',
    'ara-maxima-herculis',
    'aedes-fortunae-foro-boario',
    'aedes-matris-matutae',
  ]
    .map((id) => m.places.get(id))
    .filter((p): p is Place => !!p)
    .map((p) => projection.forward(...p.location))
  if (boarium.length > 2) open.push(hull(boarium))
  // Before a precinct's gateway the ground is kept open, so it does not open onto a
  // house: 20 m out, a little wider than the gate.
  for (const mo of monuments) {
    const d = mo.design
    const gate = (d?.d as Record<string, unknown> | undefined)?.gate as number | undefined
    if (!d || !gate || !d.bearing) continue
    const sides = ((d.d as Record<string, unknown>).sides as boolean[] | undefined) ?? [
      true,
      true,
      true,
      true,
    ]
    const f: Pt = [Math.sin(d.bearing), Math.cos(d.bearing)]
    const r: Pt = [f[1], -f[0]]
    // Each side left without a portico has the gate: front, right, back, left.
    const outs: Pt[] = [f, r, [-f[0], -f[1]], [-r[0], -r[1]]]
    const half = [d.size[1] / 2, d.size[0] / 2, d.size[1] / 2, d.size[0] / 2]
    sides.forEach((has, i) => {
      if (has) return
      const n = outs[i]
      const c: Pt = [
        d.centre[0] + n[0] * (half[i] + 10),
        d.centre[1] + n[1] * (half[i] + 10),
      ]
      open.push(rect(c[0], c[1], gate + 8, 20, Math.atan2(n[1], n[0]) - Math.PI / 2))
    })
  }
  // Each is the hilltop round its point: out to `r`, as far as the ground stays
  // within a few metres of the top, so the clearing follows the hill.
  for (const [c, r] of CAPITOL_OPEN) {
    const [cx, cy] = projection.forward(...c)
    let top = -Infinity
    for (let a = 0; a < 24; a++)
      for (let d = 0; d <= r; d += 4)
        top = Math.max(
          top,
          at(
            cx + Math.cos((a / 24) * Math.PI * 2) * d,
            cy + Math.sin((a / 24) * Math.PI * 2) * d,
          ),
        )
    open.push(
      Array.from({ length: 32 }, (_, k) => {
        const a = (k / 32) * Math.PI * 2
        let d = 12
        while (
          d < r &&
          at(cx + Math.cos(a) * (d + 3), cy + Math.sin(a) * (d + 3)) > top - 9
        )
          d += 3
        return [cx + Math.cos(a) * d, cy + Math.sin(a) * d] as Pt
      }),
    )
  }
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
    open.some((o) => inRing(p, [...o, o[0]]))

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
    if (onWall(p)) return false
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
    gates: m.course.gates.map((gt) => gt.at),
    streets: m.streets,
    pieces: excavatedPieces(),
    forum: forumHull,
    squares: open,
    monuments: [...early.map((mo) => mo.rings[0]), ...aqueductBands, ...wallBands],
    at,
    slopeAt,
    wet: (x, y) => sample(m.water, x, y, -1) < 6,
    toRiver: (x, y) => Math.min(...m.riverRings.map((r) => distToRing([x, y], r))),
    palatine: ((p) => p && projection.forward(...p.location))(
      m.places.get('mons-palatinus'),
    ),
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
      const fromWall = wallGrid.nearest(p).d
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
        insideMonument(p) ||
        onWall(p)
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
    for (let k = 0; k + 1 < w.pts.length; k++) {
      const [p, q] = [w.pts[k], w.pts[k + 1]]
      cast(
        [p.slice(0, 2) as Pt, q.slice(0, 2) as Pt],
        Math.max(p[4], q[4]) + WALL.parapet - Math.min(p[2], q[2]),
      )
    }
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

  for (const g of ASYLUM_GROVES) {
    const [gx, gy] = projection.forward(...g)
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4
      const rr = 3 + (k % 3) * 5
      courtyardTrees.push([gx + Math.cos(a) * rr, gy + Math.sin(a) * rr])
    }
  }
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
        design: mo.design && {
          ...placedDesign(mo.design, facing(mo)),
          ...mo.extra,
          // The water's surface over its ground, for what stands in the river.
          water: round(waterLevel - mo.base),
        },
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
      // The Servian Wall (`WALL`): its curtain in runs between the gates, each point
      // x, y, the ground outside and inside its faces and its walk; its gates, each
      // with the way out of the city; the agger's towers; and its build.
      wall,
      gates,
      towers,
      wallBuild: WALL,
      // The retaining walls round the levelled sites: each a line along its edge at the
      // site's level, with the wall's height at each point, and its monument's years.
      retaining,
      // The aqueducts, laid out (aqueducts.ts): each channel's years, bottom to top,
      // and the course in runs of arcade, wall and shafts.
      aqueducts: aqueducts.map(({ course, runs }) => ({
        id: course.id,
        size: course.size,
        channels: course.channels.map((ch) => {
          const { burnt: _, ...d } = dates(m.places.get(ch.id))
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
    `model: ${monuments.length} buildings known, ${city.mains.length} main streets and ${city.locals.length} local ones generated, ${city.blocks} blocks, ${fab.length / FABRIC_STRIDE} buildings, ${tre.length / 4} trees, the wall in ${wall.length} runs with ${gates.length} gates and ${towers.length} towers, water at ${waterLevel.toFixed(1)} m`,
  )
  // The footprints drawn for monuments with no surveyed outline, for picking.
  // The wall is picked along its course: a band its width, out one side and back.
  const wallPick: Pt[] = [
    ...ring.slice(0, N).map((p, i) => {
      const n = outward(i)
      return [p[0] + n[0] * face, p[1] + n[1] * face] as Pt
    }),
    ...ring
      .slice(0, N)
      .map((p, i) => {
        const n = outward(i)
        return [p[0] - n[0] * face, p[1] - n[1] * face] as Pt
      })
      .reverse(),
  ]
  const drawn = [
    ...monuments.filter((mo) => mo.approx).map((mo) => ({ id: mo.id, ring: mo.rings[0] })),
    ...(m.places.has('murus-servii-tullii')
      ? [{ id: 'murus-servii-tullii', ring: [...wallPick, wallPick[0]] }]
      : []),
    // An aqueduct's arcade opens the aqueduct it was built for.
    ...aqueducts.flatMap(({ course }, n) =>
      aqueductBands
        .filter((_, k) => bandOf[k] === n)
        .map((ring) => ({ id: course.id, ring })),
    ),
  ]
  // The footprints the streets are kept off (plate.ts): the known buildings, but not
  // the bridges and the island they cross, nor the open squares.
  const covered = monuments
    .filter(
      (mo) =>
        mo.clear !== false &&
        mo.kind !== 'bridge' &&
        mo.design?.d.model !== 'square' &&
        mo.design?.d.model !== 'quay',
    )
    .map((mo) => mo.rings[0])
  return { png, waterLevel, shadow: soft, drawn, mains: city.mains, covered }
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
  if (!p) return { years: [-10000, 10000], unfinished: null, burnt: false }
  const weak = p.condition.filter((c) => c.value !== 'standing')
  return {
    years: [p.from.year, p.to.year],
    unfinished: weak.length
      ? [Math.min(...weak.map((c) => c.from.year)), Math.max(...weak.map((c) => c.to.year))]
      : null,
    // A shell left by fire, not works in progress, when fire is all it suffered.
    burnt: weak.length > 0 && weak.every((c) => c.value === 'burnt'),
  }
}

/**
 * A design as the engine takes it (ModelLayer `Monument.design`): its own fields, and
 * where it stands — centre and size in plane metres, and the way its front faces,
 * radians clockwise from north: the design's, or its axis towards the point it
 * faces (`facing`).
 */
function placedDesign(
  p: { d: Design; centre: Pt; size: Pt; bearing: number | null; axis: Pt; drop: number },
  faces: Pt,
) {
  const {
    why: _,
    at: __,
    size: ___,
    bearing: ____,
    atLocal: _____,
    level: ______,
    ...fields
  } = p.d
  let bearing = p.bearing
  if (bearing === null) {
    const toward =
      (faces[0] - p.centre[0]) * p.axis[0] + (faces[1] - p.centre[1]) * p.axis[1]
    const s = toward < 0 ? -1 : 1
    bearing = Math.atan2(p.axis[0] * s, p.axis[1] * s)
  }
  return {
    ...fields,
    centre: p.centre.map((v) => round(v)),
    size: p.size.map((v) => round(v)),
    bearing: Math.round(bearing * 1e4) / 1e4,
    // How far its foundations run below its ground to the lowest ground under it.
    drop: round(p.drop),
  }
}

// --- geometry helpers ---------------------------------------------------------------------

function ringArea(r: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}

/** The smallest rectangle round a ring, by its edges' directions: centre, its long axis (a unit vector), and its sides. */
function orientedBox(r: Pt[]) {
  let best = { area: Infinity, cx: 0, cy: 0, axis: [0, 1] as Pt, long: 0, short: 0 }
  for (let i = 0; i + 1 < r.length; i++) {
    const a = Math.atan2(r[i + 1][1] - r[i][1], r[i + 1][0] - r[i][0])
    const [c, s] = [Math.cos(a), Math.sin(a)]
    const us = r.map(([x, y]) => x * c + y * s)
    const vs = r.map(([x, y]) => -x * s + y * c)
    const [u0, u1, v0, v1] = [
      Math.min(...us),
      Math.max(...us),
      Math.min(...vs),
      Math.max(...vs),
    ]
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2]
      const alongU = u1 - u0 >= v1 - v0
      best = {
        area,
        cx: mu * c - mv * s,
        cy: mu * s + mv * c,
        axis: alongU ? [c, s] : [-s, c],
        long: Math.max(u1 - u0, v1 - v0),
        short: Math.min(u1 - u0, v1 - v0),
      }
    }
  }
  return best
}

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

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Values round a ring smoothed along it, sigma in points. */
function smoothCyclic(v: number[], sigma: number) {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const sum = k.reduce((a, b) => a + b, 0)
  return v.map((_, i) => {
    let s = 0
    for (let o = -rad; o <= rad; o++) s += v[(i + o + v.length) % v.length] * k[o + rad]
    return s / sum
  })
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
