import * as THREE from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  mix,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import { terrainUniforms } from '../terrain/material.ts'
import type { Ground } from './PlanLayer.ts'
import { groundMeshFade, plateMask, reliefWash } from './shading.ts'
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
  orientedBox,
  polygonArea,
  edges,
  type Pt,
  ROOF,
  STONE,
  type Stone,
} from './builder.ts'
import { Frame } from './architecture.ts'
import { buildDesign, type Design } from './monuments.ts'

/**
 * The model of Rome (DESIGN.md §7.7): the city as a museum model, raised out of the
 * plate when the map is zoomed right into it, from what `npm run rome -w pipeline`
 * baked (pipeline/src/rome/model.ts says what is known and what is generated).
 *
 * It is lit as a model on a table is: a low sun from the north-west, the same
 * direction as the terrain's light, casting real shadows across the roofs and the
 * streets (a shadow map fitted to the view each frame), and a soft sky. The
 * materials are matte: the known monuments in the stone they were faced with that
 * year (`STONE`), the generated houses plainer and more muted under terracotta, so
 * they read as the backdrop, the wall tufa, the trees muted green. Walls darken a
 * little where they meet the ground, as a model's do. The model stands on the map's
 * own terrain, laid on the smoothed relief; a ground mesh over it that draws only
 * shadows lets them fall on the ground too.
 *
 * Heights are ground metres (the base) plus metres above it, and the vertex shader
 * scales both by the terrain's vertical exaggeration — so the city sits on the
 * relief exactly — and the second by `grow`, so the city rises out of the plate as
 * the zoom comes in and sinks back into it going out.
 *
 * The timeline moves the known buildings: one not yet built, or gone, is sunk out of
 * sight; one building or burnt stands a third of its height; the generated city and
 * the wall stand throughout.
 */
export const modelUniforms = {
  /** 0 flat into the ground … 1 standing. Set per frame from the scale. */
  grow: uniform(0),
  /** The year shown, astronomical. */
  year: uniform(-62),
}

/** What the distance fades the model towards: the warm, pale air of a summer day. */
const HAZE = new THREE.Color('#DCCFB8')

/**
 * The scale (m per CSS px) the model rises between: flat at the first, standing by
 * the second. It starts once the terrain is laid smooth (18 m/px, RomeMap), so its
 * ground mesh always has the terrain's own ground just under it.
 */
export const MODEL_MPP: [number, number] = [18, 10]

/** Towards the sun: north-west, 40° up. */
const SUN = new THREE.Vector3(-0.54, 0.54, 0.64).normalize()
/** The ground mesh's grid, metres, and how far past the model it reaches. */
const GROUND_STEP_M = 10
const GROUND_PAD_M = 700

/** The model's colours for its legend, as hex: the stones, and the generated houses. */
export const MODEL_KEY = {
  marble: `#${STONE.marble.face.getHexString()}`,
  stucco: `#${STONE.stucco.face.getHexString()}`,
  travertine: `#${STONE.travertine.face.getHexString()}`,
  house: '#DED3BE',
  roof: '#B8957F',
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
  unfinished: [number, number] | null
  /** Whether its part-built years are a burnt shell rather than works rising. */
  burnt?: boolean
  /** The point it faces: a temple's front is the end nearer it. */
  faces: Pt
  /** What it was faced with, from the year given; stucco when not recorded. */
  stone?: { from: number; stone: Stone }[]
  /** How it is built, where it is built as itself (monuments.ts). */
  design?: Design
}

/** How far round a monument's point its marker looks for the top of its building, metres. */
const ANCHOR_REACH_M = 6

/** The occlusion grid's cell, metres, the reach of its two blurs, cells, and its height step, metres. */
const OCC_CELL_M = 2
const OCC_BLUR = [2, 6]
const OCC_STEP_M = 0.2

/**
 * How much the model overshadows itself, for its soft shading: a grid over the city
 * of the height of whatever stands in each cell, over its ground, blurred at two
 * reaches (about 10 m and 30 m across). A point lower than the blurred height round
 * it — a narrow street, a courtyard, the foot of a wall under a taller neighbour —
 * sees less of the sky and is darker (`occlusion`). Built again for each year, as
 * buildings come and go.
 */
class Occlusion {
  readonly tex: THREE.DataTexture
  readonly origin = uniform(new THREE.Vector2())
  readonly size = uniform(new THREE.Vector2())
  private tops: Float32Array
  private nx: number
  private ny: number
  private x0: number
  private y0: number
  private year = NaN
  /** The height of what stands in each cell, unblurred, metres over its ground. */
  private raw: Float32Array | null = null
  /** The grid's extent, plane metres: x0, y0, x1, y1. */
  readonly bounds: [number, number, number, number]

