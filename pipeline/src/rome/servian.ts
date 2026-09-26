/**
 * The course of the Servian Wall, for the model of Rome (DESIGN.md §7.7): the walled
 * city the plan hatches, and the line the model builds the wall on.
 *
 * The course is SITAR's (data/geometry/rome-servian.geojson, sitar.ts): its
 * reconstruction of the whole 4th-century circuit (codice PA 19694), made for the 2017
 * "Roma medio repubblicana" conference from the surveyed remains, the remains known
 * from archive plans and historic maps, studies of the terrain and earlier
 * reconstructions. It follows the brows of the hills, as the ancient writers say the
 * wall did — "some sections of the walls, standing on hills and sheer cliffs, have
 * been fortified by Nature herself" (Dionysius 9.68) — and runs straight across the
 * flat ground of the Esquiline plateau as the earth rampart, the agger, from the Porta
 * Collina to the Porta Esquilina. SITAR draws it as a band about 4 m wide; the course
 * here is its middle line, smoothed a little where the band is drawn in short straight
 * pieces. Where SITAR's line misses a gate whose remains are surveyed (the Porta
 * Caelimontana, in the Arch of Dolabella) it is bent to pass through it.
 *
 * Between the Capitol and the Aventine the course leaves the river outside: from the
 * Porta Carmentalis by S. Omobono straight to the Porta Trigemina by S. Maria in
 * Cosmedin, and on along the Aventine's brow above the river. That is SITAR's line
 * and Coarelli's (Il Foro Boario, 1988); the older view (Platner & Ashby) had the
 * river close the circuit there, and Wiseman (PBSR 2021) argues the riverside line was
 * changed in 212 BCE. It is the least certain stretch.
 *
 * Where the course runs along a stretch SITAR records as surveyed, it is `surveyed`;
 * between them it is SITAR's reconstruction.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projection } from '@roman-map/world'
import { DATA_DIR } from '../load.ts'

type Pt = [number, number]

/** SITAR's reconstruction of the course (sitar.ts `COURSE`). */
const COURSE = 19694
/** The course's points are this far apart, metres. */
export const STEP_M = 4
/** How much the band's middle line is smoothed along the course, metres (a Gaussian's sigma). */
const SMOOTH_M = 6
/** A piece of the band shorter than this is a fragment, not part of the circuit, metres. */
const FRAGMENT_M = 60
/** A point of the course lies along a surveyed stretch within this of it, metres. */
const SURVEYED_M = 8
/** The line coming back within `LOOP_M` of itself after `LOOP_MIN_M` has looped, metres. */
const LOOP_M = 20
const LOOP_MIN_M = 150
/** A surveyed gate further than this off the course bends it through the gate, metres. */
const BEND_M = 6

/**
 * The gates, clockwise round the circuit from the Capitol: each placed by the SITAR
 * record named (its surveyed remains, or SITAR's reconstruction of its site, which
 * follows Coarelli 2008 and the Lexicon Topographicum Urbis Romae), at the middle of
 * its outline. Gates whose site nobody knows — the Ratumena, the Flumentana, the
 * Lavernalis, the Querquetulana, whose site is disputed — are not drawn.
 */
export const GATES: { name: string; sitar: number; what: string }[] = [
  {
    name: 'Porta Carmentalis',
    sitar: 16526,
    what: 'SITAR\'s site, by S. Omobono at the Capitol\'s south-west corner; it "could also be interpreted as the Porta Triumphalis or Ratumena"',
  },
  {
    name: 'Porta Fontinalis',
    sitar: 16532,
    what: "SITAR's site, on the saddle between the Capitol and the Quirinal",
  },
  {
    name: 'Porta Sanqualis',
    sitar: 19677,
    what: 'the remains surveyed in the flowerbed of the Largo Magnanapoli',
  },
  {
    name: 'Porta Salutaris',
    sitar: 16541,
    what: "SITAR's site, on the Quirinal's west brow by the Via della Dataria",
  },
  {
    name: 'Porta Quirinalis',
    sitar: 16544,
    what: "SITAR's site, by the Via delle Quattro Fontane",
  },
  {
    name: 'Porta Collina',
    sitar: 16504,
    what: "SITAR's site, at the north end of the agger, where the remains of its north bastion are surveyed (SITAR 20371)",
  },
  {
    name: 'Porta Viminalis',
    sitar: 20374,
    what: 'the remains surveyed by Termini station, in the agger',
  },
  {
    name: 'Porta Esquilina',
    sitar: 14123,
    what: 'the remains surveyed at the Arch of Gallienus, at the south end of the agger',
  },
  {
    name: 'Porta Caelimontana',
    sitar: 19673,
    what: 'the blocks of Grotta Oscura tufa built into the Arch of Dolabella',
  },
  {
    name: 'Porta Capena',
    sitar: 16625,
    what: "the remains on Parker and Gori's plan of the excavation of 1868, where the Via Appia left the city",
  },
  {
    name: 'Porta Naevia',
    sitar: 16520,
    what: "SITAR's site, on the Little Aventine",
  },
  {
    name: 'Porta Raudusculana',
    sitar: 16525,
    what: "SITAR's site, at the Piazza Albania between the two Aventines",
  },
  {
    name: 'Porta Trigemina',
    sitar: 16527,
    what: "SITAR's site, by S. Maria in Cosmedin, between the Aventine and the river",
  },
]

