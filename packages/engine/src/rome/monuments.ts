import * as THREE from 'three/webgpu'
import {
  type Covering,
  Frame,
  hall,
  type Order,
  PART,
  type Storey,
  quadriporticus,
  type Temple,
  temple,
  type Tholos,
  tholos,
} from './architecture.ts'
import { type Builder, C, type Pt, SKIN } from './builder.ts'

/**
 * The known buildings built as themselves (DESIGN.md §7.7), from their designs
 * (pipeline/src/rome/designs.ts, where each one's sources are): the building types
 * of architecture.ts, and the monuments that are types of their own. Each builder
 * works in the monument's frame (architecture.ts `Frame`): `w` across its front,
 * `l` along its depth, its front towards +v.
 */

/** A design as model.json carries it: its own fields, its centre and size in plane metres, and its bearing. */
export interface Design {
  model: string
  centre: Pt
  /** Across its front and along its depth, metres. */
  size: Pt
  /** The way its front faces, radians clockwise from north. */
  bearing: number
  phases?: ({ from: number } & Record<string, unknown>)[]
  [k: string]: unknown
}

/** Builds one design, standing on `base`, in the builder's stone of the moment. */
export function buildDesign(b: Builder, d: Design, base: number) {
  const F0 = new Frame(b, d.centre[0], d.centre[1], d.bearing, base)
  F0.deep = Math.max(6, ((d.drop as number | undefined) ?? 0) + 1.5)
  // A building set off the centre of its site (a temple at the back of its court).
  const [du, dv] = (d.offset as Pt | undefined) ?? [0, 0]
  const F = du || dv ? F0.sub(du, dv) : F0
  // A building smaller than its site (a rebuilding that grew) has its own extent.
  const [w, l] = (d.extent as Pt | undefined) ?? d.size
  const build = BUILD[d.model]
  if (!build) throw new Error(`model of Rome: no way to build a ${d.model}`)
  build(F, d as never, w, l, b.face, b.shade)
}

type Build<T = Design> = (
  F: Frame,
  d: T,
  w: number,
  l: number,
  face: THREE.Color,
  shade: THREE.Color,
) => void

// --- the types --------------------------------------------------------------------------

/**
 * A basilica: a hall on a stepped platform, its nave raised over the aisles as a
 * clerestory under its own roof. Its outside is an arcade of `storeys` round all
 * four sides (the Julia), or a portico of shops along its front only with plain walls
 * elsewhere (the Aemilia).
 */
interface Basilica {
  storeys: Storey[]
  bay: number
  /** The nave's width and length, and the height of its roof's eaves. */
  nave: [number, number]
  naveH: number
  /** Where the arcade runs: all four sides, or only the front. */
  arcade: 'all' | 'front'
  /** The platform's height, its steps along the front. */
  platform?: number
  /** How deep the gallery behind the front arcade is. */
  depth?: number
}

const basilica: Build<Design & Basilica> = (F, d, w, l, face, shade) => {
  const P = d.platform ?? 1
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, P, face)
  if (P > 0.3) F.steps(-w / 2, w / 2, l / 2, l / 2 + Frame.flight(P), 0, P, '+v', face)
  const depth = d.depth ?? 5
  const H = d.storeys.reduce((s, st) => s + st.h, 0)
  const sides: [Frame, number][] = [
    [F.sub(0, l / 2, Math.PI), w],
    [F.sub(w / 2, 0, -Math.PI / 2), l],
    [F.sub(0, -l / 2, 0), w],
    [F.sub(-w / 2, 0, Math.PI / 2), l],
  ]
  sides.forEach(([S, len], i) => {
    if (i === 0 || d.arcade === 'all')
      S.arcade(-len / 2, len / 2, 0, depth, P, d.storeys, d.bay, face)
  })
  // Behind a front-only arcade, the body of the building to the arcade's height.
  if (d.arcade === 'front')
    F.box(-w / 2, w / 2, -l / 2, l / 2 - depth, P, P + H, face, null)
  // The aisles' roof, a low hip of tiles over the whole, under the nave.
  F.roof(-w / 2 - 0.3, w / 2 + 0.3, -l / 2 - 0.3, l / 2 + 0.3, P + H + 0.2, {
    tiles: C.roofTemple,
    pitch: 0.14,
    seed: 0.21,
  })
  // The nave's clerestory, with its windows, and its gable roof.
  const [nw, nl] = d.nave
  const along = nl >= nw ? 'u' : 'v'
  const [hu, hv] = along === 'u' ? [nl / 2, nw / 2] : [nw / 2, nl / 2]
  F.box(-hu, hu, -hv, hv, P + H, P + d.naveH, shade, null)
  const n = Math.max(3, Math.round((2 * hu) / 5))
  for (let k = 0; k < n; k++) {
    const u = -hu + ((k + 0.5) * 2 * hu) / n
    for (const v of [-hv - 0.03, hv + 0.03])
      F.quad(
        [u - 0.9, v, P + d.naveH - 3.4],
        [u + 0.9, v, P + d.naveH - 3.4],
        [u + 0.9, v, P + d.naveH - 1],
        [u - 0.9, v, P + d.naveH - 1],
        PART.dark,
      )
  }
  F.roof(-hu - 0.4, hu + 0.4, -hv - 0.4, hv + 0.4, P + d.naveH, {
    along,
    tiles: C.roofTemple,
    gable: shade,
    pitch: 0.2,
    seed: 0.63,
  })
}

/** A senate house: a tall hall on a podium with a flight to its doors and a pedimented roof. */
interface Curia {
  h: number
  podium: number
  /** A porch of columns across the front, if it had one. */
  porch?: { columns: number; order: Order; depth: number }
  /** A Victory on a globe at the apex of its pediment (the Curia Julia's, on the coins). */
  victory?: boolean
}

const curia: Build<Design & Curia> = (F, d, w, l, face) => {
  const P = d.podium
  const stairs = Frame.flight(P)
  const front = l / 2 - stairs - (d.porch?.depth ?? 0)
  F.box(-w / 2, w / 2, -l / 2, front, -F.deep, P, face)
  F.steps(-w * 0.3, w * 0.3, front + (d.porch?.depth ?? 0), l / 2, 0, P, '+v', face)
  if (d.porch) {
    F.box(-w / 2, w / 2, front, front + d.porch.depth, -F.deep, P, face)
    const D = Frame.diameter(d.h * 0.55, d.porch.order)
    const n = d.porch.columns
    for (let k = 0; k < n; k++)
      F.column(
        -w / 2 + D + ((w - 2 * D) * k) / (n - 1),
        front + d.porch.depth - D,
        D,
        P,
        d.h * 0.55,
        d.porch.order,
        face,
      )
    F.entablature(-w / 2, w / 2, front, front + d.porch.depth, P + d.h * 0.55, 1, face)
    F.roof(-w / 2, w / 2, front - 0.2, front + d.porch.depth + 0.2, P + d.h * 0.55 + 1, {
      along: 'u',
      tiles: C.roofTemple,
      pitch: 0.2,
    })
  }
  hall(F, -w / 2, w / 2, -l / 2, front, P, d.h, face, {
    door: 3.2,
    windows: 0,
    along: 'v',
    roof: 'gable',
  })
  if (d.victory) {
    const apex = P + d.h + (w / 2 + 0.4) * (2 / 9)
    F.drum(0, front, 0.9, 0.9, apex - 0.2, apex + 1.4, 8, PART.gilt)
    F.box(-0.3, 0.3, front - 0.3, front + 0.3, apex + 1.4, apex + 3.4, PART.gilt)
  }
  // Three tall windows over the doors.
  for (const u of [-w * 0.26, 0, w * 0.26])
    F.quad(
      [u - 1.1, front + 0.04, P + d.h * 0.62],
      [u + 1.1, front + 0.04, P + d.h * 0.62],
      [u + 1.1, front + 0.04, P + d.h * 0.9],
      [u - 1.1, front + 0.04, P + d.h * 0.9],
      PART.dark,
    )
}

