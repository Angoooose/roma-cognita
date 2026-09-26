/**
 * The aqueducts of Rome in the window (DESIGN.md §7.7), laid out for the model:
 * each course a line of points with the level of its channel, cut into runs of
 * arcade (piers and arches) where the channel stands high over the ground, solid
 * wall where it is lower, and shafts over the stretches underground.
 */
import { projection } from '@roma-cognita/world'

type Pt = [number, number]

/** An arcade's proportions, metres. */
export interface ArcadeSize {
  span: number
  pier: number
  width: number
  band: number
}

export interface Course {
  id: string
  /**
   * Its channels, bottom to top: each an aqueduct record and the channel's height,
   * and the year it was first carried here (astronomical) if later than its record's.
   */
  channels: { id: string; h: number; from?: number }[]
  size: ArcadeSize
  /**
   * lon/lat, the level of the underside of the lowest channel (metres a.s.l.; NaN to
   * interpolate between its neighbours by distance), and the evidence for the point.
   */
  pts: { at: Pt; level: number; what: string }[]
}

/**
 * Shafts down to an underground channel, one every two actus, 240 feet: 71 m
 * ("putei ... uti inter binos sint actus", Vitruvius 8.6.3). The Augustan boundary
 * stones along the aqueducts stand at the same interval (Ashby 1935, p. 128).
 */
const SHAFT_M = 71
/** Below this clearance, metres, a channel runs on a solid wall; below `under`, underground. */
const CLEAR = { wall: 1, under: 0.3 }

/**
 * The Marcia's arcade, as Ashby measured its Republican work (1935, pp. 131–139):
 * arches of about 5.4 m between piers about 2.4 m wide (7.5 m centre to centre at
 * Le Vignaccie, p. 133; piers of 2.70 m, p. 134, narrowing to 1.60 m, p. 139), piers
 * 3.25 m long across the line, voussoirs 0.65 m deep and a string-course under the
 * channel (p. 139).
 */
const MARCIA_ARCADE: ArcadeSize = { span: 5.4, pier: 2.4, width: 3.25, band: 1.3 }

/**
 * The channel floor stands this far above the underside of the conduit: its bed of
 * masonry. Ashby's levels are of the floor.
 */
const BED_M = 0.3

/**
 * The courses drawn. Only the Marcia's stood above ground near Rome: the Appia and
 * the Anio Vetus ran underground all the way into the city (Frontinus 1.5, 1.6; the
 * Appia's "sixty paces" of arches near the Porta Capena Ashby thinks a mistake,
 * p. 53), so they are not drawn.
 *
 * The Marcia came out of the ground at Capannelle, rose from its substructures onto
 * its arcade, and came in past Roma Vecchia, Tor Fiscale and Porta
 * Furba, along the line of the Via del Mandrione to just outside the (later) Porta
 * Maggiore, north along the line of the (later) Aurelian wall to the Porta
 * Tiburtina, and north-west along the Via Marsala, before going underground to
 * pass under the agger at the Porta Viminalis (Ashby pp. 134–148; Platner & Ashby,
 * Aqua Marcia). From 33 BCE the Tepula and the Julia rode on it, "Julia topmost;
 * next below is Tepula; then Marcia" (Frontinus 1.19); where the Tepula ran before
 * then is not known (Platner & Ashby, Aqua Tepula), so it is not drawn before.
 *
 * Its line between the remains follows OpenStreetMap's reconstruction of the route
 * (relation 17803357, way 1299078816, tagged "approximate"), and the levels are
 * Ashby's surveyed levels of the Marcia's channel floor, interpolated between.
 */