  constructor(tops: number[]) {
    this.tops = new Float32Array(tops)
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < tops.length; i += 11)
      for (const k of [0, 3, 6]) {
        x0 = Math.min(x0, tops[i + k])
        x1 = Math.max(x1, tops[i + k])
        y0 = Math.min(y0, tops[i + k + 1])
        y1 = Math.max(y1, tops[i + k + 1])
      }
    const pad = OCC_CELL_M * OCC_BLUR[1] * 3
    this.x0 = x0 - pad
    this.y0 = y0 - pad
    this.nx = Math.ceil((x1 - x0 + 2 * pad) / OCC_CELL_M)
    this.ny = Math.ceil((y1 - y0 + 2 * pad) / OCC_CELL_M)
    this.tex = new THREE.DataTexture(
      new Uint8Array(this.nx * this.ny * 2),
      this.nx,
      this.ny,
      THREE.RGFormat,
      THREE.UnsignedByteType,
    )
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping
    this.bounds = [
      this.x0,
      this.y0,
      this.x0 + this.nx * OCC_CELL_M,
      this.y0 + this.ny * OCC_CELL_M,
    ]
    this.origin.value.set(this.x0, this.y0)
    this.size.value.set(this.nx * OCC_CELL_M, this.ny * OCC_CELL_M)
  }

  /** Builds the grid for a year; false if it already was. */
  build(year: number) {
    if (year === this.year) return false
    this.year = year
    const { nx, ny, tops } = this
    const grid = new Float32Array(nx * ny)
    const cx = (x: number) => (x - this.x0) / OCC_CELL_M
    const cy = (y: number) => (y - this.y0) / OCC_CELL_M
    for (let i = 0; i < tops.length; i += 11) {
      if (year < tops[i + 9] || year > tops[i + 10]) continue
      const [ax, ay, bx, by, qx, qy] = [
        cx(tops[i]),
        cy(tops[i + 1]),
        cx(tops[i + 3]),
        cy(tops[i + 4]),
        cx(tops[i + 6]),
        cy(tops[i + 7]),
      ]
      const h = Math.max(tops[i + 2], tops[i + 5], tops[i + 8])
      if (h <= 0) continue
      const mark = (x: number, y: number) => {
        const k = Math.floor(y) * nx + Math.floor(x)
        if (grid[k] < h) grid[k] = h
      }
      mark(ax, ay)
      mark(bx, by)
      mark(qx, qy)
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
      if (Math.abs(area) < 1e-6) continue
      const [i0, i1] = [
        Math.max(0, Math.floor(Math.min(ax, bx, qx))),
        Math.min(nx - 1, Math.ceil(Math.max(ax, bx, qx))),
      ]
      const [j0, j1] = [
        Math.max(0, Math.floor(Math.min(ay, by, qy))),
        Math.min(ny - 1, Math.ceil(Math.max(ay, by, qy))),
      ]
      for (let j = j0; j <= j1; j++)
        for (let ii = i0; ii <= i1; ii++) {
          const [px, py] = [ii + 0.5, j + 0.5]
          const w0 = ((bx - px) * (qy - py) - (by - py) * (qx - px)) / area
          const w1 = ((qx - px) * (ay - py) - (qy - py) * (ax - px)) / area
          if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue
          const k = j * nx + ii
          if (grid[k] < h) grid[k] = h
        }
    }
    this.raw = grid
    const data = this.tex.image.data as Uint8Array
    for (const [c, r] of OCC_BLUR.entries()) {
      const out = blur(blur(grid, nx, ny, r), nx, ny, r)
      for (let k = 0; k < out.length; k++)
        data[k * 2 + c] = Math.min(255, Math.round(out[k] / OCC_STEP_M))
    }
    this.tex.needsUpdate = true
    return true
  }

  /** The top of whatever stands within `r` metres of a point, metres over its ground. */
  topNear(x: number, y: number, r: number) {
    if (!this.raw) return 0
    const [ci, cj] = [(x - this.x0) / OCC_CELL_M, (y - this.y0) / OCC_CELL_M]
    const n = Math.ceil(r / OCC_CELL_M)
    let top = 0
    for (let j = Math.floor(cj) - n; j <= Math.floor(cj) + n; j++)
      for (let i = Math.floor(ci) - n; i <= Math.floor(ci) + n; i++)
        if (i >= 0 && j >= 0 && i < this.nx && j < this.ny)
          top = Math.max(top, this.raw[j * this.nx + i])
    return top
  }

  /**
   * How open to the sky a point is, `up` metres over its ground: 1 open, less below
   * its neighbours, by `near` for the houses close round it and `far` for those
   * further off.
   */
  at(
    x: THREE.Node<'float'>,
    y: THREE.Node<'float'>,
    up: THREE.Node<'float'>,
    near = 0.35,
    far = 0.3,
  ) {
    const uv = vec2(x, y).sub(this.origin).div(this.size)
    const hs = texture(this.tex, uv).xy.mul(255 * OCC_STEP_M)
    const close = hs.x.sub(up).div(6).clamp(0, 1)
    const round = hs.y.sub(up).div(12).clamp(0, 1)
    return float(1).sub(close.mul(near)).sub(round.mul(far))
  }
}

