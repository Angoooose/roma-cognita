import * as THREE from 'three/webgpu'
import { type Builder, C, type Pt, SKIN } from './builder.ts'
import {
  beam,
  beds,
  centering,
  COURSE,
  roundBeds,
  templeSiteRound,
  disc,
  lag,
  rafters,
  SITE_COLOURS,
  TEMPLE_WORKS,
  templeSite,
  type Works,
} from './works.ts'

/**
 * The architecture of the known buildings (DESIGN.md §7.7): a monument's own frame of
 * reference, the parts it is built of — columns of the four orders, entablatures,
 * pedimented roofs of tiles, flights of steps, arcades — and the building types
 * raised from them. What each monument is (its type, size, columns, stairs) is the
 * pipeline's (pipeline/src/rome/designs.ts, with its sources); this file only knows
 * how such a building is put together.
 *
 * Proportions not given by a design are Vitruvius' rules of thumb: a column's height
 * in lower diameters by its order (4.1.8, 4.7.2, and Roman practice for the
 * Corinthian), an entablature about a quarter of the column, and a pediment one
 * ninth of its width high (3.5.12).
 */

export type Order = 'tuscan' | 'doric' | 'ionic' | 'corinthian'

/**
 * A storey of an arcade (`Frame.arcade`): its height, the order of its half-columns
 * (none for a plain one), whether its bays are open arches or a blind wall — or, with
 * `lintel`, a colonnade under a flat entablature — and the width of its piers.
 */
export interface Storey {
  h: number
  order: Order | null
  open: boolean
  lintel?: boolean
  pier?: number
}

/** A column's height in lower diameters, by order. */
const DIAMETERS: Record<Order, number> = { tuscan: 7, doric: 7.5, ionic: 9, corinthian: 10 }
/** An entablature's height as a share of its column's. */
const ENTABLATURE = 0.24
/** A pediment's slope: its height a ninth of its width (Vitruvius 3.5.12). */
const PEDIMENT = 2 / 9
/** A step: its rise and its tread, metres. */
const RISE_M = 0.3
const TREAD_M = 0.36

/** What a roof is covered with. Catulus' Capitol had gilded bronze tiles (Pliny, NH 33.57). */
export type Covering = 'tile' | 'gilt'

/** Colours of the parts that are not the building's stone. */
export const PART = {
  door: new THREE.Color('#5E4C3C'),
  dark: new THREE.Color('#6F6252'),
  gilt: new THREE.Color('#C8A45C'),
  bronze: new THREE.Color('#7E6A4E'),
  water: new THREE.Color('#6F93A0'),
  garden: new THREE.Color('#8C9460'),
  earth: new THREE.Color('#A9976F'),
  timber: new THREE.Color('#9C7F62'),
  basalt: new THREE.Color('#8F8C86'),
  tufa: new THREE.Color('#CDB88E'),
  tufaGrey: new THREE.Color('#B7AB94'),
  brick: new THREE.Color('#B98A6C'),
  wood: new THREE.Color('#A48462'),
  scaffold: new THREE.Color('#A08868'),
}

/**
 * A monument's own axes: `u` across it, to the right as one faces its front; `v`
 * along it, towards its front; `z` up from its ground. The front faces `bearing`,
 * radians clockwise from north. Everything is built in these and handed to the
 * builder in plane metres.
 */
export class Frame {
  readonly f: Pt
  readonly r: Pt
  readonly b: Builder
  readonly cx: number
  readonly cy: number
  readonly bearing: number
  readonly base: number
  /** How far below its ground a monument's foundations and podium run, metres: further on a slope. */
  deep = 6
  constructor(b: Builder, cx: number, cy: number, bearing: number, base: number) {
    this.b = b
    this.cx = cx
    this.cy = cy
    this.bearing = bearing
    this.base = base
    this.f = [Math.sin(bearing), Math.cos(bearing)]
    this.r = [Math.cos(bearing), -Math.sin(bearing)]
  }

  /** A frame inside this one: centred at (u, v), its front turned `turn` radians clockwise. */
  sub(u: number, v: number, turn = 0, dz = 0) {
    const [x, y] = this.p(u, v)
    const F = new Frame(this.b, x, y, this.bearing + turn, this.base + dz)
    F.deep = this.deep + dz
    return F
  }

  /** A point of the plane in this frame: (u, v). */
  local(x: number, y: number): Pt {
    const [dx, dy] = [x - this.cx, y - this.cy]
    return [dx * this.r[0] + dy * this.r[1], dx * this.f[0] + dy * this.f[1]]
  }

  p(u: number, v: number): Pt {
    return [
      this.cx + this.r[0] * u + this.f[0] * v,
      this.cy + this.r[1] * u + this.f[1] * v,
    ]
  }

  /** A point for the builder: plane metres and height, then the surface's own coordinates. */
  q(u: number, v: number, z: number, ...s: number[]) {
    const [x, y] = this.p(u, v)
    return [x, y, z, ...s]
  }

  tri(a: number[], b: number[], c: number[], col: THREE.Color) {
    this.b.tri(
      this.q(a[0], a[1], a[2]),
      this.q(b[0], b[1], b[2]),
      this.q(c[0], c[1], c[2]),
      this.base,
      col,
    )
  }

  quad(a: number[], b: number[], c: number[], d: number[], col: THREE.Color) {
    this.tri(a, b, c, col)
    this.tri(a, c, d, col)
  }

  /** A quad whose points carry surface coordinates (u, v, z, s1, s2, s3). */
  skinQuad(a: number[], b: number[], c: number[], d: number[], col: THREE.Color) {
    const w = (p: number[]) => this.q(p[0], p[1], p[2], ...p.slice(3))
    this.b.tri(w(a), w(b), w(c), this.base, col)
    this.b.tri(w(a), w(c), w(d), this.base, col)
  }

