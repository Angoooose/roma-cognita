import * as THREE from 'three/webgpu'
import {
  ALWAYS,
  type Aqueduct,
  Builder,
  C,
  ccw,
  FABRIC_STRIDE,
  LOT,
  MOUND_FADE_M,
  MOUND_H_M,
  MOUND_R_M,
  type Mesh,
  orientedBox,
  polygonArea,
  edges,
  type Pt,
  ROOF,
  SKIN,
  STONE,
  type Stone,
} from './builder.ts'
import { buildDesign, type Design } from './monuments.ts'
import { type Kept, Works } from './works.ts'
import { curtain, type Gate, gatehouse, type Tower, tower, type WallBuild } from './wall.ts'

/** Floats per tree in model.bin: x, y, radius, ground, kind, first and last year (pipeline model.ts). */
const TREE_STRIDE = 7
/** What a tree is (pipeline fields.ts `TREE`). */
const TREE = { mixed: 0, olive: 1, fruit: 2, oak: 3, cypress: 4, pine: 5 }

/**
 * The model of Rome's mesh, raised from what the pipeline baked (model.json and
 * model.bin): the known buildings in the forms and stones of their years, the
 * aqueducts, the wall and its gates, the generated city and its trees. Pure, so it is
 * built off the main thread (modelWorker.ts); ModelLayer draws it.
 */
export interface BuiltModel {
  /** The mesh: its attributes and its triangles' index (Builder `mesh`). */
  mesh: Mesh
  /** What overshadows its neighbours, for the shading (Builder `tops`). */
  tops: Float64Array
  /** Where the mesh's local coordinates are centred, plane metres. */
  origin: [number, number]
  /** The model's extent, plane metres: x0, y0, x1, y1. */
  extent: [number, number, number, number]
  /** Where any of its vertices lie, plane metres: x0, y0, x1, y1. */
  bounds: [number, number, number, number]
  waterLevel: number
}

interface Monument {
  id: string
  kind: string
  rings: Pt[][]
  base: number
  body: number
  roof: string
  podium: number
  years: [number, number]
  /**
   * The spans of its years when it was building or lay burnt, in order; for works
   * rebuilding it, what they kept of it (pipeline model.ts `dates`).
   */
  spans?: { kind: 'burnt' | 'works' | 'finishing'; years: [number, number]; kept?: Kept }[]
  /** The point it faces: a temple's front is the end nearer it. */
  faces: Pt
  /** What it was faced with, from the year given; stucco when not recorded. */
  stone?: { from: number; stone: Stone }[]
  /** How it is built, where it is built as itself (monuments.ts). */
  design?: Design
}

