import type * as THREE from 'three/webgpu'
import { Frame } from './architecture.ts'
import { type Builder, C, SKIN } from './builder.ts'

/**
 * The Servian Wall (DESIGN.md §7.7), from what the pipeline laid out along its course
 * (model.ts `WALL`): a curtain of squared tufa laid in courses, its faces running down
 * to the ground either side, a walk along its top behind a battlemented parapet;
 * towers along the agger; and at each gate a gatehouse.
 */
export interface WallBuild {
  thick: number
  walk: number
  parapet: number
  merlon: number
  bay: number
}

/** A point of the curtain: x, y, the ground outside and inside its faces, and its walk. */
type WallPt = number[]

export interface Gate {
  name: string
  at: [number, number]
  /** Out of the city, a unit vector. */
  out: [number, number]
  ground: number
  walk: number
}

export interface Tower {
  at: [number, number]
  out: [number, number]
  ground: number
  walk: number
}

/** How far each face's foot runs below its ground, metres, so no slope shows under it. */
const FOOT_M = 1.5
/** The parapet's sill between the battlements, over the walk, and its thickness, metres. */
const SILL_M = 0.95
const PARAPET_THICK_M = 0.6
/** A tower's size along the wall and how far it stands out beyond the outer face, and its height over the walk. */
const TOWER = { wide: 6.4, proud: 3.2, over: 3.4 }
/**
 * A gatehouse (after the plans of the Porta Collina, Viminalis and Sanqualis): a
 * passage `passage` wide through the wall between two bastions standing out in front,
 * and behind it a court whose side walls close in to an inner gate, `court` deep.
 * The one early opening measured is twelve Roman feet (3.3 m).
 */
const GATE = { passage: 3.6, bastion: 6.2, proud: 4, court: 11, courtIn: 3.4 }

/**
 * Stone laid in courses (`SKIN.ashlar`): a point's surface coordinates are how far
 * along the face it is and its height above the sea, so the courses run level
 * whatever the ground does.
 */
const ashlar = (b: Builder, seed: number) => {
  b.look = SKIN.ashlar * 10 + (seed % 1) * 0.9
}