  /** A box between u0–u1, v0–v1 and z0–z1; its top in `top`, and its underside if `under`. */
  box(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    z0: number,
    z1: number,
    col: THREE.Color,
    top: THREE.Color | null = col,
    under = false,
  ) {
    const c: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]
    for (let i = 0; i < 4; i++) {
      const [a, d] = [c[i], c[(i + 1) % 4]]
      this.quad([a[0], a[1], z0], [d[0], d[1], z0], [d[0], d[1], z1], [a[0], a[1], z1], col)
    }
    if (top) this.quad([u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1], top)
    if (under) this.quad([u0, v0, z0], [u0, v1, z0], [u1, v1, z0], [u1, v0, z0], col)
  }

  /** A box centred at (u, v), `w` across and `d` along, turned `turn` radians clockwise. */
  obox(
    u: number,
    v: number,
    turn: number,
    w: number,
    d: number,
    z0: number,
    z1: number,
    col: THREE.Color,
    top: THREE.Color | null = col,
  ) {
    this.sub(u, v, turn).box(-w / 2, w / 2, -d / 2, d / 2, z0, z1, col, top)
  }

  /** An upright drum or frustum of `sides`, radius r0 at z0 to r1 at z1, capped. */
  drum(
    u: number,
    v: number,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
    sides: number,
    col: THREE.Color,
    cap: THREE.Color | null = col,
    a0 = 0,
    a1 = Math.PI * 2,
  ) {
    const whole = a1 - a0 >= Math.PI * 2 - 1e-6
    const at = (k: number, r: number, z: number) => {
      const a = a0 + ((a1 - a0) * k) / sides
      return [u + Math.cos(a) * r, v + Math.sin(a) * r, z]
    }
    for (let k = 0; k < sides; k++)
      this.quad(at(k, r0, z0), at(k + 1, r0, z0), at(k + 1, r1, z1), at(k, r1, z1), col)
    if (cap)
      for (let k = 0; k < sides; k++)
        this.tri([u, v, z1], at(k, r1, z1), at(k + 1, r1, z1), cap)
    if (!whole && cap) {
      // The flat faces of a part-drum.
      this.quad([u, v, z0], at(0, r0, z0), at(0, r1, z1), [u, v, z1], col)
      this.quad([u, v, z0], at(sides, r0, z0), at(sides, r1, z1), [u, v, z1], col)
    }
  }

  /** A ring wall between radii r0 and r1 (inner, outer), z0 to z1, from angle a0 to a1. */
  ring(
    u: number,
    v: number,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
    sides: number,
    col: THREE.Color,
    top: THREE.Color = col,
    a0 = 0,
    a1 = Math.PI * 2,
  ) {
    const at = (k: number, r: number, z: number) => {
      const a = a0 + ((a1 - a0) * k) / sides
      return [u + Math.cos(a) * r, v + Math.sin(a) * r, z]
    }
    for (let k = 0; k < sides; k++) {
      this.quad(at(k, r1, z0), at(k + 1, r1, z0), at(k + 1, r1, z1), at(k, r1, z1), col)
      this.quad(at(k, r0, z0), at(k + 1, r0, z0), at(k + 1, r0, z1), at(k, r0, z1), col)
      this.quad(at(k, r0, z1), at(k + 1, r0, z1), at(k + 1, r1, z1), at(k, r1, z1), top)
    }
    if (a1 - a0 < Math.PI * 2 - 1e-6)
      for (const k of [0, sides])
        this.quad(at(k, r0, z0), at(k, r1, z0), at(k, r1, z1), at(k, r0, z1), col)
  }

  /** A polygon in this frame (u, v), extruded from z0 to z1. */
  prism(
    ring: Pt[],
    z0: number,
    z1: number,
    col: THREE.Color,
    top: THREE.Color | null = col,
  ) {
    const r =
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]]
    for (let i = 0; i + 1 < r.length; i++)
      this.quad(
        [r[i][0], r[i][1], z0],
        [r[i + 1][0], r[i + 1][1], z0],
        [r[i + 1][0], r[i + 1][1], z1],
        [r[i][0], r[i][1], z1],
        col,
      )
    if (!top) return
    const pts = r.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, []))
      this.tri(
        [pts[i].x, pts[i].y, z1],
        [pts[j].x, pts[j].y, z1],
        [pts[k].x, pts[k].y, z1],
        top,
      )
  }

  /**
   * A flight of `n` steps filling u0–u1 × v0–v1 from z0 to z1, rising away from its
   * foot on the side `foot` (+v: the foot is at v1, the steps climb towards v0).
   */
  steps(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    z0: number,
    z1: number,
    foot: '+v' | '-v' | '+u' | '-u',
    col: THREE.Color,
  ) {
    const n = Math.max(1, Math.round((z1 - z0) / RISE_M))
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / n
      const z = z0 + (z1 - z0) * t
      // Each step a block from the back of the flight to its own nosing.
      if (foot === '+v')
        this.box(u0, u1, v0, v1 - (v1 - v0) * (k / n), z - (z1 - z0) / n, z, col)
      else if (foot === '-v')
        this.box(u0, u1, v0 + (v1 - v0) * (k / n), v1, z - (z1 - z0) / n, z, col)
      else if (foot === '+u')
        this.box(u0, u1 - (u1 - u0) * (k / n), v0, v1, z - (z1 - z0) / n, z, col)
      else this.box(u0 + (u1 - u0) * (k / n), u1, v0, v1, z - (z1 - z0) / n, z, col)
    }
    // Under the steps, down to the ground.
    this.box(u0, u1, v0, v1, z0 - 4, z0 + 0.01, col, null)
  }

  /** How deep a flight rising `h` is. */
  static flight(h: number) {
    return Math.max(1, Math.round(h / RISE_M)) * TREAD_M
  }

  /**
   * A column of `order`, `d` in lower diameter, standing on z0 and `h` high overall:
   * a base (none for the Doric and Tuscan's plain one), a tapering shaft and its
   * capital — an echinus and abacus for the Tuscan and Doric, the volutes' breadth
   * for the Ionic, the bell of leaves for the Corinthian.
   */
  column(
    u: number,
    v: number,
    d: number,
    z0: number,
    h: number,
    order: Order,
    col: THREE.Color,
  ) {
    const r = d / 2
    const sides = 10
    const baseH = order === 'doric' ? 0 : r * 0.9
    const capH = order === 'corinthian' ? d * 1.1 : order === 'ionic' ? r * 0.9 : r * 0.8
    const s0 = z0 + baseH
    const s1 = z0 + h - capH
    if (baseH > 0) {
      this.box(
        u - r * 1.3,
        u + r * 1.3,
        v - r * 1.3,
        v + r * 1.3,
        z0,
        z0 + baseH * 0.45,
        col,
      )
      this.drum(u, v, r * 1.18, r * 1.05, z0 + baseH * 0.45, s0, sides, col, null)
    }
    // The shaft, tapering to five-sixths at the top (Vitruvius 3.3.12).
    this.drum(u, v, r, r * 0.84, s0, s1, sides, col, null)
    const top = z0 + h
    if (order === 'corinthian') {
      this.drum(u, v, r * 0.86, r * 1.25, s1, top - capH * 0.18, sides, col, null)
      this.box(
        u - r * 1.4,
        u + r * 1.4,
        v - r * 1.4,
        v + r * 1.4,
        top - capH * 0.18,
        top,
        col,
      )
    } else if (order === 'ionic') {
      // The volutes stand out either side, across the front.
      this.box(
        u - r * 1.55,
        u + r * 1.55,
        v - r * 0.9,
        v + r * 0.9,
        s1,
        top - capH * 0.3,
        col,
      )
      this.box(
        u - r * 1.3,
        u + r * 1.3,
        v - r * 1.3,
        v + r * 1.3,
        top - capH * 0.3,
        top,
        col,
      )
    } else {
      this.drum(u, v, r * 0.86, r * 1.25, s1, top - capH * 0.45, sides, col, null)
      this.box(
        u - r * 1.35,
        u + r * 1.35,
        v - r * 1.35,
        v + r * 1.35,
        top - capH * 0.45,
        top,
        col,
      )
    }
  }

  /** A column's lower diameter for its height and order. */
  static diameter(h: number, order: Order) {
    return h / DIAMETERS[order]
  }

  /**
   * An entablature over the rectangle u0–u1 × v0–v1 from z: architrave, frieze and a
   * cornice standing out `over` beyond them. Returns the height of its top. `open`,
   * it is only its ring of blocks, not yet closed over by a roof (works.ts).
   */
  entablature(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    z: number,
    h: number,
    col: THREE.Color,
    over = h * 0.35,
    open = false,
  ) {
    const [a, f] = [h * 0.4, h * 0.33]
    const top = open ? null : col
    this.box(u0, u1, v0, v1, z, z + a, col, top)
    this.box(u0 + 0.04, u1 - 0.04, v0 + 0.04, v1 - 0.04, z + a, z + a + f, col, top)
    this.box(u0 - over, u1 + over, v0 - over, v1 + over, z + a + f, z + h, col, top, true)
    return z + h
  }

  /**
   * A roof of tiles over u0–u1 × v0–v1 from its eaves at z, its ridge along `along`,
   * rising `pitch` in each metre. With `gable` its ends are pediments, the tympanum in
   * that colour set back behind a raking cornice; without, it is hipped.
   */
  roof(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    z: number,
    opts: {
      along?: 'u' | 'v'
      pitch?: number
      tiles: THREE.Color
      gable?: THREE.Color | null
      covering?: Covering
      seed?: number
    },
  ) {
    const along = opts.along ?? (v1 - v0 >= u1 - u0 ? 'v' : 'u')
    const pitch = opts.pitch ?? PEDIMENT
    // Work in (a, c): a along the ridge, c across it.
    const [a0, a1, c0, c1] = along === 'v' ? [v0, v1, u0, u1] : [u0, u1, v0, v1]
    const P = (a: number, c: number, zz: number, ...s: number[]) =>
      along === 'v' ? [c, a, zz, ...s] : [a, c, zz, ...s]
    const half = (c1 - c0) / 2
    const rise = half * pitch
    const cm = (c0 + c1) / 2
    const hip = !opts.gable
    const e = hip ? Math.min(half, (a1 - a0) / 2) : 0
    const tiles = opts.covering === 'gilt' ? PART.gilt : opts.tiles
    const run = Math.hypot(half, rise)
    const len = a1 - a0
    const b = this.b
    const look = b.look
    b.look = SKIN.roof * 10 + (opts.seed ?? 0.5) * 0.9
    // The two slopes, tiled: along the eave `across`, from the ridge `down`.
    this.skinQuad(
      P(a0, c0, z, 0, run, run),
      P(a1, c0, z, len, run, run),
      P(a1 - e, cm, z + rise, len, 0, run),
      P(a0 + e, cm, z + rise, 0, 0, run),
      tiles,
    )
    this.skinQuad(
      P(a1, c1, z, len, run, run),
      P(a0, c1, z, 0, run, run),
      P(a0 + e, cm, z + rise, 0, 0, run),
      P(a1 - e, cm, z + rise, len, 0, run),
      tiles,
    )
    if (hip) {
      this.skinQuad(
        P(a0, c1, z, 0, run, run),
        P(a0, c0, z, half * 2, run, run),
        P(a0 + e, cm, z + rise, half, 0, run),
        P(a0 + e, cm, z + rise, half, 0, run),
        tiles,
      )
      this.skinQuad(
        P(a1, c0, z, 0, run, run),
        P(a1, c1, z, half * 2, run, run),
        P(a1 - e, cm, z + rise, half, 0, run),
        P(a1 - e, cm, z + rise, half, 0, run),
        tiles,
      )
      b.look = look
      return z + rise
    }
    b.look = look
    const g = opts.gable!
    // The pediments: the tympanum a little behind the raking cornice, which is the
    // roof's own edge thickened.
    for (const [a, inward] of [
      [a0, 1],
      [a1, -1],
    ] as const) {
      const t = a + inward * 0.35
      this.tri(P(t, c0 + 0.3, z), P(t, c1 - 0.3, z), P(t, cm, z + rise - 0.25), g)
      // The raking cornice: a band under each slope's end.
      for (const [cc, cz] of [
        [c0, c0 + 0.001],
        [c1, c1 - 0.001],
      ]) {
        void cz
        this.quad(
          P(a, cc, z - 0.35),
          P(a, cm, z + rise - 0.35),
          P(a, cm, z + rise),
          P(a, cc, z),
          g,
        )
      }
    }
    // Acroteria: a block at the apex of each pediment and at its corners.
    for (const a of [a0 + 0.3, a1 - 0.3]) {
      const [x, y] = along === 'v' ? [cm, a] : [a, cm]
      this.box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, z + rise - 0.1, z + rise + 0.9, g)
    }
    return z + rise
  }

  /**
   * A straight arcade from (u0, v) to (u1, v), its face towards -v, `depth` deep:
   * storeys of arches between piers, each pier with a half-column of the storey's
   * order on its face and an entablature over each storey. `open` storeys are
   * arches; closed ones are blind (a wall with the half-columns). Behind the arches
   * a vaulted gallery, its back wall in the dark of the building. While it is being
   * built (works.ts), `rising` dates each storey — `i` its index, from z to top — and,
   * with `centering`, the timber centering under its arches. `trim` is the stone of
   * its entablatures, where it differs from its walls'.
   */
  arcade(
    u0: number,
    u1: number,
    v: number,
    depth: number,
    z0: number,
    storeys: Storey[],
    bay: number,
    col: THREE.Color,
    inner: THREE.Color = PART.dark,
    rising?: (i: number, z: number, top: number, centering: boolean) => void,
    bay0 = 0,
    trim = col,
  ) {
    const len = u1 - u0
    const n = Math.max(1, Math.round(len / bay))
    const B = len / n
    let z = z0
    for (const [i, s] of storeys.entries()) {
      rising?.(i, z, z + s.h, false)
      if (s.lintel) {
        // A colonnade: columns at each bay, the back wall behind, an entablature over.
        const ent = Math.min(1.4, s.h * 0.14)
        const d = Math.min(B * 0.3, Frame.diameter(s.h - ent, s.order ?? 'tuscan'))
        for (let k = 0; k <= n; k++)
          this.column(u0 + k * B, v + d * 0.7, d, z, s.h - ent, s.order ?? 'tuscan', col)
        this.box(u0, u1, v + depth - 0.6, v + depth, z, z + s.h - ent, inner, null)
        this.entablature(
          u0 - d * 0.6,
          u1 + d * 0.6,
          v,
          v + depth,
          z + s.h - ent,
          ent,
          trim,
          0.25,
        )
        z += s.h
        continue
      }
      const pier = s.pier ?? Math.min(B * 0.36, 2.6)
      const ent = s.order ? Math.min(1.6, s.h * 0.13) : 0.4
      const top = z + s.h
      const archTop = top - ent - 0.35
      const span = B - pier
      const spring = Math.max(z + 0.8, archTop - span / 2)
      for (let k = 0; k < n; k++) {
        const ua = u0 + k * B
        // The pier between this bay and the last, and at the ends.
        this.box(ua - pier / 2, ua + pier / 2, v, v + depth, z, top - ent, col)
        if (k === n - 1)
          this.box(u1 - pier / 2, u1 + pier / 2, v, v + depth, z, top - ent, col)
        const sa = ua + pier / 2
        const sb = ua + B - pier / 2
        if (s.open) {
          this.arch(sa, sb, v, depth, spring, archTop, top - ent, col, inner)
          // Centering under a third of the arches, a different third on each storey:
          // the sets moved along the arcade from bay to bay (works.ts `centering`).
          if (rising && (bay0 + k + i) % 3 === 0) {
            rising(i, z, top, true)
            centering(this, sa, sb, v, depth, spring, archTop)
            rising(i, z, top, false)
          }
          // The back wall and the gallery's vault behind the arches.
          this.quad(
            [sa, v + depth, z],
            [sb, v + depth, z],
            [sb, v + depth, top - ent],
            [sa, v + depth, top - ent],
            inner,
          )
        } else {
          this.box(sa, sb, v + 0.25, v + depth, z, top - ent, col)
          // A blind arch or a window in the wall.
          this.quad(
            [sa + span * 0.3, v + 0.24, spring - 0.6],
            [sb - span * 0.3, v + 0.24, spring - 0.6],
            [sb - span * 0.3, v + 0.24, spring + span * 0.25],
            [sa + span * 0.3, v + 0.24, spring + span * 0.25],
            inner,
          )
        }
      }
      // Half-columns on the piers' faces.
      if (s.order) {
        const d = Math.min(pier * 0.7, Frame.diameter(s.h - ent, s.order) * 1.1)
        for (let k = 0; k <= n; k++)
          this.column(u0 + k * B, v - d * 0.1, d, z, s.h - ent, s.order, col)
      }
      this.entablature(
        u0 - pier / 2,
        u1 + pier / 2,
        v - 0.1,
        v + depth,
        top - ent,
        ent,
        trim,
        0.25,
      )
      z = top
    }
    return z
  }

  /**
   * One arch from sa to sb (along u) in a wall from v to v + depth: its spandrel up to
   * `top`, springing at `spring` to its crown at `crown`, and its soffit in `inner`.
   */
  arch(
    sa: number,
    sb: number,
    v: number,
    depth: number,
    spring: number,
    crown: number,
    top: number,
    col: THREE.Color,
    inner: THREE.Color,
  ) {
    const N = 8
    const r = (sb - sa) / 2
    const rise = crown - spring
    const um = (sa + sb) / 2
    const pts = Array.from({ length: N + 1 }, (_, k) => {
      const a = Math.PI * (1 - k / N)
      return [um + Math.cos(a) * r, spring + Math.sin(a) * rise] as Pt
    })
    for (const vv of [v, v + depth])
      for (let k = 0; k < N; k++) {
        const [p, q] = [pts[k], pts[k + 1]]
        this.quad([p[0], vv, p[1]], [q[0], vv, q[1]], [q[0], vv, top], [p[0], vv, top], col)
      }
    for (let k = 0; k < N; k++) {
      const [p, q] = [pts[k], pts[k + 1]]
      this.quad(
        [p[0], v, p[1]],
        [q[0], v, q[1]],
        [q[0], v + depth, q[1]],
        [p[0], v + depth, p[1]],
        inner,
      )
    }
  }

  /**
   * An arcade round an arc of radius `r` about (u, v), from angle a0 to a1 (radians,
   * from +u towards +v), its face outwards: one bay a chord, `depth` deep inwards.
   */
  arcadeArc(
    u: number,
    v: number,
    r: number,
    a0: number,
    a1: number,
    depth: number,
    z0: number,
    storeys: Storey[],
    bay: number,
    col: THREE.Color,
    rising?: (i: number, z: number, top: number, centering: boolean) => void,
  ) {
    const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / bay))
    for (let k = 0; k < n; k++) {
      const [p, q] = [a0 + ((a1 - a0) * k) / n, a0 + ((a1 - a0) * (k + 1)) / n]
      const m = (p + q) / 2
      const chord = 2 * r * Math.sin(Math.abs(q - p) / 2)
      const d = r * Math.cos(Math.abs(q - p) / 2)
      // A bay's own frame: its front faces the centre, so its face is outwards.
      const S = this.sub(
        u + Math.cos(m) * d,
        v + Math.sin(m) * d,
        Math.atan2(-Math.cos(m), -Math.sin(m)),
      )
      S.arcade(
        -chord / 2 - 0.05,
        chord / 2 + 0.05,
        0,
        depth,
        z0,
        storeys,
        chord,
        col,
        undefined,
        rising,
        k,
      )
    }
  }

  /**
   * Seating that rises in a sector of a ring about (u, v), from radius r0 at z0 to r1
   * at z1, between angles a0 and a1: rows of stone seats in bands, divided by
   * gangways (`bands`) and by radial stairs (`stairs` of them), which are darker.
   */
  cavea(
    u: number,
    v: number,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
    a0: number,
    a1: number,
    col: THREE.Color,
    opts: { rows?: number; stairs?: number; bands?: number } = {},
  ) {
    const rows = opts.rows ?? Math.max(4, Math.round((r1 - r0) / 1.6))
    const sides = Math.max(8, Math.round(((a1 - a0) * r1) / 6))
    const stairs = opts.stairs ?? Math.max(2, Math.round(sides / 3))
    const bands = opts.bands ?? 2
    const at = (a: number, r: number, z: number) => [
      u + Math.cos(a) * r,
      v + Math.sin(a) * r,
      z,
    ]
    const lighter = col.clone().multiplyScalar(1.04)
    const shade = col.clone().multiplyScalar(0.8)
    for (let j = 0; j < rows; j++) {
      const t0 = j / rows
      const t1 = (j + 1) / rows
      const ra = r0 + (r1 - r0) * t0
      const rb = r0 + (r1 - r0) * t1
      const za = z0 + (z1 - z0) * t0
      const zb = z0 + (z1 - z0) * t1
      // A gangway every so many rows: a wider, level tread.
      const walk = bands > 0 && j > 0 && j % Math.round(rows / (bands + 1)) === 0
      for (let k = 0; k < sides; k++) {
        const [p, q] = [a0 + ((a1 - a0) * k) / sides, a0 + ((a1 - a0) * (k + 1)) / sides]
        // The riser and the seat.
        this.quad(at(p, ra, za), at(q, ra, za), at(q, ra, zb), at(p, ra, zb), shade)
        this.quad(
          at(p, ra, zb),
          at(q, ra, zb),
          at(q, rb, zb),
          at(p, rb, zb),
          walk ? lighter : col,
        )
      }
    }
    // Radial stairs: darker strips up the seating, a little proud of it.
    for (let s = 1; s < stairs; s++) {
      const a = a0 + ((a1 - a0) * s) / stairs
      const w = 0.7 / ((r0 + r1) / 2)
      for (let j = 0; j < rows; j++) {
        const t1 = (j + 1) / rows
        const rb = r0 + (r1 - r0) * t1
        const ra = r0 + (r1 - r0) * (j / rows)
        const zb = z0 + (z1 - z0) * t1 + 0.05
        this.quad(
          at(a - w, ra, zb),
          at(a + w, ra, zb),
          at(a + w, rb, zb),
          at(a - w, rb, zb),
          shade,
        )
      }
    }
    // The fill under the seating, down to the ground.
    for (let k = 0; k < sides; k++) {
      const [p, q] = [a0 + ((a1 - a0) * k) / sides, a0 + ((a1 - a0) * (k + 1)) / sides]
      this.quad(at(p, r1, z0 - 4), at(q, r1, z0 - 4), at(q, r1, z1), at(p, r1, z1), shade)
    }
  }

  /** A tree at (u, v): a holm oak, a cypress or an umbrella pine (the builder's). */
  tree(u: number, v: number, r: number, kind: 'oak' | 'cypress' | 'pine' | 'plane', z = 0) {
    const [x, y] = this.p(u, v)
    const col = C.tree[Math.abs(Math.floor(x * 7 + y * 13)) % C.tree.length]
    // Built on the frame's ground and lifted, so that a tree on a terrace is as high
    // over the ground as the terrace is, and goes with it while it is being built.
    const from = this.b.mark()
    if (kind === 'cypress') this.b.cypress(x, y, r, this.base, C.cypress)
    else if (kind === 'pine') this.b.pine(x, y, r, this.base, col)
    else this.b.oak(x, y, r, this.base, col)
    this.b.lift(from, z)
  }
}

