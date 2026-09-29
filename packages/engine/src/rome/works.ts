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

/**
 * When each part of a temple rises, as shares of its works' years (from the first,
 * 0, to the dedication, 1). A convention (see above), not a record.
 */
export const TEMPLE_WORKS = {
  /** The site cleared and dug, the footings laid. */
  ground: [0, 0.08],
  /** The podium's core. */
  podium: [0.08, 0.28],
  /** The cella's walls and the columns. */
  walls: [0.28, 0.55],
  /** Capitals set, architrave, frieze and cornice. */
  entablature: [0.55, 0.68],
  /** The roof's timbers, then its tiles. */
  roof: [0.68, 0.78],
  /** The pediment's figures; the fluting and finishing, from the top down. */
  sculpture: [0.78, 0.9],
  /** The podium faced in marble, the steps laid, the scaffold down. */
  facing: [0.9, 1],
} satisfies Record<string, [number, number]>

type Share = [number, number]
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

  /** Takes up a type's order of works (`TEMPLE_KEPT`): how far what was kept had got. */
  follow(order: Record<Kept | 'finishing', number>) {
    this.keep = this.kept ? order[this.kept] : 0
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

/**
 * What of a temple works rebuilding it kept, as a share of its works
 * (`TEMPLE_WORKS`); being finished, all but the finishing.
 */
export const TEMPLE_KEPT: Record<Kept | 'finishing', number> = {
  footings: TEMPLE_WORKS.ground[1],
  podium: TEMPLE_WORKS.podium[1],
  walls: TEMPLE_WORKS.walls[1],
  finishing: TEMPLE_WORKS.sculpture[1],
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

/** A temple's layout, as its works need it (architecture.ts `temple`). */
export interface TempleSite {
  /** Across and along its podium; its front at +l/2. */
  w: number
  l: number
  /** The podium's height; the top of the entablature; the ridge. */
  podium: number
  top: number
  apex: number
  /** The cella: u0, u1, v0, v1. */
  cella: [number, number, number, number]
  /** The columns' lower diameter. */
  column: number
  /** The stone of its columns and entablature, for the yard's blocks. */
  face: THREE.Color
  /** Which flank the crane stands on: +1 the right, -1 the left. */
  crane?: 1 | -1
}

/** Lifts of the scaffold, metres: about a day's height of wall (a convention; no figure survives). */
const LIFT = 1.5

/**
 * The works round a temple: the site's trodden earth, the scaffold round the cella,
 * the crane on one flank and the yard before its front. Each part stands only for
 * the years it is needed (`TEMPLE_WORKS`).
 */
export function templeSite(F: Frame, s: TempleSite, works: Works) {
  const b = F.b
  const S = TEMPLE_WORKS
  const at = (share: Share, rise: Share | null = null, end?: number) =>
    works.stage(b, share, rise, end)
  const [w, l] = [s.w, s.l]
  const [front, back] = [l / 2, -l / 2]
  const occludes = b.occludes
  if (works.finishing) {
    // After the dedication only the scaffold is left: no crane, no yard.
    b.occludes = false
    scaffold(F, s, () => works.throughout(b))
    b.occludes = occludes
    return
  }

  // The site: trodden earth round the podium and over the yard, till it is paved again.
  at(S.ground, null, S.facing[0])
  const yard: Share = [front + 1.2, front + 9]
  F.box(-w / 2 - 1.5, w / 2 + 1.5, back - 1.5, yard[1] + 0.3, -0.3, 0.04, SITE.earth)
  if (works.clearing) ruin(F, s, works)
  else {
    // The footings, before the podium's core covers them: travertine under its walls
    // and under the lines of columns (P&A, Aedes Castoris, on the Augustan podium).
    at(S.ground, null, S.podium[0] + 0.01)
    const [cu0, cu1, cv0, cv1] = s.cella
    const T = 1.4
    for (const [u0, u1, v0, v1] of [
      [-w / 2, w / 2, back, back + T],
      [-w / 2, w / 2, front - T, front],
      [-w / 2, -w / 2 + T, back, front],
      [w / 2 - T, w / 2, back, front],
      [cu0, cu0 + T, cv0, front],
      [cu1 - T, cu1, cv0, front],
      [cu0, cu1, cv1 - T, cv1],
    ])
      F.box(u0, u1, v0, v1, -0.3, 0.35, SITE.footing)
    // The spoil from the foundations, heaped by a back corner.
    at(S.ground, null, S.podium[1])
    F.drum(-w / 2 - 1, back - 1, 3.2, 0.6, 0.05, 1.6, 7, SITE.earth)
  }

  b.occludes = false
  scaffold(F, s, at)
  crane(F, s, at)
  yardStock(F, s, yard, at)
  b.occludes = occludes
}

/**
 * The ruin being cleared, in the first year of works rebuilding a temple: heaps of
 * rubble on what was kept — the podium, or the ground where only the footings were
 * — and by its flanks; after a fire, the rubble stained by the smoke, with charred
 * timbers among it.
 */
function ruin(F: Frame, s: TempleSite, works: Works) {
  works.clear(F.b)
  const S = TEMPLE_WORKS
  const z = works.survived(S.podium) ? s.podium : 0
  const [cu0, cu1, cv0, cv1] = s.cella
  const [cu, cv] = [(cu0 + cu1) / 2, (cv0 + cv1) / 2]
  const [hw, hl] = [(cu1 - cu0) / 2, (cv1 - cv0) / 2]
  const rubble = works.afterFire ? SITE.rubble : SITE.core
  for (let i = 0; i < 5; i++) {
    const [du, dv] = [(lag(i + 3) - 0.5) * hw * 1.2, (lag(i + 9) - 0.5) * hl * 1.2]
    const r = 2 + lag(i + 5) * 2
    F.drum(cu + du, cv + dv, r, r * 0.25, z, z + 0.8 + lag(i + 7), 7, rubble)
  }
  for (const side of [-1, 1])
    F.drum(side * (s.w / 2 + 2.5), cv, 2.6, 0.5, 0.04, 1.4, 7, rubble)
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
 * The scaffold: poles standing clear of the cella's flanks and back, a runner along
 * each face at every lift and putlogs from every other pole in to the wall. It
 * rises with the walls and comes down before the facing.
 */
function scaffold(
  F: Frame,
  s: TempleSite,
  at: (s: Share, r?: Share | null, e?: number) => void,
) {
  const S = TEMPLE_WORKS
  const [cu0, cu1, cv0, cv1] = s.cella
  const top = s.top + 1.2
  at([S.podium[0], S.entablature[1]], [0, top], S.facing[0])
  const off = Math.max(1.1, s.w / 2 - cu1 + 1)
  // Each face: its line of poles and the way in to the wall it serves.
  const faces: { a: number[]; b: number[]; inward: number[] }[] = [
    { a: [cu1 + off, cv0 - off], b: [cu1 + off, cv1], inward: [-1, 0] },
    { a: [cu0 - off, cv0 - off], b: [cu0 - off, cv1], inward: [1, 0] },
    { a: [cu0 - off, cv0 - off], b: [cu1 + off, cv0 - off], inward: [0, 1] },
  ]
  for (const f of faces) {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
    const n = Math.max(2, Math.round(len / 2.4))
    const pole = (k: number): number[] => [
      f.a[0] + ((f.b[0] - f.a[0]) * k) / n,
      f.a[1] + ((f.b[1] - f.a[1]) * k) / n,
    ]
    for (let k = 0; k <= n; k++) {
      const p = pole(k)
      beam(F, [p[0], p[1], 0], [p[0], p[1], top], 0.16, SITE.pole)
      if (k % 2 === 0 && k > 0 && k < n) {
        const q = [p[0] + f.inward[0] * (off - 0.05), p[1] + f.inward[1] * (off - 0.05)]
        for (let z = LIFT; z < top - 0.3; z += LIFT)
          beam(F, [p[0], p[1], z], [q[0], q[1], z], 0.1, SITE.timber)
      }
    }
    for (let z = LIFT; z < top - 0.3; z += LIFT)
      beam(F, [f.a[0], f.a[1], z], [f.b[0], f.b[1], z], 0.12, SITE.timber)
    // Braces across the end bays, a lift at a time.
    const [p0, p1, q0, q1] = [pole(0), pole(1), pole(n - 1), pole(n)]
    for (let z = 0; z + LIFT <= top; z += LIFT) {
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
  s: TempleSite,
  at: (s: Share, r?: Share | null, e?: number) => void,
) {
  const S = TEMPLE_WORKS
  const side = s.crane ?? 1
  const [cu0, cu1, cv0, cv1] = s.cella
  const wallU = side > 0 ? cu1 : cu0
  const vm = (cv0 + cv1) / 2
  // Its foot clear of the scaffold, with room for the wheel.
  const R = 2.4
  const foot = side * (s.w / 2 + 2.2 + R)
  const hc = s.top + 3
  const head = [wallU - side * 0.4, vm, hc]
  const spread = hc * 0.3
  const legs = [
    [foot, vm - spread / 2, 0],
    [foot, vm + spread / 2, 0],
  ]
  const along = (p: number[], t: number) => p.map((x, i) => x + (head[i] - x) * t)
  at([S.podium[0], S.sculpture[1]], null, S.facing[0])
  for (const g of legs) beam(F, g, head, 0.46, SITE.legs)
  // A spreader between the legs, above the wheel.
  const sp = (2 * R + 1.2) / hc
  beam(F, along(legs[0], sp), along(legs[1], sp), 0.22, SITE.timber)
  // The wheel: two rims of ten, spokes to the hub, treads between the rims.
  const ax = (R + 0.15) / hc
  const [A, B] = [along(legs[0], ax), along(legs[1], ax)]
  beam(F, A, B, 0.26, SITE.timber)
  const hub = [(A[0] + B[0]) / 2, vm, A[2]]
  const rim = (k: number, dv: number) => {
    const a = (k / 10) * Math.PI * 2
    return [hub[0] + Math.cos(a) * R, vm + dv, hub[2] + Math.sin(a) * R]
  }
  for (const dv of [-0.65, 0.65]) {
    for (let k = 0; k < 10; k++) {
      beam(F, rim(k, dv), rim(k + 1, dv), 0.16, SITE.timber)
      beam(F, [hub[0], vm + dv, hub[2]], rim(k, dv), 0.1, SITE.timber)
    }
  }
  for (let k = 0; k < 10; k++)
    beam(F, rim(k + 0.5, -0.65), rim(k + 0.5, 0.65), 0.1, SITE.timber)
  // Ropes: two stays back to stakes, the fall to the tackle, the drive to the axle.
  const out = foot + side * hc * 0.55
  for (const dv of [-hc * 0.3, hc * 0.3]) {
    const stake = [out, vm + dv, 0.6]
    beam(F, head, stake, 0.06, SITE.rope)
    beam(F, [out, vm + dv, -0.4], [out + side * 0.25, vm + dv, 0.7], 0.14, SITE.pole)
  }
  const block = [head[0], vm, hc - 3.4]
  beam(F, [head[0], vm - 0.12, hc], [block[0], vm - 0.12, block[2] + 0.35], 0.06, SITE.rope)
  beam(F, [head[0], vm + 0.12, hc], [block[0], vm + 0.12, block[2] + 0.35], 0.06, SITE.rope)
  beam(F, head, [hub[0], vm, hub[2]], 0.06, SITE.rope)
  // What it lifts: a block of the entablature in its grips.
  F.box(
    block[0] - 0.45,
    block[0] + 0.45,
    vm - 1.1,
    vm + 1.1,
    block[2] - 0.7,
    block[2],
    s.face,
  )
  // The palm at its head, once the roof is on.
  at(S.sculpture, null, S.facing[0])
  F.drum(head[0], vm, 0.3, 0.3, hc, hc + 0.5, 6, SITE.rope)
  F.drum(head[0], vm, 0.15, 0.9, hc + 0.4, hc + 2.2, 6, SITE.palm)
}

/**
 * The yard before the temple's front: tufa for the podium and walls, drums for the
 * columns, blocks for the entablature, roof timbers and tiles, lime and sand. Each
 * is there from a little before it is wanted until it is used.
 */
function yardStock(
  F: Frame,
  s: TempleSite,
  yard: Share,
  at: (s: Share, r?: Share | null, e?: number) => void,
) {
  const S = TEMPLE_WORKS
  const w = s.w
  const [v0, v1] = yard
  const face = s.face
  // Tufa, stacked in courses: two feet by two by four.
  at([S.ground[0], S.walls[0]], null, S.walls[1])
  const tu = -w / 2 + 1
  for (let z = 0; z < 3; z++)
    for (let i = 0; i < 3 - (z === 2 ? 1 : 0); i++)
      for (let j = 0; j < 3; j++) {
        const u = tu + i * 1.24
        const v = v0 + 0.5 + j * 0.64
        F.box(u, u + 1.18, v, v + 0.59, z * 0.59, z * 0.59 + 0.59, SITE.tufa)
      }
  // Lime and sand for the mortar.
  at([S.ground[0], S.podium[1]], null, S.roof[1])
  F.drum(tu + 6.2, v0 + 1.8, 1.7, 0.25, 0, 1.1, 8, SITE.lime)
  F.drum(tu + 9.4, v0 + 2.2, 2.1, 0.3, 0, 1.3, 8, SITE.sand)
  // The columns' drums, standing, and one on its side.
  at([S.podium[0], S.walls[0]], null, S.walls[1])
  const r = s.column / 2
  const du = w * 0.08
  for (let i = 0; i < 4; i++)
    F.drum(du + i * (r * 2 + 0.4), v0 + 1 + (i % 2) * 0.5, r, r, 0, 1.2, 10, face)
  lyingDrum(F, du + 1.5, v0 + 4.2, r, 1.2, face)
  // Blocks for the architrave and frieze, and a capital roughed out.
  at([S.walls[0], S.walls[1]], null, S.entablature[1])
  const eu = w / 2 - 4.5
  F.box(eu, eu + 3.2, v0 + 0.5, v0 + 1.4, 0, 0.85, face)
  F.box(eu, eu + 3.2, v0 + 1.6, v0 + 2.5, 0, 0.85, face)
  F.box(eu + 0.3, eu + 3.5, v0 + 0.9, v0 + 1.8, 0.85, 1.7, face)
  F.box(eu - 2.4, eu - 0.9, v0 + 3, v0 + 4.5, 0, 0.7, face)
  // The roof's timbers and its tiles, stacked.
  at([S.entablature[0], S.roof[0]], null, S.roof[1])
  for (let i = 0; i < 4; i++) {
    const z = i < 3 ? 0.15 : 0.45
    const v = v1 - 2.6 + (i < 3 ? i * 0.34 : 0.34)
    beam(F, [-w * 0.3, v, z], [w * 0.2, v, z], 0.3, SITE.timber)
  }
  for (let i = 0; i < 3; i++)
    F.box(
      w * 0.26 + i * 1.3,
      w * 0.26 + i * 1.3 + 1.1,
      v1 - 3,
      v1 - 1.9,
      0,
      0.8,
      SITE.tiles,
    )
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
 * The roof's timbers over u0–u1 × v0–v1 (its ridge along v), from its eaves at z to
 * its ridge at apex, a little under where the tiles will lie: pairs of rafters a
 * metre and a half apart, tie beams across every other pair, and the ridge beam.
 */
export function rafters(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z: number,
  apex: number,
) {
  const um = (u0 + u1) / 2
  const n = Math.max(2, Math.round((v1 - v0) / 1.5))
  for (let k = 0; k <= n; k++) {
    const v = v0 + 0.3 + ((v1 - v0 - 0.6) * k) / n
    beam(F, [u0 + 0.2, v, z - 0.1], [um, v, apex - 0.28], 0.22, SITE.timber)
    beam(F, [u1 - 0.2, v, z - 0.1], [um, v, apex - 0.28], 0.22, SITE.timber)
    if (k % 2 === 0)
      beam(F, [u0 + 0.3, v, z + 0.05], [u1 - 0.3, v, z + 0.05], 0.24, SITE.timber)
  }
  beam(F, [um, v0 + 0.3, apex - 0.3], [um, v1 - 0.3, apex - 0.3], 0.26, SITE.timber)
}