/**
 * A court inside porticoes: a forum, or a porticus round temples or a garden. The
 * porticoes stand on the sides named (front, right, back, left), single or double;
 * the court is paved, or a garden of trees in rows.
 */
interface Porticus {
  depth: number
  h: number
  order: Order
  sides?: [boolean, boolean, boolean, boolean]
  /** The sides with no portico closed by the precinct's wall, with a gateway this wide. */
  gate?: number
  double?: boolean
  paving?: 'travertine' | 'tufa' | 'marble' | 'garden'
  /** Shops behind the porticoes on the sides named, this deep. */
  shops?: { depth: number; sides: [boolean, boolean, boolean, boolean] }
  /** A gateway in the middle of the front. */
  propylon?: { w: number; columns: number }
  /** Rows of trees in a garden court: how many rows, and their spacing. */
  groves?: { rows: number; spacing: number; kind: 'plane' | 'cypress' | 'oak' }
  /** An equestrian statue in the middle of the court (Caesar's in his forum). */
  statue?: boolean
}

const porticus: Build<Design & Porticus> = (F, d, w, l, face, shade) => {
  const court =
    d.paving === 'garden'
      ? PART.garden
      : d.paving === 'tufa'
        ? C.tufa
        : d.paving === 'marble'
          ? face
          : C.travertine
  quadriporticus(F, w, l, {
    depth: d.depth,
    h: d.h,
    order: d.order,
    face,
    shade,
    court,
    sides: d.sides,
    gate: d.gate,
    double: d.double,
    seed: 0.4,
  })
  if (d.shops) {
    const s = d.shops.depth
    const H = d.h + 1.4
    const edges: [number, number, number, number][] = [
      [-w / 2, w / 2, l / 2, l / 2 + s],
      [w / 2, w / 2 + s, -l / 2, l / 2],
      [-w / 2, w / 2, -l / 2 - s, -l / 2],
      [-w / 2 - s, -w / 2, -l / 2, l / 2],
    ]
    edges.forEach(([u0, u1, v0, v1], i) => {
      if (!d.shops!.sides[i]) return
      F.box(u0, u1, v0, v1, -F.deep, H, shade, null)
      F.roof(u0 - 0.3, u1 + 0.3, v0 - 0.3, v1 + 0.3, H, {
        tiles: C.roofTemple,
        pitch: 0.28,
        seed: 0.7,
      })
    })
  }
  if (d.propylon) {
    const pw = d.propylon.w
    const S = F.sub(0, l / 2 - 1, 0)
    S.box(-pw / 2, pw / 2, -1.5, 3.5, -S.deep, 0.6, face)
    const D = Frame.diameter(d.h * 1.15, d.order)
    const n = d.propylon.columns
    for (let k = 0; k < n; k++)
      S.column(
        -pw / 2 + D + ((pw - 2 * D) * k) / (n - 1),
        3.5 - D,
        D,
        0.6,
        d.h * 1.15,
        d.order,
        face,
      )
    const z = S.entablature(-pw / 2, pw / 2, -1.5, 3.5, 0.6 + d.h * 1.15, 1.3, face)
    S.roof(-pw / 2 - 0.3, pw / 2 + 0.3, -1.8, 3.8, z, {
      along: 'v',
      tiles: C.roofTemple,
      gable: face,
    })
  }
  if (d.statue) {
    F.box(-1.4, 1.4, -2.6, 2.6, 0, 2.4, face)
    F.box(-0.5, 0.5, -1.6, 1.6, 2.4, 4.2, PART.bronze)
    F.box(-0.35, 0.35, -0.8, 0.2, 4.2, 5.6, PART.bronze)
  }
  if (d.groves) {
    const { rows, spacing, kind } = d.groves
    const inner = [w / 2 - d.depth - 4, l / 2 - d.depth - 4]
    for (let i = 0; i < rows; i++) {
      const u = -inner[0] + (2 * inner[0] * (i + 0.5)) / rows
      for (let v = -inner[1] + spacing / 2; v < inner[1]; v += spacing)
        F.tree(u, v, kind === 'cypress' ? 2.2 : 3.4, kind === 'plane' ? 'oak' : kind)
    }
  }
}

/**
 * A theatre: the cavea a half-ring of seats rising from the orchestra to an outer
 * wall of arcaded storeys, a colonnade round its top; the stage building across the
 * diameter, as high as the cavea, its columned front towards the seats. Its front
 * (+v) is the side the stage is on. A temple may stand at the top of the seats, on
 * the axis (Pompey's of Venus Victrix).
 */
interface Theatre {
  /** The outer radius, the orchestra's, and the height of the outer wall. */
  radius: number
  orchestra: number
  h: number
  storeys: Storey[]
  /** The stage building's depth, and its height over the cavea's. */
  scaena: number
  temple?: Temple & { size: [number, number] }
}

const theatre: Build<Design & Theatre> = (F, d, w, l, face, shade) => {
  void w
  const R = d.radius
  const cv = -l / 2 + R
  const S = F.sub(0, cv)
  // The half-ring behind the orchestra is towards -v: angles π to 2π.
  const [a0, a1] = [Math.PI, Math.PI * 2]
  const gallery = 5
  S.arcadeArc(0, 0, R, a0, a1, gallery, 0, d.storeys, 6.2, face)
  S.cavea(0, 0, d.orchestra, R - gallery, 1.2, d.h - 3.5, a0, a1, C.seating, { bands: 2 })
  // The gallery's roof, the colonnade round the top of the seats and its roof.
  S.ring(0, 0, R - gallery, R, d.h - 0.4, d.h, 48, face, face, a0, a1)
  const top = d.h
  for (let k = 0; k <= 40; k++) {
    const a = a0 + ((a1 - a0) * k) / 40
    S.column(
      Math.cos(a) * (R - gallery - 1),
      Math.sin(a) * (R - gallery - 1),
      0.7,
      d.h - 3.5,
      5,
      'corinthian',
      face,
    )
  }
  S.ring(
    0,
    0,
    R - gallery - 1.6,
    R - gallery + 0.2,
    top + 1.5,
    top + 2.3,
    48,
    face,
    C.roofTemple,
    a0,
    a1,
  )
  // The orchestra, paved, and the stage.
  S.drum(0, 0, d.orchestra, d.orchestra, -0.2, 0.3, 24, C.travertine, C.travertine, a0, a1)
  const stage = 7
  S.box(-d.orchestra - 12, d.orchestra + 12, 0, stage, -S.deep, 1.5, face)
  // The stage building: its front of columns in storeys, and its roof sloping back.
  const sw = R * 0.9
  const v0 = stage
  const v1 = stage + d.scaena
  S.box(-sw, sw, v0, v1, -S.deep, top + 2, shade, null)
  const D = 1.1
  const n = Math.round((2 * sw) / 4.2)
  for (const [z, h] of [
    [1.5, (top - 1.5) * 0.36],
    [1.5 + (top - 1.5) * 0.36, (top - 1.5) * 0.32],
    [1.5 + (top - 1.5) * 0.68, (top - 1.5) * 0.3],
  ] as const) {
    for (let k = 0; k <= n; k++)
      S.column(
        -sw + 1 + ((2 * sw - 2) * k) / n,
        v0 - D,
        D * (h / 9),
        z,
        h - 0.8,
        'corinthian',
        face,
      )
    S.box(-sw, sw, v0 - D * 1.6, v0, z + h - 0.8, z + h, face)
  }
  S.roof(-sw - 0.4, sw + 0.4, v0 - 2.5, v1 + 0.4, top + 2, {
    along: 'u',
    tiles: C.roofTemple,
    pitch: 0.18,
    gable: shade,
    seed: 0.33,
  })
  // The halls at either end of the stage.
  for (const s of [-1, 1]) {
    const u0 = s < 0 ? -R : sw
    const u1 = s < 0 ? -sw : R
    hall(S, u0, u1, 0, v1, 0, top * 0.72, face, { roof: 'hip' })
  }
  // A temple at the top of the seats, on the axis, facing the stage.
  if (d.temple) {
    const [tw, tl] = d.temple.size
    const T = S.sub(0, -R + tl / 2 - 2, 0, d.h - 4)
    temple(T, d.temple, tw, tl, face, shade)
  }
}