// --- the building types --------------------------------------------------------------------

/**
 * A temple as the designs describe it (pipeline designs.ts `TempleDesign`), `w` across
 * its podium and `l` along it, its front at +l/2.
 */
export interface Temple {
  plan: 'peripteral' | 'sine-postico' | 'prostyle' | 'pseudoperipteral' | 'in-antis'
  /** Columns across the front, and down each flank counting the corners (peripteral). */
  front: number
  flank?: number
  /** Rows of columns in the porch, counting the front; default 2 (prostyle) or 1. */
  porch?: number
  /** Whether the porch's inner rows are full rows (an Italic temple's deep porch), not only at the sides. */
  fullPorch?: boolean
  order: Order
  column: number
  podium: number
  /** front: a flight across the front; lateral: flights either side of a front platform; none. */
  stairs: 'front' | 'lateral' | 'none'
  /** How much of the front the flight takes (the Temple of Saturn's was a third). */
  stairWidth?: number
  /** The depth of the platform before the porch (a speakers' tribunal), metres, and its height. */
  platform?: number
  platformH?: number
  /** A round niche in the platform's front (the altar of the Divus Julius). */
  niche?: number
  cellae?: number
  /** The cella's own width across, where it is not the columns' (a transverse cella). */
  cellaWidth?: number
  apse?: boolean
  covering?: Covering
  /** A chariot group on the apex of the pediment (the Capitol's). */
  quadriga?: boolean
  /** A precinct wall round it, across and along, metres. */
  precinct?: [number, number]
  /** A grove round it, across and along: trees inside its precinct. */
  grove?: [number, number]
  /** A terrace it stands on, across and along, its height, and its centre from the temple's. */
  terrace?: [number, number, number, number, number]
  /** How wide its porch's columns spread, where narrower than its podium (a transverse cella behind). */
  porchWidth?: number
  /** An altar before its steps, this far in front of the podium, metres. */
  altar?: number
  /** A court in front of it, across and along, framed by porticoes (Apollo's on the Palatine). */
  forecourt?: { w: number; l: number; h: number; order: Order; colour?: string }
  /** While it is being built: which flank its crane stands on (works.ts; default the right). */
  works?: { crane?: 'left' | 'right' }
}

