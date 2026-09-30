import * as THREE from 'three/webgpu'
import type { Frame } from './architecture.ts'
import { type Builder, C } from './builder.ts'

/**
 * A building going up (DESIGN.md §7.7, "Building sites"). The records give when works
 * began and when the building was dedicated, almost never how far they had got in a
 * given year; so what rises when is a convention, the same for every building of a
 * type, drawn from how Roman builders worked:
 *
 * - The podium first: a core of concrete (opus caementicium) poured in lifts inside
 *   retaining walls of tufa, which were its formwork (Platner & Ashby, Aedes
 *   Castoris, on the Augustan podium). Its marble facing, mouldings and steps last,
 *   as the surfaces most easily spoilt by the heavy work above them.
 * - Then the cella's walls, in courses of squared blocks (peperino lined with marble
 *   at Mars Ultor, P&A, Forum Augustum), and the columns with them, raised drum by
 *   drum with cranes (Vitruvius 10.2).
 * - Capitals, finished in the yard and lifted; the architrave, frieze and cornice.
 * - The roof: its timbers first — tie beams, rafters, purlins (Vitruvius 4.2.1) — then
 *   its tiles, laid from the eaves up.
 * - Sculpture on the pediment while the scaffold is still up (Apollo's on the
 *   Palatine, "in fastigio", Pliny NH 36.13); the facing of the podium last.
 *
 * What stands on the site while it is building: free-standing scaffolds of poles,
 * not socketed into the wall, as a marble face could not take putlog holes (J.-P.
 * Adam, Roman Building, 1994, pp. 145–156); a crane of two legs bolted at the head,
 * spread at the foot and held by ropes all round, worked by men treading a wheel at
 * its foot (Vitruvius 10.2.1–3, 10.2.7; the Haterii relief, Vatican Museums inv.
 * 9998), which at the end of the work carried a spray of palm at its head (Adam
 * p. 76); and the yard at its front: tufa blocks, left to season on site (Vitruvius
 * 2.7.5), the marble for the columns and entablature, heaps of lime and sand for
 * the mortar (Vitruvius 2.5.1), timbers and tiles for the roof. No wheelbarrows, no
 * sawn planks decked all round, no turning jibs: none is attested.
 */

/**
 * The height of a course of blocks, metres, and of the steps the works rise by:
 * two Roman feet, the tufa block's usual height (2 × 2 × 4 feet).
 */
export const COURSE = 0.59

type Share = [number, number]

/**
 * When each part of a building rises, as shares of its works' years (from the first,
 * 0, to the dedication, 1): the same seven for every type, so that what a
 * rebuilding kept (`Kept`) and the site round it (`site`) serve them all.
 */
export interface Stages {
  /** The site cleared and dug, the footings laid. */
  ground: Share
  /** Its base: a temple's podium, a basilica's platform. */
  base: Share
  /** Its walls and columns: a temple's cella, a basilica's storeys of arcades. */
  walls: Share
  /** What stands on them: an entablature, a clerestory, a porch. */
  upper: Share
  /** The roof's timbers, then its tiles. */
  roof: Share
  /** Sculpture and the finishing, from the top down. */
  finish: Share
  /** The base faced in marble, the steps laid, the scaffold down. */
  facing: Share
}

/** A temple's works (see above). A convention, not a record. */
export const TEMPLE_WORKS: Stages = {
  ground: [0, 0.08],
  base: [0.08, 0.28],
  walls: [0.28, 0.55],
  upper: [0.55, 0.68],
  roof: [0.68, 0.78],
  finish: [0.78, 0.9],
  facing: [0.9, 1],
}

/** What of a monument survived to be built on again (the record's `kept`). */
export type Kept = 'footings' | 'podium' | 'walls'

/**
 * The works a monument is being built in: `from`–`to` the years of the works,
 * astronomical, and `first`–`last` the years of what is being built now (one stone
 * or form of the monument: buildModel.ts), which what is built is kept within.
 */
export class Works {
  readonly from: number
  readonly to: number
  readonly first: number
  readonly last: number
  /**
   * What of the monument works rebuilding it kept (the record's `kept`); null from
   * bare ground; `finishing` for work on it after its dedication, all of it standing.
   */
  readonly kept: Kept | 'finishing' | null
  /** Whether the works rebuild what a fire left: its ruin is charred, not only pulled down. */
  readonly afterFire: boolean
  /**
   * How far through its type's works what was kept had got, as a share: the parts
   * up to it stand from the first year, and the rest go up over the years left
   * after clearing the ruin. Set by the type's builder (`follow`).
   */
  private keep = 0
  constructor(
    from: number,
    to: number,
    first: number,
    last: number,
    kept: Kept | 'finishing' | null = null,
    afterFire = false,
  ) {
    this.from = from
    this.to = to
    this.first = first
    this.last = last
    this.kept = kept
    this.afterFire = afterFire
  }

  /** How many years the works take. */
  get years() {
    return this.to - this.from + 1
  }

  /** The order of works of its type (`TEMPLE_WORKS`), once its builder takes it up (`follow`). */
  plan: Stages = TEMPLE_WORKS