/**
 * A circus: the arena between stands on its two long sides and round its curved end
 * (+v), the starting gates across its other end (-v). As Caesar rebuilt the Circus
 * Maximus in 46 BCE (Dionysius 3.68): seats in three tiers, the lowest of stone and
 * the upper two of timber, behind a one-storey arcade of shops; a water channel, the
 * euripus, round the arena at the foot of the seats; unroofed starting stalls behind
 * an arcaded front with towers at its ends. There was no continuous barrier in the
 * Republic: down the axis stood the turning posts, of three cones each, statues on
 * columns and shrines, and the lap counters — the eggs of 174 BCE and, from 33 BCE,
 * Agrippa's dolphins.
 */
interface Circus {
  /** How deep the stands are, the top of the seats and the outer arcade's height. */
  stands: number
  h: number
  arcade: number
  gates: number
  /** Whether the lowest tier is of stone (from Caesar's rebuilding), the rest timber. */
  stone?: boolean
  euripus?: boolean
  dolphins?: boolean
  eggs?: boolean
  /** How far apart the turning posts stand, metres. */
  metae: number
}

const circus: Build<Design & Circus> = (F, d, w, l, face) => {
  const R = w / 2
  const cv = l / 2 - R
  const gates = -l / 2
  const D = d.stands
  const inner = R - D
  const arcadeD = 4
  const seatD = D - arcadeD
  const timber = PART.timber
  const stone = C.seating
  // The arena's sand.
  F.box(-inner, inner, gates + 8, cv, -0.3, 0.25, C.sand)
  F.drum(0, cv, inner, inner, -0.3, 0.25, 24, C.sand, C.sand, 0, Math.PI)
  // The seats rise from the podium wall at the arena to the back of the stands, in
  // three tiers: the lowest of stone once Caesar rebuilt it, the upper two of timber.
  const z0 = 3
  const zr = d.h
  const rows = Math.round(seatD / 1.6)
  const tierOf = (j: number) => (d.stone && j < rows / 3 ? stone : timber)
  const riserOf = (j: number) => tierOf(j).clone().multiplyScalar(0.8)
  for (const s of [-1, 1]) {
    const len = cv - gates - 10
    const S = F.sub(
      s * (inner + seatD / 2),
      (gates + 10 + cv) / 2,
      s > 0 ? -Math.PI / 2 : Math.PI / 2,
    )
    // In the side's frame the arena is towards +v; the seats rise towards -v.
    for (let j = 0; j < rows; j++) {
      const v0 = seatD / 2 - (seatD * j) / rows
      const v1 = seatD / 2 - (seatD * (j + 1)) / rows
      const za = z0 + ((zr - z0) * j) / rows
      const zb = z0 + ((zr - z0) * (j + 1)) / rows
      S.quad(
        [-len / 2, v0, za],
        [len / 2, v0, za],
        [len / 2, v0, zb],
        [-len / 2, v0, zb],
        riserOf(j),
      )
      S.quad(
        [-len / 2, v0, zb],
        [len / 2, v0, zb],
        [len / 2, v1, zb],
        [-len / 2, v1, zb],
        tierOf(j),
      )
    }
    // The podium wall at the arena, and the back of the seats down to the arcade.
    S.box(-len / 2, len / 2, seatD / 2 - 0.8, seatD / 2, -F.deep, z0 + 0.3, face)
    S.box(-len / 2, len / 2, -seatD / 2 - 0.6, -seatD / 2, -F.deep, zr + 1.2, face)
    // The shops' arcade outside, under a lean-to of tiles against the stands.
    const A = F.sub(s * R, (gates + 10 + cv) / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2)
    A.arcade(
      -len / 2,
      len / 2,
      0,
      arcadeD,
      0,
      [{ h: d.arcade, order: 'tuscan', open: true }],
      5.8,
      face,
    )
    const look = F.b.look
    F.b.look = SKIN.roof * 10 + 0.61 * 0.9
    A.skinQuad(
      [-len / 2, -0.3, d.arcade + 0.2, 0, arcadeD + 0.6, arcadeD + 0.6],
      [len / 2, -0.3, d.arcade + 0.2, len, arcadeD + 0.6, arcadeD + 0.6],
      [len / 2, arcadeD + 0.3, d.arcade + 1.6, len, 0, arcadeD + 0.6],
      [-len / 2, arcadeD + 0.3, d.arcade + 1.6, 0, 0, arcadeD + 0.6],
      C.roofTemple,
    )
    F.b.look = look
  }
  // Round the curved end: the seats, their back, the arcade.
  const rc = inner + seatD
  for (let j = 0; j < rows; j++) {
    const ra = inner + (seatD * j) / rows
    const rb = inner + (seatD * (j + 1)) / rows
    const za = z0 + ((zr - z0) * j) / rows
    const zb = z0 + ((zr - z0) * (j + 1)) / rows
    F.ring(0, cv, ra - 0.01, ra, za, zb, 24, riserOf(j), riserOf(j), 0, Math.PI)
    F.ring(0, cv, ra, rb, zb - 0.01, zb, 24, tierOf(j), tierOf(j), 0, Math.PI)
  }
  F.ring(0, cv, inner - 0.8, inner, -F.deep, z0 + 0.3, 24, face, face, 0, Math.PI)
  F.ring(0, cv, rc, rc + 0.6, -F.deep, zr + 1.2, 24, face, face, 0, Math.PI)
  F.arcadeArc(
    0,
    cv,
    R,
    0,
    Math.PI,
    arcadeD,
    0,
    [{ h: d.arcade, order: 'tuscan', open: true }],
    5.8,
    face,
  )
  F.ring(0, cv, rc, R + 0.3, d.arcade, d.arcade + 0.6, 24, face, C.roofTemple, 0, Math.PI)
  if (d.euripus) {
    // The channel of water round the arena, at the foot of the podium wall, ten feet wide.
    for (const s of [-1, 1])
      F.box(
        s < 0 ? -inner : inner - 3,
        s < 0 ? -inner + 3 : inner,
        gates + 12,
        cv,
        -0.2,
        0.3,
        PART.water,
      )
    F.ring(0, cv, inner - 3, inner, -0.2, 0.3, 24, PART.water, PART.water, 0, Math.PI)
  }
  // The starting stalls across the open end: an arcaded front with towers at its ends,
  // the stalls behind it open to the sky.
  const G = F.sub(0, gates + 8, Math.PI)
  G.arcade(
    -inner,
    inner,
    0,
    7,
    0,
    [{ h: 6.5, order: 'tuscan', open: true }],
    (2 * inner) / d.gates,
    face,
  )
  for (let k = 1; k < d.gates; k++) {
    const u = -inner + (2 * inner * k) / d.gates
    G.box(u - 0.3, u + 0.3, 1, 7, 0, 5.8, PART.timber)
  }
  for (const s of [-1, 1])
    F.box(s * inner - 7, s * inner + 7, gates, gates + 12, -F.deep, zr + 5, face, face)
  // Down the axis: the turning posts, with shrines, statues on columns and the lap counters between.
  const mid = (gates + 8 + cv) / 2
  const [m0, m1] = [mid - d.metae / 2, mid + d.metae / 2]
  for (const v of [m0, m1]) {
    F.drum(0, v, 3.6, 3.6, -0.3, 1.8, 12, face)
    for (const u of [-1.7, 0, 1.7]) F.drum(u, v, 0.85, 0.15, 1.8, 7.8, 8, PART.gilt, null)
  }
  for (let k = 1; k < 8; k++) {
    const v = m0 + ((m1 - m0) * k) / 8
    if (k === 2 || k === 6) continue
    if (k % 2) {
      F.box(-1.8, 1.8, v - 2.2, v + 2.2, -0.3, 3.4, face)
      F.roof(-2, 2, v - 2.4, v + 2.4, 3.4, {
        along: 'v',
        tiles: C.roofTemple,
        gable: face,
        pitch: 0.3,
      })
    } else {
      F.drum(0, v, 0.5, 0.45, -0.3, 6, 8, face)
      F.drum(0, v, 0.4, 0.3, 6, 7.8, 6, PART.bronze)
    }
  }
  const counter = (v: number, kind: 'eggs' | 'dolphins') => {
    F.box(-2.6, -2.2, v - 3.5, v + 3.5, -0.3, 6.5, face)
    F.box(2.2, 2.6, v - 3.5, v + 3.5, -0.3, 6.5, face)
    F.box(-2.6, 2.6, v - 3.5, v + 3.5, 6.5, 6.9, face)
    for (let k = 0; k < 7; k++) {
      const vv = v - 3 + k
      if (kind === 'eggs') F.drum(0, vv, 0.35, 0.3, 6.9, 7.6, 6, face)
      else F.box(-0.2, 0.2, vv - 0.4, vv + 0.4, 6.9, 7.9, PART.bronze)
    }
  }
  if (d.eggs) counter(m0 + (m1 - m0) * 0.25, 'eggs')
  if (d.dolphins) counter(m0 + (m1 - m0) * 0.75, 'dolphins')
}