export function temple(
  F: Frame,
  t: Temple,
  w: number,
  l: number,
  face: THREE.Color,
  shade: THREE.Color,
) {
  const deep = -F.deep
  // While it is being built, each part goes up in its own years (works.ts).
  const W = F.b.works
  const S = TEMPLE_WORKS
  const stage = (
    share: [number, number],
    rise: [number, number] | null = null,
    end?: number,
  ) => W?.stage(F.b, share, rise, end)
  // Rebuilt, what survived stands from the first year (works.ts `kept`).
  W?.follow(TEMPLE_WORKS)
  const kept = (share: [number, number]) => !!W?.survived(share)
  stage(S.ground)
  if (t.terrace) {
    const [tw, tl, th, du, dv] = t.terrace
    F.box(du - tw / 2, du + tw / 2, dv - tl / 2, dv + tl / 2, deep, th, C.tufa)
    F = F.sub(0, 0, 0, th)
  }
  const P = t.podium
  const H = t.column
  const D = Math.min(Frame.diameter(H, t.order), w / (t.front * 1.9))
  const margin = D * 0.85
  const front = l / 2
  const back = -l / 2
  // The stairs take the front of the footprint, cut into the podium between its cheeks.
  const plat = t.platform ?? 0
  const ph = Math.min(P, t.platformH ?? P)
  const stairD = t.stairs === 'front' ? Math.min(l * 0.3, Frame.flight(P)) : 0
  const podFront = front - stairD
  // The podium: a plinth, the die and a crowning moulding. Going up, it is its core,
  // poured in lifts with a bed at every course; faced, moulded and stepped at the end.
  const face0 = face
  let core = false
  const podium = (v0: number, v1: number, h: number, flush: boolean) => {
    if (core) {
      F.box(-w / 2, w / 2, v0, v1, deep, h, SITE_COLOURS.core)
      stage(S.base, [0, P], S.base[1])
      beds(F, -w / 2, w / 2, v0, v1, 0, h, SITE_COLOURS.core)
      stage(S.base, [0, P], S.facing[0])
      return
    }
    F.box(-w / 2 - 0.2, w / 2 + 0.2, v0 - 0.2, v1 + (flush ? 0 : 0.2), deep, 0.6, face)
    F.box(-w / 2, w / 2, v0, v1, 0.6, h - 0.45, face)
    F.box(
      -w / 2 - 0.25,
      w / 2 + 0.25,
      v0 - 0.25,
      v1 + (flush ? 0 : 0.25),
      h - 0.45,
      h,
      face,
    )
  }
  for (const pass of W && !kept(S.base) ? ['core', 'faced'] : ['faced']) {
    core = pass === 'core'
    face = core ? SITE_COLOURS.core : face0
    if (core) stage(S.base, [0, P], S.facing[0])
    else stage(kept(S.base) ? S.base : S.facing)
    if (plat && ph < P) {
      // A lower platform before the temple, and a flight up from it to the porch.
      podium(back, front - plat, P, true)
      podium(front - plat, front, ph, false)
      const run = Math.min(plat * 0.6, Frame.flight(P - ph))
      F.steps(-w * 0.3, w * 0.3, front - plat, front - plat + run, ph, P, '+v', face)
    } else podium(back, podFront, P, stairD > 0)
    if (t.niche && !core) {
      // A dark half-round in the platform's face, where the altar stood.
      F.drum(
        0,
        front + 0.05,
        t.niche,
        t.niche,
        0.6,
        ph - 0.5,
        10,
        PART.dark,
        face,
        Math.PI,
        Math.PI * 2,
      )
    }
    if (t.stairs === 'front') {
      const sw = (w * (t.stairWidth ?? 1)) / 2
      const cheek = Math.min(1.6, w * 0.07)
      F.box(-w / 2, -sw + cheek, podFront, front, deep, P - 0.45, face)
      F.box(sw - cheek, w / 2, podFront, front, deep, P - 0.45, face)
      F.steps(-sw + cheek, sw - cheek, podFront, front, 0, P, '+v', face)
    } else if (t.stairs === 'lateral') {
      // Flights up either side of the front platform, climbing towards the back.
      const sw = Math.min(3.5, Math.max(2, plat * 0.4))
      const run = Math.min(plat || 6, Frame.flight(ph))
      for (const s of [-1, 1]) {
        const u0 = s < 0 ? -w / 2 - sw : w / 2
        F.steps(u0, u0 + sw, front - run, front, 0, ph, '+v', face)
      }
    }
  }
  face = face0
  // The columns.
  const colFront = front - stairD - plat - margin
  const iw = (t.porchWidth ?? w) - 2 * margin
  const nF = t.front
  const s = iw / (nF - 1)
  const us = Array.from({ length: nF }, (_, i) => -iw / 2 + s * i)
  const cols: Pt[] = us.map((u) => [u, colFront])
  const peripteral = t.plan === 'peripteral' || t.plan === 'sine-postico'
  const rows = t.porch ?? (peripteral ? 1 : 2)
  for (let j = 1; j < rows; j++) {
    const vv = colFront - s * j
    if (t.fullPorch)
      for (const u of us.slice(peripteral ? 1 : 0, peripteral ? -1 : undefined))
        cols.push([u, vv])
    else if (!peripteral) cols.push([us[0], vv], [us[nF - 1], vv])
  }
  let cellaFront: number
  let colBack = back + margin
  if (peripteral) {
    const nL = t.flank ?? Math.round((colFront - colBack) / s) + 1
    const sl = (colFront - colBack) / (nL - 1)
    for (let j = 1; j < nL; j++) {
      const vv = colFront - sl * j
      if (t.plan === 'sine-postico' && j === nL - 1) break
      cols.push([us[0], vv], [us[nF - 1], vv])
    }
    if (t.plan === 'peripteral') for (const u of us.slice(1, -1)) cols.push([u, colBack])
    // The pronaos: a third of the colonnade's length, or two bays, or the porch's rows.
    cellaFront =
      colFront - Math.max(2 * sl, (colFront - colBack) * 0.3, s * (rows - 1) + D * 1.2)
    if (t.plan === 'sine-postico') colBack = back
  } else {
    cellaFront = colFront - s * (rows - 1) - D * 0.9
    colBack = back
  }
  cols.forEach(([u, v], i) => {
    if (W) {
      // Raised drum by drum, some ahead of others; a bed on each drum laid.
      const behind = P - lag(i) * H * 0.4
      if (!kept(S.walls)) {
        stage(S.walls, [behind, P + H], S.walls[1])
        for (let z = behind + COURSE; z < P + H - D; z += COURSE)
          if (z > P + D * 0.45)
            disc(F, u, v, (D / 2) * (1 - 0.16 * ((z - P) / H)), z, 10, face)
      }
      stage(S.walls, [behind, P + H])
    }
    F.column(u, v, D, P, H, t.order, face)
  })
  // The cella, its walls in line with the outer columns (or inside the peristyle),
  // with a dark doorway in its front.
  const peri = t.plan === 'peripteral'
  const cw =
    t.cellaWidth ??
    (peri ? iw - s * 1.1 : t.plan === 'sine-postico' ? iw - s * 0.9 : iw + D)
  const cb = peri ? colBack + s * 0.55 : back + 0.3
  const cellae = t.cellae ?? 1
  const doors = Array.from({ length: cellae }, (_, k) => {
    const du = cw / cellae
    return [-cw / 2 + du * (k + 0.5), Math.min(du * 0.35, 4)]
  })
  if (W && !kept(S.walls)) cellaWalls(F, W, [-cw / 2, cw / 2, cb, cellaFront], P, H, doors)
  const cellaDone = kept(S.walls) ? S.walls : S.facing
  stage(cellaDone)
  F.box(-cw / 2, cw / 2, cb, cellaFront, P, P + H, shade)
  if (t.plan === 'pseudoperipteral') {
    stage(S.walls, [P, P + H])
    // Half-columns engaged in the cella's walls.
    const nL = Math.max(3, Math.round((cellaFront - cb) / s) + 1)
    for (let j = 1; j < nL; j++) {
      const vv = cellaFront - ((cellaFront - cb) * j) / (nL - 1)
      F.column(-cw / 2, vv, D, P, H, t.order, face)
      F.column(cw / 2, vv, D, P, H, t.order, face)
    }
    for (const u of us.slice(1, -1)) F.column(u, cb, D, P, H, t.order, face)
  }
  stage(S.walls, [P, P + H])
  if (t.apse)
    F.drum(0, cb, cw * 0.28, cw * 0.28, P, P + H, 12, shade, shade, Math.PI, Math.PI * 2)
  stage(cellaDone)
  for (const [uc, dw] of doors) {
    F.quad(
      [uc - dw / 2, cellaFront + 0.03, P],
      [uc + dw / 2, cellaFront + 0.03, P],
      [uc + dw / 2, cellaFront + 0.03, P + H * 0.72],
      [uc - dw / 2, cellaFront + 0.03, P + H * 0.72],
      PART.door,
    )
  }
  // Entablature round the columns, and the roof.
  const ext = D * 0.65
  const [eu, ef] = [Math.max(iw / 2 + ext, cw / 2 + 0.3), colFront + ext]
  const eb = peri ? colBack - ext : cb
  const E = Math.max(1, H * ENTABLATURE)
  if (W && !kept(S.upper)) {
    // Set block by block, open over the cella until the roof closes it.
    stage(S.upper, [P + H, P + H + E], S.roof[0])
    F.entablature(-eu, eu, eb, ef, P + H, E, face, E * 0.35, true)
    stage(S.roof)
  }
  const z = F.entablature(-eu, eu, eb, ef, P + H, E, face)
  // The tiles laid from the eaves up, over the timbers.
  stage(S.roof, [z, z + (eu + 0.45) * PEDIMENT + 1])
  const apex = F.roof(-eu - 0.45, eu + 0.45, eb - 0.45, ef + 0.45, z, {
    along: 'v',
    tiles: C.roofTemple,
    gable: face,
    covering: t.covering,
  })
  if (W && !kept(S.roof)) {
    stage(S.roof, null, S.finish[0])
    rafters(F, -eu - 0.45, eu + 0.45, eb - 0.45, ef + 0.45, z, apex)
  }
  stage(S.finish)
  if (t.quadriga) {
    // A chariot of four on the front apex: the horses' block and the driver.
    F.box(-2.2, 2.2, ef - 1.8, ef + 0.2, apex, apex + 1.8, PART.bronze)
    F.box(-0.7, 0.7, ef - 2.4, ef - 1.2, apex, apex + 3.4, PART.bronze)
  }
  stage(S.facing)
  if (t.altar) {
    const aw = Math.min(8, w * 0.3)
    const v = front + t.altar
    F.box(-aw / 2 - 0.3, aw / 2 + 0.3, v - 1.8, v + 1.8, deep, 0.4, face)
    F.box(-aw / 2, aw / 2, v - 1.5, v + 1.5, 0.4, 1.5, face)
    F.box(-aw / 2 - 0.15, aw / 2 + 0.15, v - 1.65, v + 1.65, 1.3, 1.6, face)
  }
  if (t.forecourt) {
    // Porticoes round a court before the temple, open towards it.
    const fc = t.forecourt
    stage(S.walls, [0, fc.h + 3])
    const Fc = F.sub(0, front + fc.l / 2, 0)
    const colour = fc.colour ? new THREE.Color(fc.colour) : face
    quadriporticus(Fc, fc.w, fc.l, {
      depth: 5,
      h: fc.h,
      order: fc.order,
      face: colour,
      shade,
      court: C.travertine,
      sides: [true, true, false, true],
      seed: 0.52,
    })
  }
  if (t.precinct) {
    const [pw, pl] = t.precinct
    stage(S.base, [0, 3.2])
    const g = Math.min(6, w * 0.5)
    const T = 0.7
    const h = 3.2
    F.box(-pw / 2, pw / 2, -pl / 2, -pl / 2 + T, deep, h, C.tufa)
    F.box(-pw / 2, -pw / 2 + T, -pl / 2, pl / 2, deep, h, C.tufa)
    F.box(pw / 2 - T, pw / 2, -pl / 2, pl / 2, deep, h, C.tufa)
    F.box(-pw / 2, -g / 2, pl / 2 - T, pl / 2, deep, h, C.tufa)
    F.box(g / 2, pw / 2, pl / 2 - T, pl / 2, deep, h, C.tufa)
  }
  if (t.grove) {
    // Trees in the ground round the temple, clear of it and of its front; planted last.
    stage(S.facing)
    const [gw, gl] = t.grove
    let k = 0
    for (let v = -gl / 2 + 4; v < gl / 2 - 3; v += 7)
      for (let u = -gw / 2 + 4; u < gw / 2 - 3; u += 7) {
        k++
        if (Math.abs(u) < w / 2 + 3 && v > back - 3) continue
        F.tree(
          u + ((k * 37) % 5) - 2,
          v + ((k * 53) % 5) - 2,
          2.6 + (k % 3) * 0.5,
          k % 4 ? 'oak' : 'cypress',
        )
      }
  }
  if (W)
    templeSite(
      F,
      {
        w,
        l,
        podium: P,
        top: z,
        cella: [-cw / 2, cw / 2, cb, cellaFront],
        column: D,
        face,
        crane: t.works?.crane === 'left' ? -1 : 1,
      },
      W,
    )
}