  /**
   * Takes up its type's order of works: how far through it what was kept had got —
   * the footings, the base, the walls, or, being finished, all but the finishing.
   */
  follow(stages: Stages) {
    this.plan = stages
    const reach = {
      footings: stages.ground[1],
      podium: stages.base[1],
      walls: stages.walls[1],
      finishing: stages.finish[1],
    }
    this.keep = this.kept ? reach[this.kept] : 0
  }

  /** Whether this is work on a building already dedicated: only its scaffold stands round it. */
  get finishing() {
    return this.kept === 'finishing'
  }

  /** Whether the parts going up in `share` survived to be built on. */
  survived(share: Share) {
    return this.keep > 0 && share[1] <= this.keep + 1e-9
  }

  /** The share of the years spent clearing the ruin before rebuilding: its first year. */
  get clearing() {
    return this.keep > 0 && !this.finishing ? Math.min(0.5, 1 / this.years) : 0
  }

  /** A share of the type's works as a share of these: after what was kept and the clearing. */
  private map(share: number) {
    if (!this.keep) return share
    const c = this.clearing
    return share < this.keep ? 0 : c + ((share - this.keep) / (1 - this.keep)) * (1 - c)
  }

  /** The year by which `share` of the works' time has passed. */
  year(share: number) {
    return this.from + Math.min(this.years - 1, Math.floor(share * this.years))
  }

  /**
   * Dates what is built next: it goes up in the years of `share` of the works,
   * rising from `rise[0]` to `rise[1]` metres over them (whole in its first year,
   * without), and stands until the year before the share `end` of the works is
   * reached (1 or more: to their end), or, without, for as long as the monument does.
   * What survived stands whole from the first year.
   */
  stage(b: Builder, share: Share, rise: Share | null = null, end?: number) {
    const kept = this.survived(share)
    const a = kept ? this.from : this.year(this.map(share[0]))
    const z = Math.max(a, this.from + Math.ceil(this.map(share[1]) * this.years) - 1)
    // Taken away the year before the share `end` begins, so that what replaces it
    // never stands in the same year.
    const until =
      end === undefined
        ? this.last
        : end >= 1
          ? this.to
          : Math.max(a, this.year(this.map(end)) - 1)
    const r = kept ? null : rise
    this.date(b, a, until, r && [a, z])
    b.rise = r
  }

  /** Dates what is built next for no year: it is not needed (centering under walls kept). */
  none(b: Builder) {
    b.dates = [1, 0, 1, 0]
    b.rise = null
  }

  /** Dates what is built next for all the works' years. */
  throughout(b: Builder) {
    this.date(b, this.from, this.to, null)
    b.rise = null
  }

  /** Dates what is built next for the clearing of the ruin: the works' first year. */
  clear(b: Builder) {
    this.date(b, this.from, this.from + Math.ceil(this.clearing * this.years) - 1, null)
    b.rise = null
  }

  /** Dates what is built next from year a to z, within this piece, rising over `rising`. */
  private date(b: Builder, a: number, z: number, rising: number[] | null) {
    const [first, last] = [Math.max(a, this.first), Math.min(z, this.last)]
    b.dates = first <= last ? [first, last, ...(rising ?? [1, 0])] : [1, 0, 1, 0]
  }
}

/** Colours of the site (J.-P. Adam and J. G. Landels on timber, rope and iron; the rest the stones'). */
const SITE = {
  /** Weathered timber: the wheel, roof timbers. */
  timber: new THREE.Color('#8A7D6B'),
  /** The crane's legs: heavier timbers, darker for their size. */
  legs: new THREE.Color('#6F604D'),
  /** Scaffold poles, stripped and left in their natural shape: a little darker. */
  pole: new THREE.Color('#7A6D5B'),
  /** Hemp rope. */
  rope: new THREE.Color('#B89F74'),
  /** The core of a podium: concrete in lifts, its rubble grey-brown. */
  core: new THREE.Color('#B9AA8C'),
  /** A wall's courses of peperino. */
  peperino: C.peperino,
  tufa: C.tufaYellow,
  /** The trodden earth of the site, and its spoil. */
  earth: new THREE.Color('#B8A27B'),
  /** The travertine of the footings, under the podium's walls and its column lines. */
  footing: C.travertine,
  lime: new THREE.Color('#EEEAE0'),
  /** A burnt building's rubble, stained by the smoke, and its charred timbers. */
  rubble: new THREE.Color('#8C8274'),
  charred: new THREE.Color('#4A423A'),
  sand: new THREE.Color('#D6C49C'),
  tiles: new THREE.Color('#C07A58'),
  palm: new THREE.Color('#6F7E48'),
}
export { SITE as SITE_COLOURS }

/** A little fixed noise for `i`, 0–1: how far one column or stretch of wall lags the rest. */
export function lag(i: number) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * A straight timber or rope from a to b ([u, v, z] in the frame), `t` thick, square
 * in section, its ends left open (they meet other members or the ground).
 */