/**
 * A great round tomb: a drum faced in stone, and above it a mound of earth planted
 * with evergreens, rising in terraces to a core that carries a statue. Inside, ring
 * walls one within another hold the earth: while it is being built they are what
 * shows.
 */
interface Mausoleum {
  /** The drum's height, and the heights and radii of the terraces above it. */
  drum: number
  terraces: [number, number][]
  statue?: number
  entrance?: number
}

const mausoleum: Build<Design & Mausoleum> = (F, d, w, _l, face) => {
  const R = w / 2
  F.drum(0, 0, R + 0.4, R + 0.4, -F.deep, 0.8, 40, face, null)
  F.drum(0, 0, R, R, 0.8, d.drum - 0.8, 40, face, null)
  F.ring(0, 0, R - 2.5, R + 0.4, d.drum - 0.8, d.drum, 40, face, face)
  // The mound's surface: from the drum's top at its rim up the terraces to the core.
  const pts: [number, number][] = [
    [R - 2.5, d.drum],
    ...d.terraces.map(([z, r]) => [r, z] as [number, number]),
  ]
  const surface = (r: number) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [[ra, za], [rb, zb]] = [pts[i], pts[i + 1]]
      if (r <= ra && r >= rb) return za + ((zb - za) * (ra - r)) / (ra - rb)
    }
    return pts[pts.length - 1][1]
  }
  // The ring walls inside, just under the earth, in reticulate.
  for (const k of [0.8, 0.62, 0.44, 0.27]) {
    const r = R * k
    F.ring(0, 0, r - 1.2, r, 0, surface(r) - 0.6, 36, PART.tufaGrey, PART.tufaGrey)
  }
  let [z, r] = [d.drum, R - 2.5]
  for (const [hz, rr] of d.terraces) {
    F.drum(0, 0, r, rr, z, hz, 36, PART.earth, PART.earth)
    const trees = Math.round((2 * Math.PI * (r + rr)) / 2 / 5)
    for (let k = 0; k < trees; k++) {
      const a = (k / trees) * Math.PI * 2 + z
      const rt = (r + rr) / 2
      F.tree(
        Math.cos(a) * rt,
        Math.sin(a) * rt,
        2.4 + (k % 3) * 0.4,
        k % 2 ? 'cypress' : 'oak',
        surface(rt),
      )
    }
    ;[z, r] = [hz, rr]
  }
  // The core, faced like the drum, with the statue on it.
  F.drum(0, 0, r, r, z - 1, z + 3, 24, face)
  if (d.statue) {
    F.box(-1.5, 1.5, -1.5, 1.5, z + 3, z + 5, face)
    F.drum(0, 0, 0.8, 0.6, z + 5, z + 5 + d.statue, 8, PART.bronze)
  }
  if (d.entrance) {
    F.quad(
      [-d.entrance / 2, R + 0.45, 0.8],
      [d.entrance / 2, R + 0.45, 0.8],
      [d.entrance / 2, R + 0.45, 0.8 + d.entrance * 1.6],
      [-d.entrance / 2, R + 0.45, 0.8 + d.entrance * 1.6],
      PART.door,
    )
  }
}

/**
 * A bridge along its length (v, from bank to bank), `w` wide: arches of the given
 * spans springing from piers with pointed cutwaters, a small flood arch through a
 * pier where it had one, and a deck with parapets at the height of its banks. A
 * timber bridge (the Sublicius) is a deck on trestles of piles.
 */
interface Bridge {
  /** The arches' spans, bank to bank, metres; and the piers' widths between them. */
  spans: number[]
  piers: number[]
  /** How high each arch rises for its span: a half for a semicircle, less for a flattened one. */
  rise?: number
  /** A flood arch through each pier, of this span. */
  flood?: number
  /** A timber bridge on trestles of piles. */
  timber?: boolean
  /** The water's surface, and the ground at its two ends, metres over its ground (from the model). */
  water?: number
  banks?: [number, number]
}

const bridge: Build<Design & Bridge> = (F, d, w, l, face) => {
  const wl = d.water ?? 2
  const banks = d.banks ?? [wl + 8, wl + 8]
  // Along the bridge in a frame turned so its u runs from bank to bank.
  const S = F.sub(0, 0, Math.PI / 2)
  const top = Math.max(wl + 6, ...banks) + 0.3
  const deckCol = d.timber ? PART.timber : C.paving
  const wall = d.timber ? PART.timber : face
  if (d.timber) {
    // Bents of piles across the stream, a deck of planks, a rail.
    const n = d.spans.length
    for (let k = 0; k <= n; k++) {
      const u = -l / 2 + (l * k) / n
      for (const v of [-w / 2 + 0.4, 0, w / 2 - 0.4])
        S.drum(u, v, 0.25, 0.25, wl - 3, top - 0.6, 5, PART.wood, null)
      S.box(u - 0.3, u + 0.3, -w / 2, w / 2, top - 1.1, top - 0.6, PART.wood)
    }
    S.box(-l / 2 - 3, l / 2 + 3, -w / 2, w / 2, top - 0.6, top, PART.wood, deckCol)
    for (const s of [-1, 1])
      S.box(
        -l / 2 - 3,
        l / 2 + 3,
        (s * w) / 2 - 0.15,
        (s * w) / 2 + 0.15,
        top,
        top + 1,
        PART.wood,
      )
    return
  }
  const total = d.spans.reduce((s, x) => s + x, 0) + d.piers.reduce((s, x) => s + x, 0)
  const rise = d.rise ?? 0.5
  const arch = (sa: number, sb: number, crown: number, r = rise) => {
    const span = sb - sa
    S.arch(
      sa,
      sb,
      -w / 2,
      w,
      Math.max(wl - 1, crown - span * r),
      crown,
      top - 1.2,
      wall,
      PART.dark,
    )
  }
  // The abutments run into the banks.
  S.box(-l / 2 - 6, -total / 2, -w / 2, w / 2, wl - 4, top - 1.2, wall)
  S.box(total / 2, l / 2 + 6, -w / 2, w / 2, wl - 4, top - 1.2, wall)
  let u = -total / 2
  d.spans.forEach((span, i) => {
    // The crowns rise towards the middle of the stream.
    const crown =
      top - 1.6 - (d.spans.length > 1 ? Math.abs(i - (d.spans.length - 1) / 2) * 1.2 : 0)
    arch(u, u + span, crown)
    u += span
    const p = d.piers[i]
    if (p === undefined) return
    const [pa, pb] = [u, u + p]
    if (d.flood) {
      const fs = Math.min(d.flood, p * 0.6)
      const m = (pa + pb) / 2
      S.box(pa, m - fs / 2, -w / 2, w / 2, wl - 4, top - 1.2, wall)
      S.box(m + fs / 2, pb, -w / 2, w / 2, wl - 4, top - 1.2, wall)
      S.box(m - fs / 2, m + fs / 2, -w / 2, w / 2, wl - 4, wl + 2, wall)
      arch(m - fs / 2, m + fs / 2, wl + 2 + fs * 0.5, 0.5)
    } else S.box(pa, pb, -w / 2, w / 2, wl - 4, top - 1.2, wall)
    // Pointed cutwaters on both faces of the pier, up to above the floods.
    for (const s of [-1, 1]) {
      const v0 = (s * w) / 2
      S.prism(
        [
          [pa, v0],
          [pb, v0],
          [(pa + pb) / 2, v0 + s * p * 0.75],
        ],
        wl - 4,
        wl + 3,
        wall,
      )
    }
    u = pb
  })
  // The deck and its parapets.
  S.box(-l / 2 - 6, l / 2 + 6, -w / 2, w / 2, top - 1.2, top, wall, deckCol)
  for (const s of [-1, 1])
    S.box(
      -l / 2 - 6,
      l / 2 + 6,
      (s * w) / 2 - (s > 0 ? 0.5 : 0),
      (s * w) / 2 + (s < 0 ? 0.5 : 0),
      top,
      top + 1.1,
      wall,
    )
}