export const COURSES: Course[] = [
  {
    id: 'aqua-marcia',
    channels: [
      // The Marcia's conduit, 1.35–1.65 m high inside (Ashby pp. 131, 139), with its
      // floor and walls; the Tepula's 1.17 m (p. 131), the Julia's 1.60 m (p. 147).
      { id: 'aqua-marcia', h: 1.8 },
      { id: 'aqua-tepula', h: 1.5, from: -32 },
      { id: 'aqua-iulia', h: 1.8 },
    ],
    size: MARCIA_ARCADE,
    pts: [
      // Capannelle, by the seventh milestone of the Via Latina: from here "528 paces on
      // substructures, and the remaining 6,472 paces on arches" (Frontinus 1.7). The
      // channel comes up out of the ground here onto its substructures (Ashby p. 129).
      {
        at: [12.57291, 41.83344],
        level: 67.73 - BED_M,
        what: 'Capannelle, where it comes out of the ground; level 67.73 m (Ashby p. 130); OSM route',
      },
      { at: [12.57248, 41.83481], level: NaN, what: 'OSM route' },
      { at: [12.57145, 41.83804], level: NaN, what: 'OSM route' },
      {
        at: [12.56746, 41.84316],
        level: NaN,
        what: 'OSM route, by Casale Roma Vecchia, where ten original arches survive (Ashby p. 131)',
      },
      { at: [12.55918, 41.85042], level: NaN, what: 'OSM route' },
      { at: [12.55703, 41.85233], level: NaN, what: 'OSM route' },
      { at: [12.55497, 41.85422], level: NaN, what: 'OSM route' },
      { at: [12.55085, 41.85435], level: NaN, what: 'OSM route, Le Vignaccie' },
      { at: [12.54604, 41.85441], level: NaN, what: 'OSM route' },
      {
        at: [12.54394, 41.85614],
        level: NaN,
        what: 'OSM route, the neck of land to Tor Fiscale (Ashby p. 134)',
      },
      { at: [12.54347, 41.85889], level: NaN, what: 'OSM route' },
      {
        at: [12.54137, 41.86221],
        level: 62.1 - BED_M,
        what: 'Tor Fiscale; level 62.10 m (Ashby p. 136 n. 1); OSM route',
      },
      { at: [12.53939, 41.86911], level: NaN, what: 'OSM route' },
      {
        at: [12.539, 41.87122],
        level: NaN,
        what: 'the Marcia at Porta Furba (OSM way 113758266, surveyed remains)',
      },
      {
        at: [12.53531, 41.87282],
        level: NaN,
        what: 'OSM route, the line of the Via del Mandrione',
      },
      {
        at: [12.5304, 41.88308],
        level: 59.4 - BED_M,
        what: 'the Mandrione; level 59.40 m (Ashby p. 139); OSM route',
      },
      { at: [12.52843, 41.88503], level: NaN, what: 'OSM route' },
      { at: [12.52722, 41.88552], level: NaN, what: 'the end of the OSM route' },
      {
        at: [12.516, 41.8912],
        level: 55.77 - BED_M,
        what: "just outside the Porta Maggiore, the pier carrying all three channels in Aurelian's wall; level 55.77 m (Ashby p. 141)",
      },
      {
        at: [12.51029, 41.89747],
        level: 54.146 - BED_M,
        what: 'the Porta Tiburtina (OSM way 345548487), carrying the three channels; level 54.146 m (Ashby p. 147)',
      },
      {
        at: [12.50855, 41.89848],
        level: NaN,
        what: 'the Via Marsala (OSM way 108327352), its piers (Ashby p. 146)',
      },
      { at: [12.50709, 41.89938], level: NaN, what: 'the Via Marsala' },
      {
        at: [12.50443, 41.90109],
        level: 52.57 - BED_M,
        what: 'the Via Marsala at the Via Castro Pretorio; level 52.57 m (Ashby p. 147)',
      },
      {
        at: [12.5017, 41.9027],
        level: 51.5 - BED_M,
        what: 'under the agger at the Porta Viminalis (Ashby p. 147): underground; level assumed, falling at the same rate',
      },
    ],
  },
]

export interface Run {
  kind: 'arcade' | 'wall' | 'shafts'
  /** x, y, ground, the underside of the lowest channel. */
  pts: number[][]
}

/** A course laid out: stations a bay apart, grouped into runs by how high the channel stands. */
export function layCourse(c: Course, at: (x: number, y: number) => number): Run[] {
  const plane = c.pts.map((p) => ({
    xy: projection.forward(...p.at) as Pt,
    level: p.level,
  }))
  // Levels not given are interpolated by distance along the course.
  const chain = [0]
  for (let k = 1; k < plane.length; k++)
    chain.push(
      chain[k - 1] +
        Math.hypot(
          plane[k].xy[0] - plane[k - 1].xy[0],
          plane[k].xy[1] - plane[k - 1].xy[1],
        ),
    )
  for (let k = 0; k < plane.length; k++) {
    if (!Number.isNaN(plane[k].level)) continue
    let a = k - 1
    while (a > 0 && Number.isNaN(plane[a].level)) a--
    let b = k + 1
    while (b < plane.length - 1 && Number.isNaN(plane[b].level)) b++
    const f = (chain[k] - chain[a]) / (chain[b] - chain[a] || 1)
    plane[k].level = plane[a].level + (plane[b].level - plane[a].level) * f
  }
  const bay = c.size.span + c.size.pier
  const needed = c.size.span / 2 + c.size.band + 1.5
  const stations: { xy: Pt; g: number; d: number; kind: Run['kind'] }[] = []
  for (let k = 0; k + 1 < plane.length; k++) {
    const [a, b] = [plane[k], plane[k + 1]]
    const L = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1])
    const n = Math.max(1, Math.round(L / bay))
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const f = i / n
      const xy: Pt = [a.xy[0] + (b.xy[0] - a.xy[0]) * f, a.xy[1] + (b.xy[1] - a.xy[1]) * f]
      const g = at(xy[0], xy[1])
      const d = a.level + (b.level - a.level) * f
      const clear = d - g
      const kind = clear > needed ? 'arcade' : clear > CLEAR.wall ? 'wall' : 'shafts'
      stations.push({ xy, g, d, kind })
    }
  }
  // Runs of one kind; neighbouring runs share their end station so the line is unbroken.
  const runs: Run[] = []
  let cur: Run | null = null
  let sinceShaft = SHAFT_M
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]
    const pt = [s.xy[0], s.xy[1], s.g, s.d]
    if (!cur || cur.kind !== s.kind) {
      if (cur && cur.kind !== 'shafts' && s.kind !== 'shafts') cur.pts.push(pt)
      cur = { kind: s.kind, pts: [] }
      runs.push(cur)
    }
    if (s.kind === 'shafts') {
      sinceShaft += bay
      if (sinceShaft < SHAFT_M) continue
      sinceShaft = 0
    }
    cur.pts.push(pt)
  }
  return runs.filter((r) => r.pts.length > (r.kind === 'shafts' ? 0 : 1))
}