/** A box blur of a grid, `r` cells either way, across and then down. */
function blur(src: Float32Array, nx: number, ny: number, r: number) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const n = 2 * r + 1
  for (let j = 0; j < ny; j++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += src[j * nx + Math.min(nx - 1, Math.max(0, i))]
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = sum / n
      sum += src[j * nx + Math.min(nx - 1, i + r + 1)] - src[j * nx + Math.max(0, i - r)]
    }
  }
  for (let i = 0; i < nx; i++) {
    let sum = 0
    for (let j = -r; j <= r; j++) sum += tmp[Math.min(ny - 1, Math.max(0, j)) * nx + i]
    for (let j = 0; j < ny; j++) {
      out[j * nx + i] = sum / n
      sum += tmp[Math.min(ny - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i]
    }
  }
  return out
}

export class ModelLayer {
  readonly group = new THREE.Group()
  private loaded = false
  // A bright room: the sun sets the shadows, the sky and its bounce keep the shaded
  // walls light, as a model under a window. Flat ground comes out at its own colour.
  private sun = new THREE.DirectionalLight('#FFF6EA', 2.1)
  private sky = new THREE.HemisphereLight('#EEF2F4', '#D8CBB2', 2.1)
  /** The model's extent, plane metres: x0, y0, x1, y1. */
  private extent: [number, number, number, number] = [0, 0, 0, 0]
  private origin: [number, number] = [0, 0]
  private waterLevel = 0
  private occlusion: Occlusion | null = null
  private ground: ((x: number, y: number) => number) | null = null
  /** Called when a year's buildings have been shaded: what stands where has changed. */
  onShaded?: () => void
  private occlusionTimer = 0
  private occlusionBuilt = false
  /** How far the view reaches, metres (`fit`), which the model's haze is measured by. */
  private viewM = uniform(1000)