/** An honorary arch: `bays` arched passages, piers either side, an attic, and a group on top. */
interface Arch {
  span: number
  h: number
  bays?: number
  attic?: number
  quadriga?: boolean
  order?: Order
}

const arch: Build<Design & Arch> = (F, d, w, l, face) => {
  const bays = d.bays ?? 1
  const pier = (w - bays * d.span) / (bays + 1)
  const spring = d.h - d.span / 2 - 1.5
  for (let k = 0; k <= bays; k++) {
    const u0 = -w / 2 + k * (pier + d.span)
    F.box(u0, u0 + pier, -l / 2, l / 2, -F.deep, d.h, face)
    if (d.order)
      for (const v of [-l / 2, l / 2])
        F.column(u0 + pier / 2, v, Math.min(pier * 0.5, 0.9), 0, d.h - 1.2, d.order, face)
  }
  for (let k = 0; k < bays; k++) {
    const sa = -w / 2 + pier + k * (pier + d.span)
    const S = F.sub(0, 0, 0)
    S.arch(sa, sa + d.span, -l / 2, l, spring, spring + d.span / 2, d.h, face, PART.dark)
  }
  const attic = d.attic ?? 2.5
  F.box(-w / 2 - 0.3, w / 2 + 0.3, -l / 2 - 0.3, l / 2 + 0.3, d.h, d.h + 0.8, face)
  F.box(-w / 2, w / 2, -l / 2, l / 2, d.h + 0.8, d.h + 0.8 + attic, face)
  if (d.quadriga) {
    const z = d.h + 0.8 + attic
    F.box(-1.6, 1.6, -1.2, 1.2, z, z + 1.2, PART.bronze)
    F.box(-0.6, 0.6, -0.4, 0.4, z + 1.2, z + 3, PART.bronze)
  }
}

/**
 * The record office on the Capitol's saddle, as Catulus built it in 78 BCE: a high
 * blank substructure towards the Forum, pierced by a few small windows, rising from
 * the Forum's ground to the saddle's; on it a gallery of arches framed by Doric
 * half-columns; and the office behind it at the level of the saddle. It stands as a
 * terrace on the slope (its ground the saddle's, its foundations the Forum's).
 */
interface Tabularium {
  gallery: Storey
  bays: number
  windows: number
  /** The body behind the gallery, its height over the saddle. */
  body: number
  /** A corner left open, across and along (u0, u1, v0, v1): Veiovis's temple, built round. */
  notch?: [number, number, number, number]
}

const tabularium: Build<Design & Tabularium> = (F, d, w, l, _face, shade) => {
  // Sperone, the grey-brown Gabine stone of its outer walls, with travertine dressings.
  const sperone = new THREE.Color('#B3A58C')
  const drop = F.deep - 1.5
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, 0.4, sperone)
  for (let k = 0; k < d.windows; k++) {
    const u = -w / 2 + ((k + 0.5) * w) / d.windows
    const z = -drop * 0.45
    F.quad(
      [u - 0.45, l / 2 + 0.03, z],
      [u + 0.45, l / 2 + 0.03, z],
      [u + 0.45, l / 2 + 0.03, z + 1.6],
      [u - 0.45, l / 2 + 0.03, z + 1.6],
      PART.dark,
    )
  }
  const G = F.sub(0, l / 2, Math.PI)
  const z = G.arcade(-w / 2, w / 2, 0, 5, 0.4, [d.gallery], w / d.bays, sperone)
  // A low parapet over the gallery, its roof a terrace.
  G.box(-w / 2, w / 2, 0, 0.6, z, z + 1.1, sperone)
  G.box(-w / 2, w / 2, 0, 5, z - 0.2, z, C.travertine)
  // The office behind, at the saddle's level, under low roofs of tiles, round the
  // corner left for Veiovis's temple.
  const [n0, n1, m0, m1] = d.notch ?? [w, w, l, l]
  const parts: [number, number, number, number][] = d.notch
    ? [
        [-w / 2, n0, -l / 2, l / 2 - 5],
        [n0, w / 2, m1, l / 2 - 5],
      ]
    : [[-w / 2, w / 2, -l / 2, l / 2 - 5]]
  void n1
  void m0
  for (const [u0, u1, v0, v1] of parts) {
    F.box(u0, u1, v0, v1, 0.4, d.body, shade, null)
    F.roof(u0 - 0.3, u1 + 0.3, v0 - 0.3, v1 + 0.3, d.body, {
      tiles: C.roofTemple,
      pitch: 0.18,
      seed: 0.55,
    })
  }
}

/**
 * A house or warehouse of rooms round courts: ranges roofed with tiles falling in to
 * each court (an atrium's compluvium, a peristyle's garden, a warehouse's yard).
 * The courts are given across and along, and where their centres are, in the frame.
 */
interface Domus {
  h: number
  /** The court, across and along, and whether it is a garden. */
  court?: [number, number]
  garden?: boolean
  /** A second court behind the first (a peristyle behind the atrium). */
  peristyle?: [number, number]
  /** Courts given in full: across, along, their centre across and along, and whether gardens. */
  courts?: [number, number, number, number, boolean][]
  /** A warehouse's rooms opening on its courts, not a house's front door. */
  store?: boolean
}