export function beam(F: Frame, a: number[], b: number[], t: number, col: THREE.Color) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  const n = d.map((x) => x / len)
  // Two axes across it: the first level, unless it stands upright.
  const up = Math.abs(n[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1]
  const cross = (p: number[], q: number[]) => [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ]
  const unit = (p: number[]) => {
    const l = Math.hypot(p[0], p[1], p[2]) || 1
    return p.map((x) => x / l)
  }
  const e1 = unit(cross(n, up))
  const e2 = unit(cross(e1, n))
  const h = t / 2
  const corner = (p: number[], s1: number, s2: number) => [
    p[0] + (e1[0] * s1 + e2[0] * s2) * h,
    p[1] + (e1[1] * s1 + e2[1] * s2) * h,
    p[2] + (e1[2] * s1 + e2[2] * s2) * h,
  ]
  const ring: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  for (let k = 0; k < 4; k++) {
    const [p, q] = [ring[k], ring[(k + 1) % 4]]
    F.quad(corner(a, ...p), corner(a, ...q), corner(b, ...q), corner(b, ...p), col)
  }
}

/** A flat round of `sides` at height z: a course's bed, seen from above. */
export function disc(
  F: Frame,
  u: number,
  v: number,
  r: number,
  z: number,
  sides: number,
  col: THREE.Color,
) {
  for (let k = 0; k < sides; k++) {
    const [a0, a1] = [(k / sides) * Math.PI * 2, ((k + 1) / sides) * Math.PI * 2]
    F.tri(
      [u, v, z],
      [u + Math.cos(a0) * r, v + Math.sin(a0) * r, z],
      [u + Math.cos(a1) * r, v + Math.sin(a1) * r, z],
      col,
    )
  }
}

/**
 * The beds of the courses laid so far over u0–u1 × v0–v1, from z0 up to z1: a flat
 * top at every course, so that a solid cut part-way up shows the course it has
 * reached, not its hollow inside (the shader draws each only once the works reach it).
 */
export function beds(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z0: number,
  z1: number,
  col: THREE.Color,
  above = -Infinity,
) {
  for (let z = z0 + COURSE; z < z1 - 0.05; z += COURSE)
    if (z > above + 0.05) F.quad([u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z], col)
}

/** A point in a monument's frame: u, v. */
type Pt2 = [number, number]
/** A rectangle in a monument's frame: u0, u1, v0, v1. */
export type Rect = [number, number, number, number]

/** One face of a scaffold: its line of poles from a to b, and the way in to the wall it serves, and how far. */
export interface ScaffoldFace {
  a: Pt2
  b: Pt2
  inward: Pt2
  reach: number
}

/**
 * A building site, as the works of one building lay it out in its frame (its front
 * towards +v): each part stands for the years its type's works need it
 * (`Works.plan`), so the same site serves every type.
 */
export interface SitePlan {
  /** The ground it takes up: trodden earth, till it is paved again. */
  ground: Rect
  /** The footings laid in its first years, when it rises from bare ground. */
  footings: Rect[]
  /** Round footings: rings about a centre, u, v, the inner and outer radius. */
  footingRings?: [number, number, number, number][]
  /** Where the foundations' spoil is heaped. */
  spoil: Pt2
  /** Its scaffolds: faces of poles, standing on z0, rising to `top` over `share`, down before `end`. */
  scaffolds: { faces: ScaffoldFace[]; z0: number; top: number; share: Share; end: number }[]
  /**
   * Its crane: the feet of its legs about `foot`, spread along `spread` (a unit
   * vector), leaning in to its head over the work. At the end of the roofing it
   * carries the palm.
   */
  crane?: { foot: Pt2; spread: Pt2; head: number[] }
  /** The yard: where its stock is laid out, the drums for its columns if it has any, and its stone. */
  yard: { at: Rect; drums?: number; stone: THREE.Color }
  /** The ruin a rebuilding clears in its first year: over what, on how high, and heaps by its flanks. */
  ruin: { at: Rect; z: number; flanks: Pt2[] }
}

/** Lifts of the scaffold, metres: about a day's height of wall (a convention; no figure survives). */
const LIFT = 1.5

/**
 * The works round a building: the site's trodden earth, its footings and spoil or
 * the ruin it rebuilds, its scaffolds, its crane and its yard. Being finished, only
 * the scaffolds stand, for all the works' years.
 */
export function site(F: Frame, s: SitePlan, works: Works) {
  const b = F.b
  const S = works.plan
  const at = (share: Share, rise: Share | null = null, end?: number) =>
    works.stage(b, share, rise, end)
  const occludes = b.occludes
  b.occludes = false
  if (works.finishing) {
    for (const sc of s.scaffolds) {
      works.throughout(b)
      scaffold(F, sc.faces, sc.z0, sc.top)
    }
    b.occludes = occludes
    return
  }
  at(S.ground, null, S.facing[0])
  const [g0, g1, g2, g3] = s.ground
  F.box(g0, g1, g2, g3, -0.3, 0.04, SITE.earth)
  if (works.clearing) ruin(F, s.ruin, works)
  else {
    // The footings, before the base's core covers them: travertine under its walls
    // and under its lines of columns (P&A, Aedes Castoris, on the Augustan podium).
    at(S.ground, null, S.base[0] + 0.01)
    for (const [u0, u1, v0, v1] of s.footings)
      F.box(u0, u1, v0, v1, -0.3, 0.35, SITE.footing)
    for (const [u, v, r0, r1] of s.footingRings ?? [])
      F.ring(u, v, r0, r1, -0.3, 0.35, 20, SITE.footing)
    at(S.ground, null, S.base[1])
    F.drum(s.spoil[0], s.spoil[1], 3.2, 0.6, 0.05, 1.6, 7, SITE.earth)
  }
  for (const sc of s.scaffolds) {
    at(sc.share, [sc.z0, sc.top], sc.end)
    scaffold(F, sc.faces, sc.z0, sc.top)
  }
  if (s.crane) crane(F, s.crane, s.yard.stone, works)
  yardStock(F, s.yard, S, at)
  b.occludes = occludes
}