  async load() {
    const [meta, bin] = await Promise.all([
      fetch('/rome/model.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch('/rome/model.bin')
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
    ])
    if (!meta || !bin) return
    const f = new Float32Array(bin)
    // Local coordinates round the city's middle keep float32 precise.
    const all = meta.wall.flatMap((w: { pts: number[][] }) => w.pts)
    const ox = Math.round(all.reduce((s: number, p: number[]) => s + p[0], 0) / all.length)
    const oy = Math.round(all.reduce((s: number, p: number[]) => s + p[1], 0) / all.length)
    const b = new Builder(ox, oy)
    const rand = mulberry32(31)

    // A building refaced or rebuilt within its years is built once for each stone and
    // each form of its design, each standing for its own years.
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
        b.dates = [from, to, ...(m.unfinished ?? [1, 0])]
        b.face = STONE[stone.stone].face
        b.shade = STONE[stone.stone].shade
        const start = b.mark()
        this.monument(b, m, from)
        // Works in progress stand to about two-fifths of their height; a burnt
        // building is a roofless shell.
        // A design may say how far its works had got (`progress`).
        const progress = (m.design?.progress as number | undefined) ?? 0.4
        if (m.unfinished) b.finish(start, m.burnt ? 0.72 : progress, !!m.burnt)
      })
    }
    b.dates = ALWAYS

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

    // The Servian Wall: drawn a little stouter than its ~4 m so it reads at the city's
    // scale, 10 m high on known stretches and lower and paler where the course is
    // reconstructed; towers at its gates.
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
    const gatesAt = meta.gates as number[][]
    for (const w of meta.wall as { pts: number[][]; known: boolean }[]) {
      const h = w.known ? 10 : 8.5
      const col = w.known ? C.stone : C.stoneLight
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [a, c] = [w.pts[i], w.pts[i + 1]]
        const len = Math.hypot(c[0] - a[0], c[1] - a[1])
        if (len < 0.1) continue
        // The gatehouse stands in the wall's place at a gate.
        const [mx, my] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
        if (gatesAt.some(([gx, gy]) => Math.hypot(gx - mx, gy - my) < 7)) continue
        const angle = Math.atan2(c[1] - a[1], c[0] - a[0]) - Math.PI / 2
        const ground = Math.min(a[2], c[2])
        b.block(
          (a[0] + c[0]) / 2,
          (a[1] + c[1]) / 2,
          angle,
          6,
          len + 0.8,
          -6,
          h + (Math.max(a[2], c[2]) - ground),
          'flat',
          ground,
          col,
          col,
        )
      }
    }
    // Each gate a gatehouse on the wall's line: a block of the wall's stone with an
    // arched passage through it for the road, under a hipped roof of tiles.
    const wallPts = (meta.wall as { pts: number[][] }[]).flatMap((w) =>
      w.pts.slice(1).map((q, k) => [w.pts[k], q]),
    )
    for (const [x, y, ground] of meta.gates as number[][]) {
      let best = { d: Infinity, a: 0 }
      for (const [p, q] of wallPts) {
        const d = Math.hypot((p[0] + q[0]) / 2 - x, (p[1] + q[1]) / 2 - y)
        if (d < best.d) best = { d, a: Math.atan2(q[0] - p[0], q[1] - p[1]) }
      }
      // The frame's front is square to the wall, along the road through the gate.
      const G = new Frame(b, x, y, best.a + Math.PI / 2, ground)
      G.box(-7.5, -2.4, -4.5, 4.5, -6, 11, C.stone)
      G.box(2.4, 7.5, -4.5, 4.5, -6, 11, C.stone)
      G.box(-2.4, 2.4, -4.5, 4.5, 7.6, 11, C.stone, C.stone)
      G.arch(-2.4, 2.4, -4.5, 9, 5.2, 7.6, 7.6, C.stone, C.aqueductShade)
      G.box(-7.9, 7.9, -4.9, 4.9, 11, 11.6, C.stone)
      G.roof(-7.9, 7.9, -4.9, 4.9, 11.6, {
        along: 'u',
        tiles: C.roof,
        pitch: 0.3,
        seed: 0.9,
      })
    }

    // The generated city (pipeline city.ts): plain stucco in a narrow range under one
    // terracotta, varied a little lot by lot. A building on the site of a later
    // monument goes when it comes.
    b.occludes = true
    const nF = meta.fabricCount
    const shade = (c: THREE.Color, k: number, r: () => number) =>
      c.clone().multiplyScalar(1 - k + r() * k * 2)
    for (let i = 0; i < nF; i++) {
      const v = f.subarray(i * FABRIC_STRIDE, (i + 1) * FABRIC_STRIDE)
      const q: Pt[] = [0, 2, 4, 6].map((k) => [v[k], v[k + 1]])
      const [h, ground, until, kind, roof, tone] = [v[8], v[9], v[10], v[11], v[12], v[13]]
      // One building's lots share its render and its roof's weathering (`tone`).
      const own = mulberry32(Math.floor(tone * 1000) + 7)
      const wall =
        kind === LOT.house
          ? shade(C.house, 0.03, own)
          : kind === LOT.warehouse
            ? shade(C.warehouse, 0.03, own)
            : C.stucco[Math.floor(own() * C.stucco.length)]
      b.dates = [ALWAYS[0], until, 1, 0]
      const tiles =
        roof === ROOF.flat ? shade(C.terrace, 0.04, own) : weathered(C.roof, own)
      // The lot's kind and its building's seed for its doors and windows, for the shader.
      b.look = kind + Math.floor(tone * 900) / 1000
      b.lot(q, h, ground, wall, tiles, roof)
    }
    b.dates = ALWAYS
    // Trees: cypresses and holm oaks, with an umbrella pine here and there. The pine
    // skyline that says "Rome" now is mostly later planting.
    for (let i = 0; i < meta.treeCount; i++) {
      const [x, y, r, ground] = f.subarray(
        nF * FABRIC_STRIDE + i * 4,
        nF * FABRIC_STRIDE + i * 4 + 4,
      )
      const t = rand()
      const col = C.tree[Math.floor(rand() * C.tree.length)]
      if (t < 0.45) b.cypress(x, y, r, ground, C.cypress)
      else if (t < 0.85) b.oak(x, y, r, ground, col)
      else b.pine(x, y, r, ground, col)
    }

    // The Forum's square, in the paving of each year: tufa, then travertine.
    for (const sq of meta.squares as {
      ring: Pt[]
      base: number
      paving: { from: number; stone: 'tufa' | 'travertine' }[]
    }[])
      sq.paving.forEach((ph, i) => {
        b.dates = [ph.from, (sq.paving[i + 1]?.from ?? ALWAYS[1] + 1) - 1, 1, 0]
        b.top(
          [ccw(sq.ring, true)],
          0.3,
          sq.base,
          ph.stone === 'tufa' ? C.tufa : C.travertine,
        )
      })
    b.dates = ALWAYS

    this.occlusion = new Occlusion(b.tops)
    this.occlusion.build(modelUniforms.year.value)
    const mesh = new THREE.Mesh(b.geometry(), material(this.occlusion, this.viewM))
    mesh.position.set(ox, oy, 0)
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    // The model's ground reaches round the aqueducts too.
    const reach = [
      ...all,
      ...((meta.aqueducts ?? []) as Aqueduct[]).flatMap((aq) =>
        aq.runs.flatMap((r) => r.pts),
      ),
    ]
    const xs = reach.map((p: number[]) => p[0])
    const ys = reach.map((p: number[]) => p[1])
    this.extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    this.origin = [ox, oy]
    this.waterLevel = meta.waterLevel

    // The sun casts; the shadow camera is fitted to the view (`fit`).
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.6
    this.sun.shadow.radius = 3
    this.group.add(this.sun, this.sun.target, this.sky)
    this.group.visible = false
    this.loaded = true
  }

  /**
   * The model's ground: a mesh over the smoothed relief, a little above the terrain
   * laid on the same heights, that draws nothing but the model's shadows.
   */
  buildGround(g: Ground) {
    if (!this.loaded) return
    const [ex0, ey0, ex1, ey1] = this.extent
    const [x0, y0] = [ex0 - GROUND_PAD_M, ey0 - GROUND_PAD_M]
    const nx = Math.ceil((ex1 - ex0 + 2 * GROUND_PAD_M) / GROUND_STEP_M) + 1
    const ny = Math.ceil((ey1 - ey0 + 2 * GROUND_PAD_M) / GROUND_STEP_M) + 1
    const heightAt = (x: number, y: number) => {
      const fx = (x - g.x0) / g.texel - 0.5
      const fy = (g.y1 - y) / g.texel - 0.5
      const i = Math.max(0, Math.min(g.width - 2, Math.floor(fx)))
      const j = Math.max(0, Math.min(g.height - 2, Math.floor(fy)))
      const [u, v] = [Math.min(1, Math.max(0, fx - i)), Math.min(1, Math.max(0, fy - j))]
      const h = (a: number, b: number) => g.heights[b * g.width + a]
      return (
        (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) +
        (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
      )
    }
    this.ground = (x, y) => Math.max(this.waterLevel, heightAt(x, y))
    const vex = terrainUniforms.verticalExaggeration.value
    const pos = new Float32Array(nx * ny * 3)
    const nrm = new Float32Array(nx * ny * 3)
    const [ox, oy] = this.origin
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * GROUND_STEP_M
        const y = y0 + j * GROUND_STEP_M
        const k = (j * nx + i) * 3
        pos[k] = x - ox
        pos[k + 1] = y - oy
        // The river lies flat at its surface: its cut bed would catch the light.
        const z = heightAt(x, y)
        const wet = z < this.waterLevel
        pos[k + 2] = wet ? this.waterLevel : z
        const gx = (heightAt(x + 5, y) - heightAt(x - 5, y)) * vex
        const gy = (heightAt(x, y + 5) - heightAt(x, y - 5)) * vex
        const n = wet
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(-gx, -gy, 10).normalize()
        nrm.set([n.x, n.y, n.z], k)
      }
    const index: number[] = []
    for (let j = 0; j + 1 < ny; j++)
      for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i
        index.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx)
      }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    geom.setIndex(index)
    // Only the shadows: the terrain's own ground shows through it.
    const mat = new THREE.ShadowNodeMaterial({ color: '#2E2618' })
    mat.positionNode = vec3(
      positionLocal.x,
      positionLocal.y,
      positionLocal.z.mul(terrainUniforms.verticalExaggeration).add(0.25),
    )
    const pxM = fwidth(positionWorld.x)
    // Faded out before the terrain rises back to its own heights; the terrain draws
    // the model's baked shadows beyond.
    mat.opacityNode = float(0.5)
      .mul(groundMeshFade(positionWorld.x, positionWorld.y))
      .mul(plateMask(positionWorld.x, positionWorld.y, pxM))
    mat.depthWrite = false
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(ox, oy, 0)
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    this.group.add(mesh)

    // The streets and courtyards in the shade of the houses round them (`Occlusion`):
    // the same ground, darkened where it sees less of the sky.
    if (!this.occlusion) return
    // Over the city only: the same ground's points, fewer of its cells.
    const [bx0, by0, bx1, by1] = this.occlusion.bounds
    const [i0, i1] = [
      Math.max(0, Math.floor((bx0 - x0) / GROUND_STEP_M)),
      Math.min(nx - 1, Math.ceil((bx1 - x0) / GROUND_STEP_M)),
    ]
    const [j0, j1] = [
      Math.max(0, Math.floor((by0 - y0) / GROUND_STEP_M)),
      Math.min(ny - 1, Math.ceil((by1 - y0) / GROUND_STEP_M)),
    ]
    const cityIndex: number[] = []
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const a = j * nx + i
        cityIndex.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx)
      }
    const city = new THREE.BufferGeometry()
    city.setAttribute('position', geom.getAttribute('position'))
    city.setIndex(cityIndex)
    const dim = new THREE.MeshBasicNodeMaterial({ color: '#2E2618', transparent: true })
    dim.positionNode = mat.positionNode
    // Mostly the narrow streets and the feet of walls; open courtyards only a little.
    const shut = float(1).sub(
      this.occlusion.at(positionWorld.x, positionWorld.y, float(0), 0.3, 0.1),
    )
    dim.opacityNode = shut
      .mul(0.7)
      .mul(modelUniforms.grow)
      .mul(groundMeshFade(positionWorld.x, positionWorld.y))
      .mul(plateMask(positionWorld.x, positionWorld.y, pxM))
    dim.depthWrite = false
    const shade = new THREE.Mesh(city, dim)
    shade.position.set(ox, oy, 0)
    shade.frustumCulled = false
    shade.renderOrder = 4
    this.group.add(shade)
  }

  /**
   * Where a monument's marker and name hang (labels/PlaceLayer.ts `Anchor`): on the
   * model's ground, lifted to the top of its building while the model stands — or,
   * where its building is not drawn, of the roofs round it. Null outside the model.
   */
  anchor(x: number, y: number) {
    if (!this.ground || !this.occlusion) return null
    return { ground: this.ground(x, y), lift: this.occlusion.topNear(x, y, ANCHOR_REACH_M) }
  }

  /**
   * Shows a year: the buildings of that year stand, and the shading of the ones round
   * them is built again for it, a moment after the year stops changing.
   */
  setYear(year: number) {
    modelUniforms.year.value = year
    if (!this.occlusion) return
    clearTimeout(this.occlusionTimer)
    this.occlusionTimer = window.setTimeout(() => {
      if (this.occlusion?.build(year)) {
        this.occlusionBuilt = true
        this.onShaded?.()
      }
    }, 150)
  }

  /**
   * Fits the sun's shadow to what the camera sees round `target` (plane metres), so
   * its texels stay near a metre however close the view; called per frame while the
   * model shows.
   */
  fit(target: THREE.Vector3, viewM: number) {
    this.viewM.value = viewM
    const half = Math.min(3200, Math.max(250, viewM * 0.75))
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -half
    cam.right = cam.top = half
    cam.near = 10
    cam.far = 8000
    cam.updateProjectionMatrix()
    this.sun.target.position.set(target.x, target.y, 0)
    this.sun.position.set(target.x + SUN.x * 3000, target.y + SUN.y * 3000, SUN.z * 3000)
    this.sun.target.updateMatrixWorld()
  }

  /** Called per frame with the scale; true while the city is rising or sinking. */
  update(mpp: number) {
    if (!this.loaded) return false
    const [flat, full] = MODEL_MPP
    const t = Math.min(1, Math.max(0, (flat - mpp) / (flat - full)))
    const grow = t * t * (3 - 2 * t)
    const changed = grow !== modelUniforms.grow.value || this.occlusionBuilt
    this.occlusionBuilt = false
    modelUniforms.grow.value = grow
    this.group.visible = grow > 0.001
    return changed
  }

  /**
   * One known building, raised by its type. Temples stand on a podium with steps at
   * the front, a colonnade round the cella under an entablature and a pedimented
   * roof, facing `faces`; a round shrine is a ring of columns under a cone; a
   * basilica a colonnade under a raised clerestory; a forum a paved court inside
   * porticoes. The proportions are the types' (Vitruvius' rules of thumb), not
   * measurements of these buildings.
   */
  private monument(b: Builder, m: Monument, year: number) {
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
    for (const h of holes)
      b.walls(ccw(h, true), podium > 0 ? podium : -6, body, base, b.face)
    b.top(rings, body, base, m.roof === 'flat' ? b.shade : C.roofTemple)
  }
}

