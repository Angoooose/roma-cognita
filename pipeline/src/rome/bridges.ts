/**
 * The bridges over the Tiber, as their sources give them (designs/south.ts), and the
 * river fitted to them (DESIGN.md §7.7). The model's river is OpenStreetMap's, the
 * Tiber inside the embankment walls of the 1870s–1900s, narrower here and wider there
 * than the Republic's; a bridge scaled to it would be the wrong size. So each bridge is
 * built at its sourced size where its record places it, and the river's banks are
 * moved to meet its abutments: the water under it is exactly as wide as its arches and
 * piers, the bank pushed back where the modern river is narrower and made up where it
 * is wider. The bake reports how far each bank moved.
 *
 * Its deck is the design's too, not the ground's: over each arch it clears the arch's
 * crown, it is level or rises gently between them, and past the outermost arches it
 * comes down at BRIDGE_GRADE to the height of its banks — the same at both ends — on
 * ramps of made ground, then runs on level a few metres as its approach. The ground is
 * fitted to the approaches (model.ts), not the deck to the ground.
 */
import polygonClipping from 'polygon-clipping'
import { projection } from '@roma-cognita/world'
import type { Place } from '@roma-cognita/schema'
import { DESIGNS, planeBearing } from './designs.ts'
import { orientedBox } from './model.ts'

type Pt = [number, number]

/** A bridge's design fields this needs (designs/south.ts). */
interface BridgeDesign {
  size: [number, number]
  spans: number[]
  piers: number[]
  rise?: number
  timber?: boolean
}

/** A bridge placed over the river. */
export interface BridgeSite {
  id: string
  /** Its centre, and its axis from bank to bank (a unit vector), plane metres. */
  centre: Pt
  axis: Pt
  /** Its arches and piers end to end, between its abutments' faces, metres. */
  water: number
  /** How far each bank was moved to meet it, metres: out (+, the river made wider) or in. */
  moved: number
}

/**
 * Its arches' springing over the water, metres; and how far its deck stands over an
 * arch's crown (its ring and the fill over it, and the paving).
 */
export const BRIDGE = { spring: 0.3, cover: 1.6 }
/** How steeply a deck comes down to its banks past its outermost arches, and how far it runs on level. */
const BRIDGE_GRADE = 0.22
const APPROACH_M = 6
/** How long the curve at a ramp's foot is, metres. */
const FOOT_M = 8
/** A timber bridge's deck over the water, metres. */
const TIMBER_DECK_M = 4.5
/** How far either side of a bridge the river's banks are moved to meet it, and how gently they ease back, metres. */
const FIT = { beside: 8, taper: 40 }

const total = (d: BridgeDesign) =>
  d.spans.reduce((s, x) => s + x, 0) + d.piers.reduce((s, x) => s + x, 0)

/**
 * Each bridge of the designs on the river: where its record places it (its design's
 * `at`, else its surveyed outline's box, else its location), turned to its bearing;
 * its centre moved along its axis to the middle of the water it crosses there, so it
 * spans the river's line whatever the modern banks do. `wet` is whether a point is in
 * the river.
 */
export function placeBridges(
  places: Map<string, Place>,
  outlines: { id: string; polys: Pt[][][] }[],
  wet: (p: Pt) => boolean,
): BridgeSite[] {
  const sites: BridgeSite[] = []
  for (const [id, design] of Object.entries(DESIGNS)) {
    if (design.model !== 'bridge') continue
    const d = design as unknown as BridgeDesign & {
      at?: [number, number]
      bearing?: number
    }
    const p = places.get(id)
    if (!p || d.bearing === undefined) continue
    const ring = outlines
      .filter((o) => o.id === id)
      .flatMap((o) => o.polys.map((poly) => poly[0]))
      .sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]
    const box = ring ? orientedBox(ring) : null
    const at: Pt = d.at
      ? projection.forward(...d.at)
      : box
        ? [box.cx, box.cy]
        : projection.forward(...p.location)
    const b = planeBearing(d.bearing, d.at ?? p.location)
    const axis: Pt = [Math.sin(b), Math.cos(b)]
    // The water along its axis, 0.5 m at a time out to 250 m either side; runs of it
    // joined across dry gaps under 45 m (a pier, an islet in the river's line); the run
    // nearest its centre is what it crosses.
    const pt = (t: number): Pt => [at[0] + axis[0] * t, at[1] + axis[1] * t]
    const runs: [number, number][] = []
    for (let t = -250; t <= 250; t += 0.5) {
      if (!wet(pt(t))) continue
      const last = runs[runs.length - 1]
      if (last && t - last[1] < 45) last[1] = t
      else runs.push([t, t])
    }
    const gap = (r: [number, number]) =>
      r[0] <= 0 && r[1] >= 0 ? 0 : Math.min(Math.abs(r[0]), Math.abs(r[1]))
    const run = runs.sort((a, c) => gap(a) - gap(c))[0]
    if (!run) continue
    const water = total(d)
    sites.push({
      id,
      centre: pt((run[0] + run[1]) / 2),
      axis,
      water,
      moved: (water - (run[1] - run[0])) / 2,
    })
  }
  return sites
}