/** The model from model.json, as parsed (`meta`), and model.bin (`bin`). */
export function buildModel(meta: any, bin: ArrayBuffer): BuiltModel {
  const f = new Float32Array(bin)
  // Local coordinates round the city's middle keep float32 precise.
  const all = meta.wall.flatMap((w: { pts: number[][] }) => w.pts)
  const ox = Math.round(all.reduce((s: number, p: number[]) => s + p[0], 0) / all.length)
  const oy = Math.round(all.reduce((s: number, p: number[]) => s + p[1], 0) / all.length)
  const b = new Builder(ox, oy)
  const rand = mulberry32(31)

  // A building refaced or rebuilt within its years is built once for each stone and
  // each form of its design, each standing for its own years; each span of works or
  // fire within them as itself (`raise`).
  for (const m of meta.monuments as Monument[]) {
    const stones = m.stone ?? [{ from: ALWAYS[0], stone: 'stucco' as Stone }]
    const cuts = [
      ...new Set([
        m.years[0],
        ...stones.map((s) => s.from),
        ...(m.design?.phases ?? []).map((ph) => ph.from),
      ]),
    ]
      .filter((y) => y >= m.years[0] && y <= m.years[1])
      .sort((a, c) => a - c)
    cuts.forEach((from, i) => {
      const to = Math.min(m.years[1], (cuts[i + 1] ?? ALWAYS[1] + 1) - 1)
      const stone = stones.filter((s) => s.from <= from).pop() ?? stones[0]
      b.face = STONE[stone.stone].face
      b.shade = STONE[stone.stone].shade
      // Each span of works or fire within these years is built on its own, from its
      // first year until the next begins; the first also stands for the years before it.
      const spans = (m.spans ?? []).filter((sp) => sp.years[0] <= to && sp.years[1] >= from)
      if (!spans.length) {
        b.dates = [from, to, 1, 0]
        monument(b, m, from)
      }
      spans.forEach((sp, k) => {
        const a = k === 0 ? from : Math.max(from, sp.years[0])
        const z = k + 1 < spans.length ? Math.min(to, spans[k + 1].years[0] - 1) : to
        raise(b, m, from, a, z, sp)
      })
    })
  }
  b.dates = ALWAYS

  // The tombs along the roads (pipeline model.ts): generated, built as the known
  // tombs' designs are, in stucco or travertine.
  for (const t of (meta.roadTombs ?? []) as (Design & {
    base: number
    stone: Stone
    from?: number
  })[]) {
    // Each from the year it was built (pipeline model.ts `GROWN.tombs`).
    b.dates = [t.from ?? ALWAYS[0], ALWAYS[1], 1, 0]
    b.face = STONE[t.stone].face
    b.shade = STONE[t.stone].shade
    buildDesign(b, t, t.base)
  }

  // The aqueducts (pipeline aqueducts.ts): arcades of tufa and peperino striding
  // over the low ground, solid walls where the ground rises under them, and over
  // the underground stretches only the heads of the shafts down to the channel. Each
  // channel stands for its own years, stacked on those below it, so the arcade
  // grows when a new aqueduct is carried on it.
  b.occludes = false
  for (const aq of (meta.aqueducts ?? []) as Aqueduct[]) {
    const [first, ...above] = aq.channels
    const dated = (c: Aqueduct['channels'][number]) => [
      c.years[0],
      c.years[1],
      ...(c.unfinished ?? [1, 0]),
    ]
    for (const [r, run] of aq.runs.entries()) {
      const pts = run.pts
      const meetsGround = (k: number) => !aq.runs[k] || aq.runs[k].kind === 'shafts'
      // Where the channel meets the ground — going under it, coming out of it, or at
      // the end of the course — it does not stop in a cut face: the masonry slopes
      // down into a bank of earth over the channel's end.
      if (run.kind !== 'shafts') {
        const ends: [number[], number[]][] = [
          ...(meetsGround(r - 1) ? [[pts[0], pts[1]] as [number[], number[]]] : []),
          ...(meetsGround(r + 1)
            ? [[pts[pts.length - 1], pts[pts.length - 2]] as [number[], number[]]]
            : []),
        ]
        const stackH = aq.channels.reduce((h, c) => h + c.h + 0.25, 0)
        for (const [end, next] of ends) {
          if (!next) continue
          b.dates = dated(first)
          b.bank(end, next, aq.size.width + 1, end[3] - end[2] + stackH)
        }
      }
      if (run.kind === 'shafts') {
        // Over the channel underground, the low grassy mound of spoil round each
        // shaft, fading out within a couple of hundred metres of where the masonry
        // goes into the ground, so the line is hinted at and no more.
        b.dates = dated(first)
        const from = [
          ...(aq.runs[r - 1] && aq.runs[r - 1].kind !== 'shafts' ? [pts[0]] : []),
          ...(aq.runs[r + 1] && aq.runs[r + 1].kind !== 'shafts'
            ? [pts[pts.length - 1]]
            : []),
        ]
        for (const [x, y, g] of pts) {
          const d = Math.min(...from.map((e) => Math.hypot(e[0] - x, e[1] - y)))
          const k = 1 - d / MOUND_FADE_M
          if (k <= 0.15) continue
          b.mound(x, y, g, MOUND_R_M * (0.6 + 0.4 * k), MOUND_H_M * k)
        }
        continue
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const [p, q] = [pts[i], pts[i + 1]]
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
        const u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]
        const base = Math.min(p[2], q[2])
        b.dates = dated(first)
        if (run.kind === 'arcade') {
          b.pier(p, u, aq.size, p[3])
          if (i + 2 === pts.length) b.pier(q, u, aq.size, q[3])
          b.arch(p, q, aq.size, base)
        } else {
          // A solid wall carrying the channel where the ground is too high for arches.
          const angle = Math.atan2(u[1], u[0]) - Math.PI / 2
          b.block(
            (p[0] + q[0]) / 2,
            (p[1] + q[1]) / 2,
            angle,
            aq.size.width,
            L + 0.05,
            -3,
            Math.max(p[3], q[3]) - base,
            'flat',
            base,
            C.tufaPier,
            C.tufaPier,
          )
        }
        // The channels, one on another, each in its own years.
        let z = 0
        for (const c of [first, ...above]) {
          b.dates = dated(c)
          b.channel(
            p,
            q,
            aq.size.width - 0.4,
            z,
            c.h,
            base,
            c === first ? C.marciaChannel : C.aqueductLater,
            C.aqueductCap,
          )
          z += c.h + 0.25
        }
      }
    }
  }
  b.dates = ALWAYS

  // Retaining walls where a levelled site is cut into rising ground (pipeline
  // model.ts): squared tufa from the site's level to a little over the ground
  // behind, standing while its monument does.
  for (const r of (meta.retaining ?? []) as {
    base: number
    pts: number[][]
    years: [number, number]
  }[]) {
    b.dates = [r.years[0], r.years[1], 1, 0]
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, c] = [r.pts[i], r.pts[i + 1]]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      if (len < 0.1) continue
      b.block(
        (a[0] + c[0]) / 2,
        (a[1] + c[1]) / 2,
        Math.atan2(c[1] - a[1], c[0] - a[0]) - Math.PI / 2,
        1.4,
        len + 0.4,
        -1,
        Math.max(a[2], c[2]),
        'flat',
        r.base,
        C.retaining,
        C.retainingTop,
      )
    }
  }
  b.dates = ALWAYS
  // The Servian Wall (wall.ts): the curtain in its runs between the gates, the
  // agger's towers, and a gatehouse at each gate.
  const W = meta.wallBuild as WallBuild
  for (const [k, w] of (meta.wall as { pts: number[][] }[]).entries())
    curtain(b, w.pts, W, k * 97.3)
  for (const [k, t] of ((meta.towers ?? []) as Tower[]).entries()) tower(b, t, W, k * 0.37)
  for (const [k, g] of ((meta.gates ?? []) as Gate[]).entries())
    gatehouse(b, g, W, k * 0.61)

  // The generated city (pipeline city.ts): plain stucco in a narrow range under one
  // terracotta, varied a little lot by lot. A building on the site of a later
  // monument goes when it comes; one the city grew into comes in its year (`since`).
  b.occludes = true
  /**
   * A suburban yard or garden (pipeline model.ts): its floor, trodden earth or garden
   * beds, over the fields' paint, and a low plastered wall round it `h` high, open in
   * the middle of its front (`q`'s first side) for a gate.
   */
  const yard = (q: Pt[], h: number, ground: number, garden: boolean) => {
    const look = b.look
    // Its kind, so the walls take no shops or windows (ModelLayer `wallPaint`).
    b.look = SKIN.none * 10 + LOT.yard
    const floor = garden ? C.garden : C.yard
    b.quad(
      [q[0][0], q[0][1], 0.1],
      [q[1][0], q[1][1], 0.1],
      [q[2][0], q[2][1], 0.1],
      [q[3][0], q[3][1], 0.1],
      ground,
      floor,
    )
    const T = 0.45
    const wall = (a: Pt, c: Pt) => {
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1
      const [nx, ny] = [(-(c[1] - a[1]) / L) * (T / 2), ((c[0] - a[0]) / L) * (T / 2)]
      b.lot(
        [
          [a[0] - nx, a[1] - ny],
          [c[0] - nx, c[1] - ny],
          [c[0] + nx, c[1] + ny],
          [a[0] + nx, a[1] + ny],
        ],
        h,
        ground,
        C.yardWall,
        C.yardWall,
        ROOF.flat,
      )
    }
    const [f0, f1, b1, b0] = q
    const mid = (t: number): Pt => [
      f0[0] + (f1[0] - f0[0]) * t,
      f0[1] + (f1[1] - f0[1]) * t,
    ]
    const flen = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) || 1
    const gap = Math.min(0.4, 1.6 / flen)
    wall(f0, mid(0.5 - gap))
    wall(mid(0.5 + gap), f1)
    wall(f1, b1)
    wall(b1, b0)
    wall(b0, f0)
    b.look = look
  }
  const nF = meta.fabricCount
  const shade = (c: THREE.Color, k: number, r: () => number) =>
    c.clone().multiplyScalar(1 - k + r() * k * 2)
  for (let i = 0; i < nF; i++) {
    const v = f.subarray(i * FABRIC_STRIDE, (i + 1) * FABRIC_STRIDE)
    const q: Pt[] = [0, 2, 4, 6].map((k) => [v[k], v[k + 1]])
    const [h, ground, until, kind, roof, tone, since] = [
      v[8],
      v[9],
      v[10],
      v[11],
      v[12],
      v[13],
      v[14],
    ]
    b.dates = [since, until, 1, 0]
    if (kind === LOT.yard || kind === LOT.garden) {
      yard(q, h, ground, kind === LOT.garden)
      continue
    }
    // One building's lots share its render and its roof's weathering (`tone`).
    const own = mulberry32(Math.floor(tone * 1000) + 7)
    const wall =
      kind === LOT.house
        ? shade(C.house, 0.03, own)
        : kind === LOT.warehouse
          ? shade(C.warehouse, 0.03, own)
          : C.stucco[Math.floor(own() * C.stucco.length)]
    const tiles = roof === ROOF.flat ? shade(C.terrace, 0.04, own) : weathered(C.roof, own)
    // The lot's kind and its building's seed for its doors and windows, for the shader.
    b.look = kind + Math.floor(tone * 900) / 1000
    b.lot(q, h, ground, wall, tiles, roof)
  }
  b.dates = ALWAYS
  b.look = SKIN.tree * 10
  // Trees (pipeline fields.ts `TREE`): the olives and fruit trees of the country's
  // groves and orchards, holm oaks and cypresses on its scrub and in the sacred
  // groves, and in the gardens and courtyards a mix of them, with an umbrella pine
  // here and there. The pine skyline that says "Rome" now is mostly later planting.
  for (let i = 0; i < meta.treeCount; i++) {
    const [x, y, r, ground, kind, from, to] = f.subarray(
      nF * FABRIC_STRIDE + i * TREE_STRIDE,
      nF * FABRIC_STRIDE + (i + 1) * TREE_STRIDE,
    )
    b.dates = [from, to, 1, 0]
    const col = C.tree[Math.floor(rand() * C.tree.length)]
    if (kind === TREE.olive) b.olive(x, y, r, ground, C.olive)
    else if (kind === TREE.fruit) b.fruit(x, y, r, ground, C.fruit)
    else if (kind === TREE.oak) b.oak(x, y, r, ground, col)
    else if (kind === TREE.cypress) b.cypress(x, y, r, ground, C.cypress)
    else if (kind === TREE.pine) b.pine(x, y, r, ground, col)
    else {
      const t = rand()
      if (t < 0.45) b.cypress(x, y, r, ground, C.cypress)
      else if (t < 0.9) b.oak(x, y, r, ground, col)
      else b.pine(x, y, r, ground, col)
    }
  }
  b.look = 0
  b.dates = ALWAYS

  // The model's ground reaches round the aqueducts too.
  const reach = [
    ...all,
    ...((meta.aqueducts ?? []) as Aqueduct[]).flatMap((aq) =>
      aq.runs.flatMap((r) => r.pts),
    ),
  ]
  const xs = reach.map((p: number[]) => p[0])
  const ys = reach.map((p: number[]) => p[1])
  const extent: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ]
  const mesh = b.mesh()
  const bounds: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ]
  const pos = mesh.attributes.position.array
  for (let i = 0; i < pos.length; i += 3) {
    bounds[0] = Math.min(bounds[0], pos[i] + ox)
    bounds[1] = Math.min(bounds[1], pos[i + 1] + oy)
    bounds[2] = Math.max(bounds[2], pos[i] + ox)
    bounds[3] = Math.max(bounds[3], pos[i + 1] + oy)
  }
  return {
    mesh,
    tops: b.tops,
    origin: [ox, oy],
    extent,
    bounds,
    waterLevel: meta.waterLevel,
  }
}