type F = THREE.Node<'float'>

/** 1 inside [a, b], 0 outside, with edges a pixel `px` soft. */
function band(v: F, a: F | number, b: F | number, px: F) {
  const [lo, hi] = [
    typeof a === 'number' ? float(a) : a,
    typeof b === 'number' ? float(b) : b,
  ]
  return smoothstep(lo.sub(px), lo.add(px), v).mul(
    float(1).sub(smoothstep(hi.sub(px), hi.add(px), v)),
  )
}

/**
 * The walls of the generated houses, painted on (`SKIN`), after the street fronts of
 * Pompeii and Herculaneum (Wallace-Hadrill 1994; Ellis 2018; DESIGN.md §7.7): on the
 * street front a ground floor of shops, each a single room open to the street across
 * most of its width (the flats'), or a house's door with shops either side of it;
 * small windows on the floors above, few on a house's front, which looked in on its
 * atrium; a darker dado of plaster along the foot of the wall; and the shade of the
 * eaves along the top. Illustrative, not of any known building: where the doors and
 * windows fall is generated. Returns what the wall's colour is multiplied by, and
 * fades to its average as the pattern gets too fine to draw.
 */
function wallPaint(surface: F, kind: F, seed: F, along: F, len: F, top: F, up: F) {
  const px = max(fwidth(along), fwidth(up)).max(0.02)
  // Each drawn while it is a few pixels across: windows close in, shops further out.
  const detail = float(1).sub(smoothstep(0.12, 0.45, px))
  const broad = float(1).sub(smoothstep(0.4, 1.2, px))
  const id = floor(seed.mul(1000))
  const front = step(0.5, surface).mul(step(surface, 1.5))
  const flats = step(kind, 0.5)
  const house = step(0.5, kind).mul(step(kind, 1.5))
  const store = step(1.5, kind).mul(step(kind, 2.5))
  const inside = band(along, 0.5, len.sub(0.5), px)
  // Shops: bays of 3–4 m along the front, most of them open.
  const bayW = len.div(max(float(1), floor(len.div(seed.mul(0.9).add(3.2)))))
  const bay = floor(along.div(bayW))
  const inBay = along.sub(bay.mul(bayW))
  const open = step(0.25, hash(id.add(bay.mul(7)).add(1)))
  const shop = band(inBay, 0.45, bayW.sub(0.45), px)
    .mul(band(up, 0.15, 2.7, px))
    .mul(open)
  // A house's door in the middle of its front, with shops either side of a wide front.
  const door = band(along, len.mul(0.5).sub(0.75), len.mul(0.5).add(0.75), px).mul(
    band(up, 0, 2.9, px),
  )
  const houseShops = shop
    .mul(step(12, len))
    .mul(float(1).sub(band(along, len.mul(0.5).sub(3), len.mul(0.5).add(3), px)))
  // A warehouse's wide door.
  const gate = band(along, len.mul(0.5).sub(1.6), len.mul(0.5).add(1.6), px).mul(
    band(up, 0, 3.4, px),
  )
  const ground = front.mul(
    flats
      .mul(shop)
      .add(house.mul(max(door, houseShops)))
      .add(store.mul(gate)),
  )
  // Windows: storeys over the tall ground floor (city.ts), one every 2.4–3 m.
  const sz = up.sub(3.8)
  const storey = floor(sz.div(3))
  const inStorey = sz.sub(storey.mul(3))
  const winW = seed.mul(0.6).add(2.4)
  const col = floor(along.div(winW))
  const inCol = along.sub(col.mul(winW))
  const keep = select(
    front.greaterThan(0.5),
    select(house.greaterThan(0.5), float(0.8), float(0.3)),
    float(0.65),
  )
  const win = band(inCol, winW.mul(0.5).sub(0.38), winW.mul(0.5).add(0.38), px)
    .mul(band(inStorey, 0.95, store.greaterThan(0.5).select(1.5, 2.0), px))
    .mul(step(0, sz))
    .mul(step(up, top.sub(0.7)))
    .mul(step(keep, hash(id.add(col.mul(13)).add(storey.mul(101)).add(surface.mul(7)))))
  const dark = max(ground.mul(broad), win.mul(detail)).mul(inside)
  // The dado, a warmer, darker plaster to about a metre; now and then painted red.
  const red = step(0.6, hash(id.add(3)))
  const dadoCol = mix(vec3(0.9, 0.88, 0.85), vec3(0.86, 0.72, 0.64), red)
  const dado = float(1).sub(smoothstep(float(0.95).sub(px), float(0.95).add(px), up))
  // The shade under the eaves, only below them (not on a gable).
  const eaves = smoothstep(top.sub(0.9), top.sub(0.05), up).mul(step(up, top.add(0.05)))
  return mix(vec3(1), dadoCol, dado.mul(mix(0.5, 1, broad)))
    .mul(mix(float(1), float(0.3), dark))
    .mul(mix(float(1), float(0.8), eaves))
    .mul(mix(float(0.95), float(1), broad))
}