/**
 * The ruin being cleared, in the first year of works rebuilding: heaps of rubble on
 * what was kept — the base, or the ground where only the footings were — and by its
 * flanks; after a fire, the rubble stained by the smoke, with charred timbers among it.
 */
function ruin(F: Frame, r: SitePlan['ruin'], works: Works) {
  works.clear(F.b)
  const [u0, u1, v0, v1] = r.at
  const z = r.z
  const [cu, cv] = [(u0 + u1) / 2, (v0 + v1) / 2]
  const [hw, hl] = [(u1 - u0) / 2, (v1 - v0) / 2]
  const rubble = works.afterFire ? SITE.rubble : SITE.core
  for (let i = 0; i < 5; i++) {
    const [du, dv] = [(lag(i + 3) - 0.5) * hw * 1.2, (lag(i + 9) - 0.5) * hl * 1.2]
    const rr = 2 + lag(i + 5) * 2
    F.drum(cu + du, cv + dv, rr, rr * 0.25, z, z + 0.8 + lag(i + 7), 7, rubble)
  }
  for (const [u, v] of r.flanks) F.drum(u, v, 2.6, 0.5, 0.04, 1.4, 7, rubble)
  if (!works.afterFire) return
  for (let i = 0; i < 6; i++) {
    const a = lag(i + 21) * Math.PI
    const [u, v] = [
      cu + (lag(i + 13) - 0.5) * hw * 1.4,
      cv + (lag(i + 17) - 0.5) * hl * 1.4,
    ]
    const len = 4 + lag(i + 19) * 5
    const [du, dv] = [(Math.cos(a) * len) / 2, (Math.sin(a) * len) / 2]
    beam(
      F,
      [u - du, v - dv, z + 0.2],
      [u + du, v + dv, z + 0.35 + lag(i) * 0.5],
      0.35,
      SITE.charred,
    )
  }
}

/**
 * A scaffold: along each face a line of poles standing on z0, a runner at every
 * lift and putlogs from every other pole in to the wall, braced across its end bays.
 */
function scaffold(F: Frame, faces: ScaffoldFace[], z0: number, top: number) {
  for (const f of faces) {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
    const n = Math.max(2, Math.round(len / 2.4))
    const pole = (k: number): number[] => [
      f.a[0] + ((f.b[0] - f.a[0]) * k) / n,
      f.a[1] + ((f.b[1] - f.a[1]) * k) / n,
    ]
    for (let k = 0; k <= n; k++) {
      const p = pole(k)
      beam(F, [p[0], p[1], z0], [p[0], p[1], top], 0.16, SITE.pole)
      if (k % 2 === 0 && k > 0 && k < n) {
        const q = [p[0] + f.inward[0] * f.reach, p[1] + f.inward[1] * f.reach]
        for (let z = z0 + LIFT; z < top - 0.3; z += LIFT)
          beam(F, [p[0], p[1], z], [q[0], q[1], z], 0.1, SITE.timber)
      }
    }
    for (let z = z0 + LIFT; z < top - 0.3; z += LIFT)
      beam(F, [f.a[0], f.a[1], z], [f.b[0], f.b[1], z], 0.12, SITE.timber)
    // Braces across the end bays, a lift at a time.
    const [p0, p1, q0, q1] = [pole(0), pole(1), pole(n - 1), pole(n)]
    for (let z = z0; z + LIFT <= top; z += LIFT) {
      beam(F, [p0[0], p0[1], z], [p1[0], p1[1], z + LIFT], 0.1, SITE.pole)
      beam(F, [q1[0], q1[1], z], [q0[0], q0[1], z + LIFT], 0.1, SITE.pole)
    }
  }
}

/**
 * The crane (Vitruvius 10.2): two legs bolted together at the head and spread at the
 * foot, leaning in over the wall; ropes from the head to stakes behind it; the
 * hoisting tackle hanging from the head with a block in its grips; at its foot the
 * great wheel, trodden by men, on the axle the rope winds on. At the end of the
 * roofing it carries the palm (the Haterii relief).
 */
