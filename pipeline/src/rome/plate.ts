/**
 * The board the model of Rome stands on (DESIGN.md §7.7): build/rome/plate-0.png,
 * plate-1.png, ground.png and names.json, on a 4 m grid a little wider than the city,
 * and the model itself (model.ts), which needs the same ground.
 *
 * - **Ground.** The Mapterhorn heights the terrain uses, smoothed over ~SMOOTH_M so
 *   the modern buildings the surface model carries do not show: the hills as they
 *   are now; the ancient ground lay a few metres lower in the valleys.
 * - **The walled city**, reconstructed in servian.ts, for the model's wall and the
 *   generated city inside it.
 * - **The Tiber**, a signed distance to OpenStreetMap's outline of its water, so the
 *   board can draw the river on its real course in place of the coarse HydroRIVERS
 *   line.
 * - **Streets and roads** (streets.ts), paved on the board.
 * - **Names** of the hills (on their highest ground near their location), quarters
 *   and the river, as lettering placements for the label layer.
 *
 * plate-0: R the model's shadow on the board (model.ts), B distance to the nearest
 * street or road, A what it is: 255 a street, 223 a generated main street, 191 a
 * street drawn lighter, 127 a road, 63 a road drawn lighter.
 * plate-1: R signed distance to the circuit, G signed distance to the river, B the
 * distance to the hull of the circuit and everything on the plan, out to
 * REACH_CLAMP_M, for the board's edge. The fields are loaded without
 * premultiplication, so alpha is data like the rest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { projection } from '@roman-map/world'
import type { Place } from '@roman-map/schema'
import { MAX_KNOWN_M, SERVIAN } from './servian.ts'
import { streetLines } from './streets.ts'
import { ancientGround } from './ground.ts'
import { COURSES } from './aqueducts.ts'
import { designFootprints } from './designs.ts'
import { bakeModel, writeGround } from './model.ts'

const CACHE = resolve(import.meta.dirname, '../../../.cache/sources/mapterhorn-rome')
const TEXEL_M = 4
/**
 * The grid, lon/lat: the city, the Campus Martius and the Janiculum across the river,
 * the Marcia's arcade out to Capannelle (aqueducts.ts),
 * with room for the plate's ragged edge, which the shader sets about PLATE_REACH_M
 * beyond the walled city.
 */
const LON = [12.447, 12.585]
const LAT = [41.826, 41.924]
const DEM_ZOOM = 13
const SMOOTH_M = 45
const CITY_CLAMP_M = 48
/** The plate's paper reaches this far beyond everything on the plan (rome/shading.ts REACH_M). */
const PLATE_REACH_M = 420
/** The plate's edge is measured from the circuit, out to this. */
const REACH_CLAMP_M = 1400
const RIVER_CLAMP_M = 16
const STREET_CLAMP_M = 12
/** The street field's code for a generated main street (plate-0 alpha). */
const MAIN_STREET = 223
/** A hill's name goes on its highest ground within this of its location. */
const SUMMIT_SEARCH_M = 150
/**
 * The Tiber's name is lettered along a course placed by hand, as the sea names' are
 * (labels/seas.ts): the near-level reach below the Ponte Umberto, lon/lat, west to
 * east. The build checks it lies on the water.
 */
const TIBER_COURSE: [number, number][] = [
  [12.4662, 41.9018],
  [12.47, 41.9023],
]
/** Spurs of a larger hill are lettered smaller than the hills themselves. */
const SPURS = new Set(['mons-oppius', 'mons-cispius', 'velia-roma'])
/**
 * Hills lettered at their record's location, not their summit: the Velia is a saddle,
 * and the Esquiline's summit is its Cispius spur, so its name goes on the tableland.
 */
const FIXED = new Set(['velia-roma', 'esquiliae'])
/**
 * Where a name is set somewhere other than its record's location, lon/lat. The
 * Capitol's goes on the Arx, its northern summit, as engraved plans often set it,
 * leaving the southern summit to the temple of Jupiter and the Tabularium below it.
 */