/** One run of the curtain, from gatehouse to gatehouse. */
export function curtain(b: Builder, pts: WallPt[], W: WallBuild, seed: number) {
  const n = pts.length
  if (n < 2) return
  const half = W.thick / 2
  // Each point's outward normal: square to the course through its neighbours.
  const normal = pts.map((_, i) => {
    const [p, q] = [pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(q[1] - p[1]) / L, -(q[0] - p[0]) / L]
  })
  const along: number[] = [0]
  for (let i = 1; i < n; i++)
    along.push(
      along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
    )
  const off = (i: number, d: number) => [
    pts[i][0] + normal[i][0] * d,
    pts[i][1] + normal[i][1] * d,
  ]
  const [gOut, gIn, walk] = [
    (i: number) => pts[i][2],
    (i: number) => pts[i][3],
    (i: number) => pts[i][4],
  ]
  /**
   * A strip along the run between two lines of it: `d` out from the course, `z` a
   * height above the sea, `g` the ground it is measured over.
   */
  const strip = (
    d0: number,
    z0: (i: number) => number,
    g0: (i: number) => number,
    d1: number,
    z1: (i: number) => number,
    g1: (i: number) => number,
    col: THREE.Color,
  ) => {
    for (let i = 0; i + 1 < n; i++) {
      const [j, k] = [i, i + 1]
      const pa = off(j, d0)
      const pb = off(k, d0)
      const pc = off(k, d1)
      const pd = off(j, d1)
      b.quad(
        [pa[0], pa[1], z0(j) - g0(j), along[j] + seed, z0(j)],
        [pb[0], pb[1], z0(k) - g0(k), along[k] + seed, z0(k)],
        [pc[0], pc[1], z1(k) - g1(k), along[k] + seed, z1(k)],
        [pd[0], pd[1], z1(j) - g1(j), along[j] + seed, z1(j)],
        [g0(j), g0(k), g1(k), g1(j)],
        col,
      )
    }
  }
  const sill = (i: number) => walk(i) + SILL_M
  const outFoot = (i: number) => gOut(i) - FOOT_M
  const inFoot = (i: number) => gIn(i) - FOOT_M
  ashlar(b, seed)
  // The outer face, from below the ground to the parapet's sill.
  strip(half, outFoot, gOut, half, sill, gOut, C.wallTufa)
  // The inner face, up to the walk, and the parapet's back.
  strip(-half, inFoot, gIn, -half, walk, gIn, C.wallTufa)
  strip(half - PARAPET_THICK_M, walk, gOut, half - PARAPET_THICK_M, sill, gOut, C.wallTufa)
  b.look = 0
  // The parapet's sill and the walk.
  strip(half, sill, gOut, half - PARAPET_THICK_M, sill, gOut, C.wallTufa)
  strip(half - PARAPET_THICK_M, walk, gOut, -half, walk, gIn, C.wallWalk)
  // The battlements, one every bay along the parapet.
  const L = along[n - 1]
  const bays = Math.floor(L / W.bay)
  const start = (L - bays * W.bay) / 2
  for (let k = 0; k < bays; k++) {
    const s = start + (k + 0.5) * W.bay
    let i = 0
    while (i + 2 < n && along[i + 1] < s) i++
    const t = (s - along[i]) / (along[i + 1] - along[i] || 1)
    const lerp = (a: number, c: number) => a + (c - a) * t
    const nx = lerp(normal[i][0], normal[i + 1][0])
    const ny = lerp(normal[i][1], normal[i + 1][1])
    const cx = lerp(pts[i][0], pts[i + 1][0]) + nx * (half - PARAPET_THICK_M / 2)
    const cy = lerp(pts[i][1], pts[i + 1][1]) + ny * (half - PARAPET_THICK_M / 2)
    const g = lerp(gOut(i), gOut(i + 1))
    const z = lerp(walk(i), walk(i + 1))
    b.block(
      cx,
      cy,
      Math.atan2(ny, nx),
      PARAPET_THICK_M,
      W.merlon,
      z + SILL_M - 0.05 - g,
      z + W.parapet - g,
      'flat',
      g,
      C.wallTufa,
      C.wallTufa,
    )
  }
  // Its ends, where a gatehouse meets it.
  for (const i of [0, n - 1]) {
    const [o, p] = [off(i, half), off(i, -half)]
    b.quad(
      [o[0], o[1], outFoot(i) - gOut(i)],
      [p[0], p[1], inFoot(i) - gIn(i)],
      [p[0], p[1], walk(i) - gIn(i)],
      [o[0], o[1], sill(i) - gOut(i)],
      [gOut(i), gIn(i), gIn(i), gOut(i)],
      C.wallTufa,
    )
  }
}

/** Stone courses on the sides of a box in a frame (`Frame.box`), its top plain. */
function coursedBox(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z0: number,
  z1: number,
  seed: number,
) {
  const c: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ]
  ashlar(F.b, seed)
  let s = seed * 37
  for (let i = 0; i < 4; i++) {
    const [a, d] = [c[i], c[(i + 1) % 4]]
    const len = Math.hypot(d[0] - a[0], d[1] - a[1])
    F.skinQuad(
      [a[0], a[1], z0, s, F.base + z0],
      [d[0], d[1], z0, s + len, F.base + z0],
      [d[0], d[1], z1, s + len, F.base + z1],
      [a[0], a[1], z1, s, F.base + z1],
      C.wallTufa,
    )
    s += len
  }
  F.b.look = 0
  F.quad([u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1], C.wallWalk)
}

/** Battlements round the top of a box in a frame, standing on `z`. */
function battlements(
  F: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z: number,
  W: WallBuild,
) {
  const t = PARAPET_THICK_M
  const edge = (a: [number, number], d: [number, number]) => {
    const len = Math.hypot(d[0] - a[0], d[1] - a[1])
    const bays = Math.max(1, Math.round(len / W.bay))
    const [du, dv] = [(d[0] - a[0]) / len, (d[1] - a[1]) / len]
    for (let k = 0; k < bays; k++) {
      const s = ((k + 0.5) * len) / bays
      const [u, v] = [a[0] + du * s, a[1] + dv * s]
      // Inset by half the parapet's thickness, towards the middle.
      const [iu, iv] = [
        u + (u < (u0 + u1) / 2 ? t / 2 : -t / 2) * Math.abs(dv),
        v + (v < (v0 + v1) / 2 ? t / 2 : -t / 2) * Math.abs(du),
      ]
      F.obox(iu, iv, Math.atan2(du, dv), t, W.merlon, z, z + W.parapet, C.wallTufa)
    }
  }
  edge([u0, v0], [u1, v0])
  edge([u1, v0], [u1, v1])
  edge([u1, v1], [u0, v1])
  edge([u0, v1], [u0, v0])
}