/**
 * The river with its banks moved to meet each bridge's abutments: where the water is
 * narrower than its arches, a channel as wide as them cut either side of it, its banks
 * easing back to the river's own over FIT.taper; where it is wider, the ground made up
 * from each abutment out to the old bank. `polys` are polygons of rings, outer first.
 */
export function fitRiver(
  polys: Pt[][][],
  sites: BridgeSite[],
  width: (id: string) => number,
  islands: Pt[][] = [],
) {
  let geom = polys as polygonClipping.MultiPolygon
  const inside = (p: Pt, r: Pt[]) => {
    let c = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (
        r[i][1] > p[1] !== r[j][1] > p[1] &&
        p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]
      )
        c = !c
    return c
  }
  for (const s of sites) {
    const side: Pt = [s.axis[1], -s.axis[0]]
    const q = (u: number, v: number): Pt => [
      s.centre[0] + s.axis[0] * u + side[0] * v,
      s.centre[1] + s.axis[1] * u + side[1] * v,
    ]
    const [h, b] = [s.water / 2, width(s.id) / 2 + FIT.beside]
    if (s.moved > 0) {
      const channel: Pt[] = [
        q(-h, -b),
        q(0, -b - FIT.taper),
        q(h, -b),
        q(h, b),
        q(0, b + FIT.taper),
        q(-h, b),
      ]
      // An island it does not land on keeps its shore (the Aemilius' channel would
      // otherwise cut into the Tiber Island's prow).
      let cut: polygonClipping.Geom = [[...channel, channel[0]]]
      for (const isle of islands)
        if (![-1, 1].some((e) => inside(q(e * (h + 5), 0), isle)))
          cut = polygonClipping.difference(cut, [isle])
      geom = polygonClipping.union(geom, cut)
    } else if (s.moved < 0) {
      const f = -s.moved + 20
      for (const e of [-1, 1]) {
        const fill: Pt[] = [
          q(e * h, -b),
          q(e * (h + f), -b - f),
          q(e * (h + f), b + f),
          q(e * h, b),
        ]
        geom = polygonClipping.difference(geom, [[...fill, fill[0]]])
      }
    }
  }
  return geom as Pt[][][]
}

/**
 * A bridge's deck from its design, metres over the water: its height every metre
 * along it, in the order its design gives its arches (the engine's u, from -; at
 * index i, u = from + i), and where its ramps come down to its banks. `bank` is the
 * height of its banks over the water, the same at both ends.
 */