const LETTER_AT: Record<string, [number, number]> = {
  'mons-capitolinus': [12.4818, 41.8943],
}
/** Placement order: hills, spurs, quarters. */
const rank = (p: Place) => (p.kind === 'hill' ? (SPURS.has(p.id) ? 1 : 0) : 2)

type Pt = [number, number]

export async function bakePlate(
  out: string,
  river: Pt[][][],
  streetGeometry: Map<string, [number, number][][]>,
  places: Map<string, Place>,
  outlines: { id: string; kind: string; polys: Pt[][][] }[],
) {
  const corners = [
    projection.forward(LON[0], LAT[0]),
    projection.forward(LON[1], LAT[0]),
    projection.forward(LON[0], LAT[1]),
    projection.forward(LON[1], LAT[1]),
  ]
  const x0 = Math.floor(Math.min(...corners.map((c) => c[0])) / TEXEL_M) * TEXEL_M
  const y0 = Math.floor(Math.min(...corners.map((c) => c[1])) / TEXEL_M) * TEXEL_M
  const width = Math.ceil((Math.max(...corners.map((c) => c[0])) - x0) / TEXEL_M)
  const height = Math.ceil((Math.max(...corners.map((c) => c[1])) - y0) / TEXEL_M)
  const y1 = y0 + height * TEXEL_M
  /** Plane position of a texel centre; row 0 is the north edge. */
  const at = (c: number, r: number): Pt => [
    x0 + (c + 0.5) * TEXEL_M,
    y1 - (r + 0.5) * TEXEL_M,
  ]

  // --- relief ---------------------------------------------------------------------
  // The plane rectangle reaches a little past the lon/lat box at its corners.
  const reach = [
    at(0, 0),
    at(width - 1, 0),
    at(0, height - 1),
    at(width - 1, height - 1),
  ].map((q) => projection.inverse(...q))
  const dem = await demSampler(
    [Math.min(...reach.map((q) => q[0])), Math.max(...reach.map((q) => q[0]))],
    [Math.min(...reach.map((q) => q[1])), Math.max(...reach.map((q) => q[1]))],
  )
  const h = new Float32Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const [lon, lat] = projection.inverse(...at(c, r))
      h[r * width + c] = dem(lon, lat)
    }
  const smooth = blur(h, width, height, SMOOTH_M / TEXEL_M)

  // --- the walled city and the river ------------------------------------------------
  const riverRings = river
    .flat()
    .map((ring) => ring.map(([lon, lat]) => projection.forward(lon, lat)))
  const riverEdges = riverRings.flatMap((r) =>
    r.slice(0, -1).map((p, i) => [p, r[i + 1]] as [Pt, Pt]),
  )
  const circuit = SERVIAN.map((v) => {
    const p = projection.forward(...v.at)
    return v.snap === 'river' ? nearestOn(riverEdges, p) : p
  })
  const circuitRing = [...circuit, circuit[0]]
  // Every join is wall, known or reconstructed, but the river bank's.
  const wall: { a: Pt; b: Pt; s0: number; known: boolean }[] = []
  let along = 0
  for (let i = 0; i < SERVIAN.length; i++) {
    const j = (i + 1) % SERVIAN.length
    const [a, b] = [circuit[i], circuit[j]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!SERVIAN[i].alongRiver) {
      const surveyed = SERVIAN[i].evidence !== 'course' && SERVIAN[j].evidence !== 'course'
      wall.push({ a, b, s0: along, known: surveyed && len < MAX_KNOWN_M })
    }
    along += len
  }

  const grid = { x0, y1, width, height, texel: TEXEL_M }
  const water = signedField(grid, riverRings, RIVER_CLAMP_M)

  // --- the ancient ground ------------------------------------------------------------
  // The valley floors set to the ground the excavations found walked on in the late
  // Republic (ground.ts); the terrain as it is elsewhere, and in the river, whose
  // level is its own.
  const ancient = ancientGround(grid, smooth)
  for (let i = 0; i < h.length; i++) {
    const k = ancient.change[i] * Math.min(1, Math.max(0, (water[i] - 4) / 30))
    h[i] += k
    smooth[i] += k
  }
  for (const f of ancient.found)
    console.log(
      `  ground: ${f.what.split(':')[0]}: ${f.floor.toFixed(1)} m today, ${f.level.toFixed(1)} m then (${f.change.toFixed(1)} m)`,
    )
  // A street drawn from the evidence keeps to the ground and off the monuments: their
  // outlines, the temples placed by a point (about as far round as one stands), and
  // the river.
  const outlined = new Set(outlines.map((o) => o.id))
  const pointTemples = [...places.values()]
    .filter((p) => p.kind === 'temple' && p.within === 'roma' && !outlined.has(p.id))
    .map((p) => projection.forward(...p.location))
  // The designed buildings with a size of their own keep the streets off them too
  // (designs.ts), and the plate reaches round them.
  const designed = designFootprints(places).filter(
    (d) => places.get(d.id)!.kind !== 'bridge',
  )
  const monumentRings = [
    ...outlines.flatMap((o) => o.polys.map((poly) => poly[0])),
    ...designed.map((d) => d.ring),
  ]
  const streets = streetLines(streetGeometry, places, circuitRing, {
    height: (x, y) => {
      const c = Math.min(width - 1, Math.max(0, Math.round((x - x0) / TEXEL_M - 0.5)))
      const r = Math.min(height - 1, Math.max(0, Math.round((y1 - y) / TEXEL_M - 0.5)))
      return smooth[r * width + c]
    },
    keepOff: (x, y) =>
      pointTemples.some((q) => Math.hypot(q[0] - x, q[1] - y) < 14) ||
      monumentRings.some((r) => inRing([x, y], r)) ||
      riverRings.some((r) => inRing([x, y], r)),
  })
  const city = signedField(grid, [circuitRing], CITY_CLAMP_M)
  // The plate reaches round everything on the plan, not just the walled city: the
  // Campus Martius, the Janiculum and the Mausoleum lie well outside the wall.
  // An aqueduct's record stands where its remains are, which may be far out; its
  // course near the city is what the plate reaches round.
  const planned = [
    ...[...places.values()]
      .filter((p) => p.within === 'roma' && p.kind !== 'aqueduct')
      .map((p) => projection.forward(...p.location)),
    ...COURSES.flatMap((c) => c.pts.map((q) => projection.forward(...q.at))),
    // With room round each, so the Tiber hands over to the map's river line beyond
    // them, not under them (rome/shading.ts `tiberReach`).
    ...designed.flatMap((d) => {
      const [cx, cy] = [d.ring[0][0] + d.ring[2][0], d.ring[0][1] + d.ring[2][1]].map(
        (v) => v / 2,
      )
      return d.ring.map(([x, y]) => {
        const l = Math.hypot(x - cx, y - cy) || 1
        return [x + ((x - cx) / l) * 250, y + ((y - cy) / l) * 250] as [number, number]
      })
    }),
  ]
  const hull = convexHull([...circuit, ...planned])
  const reachField = signedField(grid, [[...hull, hull[0]]], REACH_CLAMP_M)

  // --- the model --------------------------------------------------------------------
  const model = bakeModel({
    out,
    grid,
    raw: h,
    smooth,
    circuit: circuitRing,
    wall: wall.map(({ a, b, known }) => ({ a, b, known })),
    gates: SERVIAN.flatMap((v, i) => (v.evidence === 'gate' ? [circuit[i]] : [])),
    streets,
    riverRings,
    water,
    reach: reachField,
    reachM: PLATE_REACH_M,
    outlines,
    places,
  })
  const shadowAt = (i: number) => model.shadow[i]

  // The paved ways: the recorded streets and roads, and the generated main streets,
  // which were paved in basalt as the city's streets were from 174 BCE (Livy 41.27);
  // the lanes between are trodden earth.
  const streetSegs = [
    ...streets.flatMap((l) =>
      l.pts.slice(1).map((q, i) => ({
        seg: [l.pts[i], q] as [Pt, Pt],
        code: (l.road ? 127 : 255) - (l.known ? 0 : 64),
      })),
    ),
    ...model.mains.flatMap((l) =>
      l.slice(1).map((q, i) => ({ seg: [l[i], q] as [Pt, Pt], code: MAIN_STREET })),
    ),
  ]
  const streetField = unsignedField(
    grid,
    streetSegs.map((x) => x.seg),
    STREET_CLAMP_M,
    streetSegs.map((x) => x.code),
  )

  const img0 = new Uint8Array(width * height * 4)
  const img1 = new Uint8Array(width * height * 4)
  const unsigned = (d: number, clamp: number) => Math.round(Math.min(1, d / clamp) * 255)
  const signed = (d: number, clamp: number) =>
    Math.round(128 + Math.max(-1, Math.min(1, d / clamp)) * 127)
  for (let i = 0; i < width * height; i++) {
    img0[i * 4] = Math.round(shadowAt(i) * 255)
    img0[i * 4 + 2] = unsigned(streetField.d[i], STREET_CLAMP_M)
    img0[i * 4 + 3] = streetField.flag[i]
    img1[i * 4] = signed(city[i], CITY_CLAMP_M)
    img1[i * 4 + 1] = signed(water[i], RIVER_CLAMP_M)
    img1[i * 4 + 2] = signed(reachField[i], REACH_CLAMP_M)
    img1[i * 4 + 3] = 255
  }
  mkdirSync(out, { recursive: true })
  for (const [i, img] of [img0, img1].entries())
    await sharp(img, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(join(out, `plate-${i}.png`))

  await writeGround(out, model.png, width, height)

  // --- names ----------------------------------------------------------------------
  const names = []
  // Hills first, then their spurs, then the quarters; each tries its own place, then
  // a step north or south, and is left off rather than set over another name. A box
  // is the name's rough extent: Cinzel capitals run ~1 em a letter, Garamond italic
  // ~0.6, plus tracking.
  const lettered = [...places.values()]
    .filter((p) => p.within === 'roma' && (p.kind === 'hill' || p.kind === 'district'))
    .sort((a, b) => rank(a) - rank(b))
  const boxes: [number, number, number, number][] = []
  for (const p of lettered) {
    const text = (p.names.find((n) => n.preferred) ?? p.names[0]).text
    const hill = p.kind === 'hill'
    let [x, y] = projection.forward(...(LETTER_AT[p.id] ?? p.location))
    if (hill && !FIXED.has(p.id) && !LETTER_AT[p.id]) [x, y] = summit(smooth, grid, x, y)
    const cap = hill ? (SPURS.has(p.id) ? 30 : 46) : 20
    const tracking = hill ? 0.3 : 0.08
    const w = text.length * cap * ((hill ? 1.0 : 0.62) + tracking)
    const h = cap * 1.5
    const spot = [0, 1, -1, 2, -2]
      .map((k) => y + k * h)
      .find(
        (yy) =>
          !boxes.some(
            (b) =>
              x - w / 2 < b[2] &&
              x + w / 2 > b[0] &&
              yy - h / 2 < b[3] &&
              yy + h / 2 > b[1],
          ),
      )
    if (spot === undefined) {
      console.log(`  plate: no room to letter ${p.id}`)
      continue
    }
    boxes.push([x - w / 2, spot - h / 2, x + w / 2, spot + h / 2])
    names.push({
      kind: 'plan',
      id: p.id,
      font: hill ? 'cinzel' : 'garamond-italic',
      style: hill ? 'plan-hill' : 'plan-district',
      text: hill ? text.toUpperCase() : text,
      years: [[p.from.year, p.to.year]],
      path: [
        [Math.round(x - 1500), Math.round(spot)],
        [Math.round(x + 1500), Math.round(spot)],
      ],
      capHeight: cap,
      tracking,
    })
  }
  // Streets and roads are not lettered: on the model the names would crowd the roofs.
  const tiber = places.get('tiberis')
  if (tiber) {
    const path = TIBER_COURSE.map(([lon, lat]) => projection.forward(lon, lat))
    for (let k = 0; k <= 10; k++) {
      const q: Pt = [
        path[0][0] + ((path[1][0] - path[0][0]) * k) / 10,
        path[0][1] + ((path[1][1] - path[0][1]) * k) / 10,
      ]
      const c = Math.floor((q[0] - x0) / TEXEL_M)
      const r = Math.floor((y1 - q[1]) / TEXEL_M)
      if (water[r * width + c] > 0)
        throw new Error("plate: the Tiber's lettering course leaves the water")
    }
    names.push({
      kind: 'plan',
      id: 'tiberis',
      font: 'garamond-italic',
      style: 'plan-water',
      text: (tiber.names.find((n) => n.preferred) ?? tiber.names[0]).text,
      years: [[tiber.from.year, tiber.to.year]],
      path: path.map(([x, y]) => [Math.round(x), Math.round(y)]),
      capHeight: 26,
      tracking: 0.25,
    })
  }
  writeFileSync(
    join(out, 'names.json'),
    JSON.stringify({
      _comment:
        'Lettering for the plan of Rome: hills and quarters, in the label layer’s placement format. Plane metres; years astronomical.',
      labels: names,
    }),
  )

  console.log(
    `plate: ${width}×${height} texels of ${TEXEL_M} m, ${wall.filter((w) => w.known).length} of ${wall.length} wall joins known, ${streets.length} street and road lines, ${names.length} names`,
  )
  return {
    /** Footprints the model drew for monuments with no outline (build.ts picks by them). */
    drawn: model.drawn,
    x0,
    y0,
    texel: TEXEL_M,
    width,
    height,
    streetClamp: STREET_CLAMP_M,
    cityClamp: CITY_CLAMP_M,
    reachClamp: REACH_CLAMP_M,
    riverClamp: RIVER_CLAMP_M,
  }
}