const domus: Build<Design & Domus> = (F, d, w, l, face) => {
  const H = d.h
  const courts: [number, number, number, number, boolean][] =
    d.courts ??
    (d.peristyle
      ? [
          [d.court![0], d.court![1], 0, l / 2 - l * 0.28, false],
          [d.peristyle[0], d.peristyle[1], 0, -l * 0.2, true],
        ]
      : [[d.court![0], d.court![1], 0, 0, !!d.garden]])
  // The body, and its roof of tiles falling from the outer walls in to the courts.
  const wall = d.store ? PART.tufa : face
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, H, wall, null)
  const rise = Math.min(w, l, 20) * 0.08
  const outer = [
    [-w / 2 - 0.3, -l / 2 - 0.3],
    [w / 2 + 0.3, -l / 2 - 0.3],
    [w / 2 + 0.3, l / 2 + 0.3],
    [-w / 2 - 0.3, l / 2 + 0.3],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const holes = courts.map(([cw, cl, cu, cv]) =>
    [
      [cu - cw / 2, cv - cl / 2],
      [cu + cw / 2, cv - cl / 2],
      [cu + cw / 2, cv + cl / 2],
      [cu - cw / 2, cv + cl / 2],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  )
  const pts = [...outer, ...holes.flat()]
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
    const z = (n: number) => (n < outer.length ? H + rise : H - 0.2)
    F.tri(
      [pts[i].x, pts[i].y, z(i)],
      [pts[j].x, pts[j].y, z(j)],
      [pts[k].x, pts[k].y, z(k)],
      C.roofTemple,
    )
  }
  // The courts: their walls down to the ground, a pool, a garden or a paved yard.
  for (const [cw, cl, cu, cv, garden] of courts) {
    F.box(
      cu - cw / 2,
      cu + cw / 2,
      cv - cl / 2,
      cv + cl / 2,
      0.02,
      0.06,
      garden ? PART.garden : d.store ? C.tufa : C.travertine,
    )
    for (const [u0, u1, v0, v1] of [
      [cu - cw / 2, cu + cw / 2, cv - cl / 2 - 0.02, cv - cl / 2],
      [cu - cw / 2, cu + cw / 2, cv + cl / 2, cv + cl / 2 + 0.02],
      [cu - cw / 2 - 0.02, cu - cw / 2, cv - cl / 2, cv + cl / 2],
      [cu + cw / 2, cu + cw / 2 + 0.02, cv - cl / 2, cv + cl / 2],
    ])
      F.box(u0, u1, v0, v1, 0, H - 0.3, wall, null)
    if (d.store) {
      // Doors all round the yard, one to each storeroom.
      const n = Math.max(2, Math.round(cl / 4.5))
      for (let k = 0; k < n; k++) {
        const v = cv - cl / 2 + ((k + 0.5) * cl) / n
        for (const u of [cu - cw / 2 + 0.05, cu + cw / 2 - 0.05])
          F.quad(
            [u, v - 0.8, 0],
            [u, v + 0.8, 0],
            [u, v + 0.8, 2.6],
            [u, v - 0.8, 2.6],
            PART.dark,
          )
      }
    } else if (!garden)
      F.box(cu - cw / 4, cu + cw / 4, cv - cl / 4, cv + cl / 4, 0.06, 0.1, PART.water)
    else
      for (const [u, v] of [
        [cu - cw / 4, cv - cl / 4],
        [cu + cw / 4, cv + cl / 4],
      ])
        F.tree(u, v, 2, 'oak')
  }
  const dw = d.store ? 3 : 1
  F.quad(
    [-dw, l / 2 + 0.03, 0],
    [dw, l / 2 + 0.03, 0],
    [dw, l / 2 + 0.03, 3],
    [-dw, l / 2 + 0.03, 3],
    PART.door,
  )
}

/**
 * The speakers' platform: a high podium, its front hung with the bronze beaks of
 * captured ships, a balustrade round its top, statues on it, and steps behind.
 */
interface Rostra {
  h: number
  beaks: number
  /** Its back a hemicycle of steps (Caesar's), or a plain flight. */
  curved?: boolean
  statues?: number
}

const rostra: Build<Design & Rostra> = (F, d, w, l, face) => {
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, d.h, face)
  F.box(-w / 2 - 0.2, w / 2 + 0.2, -l / 2 - 0.2, l / 2 + 0.2, d.h - 0.4, d.h, face)
  for (let k = 0; k < d.beaks; k++) {
    const u = -w / 2 + ((k + 0.5) * w) / d.beaks
    F.box(u - 0.35, u + 0.35, l / 2, l / 2 + 1.1, d.h * 0.45, d.h * 0.65, PART.bronze)
  }
  for (const [u0, u1, v0, v1] of [
    [-w / 2, w / 2, l / 2 - 0.3, l / 2],
    [-w / 2, -w / 2 + 0.3, -l / 2, l / 2],
    [w / 2 - 0.3, w / 2, -l / 2, l / 2],
  ])
    F.box(u0, u1, v0, v1, d.h, d.h + 1, face)
  if (d.curved) {
    for (let k = 0; k < 6; k++)
      F.ring(
        0,
        -l / 2,
        0.1,
        w / 2 - k * 0.4,
        -1,
        d.h * (1 - k / 6),
        16,
        face,
        face,
        Math.PI,
        Math.PI * 2,
      )
  } else F.steps(-w * 0.3, w * 0.3, -l / 2 - Frame.flight(d.h), -l / 2, 0, d.h, '-v', face)
  for (let k = 0; k < (d.statues ?? 0); k++) {
    const u = -w / 2 + 2 + ((w - 4) * k) / Math.max(1, (d.statues ?? 1) - 1)
    F.box(u - 0.6, u + 0.6, -0.6, 0.6, d.h, d.h + 1.8, face)
    F.drum(u, 0, 0.35, 0.3, d.h + 1.8, d.h + 3.8, 6, PART.bronze)
  }
}

/**
 * A small shrine: a round enclosure of a low balustrade with statues in it
 * (Cloacina's), a paved place with a railing and an altar (the Lacus Curtius), or a
 * basin of water with a pedestal in it (Juturna's).
 */
interface Shrine {
  form: 'round' | 'paved' | 'basin' | 'altar' | 'aedicula'
  h?: number
  statues?: number
}

const shrine: Build<Design & Shrine> = (F, d, w, l, face) => {
  const h = d.h ?? 1.2
  if (d.form === 'round') {
    const r = w / 2
    F.drum(0, 0, r, r, -0.5, 0.4, 16, face)
    F.ring(0, 0, r - 0.25, r, 0.4, 0.4 + h, 16, PART.bronze, face)
    for (let k = 0; k < (d.statues ?? 2); k++)
      F.drum((k - 0.5) * r * 0.8, 0, 0.3, 0.25, 0.4, 2.2, 6, face)
  } else if (d.form === 'basin') {
    F.box(-w / 2, w / 2, -l / 2, l / 2, -1, 0.9, face, null)
    F.box(-w / 2 + 0.4, w / 2 - 0.4, -l / 2 + 0.4, l / 2 - 0.4, -1, 0.5, PART.water)
    F.box(-w * 0.12, w * 0.12, -l * 0.12, l * 0.12, 0.5, 2, face)
    F.drum(0, 0, 0.35, 0.3, 2, 3.6, 6, face)
  } else if (d.form === 'paved') {
    F.box(-w / 2, w / 2, -l / 2, l / 2, -0.3, 0.3, C.tufa)
    F.ring(0, 0, Math.min(w, l) * 0.22, Math.min(w, l) * 0.27, 0.3, 1.1, 12, face)
    for (const [u0, u1, v0, v1] of [
      [-w / 2, w / 2, -l / 2, -l / 2 + 0.15],
      [-w / 2, w / 2, l / 2 - 0.15, l / 2],
      [-w / 2, -w / 2 + 0.15, -l / 2, l / 2],
      [w / 2 - 0.15, w / 2, -l / 2, l / 2],
    ])
      F.box(u0, u1, v0, v1, 0.3, 1.2, PART.bronze, null)
  } else if (d.form === 'altar') {
    F.box(-w / 2, w / 2, -l / 2, l / 2, -0.5, h, face)
    F.box(-w / 2 - 0.15, w / 2 + 0.15, -l / 2 - 0.15, l / 2 + 0.15, h - 0.25, h, face)
  } else {
    F.box(-w / 2, w / 2, -l / 2, l / 2, -1, 1, face)
    F.box(-w / 2 + 0.3, w / 2 - 0.3, -l / 2 + 0.3, l / 2 - 0.3, 1, h, face)
    F.roof(-w / 2, w / 2, -l / 2, l / 2, h, {
      along: 'v',
      tiles: C.roofTemple,
      gable: face,
      pitch: 0.3,
    })
  }
}

/** A tomb: a façade on a podium with a door (Bibulus'), an altar on a base, a drum, or a façade cut into a hillside (the Scipios'). */
interface Tomb {
  form: 'facade' | 'altar' | 'drum' | 'rock'
  h: number
  order?: Order
}