/**
 * A cella's walls while they go up: four walls of peperino in stretches, each
 * rising a course at a time a little ahead of or behind the next, as walls are
 * raised; a gap for each door, bridged by its lintel. They come down for the
 * finished cella at the facing (`temple`).
 */
function cellaWalls(
  F: Frame,
  W: Works,
  [u0, u1, v0, v1]: [number, number, number, number],
  P: number,
  H: number,
  doors: number[][],
) {
  const S = TEMPLE_WORKS
  const T = Math.min(1.2, (u1 - u0) * 0.12)
  const col = SITE_COLOURS.peperino
  let n = 0
  // A stretch of wall over a0–a1 along one side, from z0.
  const stretch = (
    box: (a: number, b: number) => number[],
    a0: number,
    a1: number,
    z0 = P,
  ) => {
    const k = Math.max(1, Math.round((a1 - a0) / 3.5))
    for (let i = 0; i < k; i++) {
      const [a, b] = [a0 + ((a1 - a0) * i) / k, a0 + ((a1 - a0) * (i + 1)) / k]
      const [bu0, bu1, bv0, bv1] = box(a, b)
      // Racked: each stretch a little behind or ahead of the last, never far.
      const behind = P - H * 0.3 * (0.5 + 0.5 * Math.sin(++n * 1.3 + lag(n) * 0.8))
      W.stage(F.b, S.walls, [behind, P + H], S.walls[1])
      beds(F, bu0, bu1, bv0, bv1, behind, P + H, col, z0)
      W.stage(F.b, S.walls, [behind, P + H], S.facing[0])
      F.box(bu0, bu1, bv0, bv1, z0, P + H, col)
    }
  }
  const across = (v: number) => (a: number, b: number) => [a, b, v - T, v]
  stretch((a, b) => [u0, u0 + T, a, b], v0, v1)
  stretch((a, b) => [u1 - T, u1, a, b], v0, v1)
  stretch((a, b) => [a, b, v0, v0 + T], u0 + T, u1 - T)
  // The front, round its doors.
  let a = u0 + T
  for (const [uc, dw] of doors) {
    stretch(across(v1), a, uc - dw / 2)
    stretch(across(v1), uc - dw / 2, uc + dw / 2, P + H * 0.72)
    a = uc + dw / 2
  }
  stretch(across(v1), a, u1 - T)
}