function crane(
  F: Frame,
  c: NonNullable<SitePlan['crane']>,
  stone: THREE.Color,
  works: Works,
) {
  const S = works.plan
  const b = F.b
  const head = c.head
  const hc = head[2]
  const [su, sv] = c.spread
  // Out: from the head over the work back to the foot, level.
  const ou0 = c.foot[0] - head[0]
  const ov0 = c.foot[1] - head[1]
  const ol = Math.hypot(ou0, ov0) || 1
  const [ou, ov] = [ou0 / ol, ov0 / ol]
  const R = 2.4
  const spread = hc * 0.3
  const legs = [
    [c.foot[0] - (su * spread) / 2, c.foot[1] - (sv * spread) / 2, 0],
    [c.foot[0] + (su * spread) / 2, c.foot[1] + (sv * spread) / 2, 0],
  ]
  const along = (p: number[], t: number) => p.map((x, i) => x + (head[i] - x) * t)
  works.stage(b, [S.base[0], S.finish[1]], null, S.facing[0])
  const standing = b.dates
  for (const g of legs) beam(F, g, head, 0.46, SITE.legs)
  // A spreader between the legs, above the wheel.
  const sp = (2 * R + 1.2) / hc
  beam(F, along(legs[0], sp), along(legs[1], sp), 0.22, SITE.timber)
  // The wheel: two rims of ten, spokes to the hub, treads between the rims; it turns
  // in the plane across the axle, which runs between the legs.
  const ax = (R + 0.15) / hc
  const [A, B] = [along(legs[0], ax), along(legs[1], ax)]
  beam(F, A, B, 0.26, SITE.timber)
  const hub = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, A[2]]
  const rim = (k: number, d: number) => {
    const a = (k / 10) * Math.PI * 2
    return [
      hub[0] + ou * Math.cos(a) * R + su * d,
      hub[1] + ov * Math.cos(a) * R + sv * d,
      hub[2] + Math.sin(a) * R,
    ]
  }
  for (const d of [-0.65, 0.65]) {
    for (let k = 0; k < 10; k++) {
      beam(F, rim(k, d), rim(k + 1, d), 0.16, SITE.timber)
      beam(F, [hub[0] + su * d, hub[1] + sv * d, hub[2]], rim(k, d), 0.1, SITE.timber)
    }
  }
  for (let k = 0; k < 10; k++)
    beam(F, rim(k + 0.5, -0.65), rim(k + 0.5, 0.65), 0.1, SITE.timber)
  // Ropes: two stays back to stakes, the fall to the tackle, the drive to the axle.
  const out = [c.foot[0] + ou * hc * 0.55, c.foot[1] + ov * hc * 0.55]
  for (const d of [-hc * 0.3, hc * 0.3]) {
    const [u, v] = [out[0] + su * d, out[1] + sv * d]
    beam(F, head, [u, v, 0.6], 0.06, SITE.rope)
    beam(F, [u, v, -0.4], [u + ou * 0.25, v + ov * 0.25, 0.7], 0.14, SITE.pole)
  }
  const drop = hc - 3.4
  for (const d of [-0.12, 0.12])
    beam(
      F,
      [head[0] + su * d, head[1] + sv * d, hc],
      [head[0] + su * d, head[1] + sv * d, drop + 0.35],
      0.06,
      SITE.rope,
    )
  beam(F, head, hub, 0.06, SITE.rope)
  // What it lifts: a block in its grips, long along the spread.
  F.obox(head[0], head[1], Math.atan2(su, sv), 0.9, 2.2, drop - 0.7, drop, stone)
  // The palm at its head, once the roof is on.
  // Never after the crane is gone: in works of few years the two can fall in one.
  works.stage(b, S.finish, null, S.facing[0])
  if (b.dates[0] > standing[1])
    b.dates = standing[0] <= standing[1] ? [standing[1], standing[1], 1, 0] : [1, 0, 1, 0]
  F.drum(head[0], head[1], 0.3, 0.3, hc, hc + 0.5, 6, SITE.rope)
  F.drum(head[0], head[1], 0.15, 0.9, hc + 0.4, hc + 2.2, 6, SITE.palm)
}

/**
 * The yard: tufa for the base and walls, drums for the columns, blocks for the
 * entablature, roof timbers and tiles, lime and sand. Each is there from a little
 * before it is wanted until it is used.
 */
function yardStock(
  F: Frame,
  y: SitePlan['yard'],
  S: Stages,
  at: (s: Share, r?: Share | null, e?: number) => void,
) {
  const [u0, u1, v0, v1] = y.at
  const w = u1 - u0
  const um = (u0 + u1) / 2
  const stone = y.stone
  // Tufa, stacked in courses: two feet by two by four.
  at([S.ground[0], S.walls[0]], null, S.walls[1])
  const tu = u0 + 1
  for (let z = 0; z < 3; z++)
    for (let i = 0; i < 3 - (z === 2 ? 1 : 0); i++)
      for (let j = 0; j < 3; j++) {
        const u = tu + i * 1.24
        const v = v0 + 0.5 + j * 0.64
        F.box(u, u + 1.18, v, v + 0.59, z * 0.59, z * 0.59 + 0.59, SITE.tufa)
      }
  // Lime and sand for the mortar.
  at([S.ground[0], S.base[1]], null, S.roof[1])
  F.drum(tu + 6.2, v0 + 1.8, 1.7, 0.25, 0, 1.1, 8, SITE.lime)
  F.drum(tu + 9.4, v0 + 2.2, 2.1, 0.3, 0, 1.3, 8, SITE.sand)
  // The columns' drums, standing, and one on its side.
  if (y.drums) {
    at([S.base[0], S.walls[0]], null, S.walls[1])
    const r = y.drums / 2
    const du = um + w * 0.08
    for (let i = 0; i < 4; i++)
      F.drum(du + i * (r * 2 + 0.4), v0 + 1 + (i % 2) * 0.5, r, r, 0, 1.2, 10, stone)
    lyingDrum(F, du + 1.5, v0 + 4.2, r, 1.2, stone)
  }
  // Blocks for the architrave and frieze, and a capital roughed out.
  at([S.walls[0], S.walls[1]], null, S.upper[1])
  const eu = u1 - 4.5
  F.box(eu, eu + 3.2, v0 + 0.5, v0 + 1.4, 0, 0.85, stone)
  F.box(eu, eu + 3.2, v0 + 1.6, v0 + 2.5, 0, 0.85, stone)
  F.box(eu + 0.3, eu + 3.5, v0 + 0.9, v0 + 1.8, 0.85, 1.7, stone)
  F.box(eu - 2.4, eu - 0.9, v0 + 3, v0 + 4.5, 0, 0.7, stone)
  // The roof's timbers and its tiles, stacked.
  at([S.upper[0], S.roof[0]], null, S.roof[1])
  for (let i = 0; i < 4; i++) {
    const z = i < 3 ? 0.15 : 0.45
    const v = v1 - 2.6 + (i < 3 ? i * 0.34 : 0.34)
    beam(F, [um - w * 0.3, v, z], [um + w * 0.2, v, z], 0.3, SITE.timber)
  }
  for (let i = 0; i < 3; i++) {
    const u = um + w * 0.26 + i * 1.3
    F.box(u, u + 1.1, v1 - 3, v1 - 1.9, 0, 0.8, SITE.tiles)
  }
}