/** The gates the agger runs between, north to south. */
const AGGER: [string, string] = ['Porta Collina', 'Porta Esquilina']

export interface Course {
  /** The course, plane metres, every `STEP_M`, counter-clockwise (the city on its left), closed. */
  ring: Pt[]
  /** Whether each point lies along a surveyed stretch. */
  surveyed: boolean[]
  /** The gates, at their points of the course. */
  gates: { name: string; i: number; at: Pt; surveyed: boolean; what: string }[]
  /** The agger's points of the course, from its first to its last (it does not wrap). */
  agger: [number, number]
  /** Metres of the course along surveyed stretches, and of the whole. */
  lengths: { surveyed: number; all: number }
}

interface Feature {
  id: number
  properties: { what: string; name: string | null; placed: string | null }
  geometry: { type: string; coordinates: number[][][] | number[][][][] }
}

export function servianCourse(): Course {
  const geo = JSON.parse(
    readFileSync(join(DATA_DIR, 'geometry/rome-servian.geojson'), 'utf8'),
  ) as { features: Feature[] }
  const byId = new Map(geo.features.map((f) => [f.id, f]))
  const polys = (f: Feature): Pt[][] =>
    (f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates as number[][][]]
      : (f.geometry.coordinates as number[][][][])
    ).map((p) => p[0].map(([lon, lat]) => projection.forward(lon, lat)))

  const band = byId.get(COURSE)
  if (!band)
    throw new Error(`servian.ts: no course (SITAR ${COURSE}) in rome-servian.geojson`)
  // The band's middle line, piece by piece, joined end to end into one circuit.
  const parts = polys(band)
    .map(middleLine)
    .filter((l) => length(l) > FRAGMENT_M)
    .sort((a, b) => length(b) - length(a))
  let line = parts.shift()!
  while (parts.length) {
    const tail = line[line.length - 1]
    let best = { k: 0, flip: false, d: Infinity }
    parts.forEach((p, k) => {
      for (const flip of [false, true]) {
        const end = flip ? p[p.length - 1] : p[0]
        const d = Math.hypot(end[0] - tail[0], end[1] - tail[1])
        if (d < best.d) best = { k, flip, d }
      }
    })
    const [next] = parts.splice(best.k, 1)
    line = [...line, ...(best.flip ? [...next].reverse() : next)]
  }
  if (area(line) < 0) line.reverse()

  const gateAt = (sitar: number): Pt => {
    const f = byId.get(sitar)
    if (!f) throw new Error(`servian.ts: no gate SITAR ${sitar} in rome-servian.geojson`)
    const pts = polys(f).flat()
    return [
      pts.reduce((s, q) => s + q[0], 0) / pts.length,
      pts.reduce((s, q) => s + q[1], 0) / pts.length,
    ]
  }
  const gatePts = GATES.map((g) => gateAt(g.sitar))

  // Started at the Porta Carmentalis, so the agger does not run over the ring's join.
  let ring = resample(closed(line), STEP_M)
  ring = ring.slice(0, -1)
  const first = nearestIndex(ring, gatePts[0])
  ring = [...ring.slice(first), ...ring.slice(0, first)]
  // On the Capitol the band forks, one branch along the saddle below the Arx and one
  // round the Arx's brow, and the two meet again: the citadel lay within the walls, so
  // where the line comes back to itself the shorter way round is cut out.
  ring = withoutLoops(ring)
  ring = smoothRing(ring, SMOOTH_M / STEP_M)

  // Bent through each surveyed gate it misses, over a stretch that grows with the miss.
  GATES.forEach((g, k) => {
    if (byId.get(g.sitar)!.properties.placed !== 'certo') return
    const i = nearestIndex(ring, gatePts[k])
    const miss: Pt = [gatePts[k][0] - ring[i][0], gatePts[k][1] - ring[i][1]]
    const d = Math.hypot(...miss)
    if (d < BEND_M) return
    const reach = Math.max(60, d * 3) / STEP_M
    for (let o = -Math.ceil(reach); o <= Math.ceil(reach); o++) {
      const j = (i + o + ring.length) % ring.length
      const w = Math.cos(((o / reach) * Math.PI) / 2) ** 2
      if (Math.abs(o) > reach) continue
      ring[j] = [ring[j][0] + miss[0] * w, ring[j][1] + miss[1] * w]
    }
  })
  ring = resample(closed(ring), STEP_M)

  const surveyedPieces = geo.features
    .filter(
      (f) =>
        f.id !== COURSE &&
        f.properties.placed === 'certo' &&
        (f.properties.what === 'cinta muraria' ||
          f.properties.what === 'aggere' ||
          f.properties.what === 'porta urbica'),
    )
    .flatMap(polys)
  const surveyed = ring.map((p) =>
    surveyedPieces.some((r) => inRing(p, r) || distToLine(p, r) < SURVEYED_M),
  )
  const gates = GATES.map((g, k) => {
    const i = nearestIndex(ring, gatePts[k])
    return {
      name: g.name,
      i,
      at: ring[i],
      surveyed: byId.get(g.sitar)!.properties.placed === 'certo',
      what: g.what,
    }
  })
  const [a, b] = AGGER.map((n) => gates.find((g) => g.name === n)!.i)
  let lengthSurveyed = 0
  for (let i = 0; i + 1 < ring.length; i++)
    if (surveyed[i] && surveyed[i + 1])
      lengthSurveyed += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
  return {
    ring,
    surveyed,
    gates,
    agger: [Math.min(a, b), Math.max(a, b)],
    lengths: { surveyed: lengthSurveyed, all: length(ring) },
  }
}