/** A round temple (a tholos): a round podium, a ring of columns round a round cella, a conical roof. */
export interface Tholos {
  /** While it is being built: which flank its crane stands on (works.ts; default the right). */
  works?: { crane?: 'left' | 'right' }
  columns: number
  order: Order
  column: number
  podium: number
  /** Whether the ring of columns stands on steps all round (Greek) or on a podium with a front flight (Roman). */
  crepis?: boolean
  covering?: Covering
  /** Walls built between the columns, closing the ring (Temple B's later state). */
  walled?: boolean
  /** A long podium the round temple stands on, across and along, and its height. */
  platform?: [number, number, number]
}

export function tholos(
  F0: Frame,
  t: Tholos,
  radius: number,
  face: THREE.Color,
  shade: THREE.Color,
) {
  // While it is being built, each part goes up in its own years (works.ts), as a
  // temple's do: the podium or steps cored then faced, the cella's round wall and the
  // ring of columns drum by drum, the round entablature, the cone of the roof over
  // its radial rafters.
  const W = F0.b.works
  const S = TEMPLE_WORKS
  W?.follow(S)
  const stage = (
    share: [number, number],
    rise: [number, number] | null = null,
    end?: number,
  ) => W?.stage(F0.b, share, rise, end)
  const kept = (share: [number, number]) => !!W?.survived(share)
  const cored = !!W && !kept(S.base)
  stage(S.ground)
  let F = F0
  // Where the temple stands in F0: its centre, and its ground's height there.
  let [cu, cv, cz] = [0, 0, 0]
  if (t.platform) {
    // A long podium with a flight across its front; the temple towards its back.
    const [pw, pl, ph] = t.platform
    const run = Frame.flight(ph)
    if (cored) {
      stage(S.base, [0, ph], S.facing[0])
      F0.box(-pw / 2, pw / 2, -pl / 2, pl / 2 - run, -F0.deep, ph, SITE_COLOURS.core)
      stage(S.base, [0, ph], S.base[1])
      beds(F0, -pw / 2, pw / 2, -pl / 2, pl / 2 - run, 0, ph, SITE_COLOURS.core)
    }
    stage(kept(S.base) ? S.base : S.facing)
    F0.box(-pw / 2, pw / 2, -pl / 2, pl / 2 - run, -F0.deep, ph, face)
    F0.steps(-pw / 2, pw / 2, pl / 2 - run, pl / 2, 0, ph, '+v', face)
    ;[cu, cv, cz] = [0, -pl / 2 + radius + 1.5, ph]
    F = F0.sub(cu, cv, 0, ph)
  }
  const P = t.podium
  const H = t.column
  const R = radius
  const D = Math.min(Frame.diameter(H, t.order), (2 * Math.PI * R) / (t.columns * 2.4))
  // Rising: heights in its own frame, which stands on its platform's top, as the
  // shader measures them (Builder `rise`).
  const up = (z0: number, z1: number): [number, number] => [z0, z1]
  if (cored) {
    stage(S.base, up(0, P), S.facing[0])
    F.drum(0, 0, R, R, -F.deep, P, 24, SITE_COLOURS.core)
    stage(S.base, up(0, P), S.base[1])
    for (let z = COURSE; z < P - 0.05; z += COURSE)
      disc(F, 0, 0, R, z, 24, SITE_COLOURS.core)
  }
  stage(kept(S.base) ? S.base : S.facing)
  if (t.crepis) {
    const n = Math.max(2, Math.round(P / RISE_M))
    for (let k = 0; k < n; k++) {
      const rr = R - k * TREAD_M
      F.drum(0, 0, rr, rr, k === 0 ? -F.deep : (P * k) / n, (P * (k + 1)) / n, 24, face)
    }
  } else {
    F.drum(0, 0, R + 0.2, R + 0.2, -F.deep, 0.6, 24, face)
    F.drum(0, 0, R, R, 0.6, P - 0.4, 24, face)
    F.drum(0, 0, R + 0.25, R + 0.25, P - 0.4, P, 24, face)
    const run = Frame.flight(P)
    F.steps(-R * 0.45, R * 0.45, R - 0.8, R + run, 0, P, '+v', face)
  }
  const rc = R - D * 0.9
  for (let k = 0; k < t.columns; k++) {
    const a = Math.PI / 2 + (k / t.columns) * Math.PI * 2
    const [u, v] = [Math.cos(a) * rc, Math.sin(a) * rc]
    if (W) {
      // Raised drum by drum, some ahead of others; a bed on each drum laid.
      const behind = P - lag(k) * H * 0.4
      if (!kept(S.walls)) {
        stage(S.walls, up(behind, P + H), S.walls[1])
        for (let z = behind + COURSE; z < P + H - D; z += COURSE)
          if (z > P + D * 0.45)
            disc(F, u, v, (D / 2) * (1 - 0.16 * ((z - P) / H)), z, 10, face)
      }
      stage(S.walls, up(behind, P + H))
    }
    F.column(u, v, D, P, H, t.order, face)
  }
  // The cella's round wall, a course at a time, a bed on each.
  const rCella = t.walled ? rc - D * 0.3 : rc - D * 1.6
  if (W && !kept(S.walls)) {
    stage(S.walls, up(P, P + H), S.walls[1])
    roundBeds(F, 0, 0, rCella - 0.9, rCella, P, P + H, 20, shade)
  }
  stage(S.walls, up(P, P + H))
  F.drum(0, 0, rCella, rCella, P, P + H, 20, shade, W && !kept(S.upper) ? null : shade)
  F.quad(
    [-1, rCella + 0.02, P],
    [1, rCella + 0.02, P],
    [1, rCella + 0.02, P + H * 0.7],
    [-1, rCella + 0.02, P + H * 0.7],
    PART.door,
  )
  const E = Math.max(0.8, H * ENTABLATURE * 0.9)
  stage(S.upper, up(P + H, P + H + E))
  F.ring(0, 0, rCella - 0.2, rc + D * 0.65, P + H, P + H + E, 24, face)
  const tiles = t.covering === 'gilt' ? PART.gilt : C.roofTemple
  const eaves = P + H + E
  const apex = eaves + (rc + D) * 0.42
  // The cone of tiles from the eaves up, over its rafters.
  stage(S.roof, up(eaves, apex))
  F.drum(0, 0, rc + D * 0.95, 0.4, eaves, apex, 24, tiles, null)
  if (W && !kept(S.roof)) {
    stage(S.roof, null, S.finish[0])
    const rr = rc + D * 0.85
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const foot = [Math.cos(a) * rr, Math.sin(a) * rr, eaves - 0.1]
      beam(F, foot, [0, 0, apex - 0.3], 0.22, SITE_COLOURS.timber)
      const b = (((k + 1) % 12) / 12) * Math.PI * 2
      beam(
        F,
        foot,
        [Math.cos(b) * rr, Math.sin(b) * rr, eaves - 0.1],
        0.2,
        SITE_COLOURS.timber,
      )
    }
  }
  stage(S.finish)
  F.drum(0, 0, 0.5, 0.2, apex - 0.2, apex + 1, 6, face)
  if (!W) return
  // The site round it: the scaffold round the colonnade, the crane leaning over the
  // cella's wall, the yard before its steps.
  const side = t.works?.crane === 'left' ? -1 : 1
  const front =
    cv + R + (t.platform ? t.platform[1] / 2 - radius - 1.5 + 1 : Frame.flight(P)) + 1.2
  templeSiteRound(
    F0,
    {
      centre: [cu, cv],
      radius: R,
      base: cz,
      podium: cz + P,
      top: cz + P + H + E,
      cella: rCella,
      column: D,
      face,
      side,
      yard: front,
      platform: t.platform,
    },
    W,
  )
}