/**
 * A monument for years a–z, which begin with (or run into) a span of works or fire.
 * A temple going up rises through its works, each part in its years, with its
 * scaffold, crane and yard round it, on what a rebuilding kept (works.ts); before
 * them it stands as it was. Any other building being built stands cut off at about
 * two-fifths of its height, or as far as its design says its works had got
 * (`progress`); a burnt one is a roofless shell. `phase` is the year its design's
 * form is taken from.
 */
function raise(
  b: Builder,
  m: Monument,
  phase: number,
  a: number,
  z: number,
  sp: NonNullable<Monument['spans']>[number],
) {
  const [w0, w1] = sp.years
  // Being finished after its dedication: a temple stands whole in its scaffold;
  // any other building simply stands.
  if (sp.kind === 'finishing') {
    if (m.design?.model !== 'temple') {
      b.dates = [a, z, 1, 0]
      monument(b, m, phase)
      return
    }
    if (a < w0) {
      b.dates = [a, w0 - 1, 1, 0]
      monument(b, m, phase)
    }
    b.works = new Works(w0, w1, Math.max(a, w0), z, 'finishing')
    monument(b, m, phase)
    b.works = null
    b.rise = null
    return
  }
  if (sp.kind === 'works' && m.design?.model === 'temple') {
    if (a < w0) {
      b.dates = [a, w0 - 1, 1, 0]
      monument(b, m, phase)
    }
    // Works straight after a fire rebuild a burnt ruin.
    const afterFire = (m.spans ?? []).some(
      (x) => x.kind === 'burnt' && x.years[1] < w0 && x.years[1] >= w0 - 1,
    )
    b.works = new Works(w0, w1, Math.max(a, w0), z, sp.kept ?? null, afterFire)
    monument(b, m, phase)
    b.works = null
    b.rise = null
    return
  }
  const burnt = sp.kind === 'burnt'
  b.dates = [a, z, w0, w1]
  const start = b.mark()
  monument(b, m, phase)
  // How far its works had got: its design's `progress`, or its phase's.
  const now: Record<string, unknown>[] = [
    m.design ?? {},
    ...(m.design?.phases ?? []).filter((ph) => ph.from <= phase),
  ]
  const progress = (now
    .map((d) => d.progress)
    .filter((v) => v !== undefined)
    .pop() ?? 0.4) as number
  b.finish(start, burnt ? 0.72 : progress, burnt)
}