/**
 * The middle line of a band (its outline): each point of one side paired with the
 * nearest point of the other, and their midpoints taken along the longer side.
 */
export function middleLine(outline: Pt[]): Pt[] {
  const P = resample(closed(outline), 1).slice(0, -1)
  const N = P.length
  const CELL = 16
  const cells = new Map<string, number[]>()
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
  P.forEach((p, i) => {
    const k = key(p[0], p[1])
    cells.set(k, [...(cells.get(k) ?? []), i])
  })
  // Each point's partner across the band: the nearest point well along the outline from it.
  const partner = P.map((p, i) => {
    let best = { j: -1, d: 15 }
    const [ci, cj] = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)]
    for (let a = ci - 1; a <= ci + 1; a++)
      for (let b = cj - 1; b <= cj + 1; b++)
        for (const j of cells.get(`${a},${b}`) ?? []) {
          const sep = Math.min(Math.abs(i - j), N - Math.abs(i - j))
          if (sep < 30) continue
          const d = Math.hypot(P[j][0] - p[0], P[j][1] - p[1])
          if (d < best.d) best = { j, d }
        }
    return best.j
  })
  // The longest run of paired points round the outline is one side, end to end.
  let best = { start: 0, run: 0 }
  let run = 0
  let start = 0
  for (let t = 0; t < 2 * N; t++) {
    if (partner[t % N] >= 0) {
      if (run === 0) start = t
      run++
      if (run > best.run && run <= N) best = { start, run }
    } else run = 0
  }
  const firstPartner = partner[best.start % N]
  const mids: Pt[] = []
  for (let t = 0; t < best.run; t++) {
    const i = (best.start + t) % N
    const j = partner[i]
    mids.push([(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2])
    if (t > 30 && Math.min(Math.abs(i - firstPartner), N - Math.abs(i - firstPartner)) < 3)
      break
  }
  return mids
}

/** A line with its loops cut out: wherever it comes back within `LOOP_M` of itself after more than `LOOP_MIN_M`, the part between is dropped. */
function withoutLoops(l: Pt[]): Pt[] {
  const gap = Math.ceil(LOOP_MIN_M / STEP_M)
  for (let i = 0; i < l.length; i++)
    for (let j = l.length - 1; j > i + gap; j--) {
      if (Math.hypot(l[j][0] - l[i][0], l[j][1] - l[i][1]) > LOOP_M) continue
      // The shorter way round from i back to i is the loop.
      if (j - i < l.length - (j - i))
        return withoutLoops([...l.slice(0, i + 1), ...l.slice(j)])
    }
  return l
}

const closed = (l: Pt[]): Pt[] => [...l, l[0]]

function length(l: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < l.length; i++)
    s += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1])
  return s
}

function area(l: Pt[]) {
  let s = 0
  for (let i = 0; i < l.length; i++) {
    const [a, b] = [l[i], l[(i + 1) % l.length]]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** A line's points every `step` metres along it, keeping both ends. */
function resample(l: Pt[], step: number): Pt[] {
  const out: Pt[] = [l[0]]
  let carry = 0
  for (let i = 0; i + 1 < l.length; i++) {
    const [a, b] = [l[i], l[i + 1]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    let s = step - carry
    while (s <= L) {
      out.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L])
      s += step
    }
    carry = L - (s - step)
  }
  const last = l[l.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.5) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** A closed ring (first point not repeated) smoothed along itself, sigma in points. */
function smoothRing(r: Pt[], sigma: number): Pt[] {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const sum = k.reduce((a, b) => a + b, 0)
  return r.map((_, i) => {
    let [x, y] = [0, 0]
    for (let o = -rad; o <= rad; o++) {
      const q = r[(i + o + r.length) % r.length]
      x += q[0] * k[o + rad]
      y += q[1] * k[o + rad]
    }
    return [x / sum, y / sum]
  })
}

function nearestIndex(l: Pt[], p: Pt) {
  let best = { i: 0, d: Infinity }
  l.forEach((q, i) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < best.d) best = { i, d }
  })
  return best.i
}

function distToLine(p: Pt, l: Pt[]) {
  let d = Infinity
  for (let i = 0; i + 1 < l.length; i++) {
    const [a, b] = [l[i], l[i + 1]]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]))
  }
  return d
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