/**
 * The tiled roofs, painted on — Rome was roofed with tiles, not shingles, from the war
 * with Pyrrhus (Pliny, Natural History 16.36): the rows of round cover tiles over the
 * joints of the flat ones, running down the slope about half a metre apart, each lit
 * on one side and shaded on the other; tiles a little lighter or darker one by one,
 * as a roof is patched; the ridge tiles along the top and the shade of the eaves'
 * edge. The spacing is illustrative (flat tiles vary, roughly 0.3–0.5 m wide). Fades
 * to the plain roof as it gets too fine to draw.
 */
function roofPaint(seed: F, across: F, down: F, run: F) {
  const px = max(fwidth(across), fwidth(down)).max(0.01)
  const rows = float(1).sub(smoothstep(0.08, 0.3, px))
  const tiles = float(1).sub(smoothstep(0.15, 0.6, px))
  const lines = float(1).sub(smoothstep(0.12, 0.5, px))
  const v = fract(across.div(0.48))
  // The cover tile over each joint: lit, then in its own shade, then the flat tile.
  const cover = smoothstep(0.0, 0.12, v).mul(float(1).sub(smoothstep(0.18, 0.3, v)))
  const shade = smoothstep(0.3, 0.36, v).mul(float(1).sub(smoothstep(0.4, 0.5, v)))
  const row = float(1).add(cover.mul(0.08)).sub(shade.mul(0.16))
  const cell = floor(across.div(0.48))
    .mul(17)
    .add(floor(down.div(0.45)).mul(131))
    .add(floor(seed.mul(1000)).mul(7919))
  const patch = float(1).add(hash(cell.abs()).sub(0.5).mul(0.07))
  const ridge = float(1).sub(smoothstep(0.2, 0.35, down))
  const eave = smoothstep(run.sub(0.3), run.sub(0.1), down)
  return mix(float(1), row, rows)
    .mul(mix(float(1), patch, tiles))
    .mul(mix(float(1), float(0.82), ridge.mul(lines)))
    .mul(mix(float(1), float(0.78), eave.mul(lines)))
}