export function deckProfile(design: unknown, bank: number) {
  const d = design as BridgeDesign
  const [, l] = d.size
  const T = total(d)
  const rise = d.rise ?? 0.5
  // Each arch's crown sprung from the water, as the deck must clear it.
  const crowns: Pt[] = []
  let u = -T / 2
  d.spans.forEach((span, i) => {
    const z = d.timber ? TIMBER_DECK_M : BRIDGE.spring + span * rise + BRIDGE.cover
    crowns.push([u + span / 2, z])
    u += span + (d.piers[i] ?? 0)
  })
  // The deck is set by the arches whose crowns stand above a ramp coming down from
  // another's: the small arches beside a great one (the Cestius') spring higher, on
  // taller piers, under the deck it sets.
  const ruling = crowns.filter(([cu, cz]) =>
    crowns.every(([ou, oz]) => cz >= oz - BRIDGE_GRADE * Math.abs(cu - ou) - 1e-6),
  )
  // The upper hull of those crowns: level or rising to the middle, never dipping
  // between arches.
  const hull: Pt[] = []
  for (const c of ruling) {
    while (hull.length >= 2) {
      const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]]
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) hull.pop()
      else break
    }
    hull.push(c)
  }
  // The deck's line: its level approaches, its ramps at BRIDGE_GRADE, and the hull
  // between, each change of grade rounded by a parabolic curve, as a road over a hump
  // is — over a crown along the length of its arch, at a ramp's foot over FOOT_M. A
  // crown is first raised by as much as its curve takes off, so the deck still clears
  // the arch everywhere (the curve never comes under the line it rounds).
  const spanAt = new Map(crowns.map(([cu], i) => [cu, d.spans[i]]))
  const n = hull.length
  // Level where two points stand together (a ramp of no length).
  const slope = (a: Pt, b: Pt) => (b[0] - a[0] > 1e-6 ? (b[1] - a[1]) / (b[0] - a[0]) : 0)
  const tops = hull.map(([x, z], k) => {
    const gIn = k === 0 ? BRIDGE_GRADE : slope(hull[k - 1], hull[k])
    const gOut = k === n - 1 ? -BRIDGE_GRADE : slope(hull[k], hull[k + 1])
    const L = Math.min(
      spanAt.get(x) ?? 0,
      k > 0 ? x - hull[k - 1][0] : Infinity,
      k < n - 1 ? hull[k + 1][0] - x : Infinity,
    )
    return { x, z: z + (Math.max(0, gIn - gOut) * L) / 8, L }
  })
  const [first, last] = [tops[0], tops[n - 1]]
  // Where each ramp reaches its banks.
  const feet = [
    first.x - Math.max(0, first.z - bank) / BRIDGE_GRADE,
    last.x + Math.max(0, last.z - bank) / BRIDGE_GRADE,
  ]
  const foot = (x: number, top: { x: number; L: number }) => ({
    x,
    z: bank,
    L: Math.min(FOOT_M, 2 * Math.max(0, Math.abs(top.x - x) - top.L / 2)),
  })
  const verts = [foot(feet[0], first), ...tops, foot(feet[1], last)]
  // The line through them, level beyond its feet, and each vertex's curve.
  const grade = (k: number) =>
    k < 0 || k >= verts.length - 1
      ? 0
      : slope([verts[k].x, verts[k].z], [verts[k + 1].x, verts[k + 1].z])
  const line = (x: number) => {
    if (x <= verts[0].x) return verts[0].z
    for (let k = 0; k + 1 < verts.length; k++)
      if (x <= verts[k + 1].x) return verts[k].z + grade(k) * (x - verts[k].x)
    return verts[verts.length - 1].z
  }
  const deckAt = (x: number) => {
    for (let k = 0; k < verts.length; k++) {
      const { x: xk, z: zk, L } = verts[k]
      if (L <= 0 || Math.abs(x - xk) >= L / 2) continue
      const [gIn, gOut] = [grade(k - 1), grade(k)]
      return zk + gIn * (x - xk) + ((gOut - gIn) * (x - xk + L / 2) ** 2) / (2 * L)
    }
    return line(x)
  }
  // Its parapets run the length of its ramps, never short of its abutments.
  const ramps: [number, number] = [Math.min(-l / 2, feet[0]), Math.max(l / 2, feet[1])]
  const from = Math.floor(ramps[0] - APPROACH_M)
  const to = Math.ceil(ramps[1] + APPROACH_M)
  const z = Array.from({ length: to - from + 1 }, (_, i) =>
    Math.max(bank, deckAt(from + i)),
  )
  // Each arch's springing over the water, under the deck at its crown.
  const springs = crowns.map(([cu], i) =>
    Math.max(BRIDGE.spring, z[Math.round(cu - from)] - BRIDGE.cover - d.spans[i] * rise),
  )
  return { from, z, ramps, springs, water: T }
}

function area(r: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}