const tomb: Build<Design & Tomb> = (F, d, w, l, face, shade) => {
  if (d.form === 'drum') {
    F.drum(0, 0, w / 2, w / 2, -F.deep, d.h, 24, face)
    F.drum(0, 0, w / 2 - 1, 0.5, d.h, d.h + w * 0.2, 16, PART.earth, null)
    return
  }
  if (d.form === 'rock') {
    // The hill behind, and the façade against it: a podium with arched doors and
    // half-columns on its upper storey.
    F.box(-w / 2, w / 2, -l / 2, l / 2 - 1.5, -F.deep, d.h + 2, PART.earth)
    F.box(-w / 2, w / 2, l / 2 - 1.5, l / 2, -F.deep, d.h * 0.45, face)
    for (const u of [-w / 4, 0, w / 4])
      F.quad(
        [u - 0.8, l / 2 + 0.03, 0],
        [u + 0.8, l / 2 + 0.03, 0],
        [u + 0.8, l / 2 + 0.03, 2.4],
        [u - 0.8, l / 2 + 0.03, 2.4],
        PART.door,
      )
    F.box(-w / 2, w / 2, l / 2 - 1.2, l / 2 - 0.2, d.h * 0.45, d.h, shade)
    for (let k = 0; k < 4; k++)
      F.column(
        -w / 2 + 0.6 + ((w - 1.2) * k) / 3,
        l / 2 - 0.2,
        0.5,
        d.h * 0.45,
        d.h * 0.55,
        d.order ?? 'ionic',
        face,
      )
    return
  }
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, d.h * 0.35, face)
  F.box(-w / 2 + 0.2, w / 2 - 0.2, -l / 2 + 0.2, l / 2 - 0.2, d.h * 0.35, d.h, face)
  if (d.form === 'facade') {
    for (const u of [-w / 2 + 0.4, w / 2 - 0.4])
      F.column(u, l / 2 - 0.1, 0.45, d.h * 0.35, d.h * 0.6, d.order ?? 'tuscan', face)
    F.quad(
      [-0.6, l / 2 - 0.17, d.h * 0.35],
      [0.6, l / 2 - 0.17, d.h * 0.35],
      [0.6, l / 2 - 0.17, d.h * 0.75],
      [-0.6, l / 2 - 0.17, d.h * 0.75],
      PART.door,
    )
    F.box(-w / 2, w / 2, -l / 2, l / 2, d.h, d.h + 0.6, face)
  } else {
    F.box(-w / 2 - 0.2, w / 2 + 0.2, -l / 2 - 0.2, l / 2 + 0.2, d.h, d.h + 0.4, face)
    for (const s of [-1, 1])
      F.drum(s * (w / 2 - 0.4), 0, 0.4, 0.4, d.h + 0.4, d.h + 0.8, 8, face)
  }
}

/** A plain building: walls `h` high under a hipped or gabled roof, a door on its front. */
interface Plain {
  h: number
  roof?: 'gable' | 'hip' | 'flat'
  stone?: 'tufa' | 'tufaGrey' | 'brick'
  covering?: Covering
}

const plain: Build<Design & Plain> = (F, d, w, l, face) => {
  const col = d.stone ? PART[d.stone] : face
  hall(F, -w / 2, w / 2, -l / 2, l / 2, 0, d.h, col, {
    roof: d.roof ?? 'hip',
    door: Math.min(3, w * 0.25),
  })
}

/**
 * A great warehouse of parallel vaulted halls side by side (the hall at the
 * Emporium): each hall runs back from the river front, its barrel vault showing as a
 * rounded roof, and the roofs step down in terraces towards the river (+v).
 */
interface Navalia {
  halls: number
  h: number
  terraces?: number
}

const navalia: Build<Design & Navalia> = (F, d, w, l, _face) => {
  const col = PART.tufa
  const hw = w / d.halls
  const terr = d.terraces ?? 1
  const tl = l / terr
  for (let k = 0; k < d.halls; k++) {
    const u0 = -w / 2 + k * hw
    const r = (hw - 0.8) / 2
    const um = u0 + r
    for (let t = 0; t < terr; t++) {
      // Terrace t from the back (-v) to the river front (+v), each lower than the last.
      const v0 = -l / 2 + t * tl
      const v1 = v0 + tl
      const z0 = (terr - 1 - t) * 1.6
      F.box(u0, u0 + hw - 0.8, v0, v1, -F.deep, z0 + d.h, col, null)
      F.box(u0 + hw - 0.8, u0 + hw, v0, v1, -F.deep, z0 + d.h + 0.4, col)
      const N = 6
      const look = F.b.look
      F.b.look = SKIN.roof * 10 + 0.3 * 0.9
      for (let j = 0; j < N; j++) {
        const [a, b] = [Math.PI * (j / N), Math.PI * ((j + 1) / N)]
        F.skinQuad(
          [um + Math.cos(a) * r, v0, z0 + d.h + Math.sin(a) * r * 0.7, 0, 0, 1],
          [um + Math.cos(b) * r, v0, z0 + d.h + Math.sin(b) * r * 0.7, 0, 0, 1],
          [um + Math.cos(b) * r, v1, z0 + d.h + Math.sin(b) * r * 0.7, tl, 0, 1],
          [um + Math.cos(a) * r, v1, z0 + d.h + Math.sin(a) * r * 0.7, tl, 0, 1],
          C.roofTemple,
        )
      }
      F.b.look = look
      // The vault's end over the lower terrace in front.
      F.drum(um, v1, r, r, z0 + d.h, z0 + d.h + 0.01, 8, col, col, 0, Math.PI)
    }
    // An arched door in each hall's end towards the river.
    F.quad(
      [um - r * 0.5, l / 2 + 0.03, 0],
      [um + r * 0.5, l / 2 + 0.03, 0],
      [um + r * 0.5, l / 2 + 0.03, d.h * 0.7],
      [um - r * 0.5, l / 2 + 0.03, d.h * 0.7],
      PART.dark,
    )
  }
}

/** A thatched hut of wattle and daub, oval, under a steep roof of straw (the Casa Romuli). */
const hut: Build<Design & { h: number }> = (F, d, w, l) => {
  const walls = new THREE.Color('#B09A7A')
  const thatch = new THREE.Color('#A8925E')
  const S = F.sub(0, 0)
  const sides = 12
  const pts: Pt[] = Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2
    return [Math.cos(a) * (w / 2), Math.sin(a) * (l / 2)]
  })
  S.prism(pts, -0.5, d.h, walls, null)
  for (let k = 0; k < sides; k++) {
    const [a, b] = [pts[k], pts[(k + 1) % sides]]
    S.tri(
      [a[0] * 1.15, a[1] * 1.15, d.h - 0.2],
      [b[0] * 1.15, b[1] * 1.15, d.h - 0.2],
      [0, 0, d.h + Math.max(w, l) * 0.55],
      thatch,
    )
  }
  S.quad(
    [-0.5, l / 2 + 0.03, 0],
    [0.5, l / 2 + 0.03, 0],
    [0.5, l / 2 + 0.03, 1.7],
    [-0.5, l / 2 + 0.03, 1.7],
    PART.door,
  )
}

/** A precinct wall round an open area, with a gate in its front, and an altar and a small shrine in it if it had them (Semo Sancus' was open to the sky). */
const enclosure: Build<
  Design & {
    h: number
    gate?: number
    paving?: 'tufa' | 'travertine' | 'earth'
    altar?: boolean
    aedicula?: boolean
  }