/** A tower on the agger: a square of coursed tufa standing out from the outer face. */
export function tower(b: Builder, t: Tower, W: WallBuild, seed: number) {
  const F = new Frame(b, t.at[0], t.at[1], Math.atan2(t.out[0], t.out[1]), t.ground)
  const top = t.walk - t.ground + TOWER.over
  const [u0, u1] = [-TOWER.wide / 2, TOWER.wide / 2]
  const [v0, v1] = [-W.thick / 2 + 0.2, W.thick / 2 + TOWER.proud]
  coursedBox(F, u0, u1, v0, v1, -FOOT_M, top, seed)
  battlements(F, u0, u1, v0, v1, top, W)
}

/**
 * A gatehouse: two bastions of coursed tufa either side of an arched passage through
 * the wall, the wall carried over it; behind it the court, its side walls closing in
 * to the inner gate.
 */
export function gatehouse(b: Builder, g: Gate, W: WallBuild, seed: number) {
  const F = new Frame(b, g.at[0], g.at[1], Math.atan2(g.out[0], g.out[1]), g.ground)
  const walkZ = Math.max(6, g.walk - g.ground)
  const top = walkZ + TOWER.over + 0.6
  const p = GATE.passage / 2
  const half = W.thick / 2
  // The bastions.
  for (const s of [-1, 1]) {
    const [u0, u1] = s < 0 ? [-p - GATE.bastion, -p] : [p, p + GATE.bastion]
    coursedBox(F, u0, u1, -half - 1, half + GATE.proud, -FOOT_M, top, seed + s)
    battlements(F, u0, u1, -half - 1, half + GATE.proud, top, W)
  }
  // The passage's arch, the wall's courses over it up to the parapet's sill.
  const spring = Math.min(3.8, walkZ - 2.6)
  const crown = spring + p
  F.arch(
    -p,
    p,
    -half - 1,
    W.thick + 1,
    spring,
    crown,
    walkZ + SILL_M,
    C.wallTufa,
    C.wallShade,
  )
  F.box(-p, p, -half - 1, half, walkZ, walkZ + SILL_M, C.wallTufa, C.wallWalk)
  F.box(-p, p, half - 0.1, half + 0.5, walkZ + SILL_M, walkZ + W.parapet, C.wallTufa)
  // The court: its side walls from the curtain's inner face, closing in to the inner
  // gate, a little lower than the walk.
  const courtH = walkZ - 1
  const [vA, vB] = [-half - 1, -half - 1 - GATE.court]
  for (const s of [-1, 1]) {
    const [ua, ub] = [s * (p + GATE.bastion - 0.6), s * (GATE.courtIn / 2 + 0.9)]
    const [um, vm] = [(ua + ub) / 2, (vA + vB) / 2]
    const len = Math.hypot(ub - ua, vB - vA)
    F.obox(
      um,
      vm,
      Math.atan2(ub - ua, vB - vA),
      1.2,
      len,
      -FOOT_M,
      courtH,
      C.wallTufa,
      C.wallWalk,
    )
  }
  // The inner gate: an arch between two short piers at the court's inner end.
  const q = GATE.courtIn / 2
  F.box(-q - 1.6, -q, vB - 1.4, vB, -FOOT_M, courtH, C.wallTufa, C.wallWalk)
  F.box(q, q + 1.6, vB - 1.4, vB, -FOOT_M, courtH, C.wallTufa, C.wallWalk)
  F.arch(
    -q,
    q,
    vB - 1.4,
    1.4,
    Math.min(3, courtH - 2.2),
    Math.min(3, courtH - 2.2) + q,
    courtH,
    C.wallTufa,
    C.wallShade,
  )
  F.box(-q, q, vB - 1.4, vB, courtH, courtH + 0.01, C.wallTufa, C.wallWalk)
}