/** A temple's layout, as its works need it (architecture.ts `temple`). */
export interface TempleSite {
  /** Across and along its podium; its front at +l/2. */
  w: number
  l: number
  /** The podium's height; the top of the entablature. */
  podium: number
  top: number
  /** The cella: u0, u1, v0, v1. */
  cella: Rect
  /** The columns' lower diameter. */
  column: number
  /** The stone of its columns and entablature, for the yard's blocks. */
  face: THREE.Color
  /** Which flank the crane stands on: +1 the right, -1 the left. */
  crane?: 1 | -1
}

/**
 * The site round a temple: the scaffold round the cella's flanks and back, the crane
 * on one flank leaning over the cella's wall, the yard before its front.
 */
export function templeSite(F: Frame, s: TempleSite, works: Works) {
  const S = works.plan
  const [w, l] = [s.w, s.l]
  const [front, back] = [l / 2, -l / 2]
  const [cu0, cu1, cv0, cv1] = s.cella
  const T = 1.4
  const off = Math.max(1.1, w / 2 - cu1 + 1)
  const side = s.crane ?? 1
  const vm = (cv0 + cv1) / 2
  site(
    F,
    {
      ground: [-w / 2 - 1.5, w / 2 + 1.5, back - 1.5, front + 9.3],
      footings: [
        [-w / 2, w / 2, back, back + T],
        [-w / 2, w / 2, front - T, front],
        [-w / 2, -w / 2 + T, back, front],
        [w / 2 - T, w / 2, back, front],
        [cu0, cu0 + T, cv0, front],
        [cu1 - T, cu1, cv0, front],
        [cu0, cu1, cv1 - T, cv1],
      ],
      spoil: [-w / 2 - 1, back - 1],
      scaffolds: [
        {
          faces: ringFaces([cu0, cu1, cv0, cv1], off, [true, true, false, true]),
          z0: 0,
          top: s.top + 1.2,
          share: [S.base[0], S.upper[1]],
          end: S.facing[0],
        },
      ],
      crane: {
        // Its foot clear of the scaffold, with room for the wheel.
        foot: [side * (w / 2 + 4.6), vm],
        spread: [0, 1],
        head: [(side > 0 ? cu1 : cu0) - side * 0.4, vm, s.top + 3],
      },
      yard: { at: [-w / 2, w / 2, front + 1.2, front + 9], drums: s.column, stone: s.face },
      ruin: {
        at: s.cella,
        z: works.survived(S.base) ? s.podium : 0,
        flanks: [
          [-(w / 2 + 2.5), vm],
          [w / 2 + 2.5, vm],
        ],
      },
    },
    works,
  )
}

/** A round temple's layout, as its works need it (architecture.ts `tholos`). */
export interface RoundSite {
  /** Its centre in the frame of its ground, and the ground's height under it (its platform's top, if on one). */
  centre: Pt2
  base: number
  /** Its podium's radius, the podium's top and the entablature's, over the ground. */
  radius: number
  podium: number
  top: number
  /** The cella's radius, and the columns' lower diameter. */
  cella: number
  column: number
  face: THREE.Color
  /** Which flank the crane stands on: +1 the right, -1 the left. */
  side: 1 | -1
  /** Where the yard begins, before its front. */
  yard: number
  /** The long platform it stands at the back of, across, along and high, if any. */
  platform?: [number, number, number]
}

/**
 * The site round a round temple: a ring of scaffold round its colonnade, the crane
 * on one flank leaning over the cella's wall, the yard before its front, round
 * footings under the podium's edge and the cella's wall.
 */
