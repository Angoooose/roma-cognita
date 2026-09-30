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
import {
  BASILICA_WORKS,
  beds,
  COURSE,
  CURIA_WORKS,
  disc,
  GENERAL_WORKS,
  part,
  rafters,
  type Rect,
  ringBeds,
  ringFaces,
  SITE_COLOURS,
  site,
  type Stages,
  THEATRE_WORKS,
  arcFaces,
} from './works.ts'

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
  if (b.works && !STAGED_TYPES.has(d.model)) return rising(F, d, w, l, build)
  build(F, d as never, w, l, b.face, b.shade)
}

/** The types whose builders stage their own works (works.ts); any other rises whole (`rising`). */
const STAGED_TYPES = new Set(['temple', 'tholos', 'basilica', 'curia', 'theatre'])

/**
 * A building of a type with no stages of its own, while it is being built: the whole
 * of it rising a course at a time over its works (`GENERAL_WORKS`), to the share of
 * its height its design says its works had reached (`progress`) or to its top, with
 * the site round its footprint — the scaffold on its flanks and back, a crane if it
 * is tall enough to want one, the yard before its front.
 */
function rising(F: Frame, d: Design, w: number, l: number, build: Build<never>) {
  const b = F.b
  const W = b.works!
  const S = GENERAL_WORKS
  W.follow(S)
  const share: [number, number] = [S.base[0], S.roof[1]]
  // Dated first (so what it overshadows is dated too), then told how it rises.
  W.stage(b, share, [0, 1])
  const start = b.mark()
  build(F, d as never, w, l, b.face, b.shade)
  const top = b.topSince(start)
  const reach = Math.min(1, (d.progress as number | undefined) ?? 1)
  if (b.rise) b.riseSince(start, [0, top * reach])
  const high = top * reach
  if (high < 3) return
  // The Mausoleum's rings were raised about 70 cm at a time with the earth between
  // them filled in as they went, each fill the floor for the next lift, "instead of
  // scaffolding" (the excavators of 2021, as reported at its reopening): earth
  // floors rise inside it, and no scaffold stands round it. A bridge's works stand in
  // the river, where no scaffold of poles on the ground could.
  const mausoleum = d.model === 'mausoleum'
  const open = mausoleum || d.model === 'bridge'
  if (mausoleum) {
    W.stage(b, share, [0, high], 1)
    for (let z = COURSE; z < high - 0.05; z += COURSE)
      disc(F, 0, 0, w / 2 - 0.6, z, 36, SITE_COLOURS.earth)
  }
  const side = (d.works as { crane?: string } | undefined)?.crane === 'left' ? -1 : 1
  site(
    F,
    {
      ground: [-w / 2 - 2, w / 2 + 2, -l / 2 - 2, l / 2 + 9.3],
      footings: [
        [-w / 2, w / 2, -l / 2, -l / 2 + 1.4],
        [-w / 2, w / 2, l / 2 - 1.4, l / 2],
        [-w / 2, -w / 2 + 1.4, -l / 2, l / 2],
        [w / 2 - 1.4, w / 2, -l / 2, l / 2],
      ],
      spoil: [-w / 2 - 1.5, -l / 2 - 1.5],
      scaffolds: open
        ? []
        : [
            {
              faces: ringFaces([-w / 2, w / 2, -l / 2, l / 2], 1.2, [
                true,
                true,
                false,
                true,
              ]),
              z0: 0,
              top: Math.min(high, 30) + 1.2,
              share,
              end: S.facing[0],
            },
          ],
      crane:
        high > 6 && d.model !== 'bridge'
          ? {
              foot: [side * (w / 2 + 5), 0],
              spread: [0, 1],
              head: [side * (w / 2 - 0.8), 0, high + 3],
            }
          : undefined,
      yard: {
        at: [-Math.min(w / 2, 12), Math.min(w / 2, 12), l / 2 + 1.2, l / 2 + 9],
        stone: b.face,
      },
      ruin: {
        at: [-w / 2, w / 2, -l / 2, l / 2],
        z: 0,
        flanks: [
          [-(w / 2 + 2.5), 0],
          [w / 2 + 2.5, 0],
        ],
      },
    },
    W,
  )
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

/** While it is being built (works.ts): which flank its crane stands on. */
interface Building {
  works?: { crane?: 'left' | 'right' }
}

/**
 * Dates what a building of a type is built of while it goes up (works.ts): `stage`
 * for the parts that rise in a share of its works, `kept` for what a rebuilding kept.
 * Without works, both do nothing.
 */
function staging(F: Frame, stages: Stages) {
  const W = F.b.works
  W?.follow(stages)
  return {
    W,
    stage: (share: [number, number], rise: [number, number] | null = null, end?: number) =>
      W?.stage(F.b, share, rise, end),
    kept: (share: [number, number]) => !!W?.survived(share),
  }
}

/**
 * A base (a platform or a podium) over u0–u1 × v0–v1 up to P: going up, its core in
 * lifts with a bed at each course, faced at the end (`faced`); rebuilt on it, it
 * stands throughout.
 */
function base(
  F: Frame,
  S: Stages,
  { W, stage, kept }: ReturnType<typeof staging>,
  rect: Rect,
  P: number,
  faced: () => void,
) {
  const [u0, u1, v0, v1] = rect
  if (W && !kept(S.base)) {
    stage(S.base, [0, P], S.facing[0])
    F.box(u0, u1, v0, v1, -F.deep, P, SITE_COLOURS.core)
    stage(S.base, [0, P], S.base[1])
    beds(F, u0, u1, v0, v1, 0, P, SITE_COLOURS.core)
  }
  stage(kept(S.base) ? S.base : S.facing)
  faced()
}

const basilica: Build<Design & Basilica & Building> = (F, d, w, l, face, shade) => {
  const S = BASILICA_WORKS
  const st = staging(F, S)
  const { W, stage, kept } = st
  stage(S.ground)
  const P = d.platform ?? 1
  const flight = P > 0.3 ? Frame.flight(P) : 0
  base(F, S, st, [-w / 2, w / 2, -l / 2, l / 2], P, () => {
    F.box(-w / 2, w / 2, -l / 2, l / 2, -F.deep, P, face)
    if (flight) F.steps(-w / 2, w / 2, l / 2, l / 2 + flight, 0, P, '+v', face)
  })
  const depth = d.depth ?? 5
  const H = d.storeys.reduce((s, st) => s + st.h, 0)
  const n = d.storeys.length
  // Each storey of the arcades goes up in its own share of the walls' years, on
  // centering; a rebuilding that kept the walls has them standing.
  const rising = W
    ? (i: number, z: number, top: number, centering: boolean) => {
        // Its centering stands until the storey over it is half built, or the
        // clerestory, over the last.
        const next = i + 1 < n ? part(S.walls, i + 1, n) : S.upper
        if (!kept(S.walls))
          stage(
            part(S.walls, i, n),
            [z, top],
            centering ? (next[0] + next[1]) / 2 : undefined,
          )
        else if (centering) W.none(F.b)
        else stage(S.walls)
      }
    : undefined
  const sides: [Frame, number][] = [
    [F.sub(0, l / 2, Math.PI), w],
    [F.sub(w / 2, 0, -Math.PI / 2), l],
    [F.sub(0, -l / 2, 0), w],
    [F.sub(-w / 2, 0, Math.PI / 2), l],
  ]
  sides.forEach(([Sd, len], i) => {
    if (i === 0 || d.arcade === 'all')
      Sd.arcade(-len / 2, len / 2, 0, depth, P, d.storeys, d.bay, face, undefined, rising)
  })
  // Behind a front-only arcade, the body of the building to the arcade's height.
  if (d.arcade === 'front') {
    stage(S.walls, [P, P + H])
    F.box(-w / 2, w / 2, -l / 2, l / 2 - depth, P, P + H, face, null)
    if (W && !kept(S.walls)) {
      stage(S.walls, [P, P + H], S.walls[1])
      ringBeds(F, [-w / 2, w / 2, -l / 2, l / 2 - depth], 1.2, P, P + H, face)
    }
  }
  // The nave's clerestory, with its windows, over the aisles.
  const [nw, nl] = d.nave
  const along = w >= l ? 'u' : 'v'
  const [hu, hv] = along === 'u' ? [nl / 2, nw / 2] : [nw / 2, nl / 2]
  stage(S.upper, [P + H, P + d.naveH])
  F.box(-hu, hu, -hv, hv, P + H, P + d.naveH, shade, null)
  if (W && !kept(S.upper)) {
    stage(S.upper, [P + H, P + d.naveH], S.upper[1])
    ringBeds(F, [-hu, hu, -hv, hv], 1, P + H, P + d.naveH, shade)
    stage(S.upper, [P + H, P + d.naveH])
  }
  // The windows down its long sides: `s` along the nave, `t` across it.
  const at = (s: number, t: number, z: number): [number, number, number] =>
    along === 'u' ? [s, t, z] : [t, s, z]
  const nwin = Math.max(3, Math.round(nl / 5))
  for (let k = 0; k < nwin; k++) {
    const s = -nl / 2 + ((k + 0.5) * nl) / nwin
    for (const t of [-nw / 2 - 0.03, nw / 2 + 0.03])
      F.quad(
        at(s - 0.9, t, P + d.naveH - 3.4),
        at(s + 0.9, t, P + d.naveH - 3.4),
        at(s + 0.9, t, P + d.naveH - 1),
        at(s - 0.9, t, P + d.naveH - 1),
        PART.dark,
      )
  }
  // The aisles' roof, a low hip of tiles over the whole, under the nave; then the
  // nave's gable over its timbers.
  const aisles = P + H + 0.2
  stage(S.roof, [aisles, aisles + (Math.min(w, l) / 2) * 0.14 + 0.6])
  F.roof(-w / 2 - 0.3, w / 2 + 0.3, -l / 2 - 0.3, l / 2 + 0.3, aisles, {
    tiles: C.roofTemple,
    pitch: 0.14,
    seed: 0.21,
  })
  const eaves = P + d.naveH
  const ridge = eaves + (along === 'u' ? hv + 0.4 : hu + 0.4) * 0.2
  stage(S.roof, [eaves, ridge + 1])
  F.roof(-hu - 0.4, hu + 0.4, -hv - 0.4, hv + 0.4, eaves, {
    along,
    tiles: C.roofTemple,
    gable: shade,
    pitch: 0.2,
    seed: 0.63,
  })
  if (W && !kept(S.roof)) {
    stage(S.roof, null, S.finish[0])
    rafters(F, -hu - 0.4, hu + 0.4, -hv - 0.4, hv + 0.4, eaves, ridge, along)
  }
  if (!W) return
  const side = d.works?.crane === 'left' ? -1 : 1
  const off = 1.2
  const yard0 = l / 2 + flight + 1.2
  const order = d.storeys[0].order ?? 'tuscan'
  site(
    F,
    {
      ground: [-w / 2 - 2, w / 2 + 2, -l / 2 - 2, yard0 + 8.3],
      footings: [
        [-w / 2, w / 2, -l / 2, -l / 2 + 1.6],
        [-w / 2, w / 2, l / 2 - 1.6, l / 2],
        [-w / 2, -w / 2 + 1.6, -l / 2, l / 2],
        [w / 2 - 1.6, w / 2, -l / 2, l / 2],
        [-hu, hu, -hv, -hv + 1.4],
        [-hu, hu, hv - 1.4, hv],
      ],
      spoil: [-w / 2 - 1.5, -l / 2 - 1.5],
      scaffolds: [
        {
          // Round its flanks and back while its storeys go up, and faced from it last.
          faces: ringFaces([-w / 2, w / 2, -l / 2, l / 2], off, [true, true, false, true]),
          z0: 0,
          top: P + H + 1.2,
          share: [S.base[0], S.walls[1]],
          end: S.facing[0],
        },
        {
          // Round the clerestory, standing on the aisles.
          faces: ringFaces([-hu, hu, -hv, hv], 1, [true, true, true, true]),
          z0: P + H,
          top: P + d.naveH + 1.2,
          share: S.upper,
          end: S.finish[0],
        },
      ],
      // The crane on a long side — the back, when the long sides are front and back —
      // leaning over the outer arcade, which is the heavy lifting.
      crane:
        along === 'u'
          ? {
              foot: [side * w * 0.2, -(l / 2 + off + 3.8)],
              spread: [1, 0],
              head: [side * w * 0.2, -(l / 2 - depth / 2), P + H + 3],
            }
          : {
              foot: [side * (w / 2 + off + 3.8), 0],
              spread: [0, 1],
              head: [side * (w / 2 - depth / 2), 0, P + H + 3],
            },
      yard: {
        at: [-Math.min(w / 2, 14), Math.min(w / 2, 14), yard0, yard0 + 8],
        drums: Frame.diameter(d.storeys[0].h, order),
        stone: face,
      },
      ruin: {
        at: [-hu, hu, -hv, hv],
        z: kept(S.base) ? P : 0,
        flanks: [
          [-(w / 2 + 2.5), 0],
          [w / 2 + 2.5, 0],
        ],
      },
    },
    W,
  )
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

const curia: Build<Design & Curia & Building> = (F, d, w, l, face) => {
  const S = CURIA_WORKS
  const st = staging(F, S)
  const { W, stage, kept } = st
  stage(S.ground)
  const P = d.podium
  const stairs = Frame.flight(P)
  const front = l / 2 - stairs - (d.porch?.depth ?? 0)
  base(F, S, st, [-w / 2, w / 2, -l / 2, front + (d.porch?.depth ?? 0)], P, () => {
    F.box(-w / 2, w / 2, -l / 2, front, -F.deep, P, face)
    F.steps(-w * 0.3, w * 0.3, front + (d.porch?.depth ?? 0), l / 2, 0, P, '+v', face)
    if (d.porch) F.box(-w / 2, w / 2, front, front + d.porch.depth, -F.deep, P, face)
  })
  if (d.porch) {
    const ph = d.h * 0.55
    stage(S.finish, [P, P + ph + 1])
    const D = Frame.diameter(ph, d.porch.order)
    const n = d.porch.columns
    for (let k = 0; k < n; k++)
      F.column(
        -w / 2 + D + ((w - 2 * D) * k) / (n - 1),
        front + d.porch.depth - D,
        D,
        P,
        ph,
        d.porch.order,
        face,
      )
    F.entablature(-w / 2, w / 2, front, front + d.porch.depth, P + ph, 1, face)
    stage([S.finish[1] - 0.01, S.finish[1]])
    F.roof(-w / 2, w / 2, front - 0.2, front + d.porch.depth + 0.2, P + ph + 1, {
      along: 'u',
      tiles: C.roofTemple,
      pitch: 0.2,
    })
  }
  // Its walls, a course at a time, with a bed on each; its roof over its timbers.
  const walls: Rect = [-w / 2, w / 2, -l / 2, front]
  if (W && !kept(S.walls)) {
    stage(S.walls, [P, P + d.h], S.walls[1])
    ringBeds(F, walls, 1.4, P, P + d.h, face)
  }
  stage(S.walls, [P, P + d.h])
  const ridge = P + d.h + (w / 2 + 0.4) * (2 / 9)
  hall(F, -w / 2, w / 2, -l / 2, front, P, d.h, face, {
    door: 3.2,
    windows: 0,
    along: 'v',
    roof: 'gable',
    roofing: (z) => {
      if (W && !kept(S.roof)) {
        stage(S.roof, null, S.finish[0])
        rafters(F, -w / 2 - 0.4, w / 2 + 0.4, -l / 2 - 0.4, front + 0.4, z, ridge, 'v')
      }
      stage(S.roof, [z, ridge + 1])
    },
  })
  if (d.victory) {
    stage(S.finish)
    F.drum(0, front, 0.9, 0.9, ridge - 0.2, ridge + 1.4, 8, PART.gilt)
    F.box(-0.3, 0.3, front - 0.3, front + 0.3, ridge + 1.4, ridge + 3.4, PART.gilt)
  }
  // Three tall windows over the doors.
  stage(S.walls, [P, P + d.h])
  for (const u of [-w * 0.26, 0, w * 0.26])
    F.quad(
      [u - 1.1, front + 0.04, P + d.h * 0.62],
      [u + 1.1, front + 0.04, P + d.h * 0.62],
      [u + 1.1, front + 0.04, P + d.h * 0.9],
      [u - 1.1, front + 0.04, P + d.h * 0.9],
      PART.dark,
    )
  if (!W) return
  const side = d.works?.crane === 'left' ? -1 : 1
  site(
    F,
    {
      ground: [-w / 2 - 2, w / 2 + 2, -l / 2 - 2, l / 2 + 9.3],
      footings: [
        [-w / 2, w / 2, -l / 2, -l / 2 + 1.6],
        [-w / 2, w / 2, front - 1.6, front],
        [-w / 2, -w / 2 + 1.6, -l / 2, front],
        [w / 2 - 1.6, w / 2, -l / 2, front],
      ],
      spoil: [-w / 2 - 1.5, -l / 2 - 1.5],
      scaffolds: [
        {
          faces: ringFaces(walls, 1.2, [true, true, false, true]),
          z0: 0,
          top: P + d.h + 1.2,
          share: [S.base[0], S.walls[1]],
          end: S.facing[0],
        },
      ],
      crane: {
        foot: [side * (w / 2 + 5), 0],
        spread: [0, 1],
        head: [side * (w / 2 - 0.8), 0, P + d.h + 3],
      },
      yard: { at: [-w / 2, w / 2, l / 2 + 1.2, l / 2 + 9], stone: face },
      ruin: {
        at: walls,
        z: kept(S.base) ? P : 0,
        flanks: [
          [-(w / 2 + 2.5), 0],
          [w / 2 + 2.5, 0],
        ],
      },
    },
    W,
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

const theatre: Build<Design & Theatre & Building> = (F, d, w, l, face, shade) => {
  void w
  const R = d.radius
  const cv = -l / 2 + R
  const S = F.sub(0, cv)
  // While it is being built (works.ts `THEATRE_WORKS`): the arcade storey by storey
  // on centering, the vaulted seating rising behind it with it and the stage
  // building beside them; then the portico and roofs at the top, the stage's marble
  // front, and the orchestra paved last; the temple over the seats in its own works.
  const T = THEATRE_WORKS
  const { W, stage } = staging(F, T)
  const H = d.storeys.reduce((s, st) => s + st.h, 0)
  const n = d.storeys.length
  const rising = W
    ? (i: number, z: number, top: number, centering: boolean) => {
        const own = part([T.base[0], T.upper[1]], i, n)
        const next = i + 1 < n ? part([T.base[0], T.upper[1]], i + 1, n) : T.roof
        stage(own, [z, top], centering ? (next[0] + next[1]) / 2 : undefined)
      }
    : undefined
  // The half-ring behind the orchestra is towards -v: angles π to 2π.
  const [a0, a1] = [Math.PI, Math.PI * 2]
  const gallery = 5
  S.arcadeArc(0, 0, R, a0, a1, gallery, 0, d.storeys, 6.2, face, rising)
  stage([T.base[0], T.roof[0]], [1.2, d.h - 3.5])
  S.cavea(0, 0, d.orchestra, R - gallery, 1.2, d.h - 3.5, a0, a1, C.seating, { bands: 2 })
  if (W) {
    // Under the seats, the radial walls their vaults spring from, rising with the
    // arcade as one structure; each a little under the seats' slope, so the seats
    // cover it once laid.
    stage([T.base[0], T.upper[1]], [0, d.h - 3.5])
    const [r0, r1] = [d.orchestra + 2, R - gallery]
    const slope = (r: number) =>
      1.2 + ((d.h - 4.7) * (r - d.orchestra)) / (R - gallery - d.orchestra)
    const nr = Math.round(((a1 - a0) * R) / 6.2)
    for (let k = 1; k < nr; k++) {
      const a = a0 + ((a1 - a0) * k) / nr
      const [c, s] = [Math.cos(a), Math.sin(a)]
      const [nx, ny] = [-s * 0.6, c * 0.6]
      const P = (r: number, side: number, z: number) => [
        c * r + nx * side,
        s * r + ny * side,
        z,
      ]
      for (const side of [-1, 1])
        S.quad(
          P(r0, side, 0),
          P(r1, side, 0),
          P(r1, side, slope(r1)),
          P(r0, side, slope(r0)),
          SITE_COLOURS.core,
        )
      S.quad(
        P(r0, -1, slope(r0)),
        P(r1, -1, slope(r1)),
        P(r1, 1, slope(r1)),
        P(r0, 1, slope(r0)),
        SITE_COLOURS.core,
      )
    }
  }
  // The gallery's roof, the colonnade round the top of the seats and its roof.
  stage(T.roof, [d.h - 3.5, d.h + 2.3])
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
  stage(T.facing)
  S.drum(0, 0, d.orchestra, d.orchestra, -0.2, 0.3, 24, C.travertine, C.travertine, a0, a1)
  const platform = 7
  stage(T.base, [0, 1.5])
  S.box(-d.orchestra - 12, d.orchestra + 12, 0, platform, -S.deep, 1.5, face)
  // The stage building: its front of columns in storeys, and its roof sloping back.
  const sw = R * 0.9
  const v0 = platform
  const v1 = platform + d.scaena
  const scaena: [number, number] = [T.base[0] + 0.07, T.upper[1]]
  stage(scaena, [0, top + 2])
  S.box(-sw, sw, v0, v1, -S.deep, top + 2, shade, null)
  if (W) {
    stage(scaena, [0, top + 2], scaena[1])
    ringBeds(S, [-sw, sw, v0, v1], 1.4, 0, top + 2, shade)
  }
  stage(T.finish, [1.5, top])
  const D = 1.1
  const nc = Math.round((2 * sw) / 4.2)
  for (const [z, h] of [
    [1.5, (top - 1.5) * 0.36],
    [1.5 + (top - 1.5) * 0.36, (top - 1.5) * 0.32],
    [1.5 + (top - 1.5) * 0.68, (top - 1.5) * 0.3],
  ] as const) {
    for (let k = 0; k <= nc; k++)
      S.column(
        -sw + 1 + ((2 * sw - 2) * k) / nc,
        v0 - D,
        D * (h / 9),
        z,
        h - 0.8,
        'corinthian',
        face,
      )
    S.box(-sw, sw, v0 - D * 1.6, v0, z + h - 0.8, z + h, face)
  }
  const ridge = top + 2 + (d.scaena / 2 + 1.5) * 0.18
  if (W) {
    stage(T.roof, null, T.finish[0])
    rafters(S, -sw - 0.4, sw + 0.4, v0 - 2.5, v1 + 0.4, top + 2, ridge, 'u')
  }
  stage(T.roof, [top + 2, ridge + 1])
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
    stage(scaena, [0, top * 0.72])
    hall(S, u0, u1, 0, v1, 0, top * 0.72, face, {
      roof: 'hip',
      roofing: (z) => stage(T.roof, [z, z + 4]),
    })
  }
  // A temple at the top of the seats, on the axis, facing the stage: built once the
  // seats under it are up, in its own works over the rest of the theatre's.
  if (d.temple) {
    const [tw, tl] = d.temple.size
    const Tf = S.sub(0, -R + tl / 2 - 2, 0, d.h - 4)
    const b = F.b
    const whole = b.works
    b.works = whole?.within([T.roof[0], 1]) ?? null
    temple(Tf, d.temple, tw, tl, face, shade)
    b.works = whole
    whole?.follow(T)
  }
  if (!W) return
  site(
    S,
    {
      ground: [-R - 2, R + 2, -R - 2, v1 + 2],
      // Under the outer arcade, the ring of radial walls and the seats' inner edge;
      // under the stage building.
      footings: [[-sw, sw, v0, v1]],
      footingRings: [
        [0, 0, R - gallery, R, a0, a1],
        [0, 0, R * 0.62 - 1.4, R * 0.62, a0, a1],
        [0, 0, d.orchestra, d.orchestra + 1.4, a0, a1],
      ],
      spoil: [R + 4, -R * 0.5],
      scaffolds: [
        {
          // Round the outer arcade as it goes up, and faced from it last.
          faces: arcFaces(0, 0, R + 1.2, a0, a1, 16, 1.15),
          z0: 0,
          top: H + 1.2,
          share: [T.base[0], T.upper[1]],
          end: T.facing[0],
        },
        {
          // Round the stage building's flanks and back.
          faces: ringFaces([-sw, sw, v0, v1], 1.2, [true, true, true, false]),
          z0: 0,
          top: top + 3.2,
          share: scaena,
          end: T.facing[0],
        },
      ],
      crane: {
        // Behind the curve, leaning in over the outer arcade.
        foot: [0, -(R + 6.4)],
        spread: [1, 0],
        head: [0, -(R - gallery / 2), H + 3],
      },
      yard: { at: [R + 2, R + 16, -8, 0], stone: face },
      ruin: { at: [-R / 2, R / 2, -R / 2, 0], z: 0, flanks: [] },
    },
    W,
  )
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
  /** How deep the stands are, the top of the seats and the outer arcade's height (0: none). */
  stands: number
  h: number
  arcade: number
  gates: number
  /** Whether seats run round the curved end (from Caesar's rebuilding); default true. */
  curve?: boolean
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
  const arcadeD = d.arcade > 0 ? 4 : 0
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
    if (d.arcade <= 0) continue
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
  // Round the curved end: the seats, their back, the arcade. Before Caesar the stands
  // ran along the sides only, and the curved end was open.
  const rc = inner + seatD
  for (let j = 0; j < (d.curve === false ? 0 : rows); j++) {
    const ra = inner + (seatD * j) / rows
    const rb = inner + (seatD * (j + 1)) / rows
    const za = z0 + ((zr - z0) * j) / rows
    const zb = z0 + ((zr - z0) * (j + 1)) / rows
    F.ring(0, cv, ra - 0.01, ra, za, zb, 24, riserOf(j), riserOf(j), 0, Math.PI)
    F.ring(0, cv, ra, rb, zb - 0.01, zb, 24, tierOf(j), tierOf(j), 0, Math.PI)
  }
  if (d.curve !== false) {
    F.ring(0, cv, inner - 0.8, inner, -F.deep, z0 + 0.3, 24, face, face, 0, Math.PI)
    F.ring(0, cv, rc, rc + 0.6, -F.deep, zr + 1.2, 24, face, face, 0, Math.PI)
  }
  if (d.curve !== false && d.arcade > 0) {
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
  }
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
  const [hA, hB] = d.banks ?? [wl + 8, wl + 8]
  // Along the bridge in a frame turned so its u runs from bank to bank, -l/2 to l/2.
  const S = F.sub(0, 0, Math.PI / 2)
  const wall = d.timber ? PART.timber : face
  const deckCol = d.timber ? PART.timber : C.paving
  const land = 7
  // The arches, scaled from the design's spans to the water here, bank to bank.
  const total = d.spans.reduce((s, x) => s + x, 0) + d.piers.reduce((s, x) => s + x, 0)
  const k = l / total
  const spans = d.spans.map((x) => x * k)
  const piers = d.piers.map((x) => x * k)
  const rise = d.rise ?? 0.5
  // The deck: from the ground at one end to the ground at the other, lifted over the
  // stream to clear its arches, and eased at the banks.
  const clear = d.timber ? 4.5 : Math.max(...spans) * rise + 2.2
  const deck = (u: number) => {
    const t = Math.min(1, Math.max(0, (u + l / 2) / l))
    const ends = hA + (hB - hA) * t
    const need = wl + clear
    const off = Math.max(0, need - ends)
    // How far out over the water the lift reaches, full across the middle.
    const e = Math.min(1, Math.min(u + l / 2 + land, l / 2 + land - u) / (l * 0.3 + land))
    return ends + off * (e * e * (3 - 2 * e))
  }
  const step = 2
  const us: number[] = []
  for (let u = -l / 2 - land; u < l / 2 + land; u += step) us.push(u)
  us.push(l / 2 + land)
  // The deck's paving, its two faces down to where the arches or piers take over,
  // and its parapets.
  for (let i = 0; i + 1 < us.length; i++) {
    const [a, b] = [us[i], us[i + 1]]
    const [za, zb] = [deck(a), deck(b)]
    S.quad([a, -w / 2, za], [b, -w / 2, zb], [b, w / 2, zb], [a, w / 2, za], deckCol)
    for (const s of [-1, 1]) {
      const v = (s * w) / 2
      S.quad([a, v, za - 1.2], [b, v, zb - 1.2], [b, v, zb], [a, v, za], wall)
      const pv = v - s * 0.25
      S.quad([a, pv, za], [b, pv, zb], [b, pv, zb + 1.1], [a, pv, za + 1.1], wall)
      S.quad([a, v, za + 1.1], [b, v, zb + 1.1], [b, pv, zb + 1.1], [a, pv, za + 1.1], wall)
    }
  }
  if (d.timber) {
    // Bents of piles across the stream under the deck, with a cross beam on each.
    const n = spans.length
    for (let j = 0; j <= n; j++) {
      const u = -l / 2 + (l * j) / n
      const z = deck(u) - 0.5
      for (const v of [-w / 2 + 0.4, 0, w / 2 - 0.4])
        S.drum(u, v, 0.25, 0.25, wl - 3, z, 5, PART.wood, null)
      S.box(u - 0.3, u + 0.3, -w / 2, w / 2, z - 0.5, z, PART.wood)
    }
    return
  }
  // Solid masonry from the ground up to the deck at each end, onto the land.
  const solid = (u0: number, u1: number, z0: number) => {
    const n = Math.max(1, Math.ceil((u1 - u0) / step))
    for (let j = 0; j < n; j++) {
      const [a, b] = [u0 + ((u1 - u0) * j) / n, u0 + ((u1 - u0) * (j + 1)) / n]
      const [za, zb] = [deck(a) - 1.2, deck(b) - 1.2]
      for (const s of [-1, 1])
        S.quad(
          [a, (s * w) / 2, z0],
          [b, (s * w) / 2, z0],
          [b, (s * w) / 2, zb],
          [a, (s * w) / 2, za],
          wall,
        )
    }
    for (const [u, z] of [
      [u0, deck(u0) - 1.2],
      [u1, deck(u1) - 1.2],
    ])
      S.quad([u, -w / 2, z0], [u, w / 2, z0], [u, w / 2, z], [u, -w / 2, z], wall)
  }
  solid(-l / 2 - land, -l / 2, Math.min(hA, wl) - 3)
  solid(l / 2, l / 2 + land, Math.min(hB, wl) - 3)
  // An arch from sa to sb: its ring springing over the water, its spandrels up to the
  // deck on both faces, its soffit dark.
  const arch = (sa: number, sb: number, r0: number) => {
    const N = 10
    const r = (sb - sa) / 2
    const um = (sa + sb) / 2
    const crown = deck(um) - 1.6
    const spring = Math.max(wl - 0.8, crown - (sb - sa) * r0)
    const pts = Array.from({ length: N + 1 }, (_, j) => {
      const a = Math.PI * (1 - j / N)
      return [um + Math.cos(a) * r, spring + Math.sin(a) * (crown - spring)] as Pt
    })
    for (const s of [-1, 1]) {
      const v = (s * w) / 2
      for (let j = 0; j < N; j++) {
        const [p, q] = [pts[j], pts[j + 1]]
        S.quad(
          [p[0], v, p[1]],
          [q[0], v, q[1]],
          [q[0], v, deck(q[0]) - 1.2],
          [p[0], v, deck(p[0]) - 1.2],
          wall,
        )
      }
    }
    for (let j = 0; j < N; j++) {
      const [p, q] = [pts[j], pts[j + 1]]
      S.quad(
        [p[0], -w / 2, p[1]],
        [q[0], -w / 2, q[1]],
        [q[0], w / 2, q[1]],
        [p[0], w / 2, p[1]],
        PART.dark,
      )
    }
    return spring
  }
  let u = -l / 2
  spans.forEach((span, i) => {
    arch(u, u + span, rise)
    u += span
    const p = piers[i]
    if (p === undefined) return
    const [pa, pb] = [u, u + p]
    const m = (pa + pb) / 2
    // The pier up to the deck, a flood arch through it where it had one, and pointed
    // cutwaters on both faces to above the floods.
    if (d.flood) {
      const fs = Math.min(d.flood * k, p * 0.6)
      solid(pa, m - fs / 2, wl - 4)
      solid(m + fs / 2, pb, wl - 4)
      arch(m - fs / 2, m + fs / 2, 0.5)
    } else solid(pa, pb, wl - 4)
    for (const s of [-1, 1]) {
      const v0 = (s * w) / 2
      S.prism(
        [
          [pa, v0],
          [pb, v0],
          [m, v0 + s * p * 0.75],
        ],
        wl - 4,
        wl + 3,
        wall,
      )
      S.prism(
        [
          [pa, v0],
          [pb, v0],
          [m, v0 + s * p * 0.75],
        ],
        wl + 3,
        wl + 3.01,
        wall,
      )
    }
    u = pb
  })
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
 * An assembly place open to the sky (the Comitium): rings of low tufa steps round a
 * paved floor, standing along the arcs its design gives (degrees clockwise from its
 * front, +v), the rest of the ring left out where other buildings stood on it — the
 * Rostra at its front, and from Sulla's time the Curia over its north side.
 */
interface Comitium {
  /** The outer radius and the floor's, metres. */
  radius: number
  orchestra: number
  /** The top step's height over the floor, and how many steps. */
  h: number
  steps: number
  arcs: [number, number][]
}

const comitium: Build<Design & Comitium> = (F, d) => {
  F.drum(0, 0, d.orchestra, d.orchestra, -0.3, 0.12, 32, C.tufa)
  for (const [from, to] of d.arcs) {
    const a0 = Math.PI / 2 - (to * Math.PI) / 180
    const a1 = Math.PI / 2 - (from * Math.PI) / 180
    F.cavea(0, 0, d.orchestra, d.radius, 0.12, d.h, a0, a1, C.tufa, {
      rows: d.steps,
      stairs: 3,
      bands: 0,
    })
  }
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

const island: Build<Design & Island> = (F, d) => {
  if (!d.ship || !d.outline) return
  const wl = (d.water as number | undefined) ?? 2
  const trav = C.travertine
  const ring = d.outline.map(
    ([x, y, g]) => [...F.local(x, y), g] as [number, number, number],
  )
  if (ring.length < 4) return
  // Its winding, so each wall's inside is towards the island.
  let area = 0
  for (let i = 0; i + 1 < ring.length; i++)
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  const inward = area > 0 ? 1 : -1
  // The ship's end: its tip downstream (the frame's front), the wall rising towards it
  // as a ship's sides rise to its stern, over its last `SHEER` metres.
  const SHEER = 40
  const tip = ring.reduce((m, p) => (p[1] > m[1] ? p : m), ring[0])
  const top = (p: [number, number, number]) => {
    const d = Math.hypot(p[0] - tip[0], p[1] - tip[1])
    return Math.max(wl + 2.2, p[2] + 0.6) + 2.2 * Math.max(0, 1 - d / SHEER) ** 2
  }
  const T = 1.4
  for (let i = 0; i + 1 < ring.length; i++) {
    const [a, b] = [ring[i], ring[i + 1]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.05) continue
    const n = [(-(b[1] - a[1]) / L) * inward, ((b[0] - a[0]) / L) * inward]
    const [ta, tb] = [top(a), top(b)]
    const ai = [a[0] + n[0] * T, a[1] + n[1] * T]
    const bi = [b[0] + n[0] * T, b[1] + n[1] * T]
    // The face to the river, its coping, and its back down into the island's ground.
    F.quad(
      [a[0], a[1], wl - 1.5],
      [b[0], b[1], wl - 1.5],
      [b[0], b[1], tb],
      [a[0], a[1], ta],
      trav,
    )
    F.quad([a[0], a[1], ta], [b[0], b[1], tb], [bi[0], bi[1], tb], [ai[0], ai[1], ta], trav)
    F.quad(
      [ai[0], ai[1], ta],
      [bi[0], bi[1], tb],
      [bi[0], bi[1], b[2] - 1],
      [ai[0], ai[1], a[2] - 1],
      trav,
    )
  }
  // Near the tip on each side the relief of Aesculapius' staff and serpent (drawn as a
  // darker panel), as the stern's ornament survives.
  const near = ring
    .map((p, i) => ({ p, i, d: Math.hypot(p[0] - tip[0], p[1] - tip[1]) }))
    .filter((q) => q.d > 8 && q.d < 16)
  for (const { i } of near.slice(0, 2)) {
    const [a, b] = [ring[i], ring[Math.min(ring.length - 1, i + 1)]]
    const z = top(a)
    F.quad(
      [a[0], a[1], z - 2.4],
      [b[0], b[1], z - 2.4],
      [b[0], b[1], z - 0.8],
      [a[0], a[1], z - 0.8],
      PART.tufaGrey,
    )
  }
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
  comitium,
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