/**
 * A court surrounded by porticoes: `w` × `l`, its colonnades `depth` deep and `h`
 * high facing in, a back wall round the outside; `sides` says which sides have one
 * (front, right, back, left; +v first, clockwise). `double` doubles the colonnade.
 */
export function quadriporticus(
  F: Frame,
  w: number,
  l: number,
  opts: {
    depth: number
    h: number
    order: Order
    face: THREE.Color
    shade: THREE.Color
    court?: THREE.Color | null
    sides?: [boolean, boolean, boolean, boolean]
    double?: boolean
    wall?: number
    spacing?: number
    seed?: number
    /** The sides with no portico closed by the precinct's wall, with a gateway this wide in the middle of the front (none: left open). */
    gate?: number
    /**
     * Where the side porticoes end, this far from the back: level with the front of a
     * temple standing at the back, behind them only the precinct's wall.
     */
    heads?: number
    /** The sides whose portico is roofed by what stands behind it instead (shops on a hillside). */
    roofless?: boolean[]
    /**
     * While it is being built (works.ts): dates each part before it is built — the
     * court's paving, and for side `i` its enclosure wall, its colonnade's floor, its
     * columns and entablature, its roof — with the heights each rises between.
     */
    stage?: (
      part: 'court' | 'wall' | 'floor' | 'colonnade' | 'roof',
      i: number,
      z0: number,
      z1: number,
    ) => void
  },
) {
  const { depth, h, order, face, shade } = opts
  const sides = opts.sides ?? [true, true, true, true]
  const wall = opts.wall ?? h + 1.4
  const at = opts.stage ?? (() => {})
  at('court', -1, 0, 0.25)
  if (opts.court !== null)
    F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, 0.25, opts.court ?? face)
  const D = Frame.diameter(h, order)
  const sp = opts.spacing ?? Math.max(3, D * 4.5)
  // Each side in its own frame: facing inwards, its back wall at the outside.
  const frames: [Frame, number][] = [
    [F.sub(0, l / 2, Math.PI), w],
    [F.sub(w / 2, 0, -Math.PI / 2), l],
    [F.sub(0, -l / 2, 0), w],
    [F.sub(-w / 2, 0, Math.PI / 2), l],
  ]
  frames.forEach(([S, len], i) => {
    if (!sides[i]) {
      if (opts.gate === undefined) return
      // The enclosure wall, and its gateway: an opening under a lintel, framed by
      // pilasters, up the wall's full height.
      const a = -len / 2
      const b = len / 2
      if (i !== 0) {
        at('wall', i, 0, wall)
        S.box(a, b, -0.9, 0, -S.deep, wall, shade)
        return
      }
      const g = opts.gate / 2
      at('wall', i, 0, wall + 0.6)
      S.box(a, -g, -0.9, 0, -S.deep, wall, shade)
      S.box(g, b, -0.9, 0, -S.deep, wall, shade)
      S.box(-g - 0.1, g + 0.1, -0.9, 0, h * 0.75, wall, shade)
      for (const u of [-g, g]) S.box(u - 0.7, u + 0.7, -1.2, 0.3, -S.deep, wall + 0.3, face)
      S.box(-g - 0.8, g + 0.8, -1.25, 0.35, wall, wall + 0.6, face)
      return
    }
    // In the side's frame the court is towards +v, the back wall at v = 0. The right
    // side runs from the back (-u) to the front, the left from the front to the back.
    at('wall', i, 0, wall)
    S.box(-len / 2, len / 2, -0.9, 0, -S.deep, wall, shade)
    const cut = opts.heads !== undefined && (i === 1 || i === 3) ? opts.heads : 0
    const a = -len / 2 + (i === 1 ? cut : 0)
    const b = len / 2 - (i === 3 ? cut : 0)
    // Its columns are set in from an end where it meets another portico, not where it
    // stops at its head.
    const [inA, inB] = [i === 1 && cut, i === 3 && cut].map((open) => !open)
    at('floor', i, 0, 0.4)
    S.box(a, b, 0, depth, -0.2, 0.4, face)
    const E = Math.max(0.8, h * 0.18)
    at('colonnade', i, 0.4, h + 0.4 + E)
    const rows = opts.double ? [depth * 0.45, depth - D] : [depth - D]
    const ua = a + (inA ? depth - D : D)
    const ub = b - (inB ? depth - D : D)
    for (const vv of rows) {
      const n = Math.max(2, Math.round((ub - ua - 2 * D) / sp))
      for (let k = 0; k <= n; k++) {
        const u = ua + ((ub - ua) * k) / n
        S.column(u, vv, D, 0.4, h, order, face)
      }
    }
    S.entablature(
      ua - D * 0.2,
      ub + D * 0.2,
      depth - D * 1.6,
      depth - D * 0.4,
      h + 0.4,
      E,
      face,
      0.2,
    )
    // A lean-to of tiles from the back wall down over the colonnade.
    if (opts.roofless?.[i]) return
    const z0 = h + 0.4 + E
    at('roof', i, z0, wall + 0.6)
    const look = S.b.look
    S.b.look = SKIN.roof * 10 + (opts.seed ?? 0.3) * 0.9
    const run = depth + 0.3
    S.skinQuad(
      [a, -0.2, wall + 0.6, 0, 0, run],
      [b, -0.2, wall + 0.6, b - a, 0, run],
      [b, depth + 0.3, z0, b - a, run, run],
      [a, depth + 0.3, z0, 0, run, run],
      C.roofTemple,
    )
    S.b.look = look
  })
}