export function templeSiteRound(F: Frame, s: RoundSite, works: Works) {
  const S = works.plan
  const [cu, cv] = s.centre
  const R = s.radius
  const [w, back] = s.platform ? [s.platform[0], -s.platform[1] / 2] : [2 * R, cv - R]
  const off = 1.2
  site(
    F,
    {
      ground: [-w / 2 - 1.5, w / 2 + 1.5, back - 1.5, s.yard + 8.3],
      footings: [],
      footingRings: [
        [cu, cv, R - 1.4, R],
        [cu, cv, s.cella - 1.2, s.cella],
      ],
      spoil: [-w / 2 - 1, back - 1],
      scaffolds: [
        {
          faces: roundFaces(cu, cv, R + off, 10, off + s.column * 0.4),
          z0: s.base,
          top: s.top + 1.2,
          share: [S.base[0], S.upper[1]],
          end: S.facing[0],
        },
      ],
      crane: {
        foot: [cu + s.side * (R + off + 3.6), cv],
        spread: [0, 1],
        head: [cu + s.side * (s.cella - 0.4), cv, s.top + 3],
      },
      yard: {
        at: [-Math.max(R, 7), Math.max(R, 7), s.yard, s.yard + 8],
        drums: s.column,
        stone: s.face,
      },
      ruin: {
        at: [cu - s.cella, cu + s.cella, cv - s.cella, cv + s.cella],
        z: works.survived(S.base) ? s.podium : s.base,
        flanks: [
          [cu - (R + 2.5), cv],
          [cu + R + 2.5, cv],
        ],
      },
    },
    works,
  )
}

/**
 * The faces of a scaffold standing round a circle of radius `r` about (u, v), in `n`
 * straight runs, each reaching `reach` in towards the centre.
 */
export function roundFaces(u: number, v: number, r: number, n: number, reach: number) {
  const faces: ScaffoldFace[] = []
  for (let k = 0; k < n; k++) {
    const [a0, a1] = [(k / n) * Math.PI * 2, ((k + 1) / n) * Math.PI * 2]
    const am = (a0 + a1) / 2
    faces.push({
      a: [u + Math.cos(a0) * r, v + Math.sin(a0) * r],
      b: [u + Math.cos(a1) * r, v + Math.sin(a1) * r],
      inward: [-Math.cos(am), -Math.sin(am)],
      reach,
    })
  }
  return faces
}

/**
 * The beds of the courses laid so far round a round wall between radii r0 and r1
 * about (u, v), from z0 up to z1: a drum's wall seen from above as a wall.
 */
export function roundBeds(
  F: Frame,
  u: number,
  v: number,
  r0: number,
  r1: number,
  z0: number,
  z1: number,
  sides: number,
  col: THREE.Color,
) {
  const at = (k: number, r: number, z: number) => {
    const a = (k / sides) * Math.PI * 2
    return [u + Math.cos(a) * r, v + Math.sin(a) * r, z]
  }
  for (let z = z0 + COURSE; z < z1 - 0.05; z += COURSE)
    for (let k = 0; k < sides; k++)
      F.quad(at(k, r0, z), at(k + 1, r0, z), at(k + 1, r1, z), at(k, r1, z), col)
}

/**
 * The faces of a scaffold standing `off` out from a rectangle's sides, on those
 * named (right, left, front, back — +u, -u, +v, -v), each reaching in to its wall.
 */
export function ringFaces(
  [u0, u1, v0, v1]: Rect,
  off: number,
  [right, left, front, back]: [boolean, boolean, boolean, boolean],
): ScaffoldFace[] {
  const faces: ScaffoldFace[] = []
  const [a0, a1] = [v0 - (back ? off : 0), v1 + (front ? off : 0)]
  const [b0, b1] = [u0 - (left ? off : 0), u1 + (right ? off : 0)]
  const reach = off - 0.05
  if (right) faces.push({ a: [u1 + off, a0], b: [u1 + off, a1], inward: [-1, 0], reach })
  if (left) faces.push({ a: [u0 - off, a0], b: [u0 - off, a1], inward: [1, 0], reach })
  if (back) faces.push({ a: [b0, v0 - off], b: [b1, v0 - off], inward: [0, 1], reach })
  if (front) faces.push({ a: [b0, v1 + off], b: [b1, v1 + off], inward: [0, -1], reach })
  return faces
}

/** A drum lying on its side along u, centred at (u, v). */
function lyingDrum(
  F: Frame,
  u: number,
  v: number,
  r: number,
  len: number,
  col: THREE.Color,
) {
  const sides = 10
  const at = (k: number, du: number) => {
    const a = (k / sides) * Math.PI * 2
    return [u + du, v + Math.cos(a) * r, r + Math.sin(a) * r]
  }
  for (let k = 0; k < sides; k++) {
    F.quad(at(k, -len / 2), at(k + 1, -len / 2), at(k + 1, len / 2), at(k, len / 2), col)
    F.tri([u - len / 2, v, r], at(k, -len / 2), at(k + 1, -len / 2), col)
    F.tri([u + len / 2, v, r], at(k, len / 2), at(k + 1, len / 2), col)
  }
}

/**
 * The roof's timbers over u0–u1 × v0–v1, its ridge along `along`, from its eaves at
 * z to its ridge at apex, a little under where the tiles will lie: pairs of rafters
 * a metre and a half apart, tie beams across every other pair, and the ridge beam.
 */