interface Grid {
  x0: number
  y1: number
  width: number
  height: number
  texel: number
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

/** Distance to the nearest segment, within `clamp`; `flags` marks which segment was nearest (a byte). */
function unsignedField(
  g: Grid,
  segs: [Pt, Pt][],
  clamp: number,
  flags?: (boolean | number)[],
) {
  const d = new Float32Array(g.width * g.height).fill(clamp)
  const flag = new Uint8Array(g.width * g.height)
  segs.forEach(([a, b], k) => {
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - clamp - g.x0) / g.texel))
    const c1 = Math.min(
      g.width - 1,
      Math.ceil((Math.max(a[0], b[0]) + clamp - g.x0) / g.texel),
    )
    const r0 = Math.max(0, Math.floor((g.y1 - Math.max(a[1], b[1]) - clamp) / g.texel))
    const r1 = Math.min(
      g.height - 1,
      Math.ceil((g.y1 - Math.min(a[1], b[1]) + clamp) / g.texel),
    )
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p: Pt = [g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel]
        const dd = segDist(p, a, b)
        const i = r * g.width + c
        if (dd < d[i]) {
          d[i] = dd
          flag[i] = Number(flags?.[k] ?? 0)
        }
      }
  })
  return { d, flag }
}

/** Signed distance to some rings (negative inside, even-odd), clamped. */
function signedField(g: Grid, rings: Pt[][], clamp: number) {
  const edges = rings.flatMap((r) =>
    r.slice(0, -1).map((p, i) => [p, r[i + 1]] as [Pt, Pt]),
  )
  const { d } = unsignedField(g, edges, clamp)
  for (let r = 0; r < g.height; r++) {
    const y = g.y1 - (r + 0.5) * g.texel
    const xs: number[] = []
    for (const [a, b] of edges)
      if (a[1] > y !== b[1] > y)
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.texel - 0.5))
      const c1 = Math.min(g.width - 1, Math.floor((xs[k + 1] - g.x0) / g.texel - 0.5))
      for (let c = c0; c <= c1; c++) d[r * g.width + c] = -d[r * g.width + c]
    }
  }
  return d
}