/**
 * A hall under a tiled roof: its walls `h` high in `face` round u0–u1 × v0–v1, a
 * doorway on its front (+v) and small windows high in its sides.
 */
export function hall(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z0: number,
  h: number,
  face: THREE.Color,
  opts: {
    roof?: 'gable' | 'hip' | 'flat'
    door?: number
    windows?: number
    along?: 'u' | 'v'
    pitch?: number
    /** Called before its roof is built, to date it while it is being built (works.ts). */
    roofing?: (z: number) => void
  } = {},
) {
  F.box(
    u0,
    u1,
    v0,
    v1,
    Math.min(z0 - 6, -F.deep),
    z0 + h,
    face,
    opts.roof === 'flat' ? face : null,
  )
  if (opts.door) {
    const dw = opts.door
    F.quad(
      [-dw / 2, v1 + 0.03, z0],
      [dw / 2, v1 + 0.03, z0],
      [dw / 2, v1 + 0.03, z0 + Math.min(h * 0.6, dw * 2.2)],
      [-dw / 2, v1 + 0.03, z0 + Math.min(h * 0.6, dw * 2.2)],
      PART.door,
    )
  }
  const nw = opts.windows ?? 0
  for (let k = 0; k < nw; k++) {
    const v = v0 + ((v1 - v0) * (k + 0.5)) / nw
    for (const [u, du] of [
      [u0 - 0.03, 0],
      [u1 + 0.03, 0],
    ] as const) {
      void du
      F.quad(
        [u, v - 0.7, z0 + h * 0.62],
        [u, v + 0.7, z0 + h * 0.62],
        [u, v + 0.7, z0 + h * 0.86],
        [u, v - 0.7, z0 + h * 0.86],
        PART.dark,
      )
    }
  }
  opts.roofing?.(z0 + h)
  if (opts.roof !== 'flat')
    F.roof(u0 - 0.4, u1 + 0.4, v0 - 0.4, v1 + 0.4, z0 + h, {
      along: opts.along,
      tiles: C.roofTemple,
      gable: opts.roof === 'hip' ? null : face,
      pitch: opts.pitch,
    })
}