function material(occlusion: Occlusion, viewM: F) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  // Built by hand, the geometry's winding is not consistent: both faces are drawn,
  // and three turns each face's normal towards the eye.
  mat.side = THREE.DoubleSide
  const vex = terrainUniforms.verticalExaggeration
  const ground = attribute('ground', 'float')
  const up = positionLocal.z
  const years = attribute('years', 'vec4')
  const y = modelUniforms.year
  const stands = y.greaterThanEqual(years.x).and(y.lessThanEqual(years.y))
  const unfinished = y.greaterThanEqual(years.z).and(y.lessThanEqual(years.w))
  // Not standing this year: sunk well under the ground, where the terrain hides it.
  const scale = select(stands, float(1), float(0))
  const sink = select(stands, float(0), float(40))
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    ground.add(up.mul(modelUniforms.grow).mul(scale)).sub(sink).mul(vex),
  )
  // Heights over the ground as built, before the model rises.
  const built = positionGeometry.z
  // Part-built (`Builder.finish`): works in progress, or a shell left by fire, are
  // cut off at the height they had reached — open to the sky, as a building going up
  // or burnt out is — and a burnt one is blackened towards its top.
  const part = attribute('part', 'vec2')
  const cut = select(unfinished, part.x, float(1e5))
  mat.maskNode = built.lessThanEqual(cut)
  const soot = select(
    unfinished.and(part.y.greaterThan(0.5)),
    mix(float(0.8), float(0.45), smoothstep(0, part.x.max(1), built)),
    float(1),
  )
  // Where a wall meets the ground it darkens, as a model's does; and wherever the
  // model overshadows itself, less of the sky's light reaches.
  const foot = mix(float(0.85), float(1), smoothstep(0, 3, built))
  const open = occlusion.at(positionWorld.x, positionWorld.y, built)
  mat.aoNode = open
  // The houses' walls and roofs, painted (`SKIN`).
  const skin = attribute('skin', 'vec4')
  const surface = floor(skin.x.div(10))
  const rest = skin.x.sub(surface.mul(10))
  const kind = floor(rest)
  const seed = fract(rest).div(0.9)
  const paint = select(
    surface.greaterThan(2.5),
    vec3(roofPaint(seed, skin.y, skin.z, skin.w)),
    select(
      surface.greaterThan(0.5),
      wallPaint(surface, kind, seed, skin.y, skin.z, skin.w, built),
      vec3(1),
    ),
  )
  // The relief under the city, washed over it at half strength, so the hills read
  // from above while the buildings keep their own colour and their real shadows
  // show the slopes.
  const wash = mix(float(1), reliefWash(positionWorld.x, positionWorld.y), 0.5)
  const lit = attribute('colour', 'vec3')
    .mul(paint)
    .mul(foot)
    .mul(mix(float(1), open, 0.5))
    .mul(wash)
    .mul(soot)
  // A little haze with distance, as over a real city: what is far off is paler and
  // flatter, so the near streets stand out from the roofs behind them.
  const far = smoothstep(1.2, 3.5, cameraPosition.sub(positionWorld).length().div(viewM))
  mat.colorNode = mix(lit, vec3(HAZE.r, HAZE.g, HAZE.b), far.mul(0.25))
  // Whatever runs out to the edge of the modelled ground (an aqueduct across the
  // Campagna) fades out with it, dithered, rather than stopping in a cut.
  mat.opacityNode = plateMask(positionWorld.x, positionWorld.y, fwidth(positionWorld.x))
  mat.alphaHash = true
  return mat
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