function nearestOn(edges: [Pt, Pt][], p: Pt): Pt {
  let best: Pt = p
  let bestD = Infinity
  for (const [a, b] of edges) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    const q: Pt = [a[0] + t * dx, a[1] + t * dy]
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < bestD) [best, bestD] = [q, d]
  }
  return best
}

/** The convex hull of some points, counter-clockwise (Andrew's monotone chain). */
function convexHull(points: Pt[]): Pt[] {
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

/** The highest smoothed ground within SUMMIT_SEARCH_M of a point. */
function summit(h: Float32Array, g: Grid, x: number, y: number): Pt {
  const n = Math.ceil(SUMMIT_SEARCH_M / g.texel)
  const c0 = Math.round((x - g.x0) / g.texel - 0.5)
  const r0 = Math.round((g.y1 - y) / g.texel - 0.5)
  let best: Pt = [x, y]
  let top = -Infinity
  for (let r = r0 - n; r <= r0 + n; r++)
    for (let c = c0 - n; c <= c0 + n; c++) {
      if (
        r < 0 ||
        c < 0 ||
        r >= g.height ||
        c >= g.width ||
        (r - r0) ** 2 + (c - c0) ** 2 > n * n
      )
        continue
      if (h[r * g.width + c] > top) {
        top = h[r * g.width + c]
        best = [g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel]
      }
    }
  return best
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
        let wsum = 0
        for (let i = -rad; i <= rad; i++) {
          const cc = horizontal ? c + i : c
          const rr = horizontal ? r : r + i
          if (cc < 0 || rr < 0 || cc >= w || rr >= hgt) continue
          s += a[rr * w + cc] * k[i + rad]
          wsum += k[i + rad]
        }
        b[r * w + c] = s / wsum
      }
    return b
  }
  return pass(pass(src, true), false)
}