/**
 * One known building, raised by its type. Temples stand on a podium with steps at
 * the front, a colonnade round the cella under an entablature and a pedimented
 * roof, facing `faces`; a round shrine is a ring of columns under a cone; a
 * basilica a colonnade under a raised clerestory; a forum a paved court inside
 * porticoes. The proportions are the types' (Vitruvius' rules of thumb), not
 * measurements of these buildings.
 */
function monument(b: Builder, m: Monument, year: number) {
  if (m.design) {
    const { phases, ...d } = m.design
    const now = Object.assign({}, d, ...(phases ?? []).filter((ph) => ph.from <= year))
    return buildDesign(b, now, m.base)
  }
  const [outer, ...holes] = m.rings.map((r) => ccw(r, true))
  const rings = [outer, ...holes.map((h) => ccw(h, false))]
  const base = m.base
  const obb = orientedBox(outer)
  const boxy = obb.area > 0 && polygonArea(outer) / obb.area > 0.8
  // Round: its outline as compact as a circle's (perimeter² / 4π·area near 1).
  let perimeter = 0
  for (let i = 0; i + 1 < outer.length; i++)
    perimeter += Math.hypot(outer[i + 1][0] - outer[i][0], outer[i + 1][1] - outer[i][1])
  const round = (perimeter * perimeter) / (4 * Math.PI * polygonArea(outer)) < 1.08
  switch (m.kind) {
    case 'bridge': {
      b.walls(outer, 0, m.body, base, C.stone)
      b.top(rings, m.body, base, C.paving)
      return
    }
    case 'forum': {
      b.top(rings, 0.4, base, C.travertine)
      edges(outer, (a, c) => b.portico(a, c, 9, m.body, base))
      return
    }
    case 'circus': {
      // Stands round the edge in three tiers, and the long barrier down the arena.
      b.top(rings, 0.3, base, C.sand)
      for (const [k, [w, h]] of [
        [26, 4],
        [18, 8],
        [9, 12],
      ].entries())
        edges(outer, (a, c) =>
          b.edgeBlock(a, c, w, 0.3, h, base, k === 2 ? b.face : b.shade, b.face),
        )
      b.block(
        obb.cx,
        obb.cy,
        obb.angle,
        8,
        obb.long * 0.62,
        -2,
        2.5,
        'flat',
        base,
        b.face,
        b.face,
      )
      return
    }
    case 'theatre': {
      // The seating rises from the stage to the outer wall.
      const r = Math.max(...outer.map(([x, y]) => Math.hypot(x - obb.cx, y - obb.cy)))
      const [cx, cy] = [Math.max(...outer.map((p) => p[0])) - 12, obb.cy]
      const zAt = ([x, y]: Pt) =>
        4 + (m.body - 4) * Math.min(1, Math.hypot(x - cx, y - cy) / r)
      b.walls(outer, -6, 0, base, b.face, outer.map(zAt))
      b.top(rings, zAt, base, C.seating)
      b.block(cx + 6, cy, 0, 12, 95, -6, m.body, 'gable', base, b.face, C.roofTemple)
      return
    }
  }
  if (m.kind === 'temple' && round)
    return b.tholos(obb.cx, obb.cy, obb.short / 2, m.podium || 3, base)
  if (m.kind === 'temple' && boxy)
    return b.temple(obb, m.faces, m.podium || 3, m.body, base)
  if (m.kind === 'basilica' && boxy) return b.basilica(obb, m.body, base)
  if (
    (m.kind === 'curia' ||
      m.kind === 'house' ||
      m.kind === 'warehouse' ||
      m.kind === 'portico') &&
    boxy
  ) {
    b.block(
      obb.cx,
      obb.cy,
      obb.angle,
      obb.short,
      obb.long,
      -6,
      m.body,
      m.roof === 'flat' ? 'flat' : 'gable',
      base,
      b.face,
      C.roofTemple,
      0.6,
    )
    return
  }
  const podium = m.podium
  const body = podium + m.body
  if (podium > 0) {
    b.walls(outer, -6, podium, base, b.face)
    b.top(rings, podium, base, b.face)
  }
  b.walls(outer, podium > 0 ? podium : -6, body, base, b.face)
  for (const h of holes) b.walls(ccw(h, true), podium > 0 ? podium : -6, body, base, b.face)
  b.top(rings, body, base, m.roof === 'flat' ? b.shade : C.roofTemple)
}

/** A tiled roof, weathered: lighter or darker, and now and then browner or redder. */
function weathered(c: THREE.Color, rand: () => number) {
  const out = c.clone().multiplyScalar(0.93 + rand() * 0.14)
  const hsl = { h: 0, s: 0, l: 0 }
  out.getHSL(hsl)
  return out.setHSL(hsl.h + (rand() - 0.5) * 0.02, hsl.s * (0.85 + rand() * 0.3), hsl.l)
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