export function rafters(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z: number,
  apex: number,
  along: 'u' | 'v' = 'v',
) {
  // Work in (a, c): a along the ridge, c across it.
  const [a0, a1, c0, c1] = along === 'v' ? [v0, v1, u0, u1] : [u0, u1, v0, v1]
  const P = (a: number, c: number, zz: number) => (along === 'v' ? [c, a, zz] : [a, c, zz])
  const cm = (c0 + c1) / 2
  const n = Math.max(2, Math.round((a1 - a0) / 1.5))
  for (let k = 0; k <= n; k++) {
    const a = a0 + 0.3 + ((a1 - a0 - 0.6) * k) / n
    beam(F, P(a, c0 + 0.2, z - 0.1), P(a, cm, apex - 0.28), 0.22, SITE.timber)
    beam(F, P(a, c1 - 0.2, z - 0.1), P(a, cm, apex - 0.28), 0.22, SITE.timber)
    if (k % 2 === 0)
      beam(F, P(a, c0 + 0.3, z + 0.05), P(a, c1 - 0.3, z + 0.05), 0.24, SITE.timber)
  }
  beam(F, P(a0 + 0.3, cm, apex - 0.3), P(a1 - 0.3, cm, apex - 0.3), 0.26, SITE.timber)
}

/**
 * The beds of the courses laid so far round the walls of u0–u1 × v0–v1, `T` thick,
 * from z0 up to z1: a hall's walls seen from above as walls, not as the edges of a
 * hollow box.
 */
export function ringBeds(
  F: Frame,
  [u0, u1, v0, v1]: Rect,
  T: number,
  z0: number,
  z1: number,
  col: THREE.Color,
) {
  for (const [a, b, c, d] of [
    [u0, u1, v0, v0 + T],
    [u0, u1, v1 - T, v1],
    [u0, u0 + T, v0 + T, v1 - T],
    [u1 - T, u1, v0 + T, v1 - T],
  ])
    beds(F, a, b, c, d, z0, z1, col)
}

/**
 * The timber centering under an arch from sa to sb (along u) in a wall from v to
 * v + depth, springing at `spring` to its crown at `crown`: "at least two arcs of a
 * circle made of wood and solidly braced" (J.-P. Adam, Roman Building, p. 357), a
 * rib a little under the soffit at either face on a chord at the springing, and
 * laggings across them for the voussoirs to lie on. It stands at the springing,
 * "very frequently chosen by the Romans … to save on wood" (the same); no ledges are
 * drawn for it, as none are known on the arcades of Rome. It is struck once the arch
 * is closed, and "moved along to put up the next section" (p. 358). No Roman picture
 * of it survives (p. 358): the sizes are a guess.
 */
export function centering(
  F: Frame,
  sa: number,
  sb: number,
  v: number,
  depth: number,
  spring: number,
  crown: number,
) {
  const N = 4
  const r = (sb - sa) / 2 - 0.1
  const rise = crown - spring - 0.12
  const um = (sa + sb) / 2
  const arc = (k: number, vv: number) => {
    const a = Math.PI * (1 - k / N)
    return [um + Math.cos(a) * r, vv, spring + Math.sin(a) * rise]
  }
  for (const vv of [v + 0.3, v + depth - 0.3]) {
    for (let k = 0; k < N; k++) beam(F, arc(k, vv), arc(k + 1, vv), 0.2, SITE.timber)
    beam(F, [sa + 0.05, vv, spring - 0.1], [sb - 0.05, vv, spring - 0.1], 0.2, SITE.timber)
  }
  for (let k = 1; k < N; k++)
    beam(F, arc(k, v + 0.15), arc(k, v + depth - 0.15), 0.12, SITE.pole)
}

/**
 * A basilica's works: its platform, then its storeys of arcades one after another,
 * each on centering; its clerestory over the nave (Vitruvius 5.1.6–7); a truss over
 * each pier for the nave (5.1.9) and the tiles; the marble last. A convention
 * (DESIGN.md, "Building sites"), not a record.
 */
export const BASILICA_WORKS: Stages = {
  ground: [0, 0.06],
  base: [0.06, 0.15],
  walls: [0.15, 0.5],
  upper: [0.5, 0.65],
  roof: [0.65, 0.8],
  finish: [0.8, 0.88],
  facing: [0.88, 1],
}

/**
 * A senate house's works: its podium, its tall walls, the trusses over its hall and
 * the tiles, then its porch and the Victory on its gable (the porch late, as the
 * chalcidicum beside the Curia Julia, RG 19), the facing and steps. A convention,
 * not a record.
 */
export const CURIA_WORKS: Stages = {
  ground: [0, 0.05],
  base: [0.05, 0.15],
  walls: [0.15, 0.55],
  upper: [0.55, 0.6],
  roof: [0.6, 0.75],
  finish: [0.75, 0.9],
  facing: [0.9, 1],
}

/**
 * The works of a building of a type with no stages of its own (monuments.ts
 * `rising`): cleared and footed, then the whole of it rising over most of its years,
 * the facing last. A convention, not a record.
 */
export const GENERAL_WORKS: Stages = {
  ground: [0, 0.06],
  base: [0.06, 0.12],
  walls: [0.12, 0.5],
  upper: [0.5, 0.7],
  roof: [0.7, 0.85],
  finish: [0.85, 0.92],
  facing: [0.92, 1],
}

/** A share `i` of `n` parts of a share of the works: the years of one storey of several. */
export function part([a, b]: Share, i: number, n: number): Share {
  return [a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n]
}