/** Heights (m) at lon/lat from Mapterhorn's Terrarium tiles, cached under .cache. */
async function demSampler(lons: number[], lats: number[]) {
  mkdirSync(CACHE, { recursive: true })
  const tiles = new Map<string, { data: Buffer; size: number; channels: number }>()
  const n = 2 ** DEM_ZOOM
  const merc = (lon: number, lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180)
    return [
      ((lon + 180) / 360) * n,
      (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
    ]
  }
  const [tx0, ty1] = merc(lons[0], lats[0]).map(Math.floor)
  const [tx1, ty0] = merc(lons[1], lats[1]).map(Math.floor)
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      const file = join(CACHE, `${DEM_ZOOM}-${tx}-${ty}.webp`)
      if (!existsSync(file)) {
        const res = await fetch(`https://tiles.mapterhorn.com/${DEM_ZOOM}/${tx}/${ty}.webp`)
        if (!res.ok) throw new Error(`Mapterhorn ${DEM_ZOOM}/${tx}/${ty}: ${res.status}`)
        writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      }
      const { data, info } = await sharp(readFileSync(file))
        .raw()
        .toBuffer({ resolveWithObject: true })
      tiles.set(`${tx}/${ty}`, { data, size: info.width, channels: info.channels })
    }
  const px = (tx: number, ty: number, i: number, j: number) => {
    const t = tiles.get(`${tx}/${ty}`)!
    const k =
      (Math.min(t.size - 1, Math.max(0, j)) * t.size +
        Math.min(t.size - 1, Math.max(0, i))) *
      t.channels
    return t.data[k] * 256 + t.data[k + 1] + t.data[k + 2] / 256 - 32768
  }
  return (lon: number, lat: number) => {
    const [mx, my] = merc(lon, lat)
    const tx = Math.floor(mx)
    const ty = Math.floor(my)
    const size = tiles.get(`${tx}/${ty}`)!.size
    const fx = (mx - tx) * size - 0.5
    const fy = (my - ty) * size - 0.5
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const u = fx - i
    const v = fy - j
    return (
      (1 - u) * (1 - v) * px(tx, ty, i, j) +
      u * (1 - v) * px(tx, ty, i + 1, j) +
      (1 - u) * v * px(tx, ty, i, j + 1) +
      u * v * px(tx, ty, i + 1, j + 1)
    )
  }
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