> = (F, d, w, l, face) => {
  if (d.altar) {
    F.box(-1, 1, -0.7, 0.7, 0, 1.1, face)
    F.box(-1.15, 1.15, -0.85, 0.85, 0.95, 1.2, face)
  }
  if (d.aedicula) {
    const v = -l / 2 + 3
    F.box(-1.8, 1.8, v - 1.6, v + 1.6, -1, 1, face)
    F.box(-1.4, 1.4, v - 1.3, v + 1.1, 1, 3.4, face)
    F.roof(-1.8, 1.8, v - 1.6, v + 1.6, 3.4, {
      along: 'v',
      tiles: C.roofTemple,
      gable: face,
      pitch: 0.3,
    })
  }
  const t = 0.8
  const g = d.gate ?? 0
  F.box(
    -w / 2,
    w / 2,
    -l / 2,
    l / 2,
    -0.2,
    0.15,
    d.paving === 'earth' ? PART.earth : d.paving === 'tufa' ? C.tufa : C.travertine,
  )
  F.box(-w / 2, w / 2, -l / 2, -l / 2 + t, -F.deep, d.h, face)
  F.box(-w / 2, -w / 2 + t, -l / 2, l / 2, -F.deep, d.h, face)
  F.box(w / 2 - t, w / 2, -l / 2, l / 2, -F.deep, d.h, face)
  F.box(-w / 2, -g / 2, l / 2 - t, l / 2, -F.deep, d.h, face)
  F.box(g / 2, w / 2, l / 2 - t, l / 2, -F.deep, d.h, face)
}

/**
 * The Regia: a small irregular building of a hall and two rooms along one side, a
 * court walled round beside it, under a tiled roof.
 */
const regia: Build<Design & { h: number; rooms?: number }> = (F, d, w, l, face, shade) => {
  const rooms = d.rooms ?? l * 0.42
  hall(F, -w / 2, w / 2, -l / 2, -l / 2 + rooms, 0, d.h, face, {
    roof: 'gable',
    along: 'u',
    door: 2,
  })
  for (const u of [-w / 6, w / 6])
    F.box(
      u - 0.35,
      u + 0.35,
      -l / 2 + 0.3,
      -l / 2 + rooms - 0.3,
      d.h - 0.02,
      d.h + 0.9,
      shade,
    )
  const t = 0.9
  F.box(-w / 2, w / 2, -l / 2 + rooms, l / 2, -0.2, 0.2, C.tufa)
  F.box(-w / 2, -w / 2 + t, -l / 2 + rooms, l / 2, -F.deep, d.h * 0.55, face)
  F.box(w / 2 - t, w / 2, -l / 2 + rooms, l / 2, -F.deep, d.h * 0.55, face)
  F.box(-w / 2, -1.5, l / 2 - t, l / 2, -F.deep, d.h * 0.55, face)
  F.box(1.5, w / 2, l / 2 - t, l / 2, -F.deep, d.h * 0.55, face)
}

/** The prison: a low block of tufa with a small door, over the Tullianum's cell. */
const prison: Build<Design & { h: number }> = (F, d, w, l) => {
  hall(F, -w / 2, w / 2, -l / 2, l / 2, 0, d.h, PART.tufaGrey, { roof: 'flat', door: 1.4 })
}

const TRODDEN = new THREE.Color('#BCAB88')

/** An open square, levelled and kept clear of houses (the Circus Flaminius). */
const square: Build<Design & { paving?: 'earth' | 'tufa' | 'travertine' }> = (
  F,
  d,
  w,
  l,
) => {
  // Trodden earth as the walled city's ground is (rome/shading.ts `EARTH`).
  const col =
    d.paving === 'tufa' ? C.tufa : d.paving === 'travertine' ? C.travertine : TRODDEN
  F.box(-w / 2, w / 2, -l / 2, l / 2, -0.3, 0.12, col)
}

/**
 * The Tiber Island walled as a ship (from the 60s–50s BCE): a travertine embankment
 * round its shore, from the water up past the ground, and its prow at the downstream
 * end, towards the front (+v).
 */
interface Island {
  /** Its shore, plane metres with the ground's height over the model's water there. */
  outline?: number[][]
  /** Whether the ship's walls stand yet. */
  ship?: boolean
}

const island: Build<Design & Island> = (F, d, w, l) => {
  if (!d.ship || !d.outline) return
  const wl = (d.water as number | undefined) ?? 2
  const trav = C.travertine
  const pts = d.outline.map(
    ([x, y, g]) => [...F.local(x, y), g] as [number, number, number],
  )
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]]
    const top = Math.max(wl + 2.5, Math.max(a[2], b[2]) + 0.7)
    F.quad(
      [a[0], a[1], wl - 1.5],
      [b[0], b[1], wl - 1.5],
      [b[0], b[1], top],
      [a[0], a[1], top],
      trav,
    )
    F.quad(
      [a[0], a[1], top],
      [b[0], b[1], top],
      [b[0] * 0.995, b[1] * 0.995, top],
      [a[0] * 0.995, a[1] * 0.995, top],
      trav,
    )
  }
  // The prow: a pointed bow of travertine standing out from the island's tip, with the
  // relief of Aesculapius' staff and serpent on its side (drawn as a dark panel).
  const tip = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0])
  const P = F.sub(tip[0], tip[1] - 4)
  const top = Math.max(wl + 3.5, tip[2] + 1.5)
  P.prism(
    [
      [-w / 2, -l / 2],
      [w / 2, -l / 2],
      [w / 4, l / 4],
      [0, l / 2],
      [-w / 4, l / 4],
    ],
    wl - 1.5,
    top,
    trav,
  )
  for (const s of [-1, 1])
    P.quad(
      [s * w * 0.36, -l * 0.1, top - 2.6],
      [s * w * 0.3, l * 0.08, top - 2.6],
      [s * w * 0.3, l * 0.08, top - 0.8],
      [s * w * 0.36, -l * 0.1, top - 0.8],
      PART.tufaGrey,
    )
}

/**
 * A quay along the river (the Emporium): a paved platform of tufa, its front a wall
 * down to the water with flights of steps down it and stones for mooring.
 */
const quay: Build<Design> = (F, _d, w, l) => {
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, 0.3, C.tufa)
  for (let k = 0; k < Math.round(w / 8); k++) {
    const u = -w / 2 + ((k + 0.5) * w) / Math.round(w / 8)
    F.box(u - 0.35, u + 0.35, l / 2 - 0.6, l / 2 + 0.15, 0.3, 0.9, C.travertine)
  }
}

/** A great altar on a platform (the Ara Maxima): its podium, the altar on it, a low fence round it. */
const ara: Build<Design & { h: number }> = (F, d, w, l, face) => {
  F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, d.h, face)
  F.box(-w / 2 - 0.2, w / 2 + 0.2, -l / 2 - 0.2, l / 2 + 0.2, d.h - 0.35, d.h, face)
  F.box(-2, 2, -3, 3, d.h, d.h + 1.4, face)
  F.box(-2.2, 2.2, -3.2, 3.2, d.h + 1.2, d.h + 1.5, face)
  for (const [u0, u1, v0, v1] of [
    [-w / 2, w / 2, -l / 2, -l / 2 + 0.2],
    [-w / 2, w / 2, l / 2 - 0.2, l / 2],
    [-w / 2, -w / 2 + 0.2, -l / 2, l / 2],
    [w / 2 - 0.2, w / 2, -l / 2, l / 2],
  ])
    F.box(u0, u1, v0, v1, d.h, d.h + 1, PART.bronze, null)
  F.steps(-w * 0.2, w * 0.2, l / 2, l / 2 + Frame.flight(d.h), 0, d.h, '+v', face)
}

const BUILD: Record<string, Build<never>> = {
  square,
  island,
  quay,
  ara,
  horrea: domus,
  temple: (F, d, w, l, face, shade) => temple(F, d as Temple, w, l, face, shade),
  tholos: (F, d, w, _l, face, shade) => tholos(F, d as Tholos, w / 2, face, shade),
  basilica,
  curia,
  forum: porticus,
  porticus,
  theatre,
  circus,
  mausoleum,
  bridge,
  arch,
  tabularium,
  domus,
  rostra,
  shrine,
  tomb,
  plain,
  navalia,
  hut,
  enclosure,
  regia,
  prison,
}
