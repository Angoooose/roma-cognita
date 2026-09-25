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

/** Years that span everything: the generated city, the wall, the trees. */
const ALWAYS = [-100000, 100000, 1, 0]

/** Floats per generated building in model.bin, its kinds and roofs (pipeline city.ts `LOT_KIND`, `ROOF`). */
const FABRIC_STRIDE = 14
const LOT = { flats: 0, house: 1, warehouse: 2, suburb: 3 }
const ROOF = { along: 0, across: 1, flat: 2, lean: 3 }
/** What the distance fades the model towards: the warm, pale air of a summer day. */
const HAZE = new THREE.Color('#DCCFB8')
/** What the shader paints on a face (`Builder.look`, `skin` in `material`). */
const SKIN = { none: 0, front: 1, wall: 2, roof: 3 }

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

/**
 * What the known buildings are faced with, as the records' sources say (model.ts
 * `STONE_OF`): `face` in the light, `shade` for the cella behind a colonnade.
 * - `stucco`: tufa or peperino rendered in white stucco, the Republic's usual finish,
 *   warm and a little soft;
 * - `marble`: white marble, cooler and brighter — rare until Augustus;
 * - `travertine`: the creamy limestone left bare.
 */
export const STONE = {
  stucco: { face: new THREE.Color('#E9DDC6'), shade: new THREE.Color('#D3C5AA') },
  marble: { face: new THREE.Color('#F7F5F0'), shade: new THREE.Color('#E4E0D8') },
  travertine: { face: new THREE.Color('#E3D6B8'), shade: new THREE.Color('#CDBF9F') },
}
export type Stone = keyof typeof STONE

/** The model's colours for its legend, as hex: the stones, and the generated houses. */
export const MODEL_KEY = {
  marble: `#${STONE.marble.face.getHexString()}`,
  stucco: `#${STONE.stucco.face.getHexString()}`,
  travertine: `#${STONE.travertine.face.getHexString()}`,
  house: '#DED3BE',
  roof: '#B8957F',
}

const C = {
  travertine: STONE.travertine.face,
  /**
   * The aqueducts, in the stones Ashby records for the Marcia's arcade (1935, pp.
   * 131–139): piers of reddish grey-brown tufa, spandrels of yellow tufa, voussoirs,
   * imposts and string-courses of grey peperino, its channel of dark red tufa; the
   * later channels on it in paler reticulate.
   */
  aqueduct: new THREE.Color('#B8A386'),
  tufaPier: new THREE.Color('#B39B80'),
  tufaYellow: new THREE.Color('#CDB88E'),
  peperino: new THREE.Color('#A8A399'),
  marciaChannel: new THREE.Color('#AE8C76'),
  aqueductShade: new THREE.Color('#8F8472'),
  /** A channel added on an older arcade: paler reticulate. */
  aqueductLater: new THREE.Color('#C3B8A4'),
  aqueductCap: new THREE.Color('#CFC6B3'),
  /** A shaft's grassed spoil heap: the ground's own green, a shade lighter. */
  mound: new THREE.Color('#9A9A62'),
  /** The earth banked over an aqueduct's channel where it goes into the ground. */
  earthBank: new THREE.Color('#8E8A5C'),
  earthBankShade: new THREE.Color('#7D7950'),
  /** Monte Verde tufa paving: a warm grey-brown. */
  tufa: new THREE.Color('#C7B597'),
  /** A theatre's seating: a warmer, darker stone than its walls. */
  seating: new THREE.Color('#CDBB98'),
  sand: new THREE.Color('#DCCBA6'),
  roofTemple: new THREE.Color('#C98B6C'),
  /**
   * The generated houses' walls and roofs: plainer and more muted than the known
   * buildings, so the eye reads them as the backdrop they are (DESIGN.md §7.7).
   */
  stucco: [
    new THREE.Color('#E3D9C6'),
    new THREE.Color('#DED2BC'),
    new THREE.Color('#E6DFD0'),
    new THREE.Color('#DACDB4'),
    // Ochre and red washes, a few.
    new THREE.Color('#DBC29C'),
    new THREE.Color('#D6B79A'),
  ],
  /** A flat roof terrace: tiled or trodden mortar, greyer than the roofs. */
  terrace: new THREE.Color('#BFA894'),
  /** One terracotta for the generated roofs, varied a little lot by lot. */
  roof: new THREE.Color('#B8927D'),
  /** Atrium houses: a warmer, paler render. */
  house: new THREE.Color('#E6D9C2'),
  /** Warehouses: bare tufa. */
  warehouse: new THREE.Color('#CFC1A2'),
  stone: new THREE.Color('#D2C4AA'),
  stoneLight: new THREE.Color('#DCD1BD'),
  tree: [
    new THREE.Color('#6F8052'),
    new THREE.Color('#62734A'),
    new THREE.Color('#7C8B5C'),
  ],
  cypress: new THREE.Color('#4F6040'),
  trunk: new THREE.Color('#7A6450'),
  paving: new THREE.Color('#E9E1D0'),
}

type Pt = [number, number]

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
  /** The point it faces: a temple's front is the end nearer it. */
  faces: Pt
  /** What it was faced with, from the year given; stucco when not recorded. */
  stone?: { from: number; stone: Stone }[]
}

type OBB = ReturnType<typeof orientedBox>

/** The depth of an arch's ring of voussoirs, and of the string-course under a channel, metres (Ashby 1935, p. 131). */
/** A shaft's spoil heap: its radius and height, metres, and how far from the masonry they fade out. */
const MOUND_R_M = 4
const MOUND_H_M = 0.9
const MOUND_FADE_M = 260

const VOUSSOIR_M = 0.65
const STRING_M = 0.35

/** An arcade's proportions, metres (pipeline aqueducts.ts `ARCADE`). */
interface ArcadeSize {
  span: number
  pier: number
  width: number
  /** The band of voussoirs and masonry between the crown of an arch and the channel. */
  band: number
}

/**
 * An aqueduct as the pipeline laid it out (model.ts): its channels, bottom to top,
 * each with its own years; and its course in runs — piers of an arcade, a solid
 * wall, or shafts over an underground channel — as points of x, y, ground and the
 * underside of the lowest channel.
 */
interface Aqueduct {
  id: string
  size: ArcadeSize
  channels: {
    id: string
    h: number
    years: [number, number]
    unfinished: [number, number] | null
  }[]
  runs: { kind: 'arcade' | 'wall' | 'shafts'; pts: number[][] }[]
}

/** A mesh in the making: triangles with a base, a height above it, a normal and a colour. */
class Builder {
  pos: number[] = []
  base: number[] = []
  years: number[] = []
  /** The years of what is being built now: from, to, and a span part-built (from > to for none). */
  dates = ALWAYS
  /** The stone of what is being built now, in the light and in shade (`STONE`). */
  face = STONE.stucco.face
  shade = STONE.stucco.shade
  normal: number[] = []
  colour: number[] = []
  /**
   * What a face is painted with in the shader (`skin` in `material`): its surface —
   * none, a building's front, its other walls, or tiled roof — the lot's kind and a
   * seed for it. A point's 4th to 6th values are its coordinates on that surface.
   */
  skin: number[] = []
  look = 0
  /** Whether what is being built now overshadows its neighbours (`Occlusion`). */
  occludes = true
  /** The tops of what overshadows: triangles as x, y, height over the ground ×3, then its years. */
  tops: number[] = []
  private ox: number
  private oy: number
  constructor(ox: number, oy: number) {
    this.ox = ox
    this.oy = oy
  }

  /** One triangle; points are [x, y, z above base], and the normal is its own. */
  tri(a: number[], b: number[], c: number[], base: number, col: THREE.Color) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    n = n.map((q) => q / l)
    for (const p of [a, b, c]) {
      this.pos.push(p[0] - this.ox, p[1] - this.oy, p[2])
      this.base.push(base)
      this.years.push(...this.dates)
      this.normal.push(n[0], n[1], n[2])
      this.colour.push(col.r, col.g, col.b)
      this.skin.push(this.look, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0)
    }
    if (this.occludes && Math.abs(n[2]) > 0.3)
      this.tops.push(
        a[0],
        a[1],
        a[2],
        b[0],
        b[1],
        b[2],
        c[0],
        c[1],
        c[2],
        this.dates[0],
        this.dates[1],
      )
  }

  quad(a: number[], b: number[], c: number[], d: number[], base: number, col: THREE.Color) {
    this.tri(a, b, c, base, col)
    this.tri(a, c, d, base, col)
  }

  /** Vertical walls round a ring, from z0 to z1 (outward-facing for a CCW ring). */
  walls(
    ring: Pt[],
    z0: number,
    z1: number,
    base: number,
    col: THREE.Color,
    heights?: number[],
  ) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i], ring[i + 1]]
      const [ha, hb] = heights ? [heights[i], heights[i + 1]] : [z1, z1]
      this.quad(
        [a[0], a[1], z0],
        [b[0], b[1], z0],
        [b[0], b[1], hb],
        [a[0], a[1], ha],
        base,
        col,
      )
    }
  }

  /** A flat or height-shaped top over rings (outer first, then holes). */
  top(rings: Pt[][], z: number | ((p: Pt) => number), base: number, col: THREE.Color) {
    const outer = rings[0].slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
    const holes = rings
      .slice(1)
      .map((r) => r.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)))
    const all = [...outer, ...holes.flat()]
    const zAt = (p: THREE.Vector2) => (typeof z === 'number' ? z : z([p.x, p.y]))
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const [a, b, c] = [all[i], all[j], all[k]]
      // Wound to face up.
      const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
      const pts = [a, up ? b : c, up ? c : b].map((p) => [p.x, p.y, zAt(p)])
      this.tri(pts[0], pts[1], pts[2], base, col)
    }
  }

  /** A box on an oriented rectangle with a gable or hipped roof, or none. */
  block(
    cx: number,
    cy: number,
    angle: number,
    w: number,
    d: number,
    z0: number,
    h: number,
    roof: 'gable' | 'hip' | 'flat',
    base: number,
    wall: THREE.Color,
    top: THREE.Color,
    eave = 0,
    pitchK = 0.27,
  ) {
    const [c, s] = [Math.cos(angle), Math.sin(angle)]
    const at = (x: number, y: number, z: number) => [
      cx + x * c - y * s,
      cy + x * s + y * c,
      z,
    ]
    let [hw, hd] = [w / 2, d / 2]
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ]
    for (let i = 0; i < 4; i++) {
      const [a, b] = [corners[i], corners[(i + 1) % 4]]
      this.quad(
        at(a[0], a[1], z0),
        at(b[0], b[1], z0),
        at(b[0], b[1], h),
        at(a[0], a[1], h),
        base,
        wall,
      )
    }
    // The ridge runs along the longer side, as a Roman roof's does; the roof
    // overhangs the walls by `eave`.
    const pitch = Math.min(w, d) * pitchK
    const along = d >= w
    if (roof === 'flat') {
      this.quad(at(-hw, -hd, h), at(hw, -hd, h), at(hw, hd, h), at(-hw, hd, h), base, top)
      return
    }
    hw += eave
    hd += eave
    const r = h + pitch
    const e = roof === 'hip' ? Math.min(w, d) / 2 : 0
    if (along) {
      const [r0, r1] = [at(0, -hd + e, r), at(0, hd - e, r)]
      this.quad(at(-hw, -hd, h), at(-hw, hd, h), r1, r0, base, top)
      this.quad(at(hw, hd, h), at(hw, -hd, h), r0, r1, base, top)
      this.tri(at(hw, -hd, h), at(-hw, -hd, h), r0, base, roof === 'hip' ? top : wall)
      this.tri(at(-hw, hd, h), at(hw, hd, h), r1, base, roof === 'hip' ? top : wall)
    } else {
      const [r0, r1] = [at(-hw + e, 0, r), at(hw - e, 0, r)]
      this.quad(at(hw, -hd, h), at(-hw, -hd, h), r0, r1, base, top)
      this.quad(at(-hw, hd, h), at(hw, hd, h), r1, r0, base, top)
      this.tri(at(-hw, -hd, h), at(-hw, hd, h), r0, base, roof === 'hip' ? top : wall)
      this.tri(at(hw, hd, h), at(hw, -hd, h), r1, base, roof === 'hip' ? top : wall)
    }
  }

  /** An n-sided upright prism: a column, a drum, a round podium. */
  prism(
    cx: number,
    cy: number,
    r: number,
    z0: number,
    z1: number,
    sides: number,
    base: number,
    col: THREE.Color,
    cap = true,
  ) {
    const ring: Pt[] = []
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2
      ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    this.walls(ring, z0, z1, base, col)
    if (cap)
      for (let k = 0; k < sides; k++)
        this.tri(
          [cx, cy, z1],
          [ring[k][0], ring[k][1], z1],
          [ring[k + 1][0], ring[k + 1][1], z1],
          base,
          col,
        )
  }

  /** A cone over a circle: a round temple's roof. */
  cone(
    cx: number,
    cy: number,
    r: number,
    z0: number,
    h: number,
    sides: number,
    base: number,
    col: THREE.Color,
  ) {
    for (let k = 0; k < sides; k++) {
      const [a0, a1] = [(k / sides) * Math.PI * 2, ((k + 1) / sides) * Math.PI * 2]
      this.tri(
        [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0],
        [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0],
        [cx, cy, z0 + h],
        base,
        col,
      )
    }
  }

  /** A column: an eight-sided shaft with a square block for its capital. */
  column(x: number, y: number, r: number, z0: number, z1: number, base: number) {
    this.prism(x, y, r, z0, z1 - r * 0.6, 8, base, this.face, false)
    this.block(
      x,
      y,
      0,
      r * 2.6,
      r * 2.6,
      z1 - r * 0.6,
      z1,
      'flat',
      base,
      this.face,
      this.face,
    )
  }

  /**
   * A temple on its oriented rectangle, facing `faces`: a podium with steps across
   * the front, columns round the cella (only across the porch on a small temple),
   * an entablature, and a low-pitched tiled roof with a pediment at each end.
   */
  temple(obb: OBB, faces: Pt, podium: number, body: number, base: number) {
    const long: Pt = [-Math.sin(obb.angle), Math.cos(obb.angle)]
    const side: Pt = [Math.cos(obb.angle), Math.sin(obb.angle)]
    const front =
      Math.sign((faces[0] - obb.cx) * long[0] + (faces[1] - obb.cy) * long[1]) || 1
    const at = (u: number, v: number): Pt => [
      obb.cx + side[0] * u + long[0] * v,
      obb.cy + side[1] * u + long[1] * v,
    ]
    const [W, L] = [obb.short, obb.long]
    this.block(
      obb.cx,
      obb.cy,
      obb.angle,
      W,
      L,
      -6,
      podium,
      'flat',
      base,
      this.face,
      this.face,
    )
    // Steps: three flights across the front, each lower and further out.
    for (let k = 0; k < 3; k++) {
      const depth = 2.2
      const [sx, sy] = at(0, front * (L / 2 + depth * (k + 0.5)))
      this.block(
        sx,
        sy,
        obb.angle,
        W * 0.62,
        depth,
        -6,
        podium * (1 - (k + 1) / 4),
        'flat',
        base,
        this.face,
        this.face,
      )
    }
    const H = body * 0.78
    const small = W < 16
    const [iw, il] = [W - 2.4, L - 2.4]
    const nW = Math.max(4, Math.round(iw / 3.8) + 1)
    const nL = Math.max(3, Math.round(il / 3.8) + 1)
    const r = Math.min(0.95, Math.max(0.45, iw / nW / 3.4))
    const cols: Pt[] = []
    for (let i = 0; i < nW; i++) {
      const u = -iw / 2 + (iw * i) / (nW - 1)
      cols.push(at(u, (front * il) / 2))
      if (!small) cols.push(at(u, (-front * il) / 2))
    }
    const porch = small ? 2 : nL
    for (let j = 1; j < porch - (small ? 0 : 1); j++) {
      const v = front * (il / 2 - (il * j) / (nL - 1))
      cols.push(at(-iw / 2, v), at(iw / 2, v))
    }
    for (const [x, y] of cols) this.column(x, y, r, podium, podium + H, base)
    // The cella behind the columns, set back from the porch.
    const cellaL = small ? L * 0.62 : L * 0.66
    const [cx, cy] = at(0, -front * (L - cellaL) * 0.35)
    this.block(
      cx,
      cy,
      obb.angle,
      small ? W - 1.2 : W * 0.62,
      cellaL,
      podium,
      podium + H,
      'flat',
      base,
      this.shade,
      this.shade,
    )
    // Entablature and roof.
    const e = podium + H
    this.block(
      obb.cx,
      obb.cy,
      obb.angle,
      W - 0.6,
      L - 0.6,
      e,
      e + 1.6,
      'flat',
      base,
      this.face,
      this.face,
    )
    this.block(
      obb.cx,
      obb.cy,
      obb.angle,
      W - 0.2,
      L - 0.2,
      e + 1.6,
      e + 1.61,
      'gable',
      base,
      this.face,
      C.roofTemple,
      0.4,
      0.2,
    )
  }

  /** A round temple: a drum podium, a ring of columns round a round cella, a cone roof. */
  tholos(cx: number, cy: number, r: number, podium: number, base: number) {
    this.prism(cx, cy, r, -6, podium, 16, base, this.face)
    const H = Math.max(7, r * 1.1)
    const n = 12
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      this.column(
        cx + Math.cos(a) * (r - 1),
        cy + Math.sin(a) * (r - 1),
        0.45,
        podium,
        podium + H,
        base,
      )
    }
    this.prism(cx, cy, r * 0.6, podium, podium + H, 16, base, this.shade)
    this.prism(cx, cy, r - 0.3, podium + H, podium + H + 1.1, 16, base, this.face)
    this.cone(cx, cy, r + 0.2, podium + H + 1.1, r * 0.55, 16, base, C.roofTemple)
  }

  /**
   * A basilica: a colonnade round the hall under a tiled lean-to, and the nave raised
   * above it as a clerestory under its own low roof.
   */
  basilica(obb: OBB, body: number, base: number) {
    const long: Pt = [-Math.sin(obb.angle), Math.cos(obb.angle)]
    const side: Pt = [Math.cos(obb.angle), Math.sin(obb.angle)]
    const at = (u: number, v: number): Pt => [
      obb.cx + side[0] * u + long[0] * v,
      obb.cy + side[1] * u + long[1] * v,
    ]
    const [W, L] = [obb.short, obb.long]
    const H = body * 0.6
    this.block(obb.cx, obb.cy, obb.angle, W, L, -6, 1.2, 'flat', base, this.face, this.face)
    const [iw, il] = [W - 1.6, L - 1.6]
    const nL = Math.max(4, Math.round(il / 4.2) + 1)
    const nW = Math.max(3, Math.round(iw / 4.2) + 1)
    for (let j = 0; j < nL; j++) {
      const v = -il / 2 + (il * j) / (nL - 1)
      this.column(...at(-iw / 2, v), 0.6, 1.2, 1.2 + H, base)
      this.column(...at(iw / 2, v), 0.6, 1.2, 1.2 + H, base)
    }
    for (let i = 1; i < nW - 1; i++) {
      const u = -iw / 2 + (iw * i) / (nW - 1)
      this.column(...at(u, -il / 2), 0.6, 1.2, 1.2 + H, base)
      this.column(...at(u, il / 2), 0.6, 1.2, 1.2 + H, base)
    }
    // The aisles' roof, and the hall's walls inside the columns.
    this.block(
      obb.cx,
      obb.cy,
      obb.angle,
      W,
      L,
      1.2 + H,
      2.4 + H,
      'hip',
      base,
      this.face,
      C.roofTemple,
      0.4,
      0.12,
    )
    this.block(
      obb.cx,
      obb.cy,
      obb.angle,
      W * 0.55,
      L * 0.86,
      2.4 + H,
      body + 6,
      'gable',
      base,
      this.shade,
      C.roofTemple,
      0.3,
      0.2,
    )
  }

  /** A portico along one edge of a CCW court, on its inside: a back wall, columns, a tiled roof. */
  portico(a: Pt, c: Pt, depth: number, h: number, base: number) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1])
    if (len < 4) return
    const [ux, uy] = [(c[0] - a[0]) / len, (c[1] - a[1]) / len]
    const [nx, ny] = [-uy, ux]
    const angle = Math.atan2(uy, ux) - Math.PI / 2
    this.block(
      (a[0] + c[0]) / 2 + nx * 0.6,
      (a[1] + c[1]) / 2 + ny * 0.6,
      angle,
      1.2,
      len,
      -6,
      h + 1.2,
      'flat',
      base,
      this.shade,
      this.shade,
    )
    const n = Math.max(2, Math.round(len / 4))
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * (len - 2) + 1
      this.column(
        a[0] + ux * t + nx * (depth - 0.8),
        a[1] + uy * t + ny * (depth - 0.8),
        0.5,
        0.4,
        h,
        base,
      )
    }
    this.block(
      (a[0] + c[0]) / 2 + nx * (depth / 2),
      (a[1] + c[1]) / 2 + ny * (depth / 2),
      angle,
      depth,
      len,
      h,
      h + 0.6,
      'flat',
      base,
      this.face,
      C.roofTemple,
    )
  }

  /** An umbrella pine: a thin trunk under a wide, flat crown. */
  pine(x: number, y: number, r: number, base: number, col: THREE.Color) {
    const h = r * 2.4
    this.prism(x, y, 0.35, -1, h, 4, base, C.trunk, false)
    const crown = r * 1.35
    this.prism(x, y, crown, h, h + r * 0.35, 7, base, col)
    this.cone(x, y, crown, h + r * 0.35, r * 0.25, 7, base, col)
    this.cone(x, y, crown, h, -r * 0.2, 7, base, col)
  }

  /**
   * One bay of an aqueduct's arcade, from pier `a` to pier `b` (x, y, ground, the
   * underside of the channel — all metres), as the Marcia's were built (Ashby 1935,
   * pp. 131–139): a semicircular arch springing between the two piers, ringed with
   * voussoirs of grey peperino, its spandrels of yellow tufa up to a peperino
   * string-course under the channel, and its underside in the shade of the vault.
   */
  arch(a: number[], b: number[], d: ArcadeSize, base: number) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < d.pier + 1) return
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const n = [-u[1], u[0]]
    const t = d.width / 2
    const [s0, s1] = [d.pier / 2, L - d.pier / 2]
    const r = (s1 - s0) / 2
    const deck = (s: number) => a[3] + ((b[3] - a[3]) * s) / L - base
    const ground = Math.min(a[2], b[2]) - base
    // The arch's crown sits the voussoirs and a course of masonry below the channel;
    // where the ground is too high for a full semicircle the arch is lower.
    const crown = Math.min(deck(s0), deck(s1)) - d.band
    const spring = Math.max(ground + 0.4, crown - r)
    const rise = crown - spring
    const ring = Math.min(VOUSSOIR_M, d.band * 0.6)
    const at = (s: number, z: number, side: number, proud = 0) => [
      a[0] + u[0] * s + n[0] * (t + proud) * side,
      a[1] + u[1] * s + n[1] * (t + proud) * side,
      z,
    ]
    const N = 12
    const arc = (extra: number) =>
      Array.from({ length: N + 1 }, (_, k) => {
        const ang = Math.PI * (1 - k / N)
        return [
          s0 + r + Math.cos(ang) * (r + extra),
          spring + Math.sin(ang) * (rise + extra),
        ]
      })
    const inner = arc(0)
    const outer = arc(ring)
    const top = (s: number) => deck(Math.min(Math.max(s, 0), L)) - STRING_M
    for (const side of [-1, 1]) {
      for (let k = 0; k < N; k++) {
        const [p, q, P, Q] = [inner[k], inner[k + 1], outer[k], outer[k + 1]]
        // The voussoirs, a hair proud of the face.
        this.quad(
          at(p[0], p[1], side, 0.03),
          at(q[0], q[1], side, 0.03),
          at(Q[0], Q[1], side, 0.03),
          at(P[0], P[1], side, 0.03),
          base,
          C.peperino,
        )
        // The spandrel, from the voussoirs up to the string-course.
        this.quad(
          at(P[0], P[1], side),
          at(Q[0], Q[1], side),
          at(Q[0], top(Q[0]), side),
          at(P[0], top(P[0]), side),
          base,
          C.tufaYellow,
        )
      }
      // The spandrel over the piers' halves, beside the voussoirs.
      this.quad(
        at(0, spring, side),
        at(outer[0][0], spring, side),
        at(outer[0][0], top(outer[0][0]), side),
        at(0, top(0), side),
        base,
        C.tufaYellow,
      )
      this.quad(
        at(outer[N][0], spring, side),
        at(L, spring, side),
        at(L, top(L), side),
        at(outer[N][0], top(outer[N][0]), side),
        base,
        C.tufaYellow,
      )
      // The string-course: a peperino band under the channel, standing a little proud.
      this.quad(
        at(0, deck(0) - STRING_M, side, 0.12),
        at(L, deck(L) - STRING_M, side, 0.12),
        at(L, deck(L), side, 0.12),
        at(0, deck(0), side, 0.12),
        base,
        C.peperino,
      )
    }
    // The underside of the arch, in the shade of its own vault.
    for (let k = 0; k < N; k++) {
      const [p, q] = [inner[k], inner[k + 1]]
      this.quad(
        at(p[0], p[1], -1),
        at(q[0], q[1], -1),
        at(q[0], q[1], 1),
        at(p[0], p[1], 1),
        base,
        C.aqueductShade,
      )
    }
  }

  /** A pier of an arcade at (x, y), of bossed tufa, from below its ground up to where its arches spring. */
  pier(p: number[], u: number[], d: ArcadeSize, top: number) {
    const angle = Math.atan2(u[1], u[0])
    const spring = Math.max(p[2] + 0.4, top - d.band - d.span / 2)
    this.block(
      p[0],
      p[1],
      angle,
      d.pier,
      d.width,
      -3,
      spring - p[2],
      'flat',
      p[2],
      C.tufaPier,
      C.tufaPier,
    )
    // An impost where the arches spring: a peperino band a little proud of the pier.
    if (spring - p[2] > 1.5)
      this.block(
        p[0],
        p[1],
        angle,
        d.pier + 0.25,
        d.width + 0.25,
        spring - p[2] - 0.35,
        spring - p[2],
        'flat',
        p[2],
        C.peperino,
        C.peperino,
      )
  }

  /**
   * An aqueduct's channel on its arcade or wall, from `a` to `b` (x, y, ground, its
   * underside), `h` high: a covered stone conduit, its cover slabs a little proud.
   */
  channel(
    a: number[],
    b: number[],
    width: number,
    z0: number,
    h: number,
    base: number,
    col: THREE.Color,
    cap: THREE.Color,
  ) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.1) return
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const n = [-u[1], u[0]]
    const at = (s: number, side: number, z: number, w: number) => [
      a[0] + u[0] * s + n[0] * w * side,
      a[1] + u[1] * s + n[1] * w * side,
      z,
    ]
    const zA = a[3] - base + z0
    const zB = b[3] - base + z0
    const w = width / 2
    for (const side of [-1, 1])
      this.quad(
        at(0, side, zA, w),
        at(L, side, zB, w),
        at(L, side, zB + h, w),
        at(0, side, zA + h, w),
        base,
        col,
      )
    // The cover slabs, overhanging a hand's breadth.
    const c = w + 0.15
    this.quad(
      at(0, -1, zA + h, c),
      at(L, -1, zB + h, c),
      at(L, 1, zB + h, c),
      at(0, 1, zA + h, c),
      base,
      cap,
    )
    for (const side of [-1, 1])
      this.quad(
        at(0, side, zA + h, c),
        at(L, side, zB + h, c),
        at(L, side, zB + h + 0.25, c),
        at(0, side, zA + h + 0.25, c),
        base,
        cap,
      )
    this.quad(
      at(0, -1, zA + h + 0.25, c),
      at(L, -1, zB + h + 0.25, c),
      at(L, 1, zB + h + 0.25, c),
      at(0, 1, zA + h + 0.25, c),
      base,
      cap,
    )
  }

  /**
   * A bank of earth over an aqueduct's end at `end` (x, y, ground), away from `next`:
   * from the top of its channels, `h` over the ground, sloping down to the ground
   * over twice its height, as a channel is covered where it goes underground.
   */
  bank(end: number[], next: number[], width: number, h: number) {
    const L = Math.hypot(end[0] - next[0], end[1] - next[1]) || 1
    const u = [(end[0] - next[0]) / L, (end[1] - next[1]) / L]
    const n = [-u[1], u[0]]
    const run = Math.max(3, h * 2)
    const w = width / 2
    const at = (s: number, side: number, z: number, spread = 0) => [
      end[0] + u[0] * s + n[0] * (w + spread) * side,
      end[1] + u[1] * s + n[1] * (w + spread) * side,
      z,
    ]
    const g = end[2]
    const top = h
    // The slope, a little wider at its foot, and its two flanks.
    this.quad(
      at(-0.5, -1, top),
      at(-0.5, 1, top),
      at(run, 1, -0.2, 1.5),
      at(run, -1, -0.2, 1.5),
      g,
      C.earthBank,
    )
    for (const side of [-1, 1])
      this.tri(
        at(-0.5, side, top),
        at(run, side, -0.2, 1.5),
        at(-0.5, side, -1),
        g,
        C.earthBankShade,
      )
  }

  /** A low round mound of earth at (x, y) on the ground `base`: a shaft's spoil heap, grassed over. */
  mound(x: number, y: number, base: number, r: number, h: number) {
    const sides = 10
    // Two tiers, so it reads as a soft dome rather than a cone.
    const ring = (rr: number, z: number) =>
      Array.from({ length: sides + 1 }, (_, k) => {
        const a = (k / sides) * Math.PI * 2
        return [x + Math.cos(a) * rr, y + Math.sin(a) * rr, z]
      })
    const [foot, shoulder] = [ring(r, -0.3), ring(r * 0.55, h * 0.75)]
    for (let k = 0; k < sides; k++) {
      this.quad(foot[k], foot[k + 1], shoulder[k + 1], shoulder[k], base, C.mound)
      this.tri(shoulder[k], shoulder[k + 1], [x, y, h], base, C.mound)
    }
  }

  /** A holm oak: a short trunk under a round, dense crown. */
  oak(x: number, y: number, r: number, base: number, col: THREE.Color) {
    const h = r * 0.9
    this.prism(x, y, 0.4, -1, h + 0.5, 4, base, C.trunk, false)
    const crown = r * 1.05
    this.cone(x, y, crown, h, -r * 0.45, 8, base, col)
    this.prism(x, y, crown, h, h + r * 0.7, 8, base, col, false)
    this.cone(x, y, crown, h + r * 0.7, r * 0.75, 8, base, col)
  }

  /** A cypress: a tall, narrow cone. */
  cypress(x: number, y: number, r: number, base: number, col: THREE.Color) {
    const w = Math.max(1, r * 0.45)
    this.prism(x, y, w, -1, r * 0.8, 6, base, col, false)
    this.cone(x, y, w, r * 0.8, r * 2.6, 6, base, col)
  }

  /**
   * A building on its lot (pipeline city.ts), corners front left, front right, back
   * right, back left. Walls round it, and a low tiled roof whose ridge runs along
   * the middle of the lot parallel to the street, at the same height for the same
   * depth: a row of lots of one height makes one long roof, and the rows round a
   * block meet on the mitred corners, hipped. Where a neighbour is lower, or there
   * is none, the gable end shows. `pitch` is the roof's rise over run.
   */
  lot(
    q: Pt[],
    h: number,
    base: number,
    wall: THREE.Color,
    tiles: THREE.Color,
    roof = ROOF.along,
    pitch = 0.36,
    eave = 0.4,
  ) {
    const [f0, f1, b1, b0] = q
    const lot = this.look
    const as = (surface: number) => (this.look = surface * 10 + lot)
    // Each wall with its own coordinates: along it from its left end, its length, and
    // the height of its eaves; the front to the street, the others behind.
    const side = (a: Pt, c: Pt, surface: number) => {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      as(surface)
      this.quad(
        [a[0], a[1], -4, 0, len, h],
        [c[0], c[1], -4, len, len, h],
        [c[0], c[1], h, len, len, h],
        [a[0], a[1], h, 0, len, h],
        base,
        wall,
      )
    }
    side(f0, f1, SKIN.front)
    side(f1, b1, SKIN.wall)
    side(b1, b0, SKIN.wall)
    side(b0, f0, SKIN.wall)
    const L = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) || 1
    const u: Pt = [(f1[0] - f0[0]) / L, (f1[1] - f0[1]) / L]
    const n: Pt = [-u[1], u[0]]
    // Depth measured square to the street, so a mitred corner lot keeps the ridge level.
    const depth = (f: Pt, b: Pt) => (b[0] - f[0]) * n[0] + (b[1] - f[1]) * n[1]
    const deep = Math.max(1, (depth(f0, b0) + depth(f1, b1)) / 2)
    // A point on a wall (`at` along it, of `len`) or on the roof (`across` its tiles'
    // rows, `down` from the ridge, of `run` to the eaves).
    const w = (p: Pt, zz: number, at: number, len: number) => [p[0], p[1], zz, at, len, h]
    const t = (p: number[], across: number, down: number, run: number) => [
      p[0],
      p[1],
      p[2],
      across,
      down,
      run,
    ]
    const z = (p: Pt, zz: number) => [p[0], p[1], zz]
    const mid = (a: Pt, b: Pt, zz: number) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zz]
    const sideB = Math.hypot(b0[0] - f0[0], b0[1] - f0[1])
    const sideF = Math.hypot(b1[0] - f1[0], b1[1] - f1[1])
    try {
      if (roof === ROOF.flat) {
        // A terrace behind a low parapet.
        as(SKIN.none)
        this.quad(z(f0, h), z(f1, h), z(b1, h), z(b0, h), base, tiles)
        return
      }
      if (roof === ROOF.lean) {
        // One slope from the street front down to the back.
        const top = h + pitch * deep * 0.6
        as(SKIN.front)
        this.quad(
          w(f0, h, 0, L),
          w(f1, h, L, L),
          w(f1, top, L, L),
          w(f0, top, 0, L),
          base,
          wall,
        )
        as(SKIN.wall)
        this.tri(
          w(f0, h, sideB, sideB),
          w(f0, top, sideB, sideB),
          w(b0, h, 0, sideB),
          base,
          wall,
        )
        this.tri(
          w(f1, h, 0, sideF),
          w(b1, h, sideF, sideF),
          w(f1, top, 0, sideF),
          base,
          wall,
        )
        as(SKIN.roof)
        this.quad(
          t(z(f0, top), 0, 0, deep),
          t(z(f1, top), L, 0, deep),
          t(z(b1, h), L, deep, deep),
          t(z(b0, h), 0, deep, deep),
          base,
          tiles,
        )
        return
      }
      if (roof === ROOF.across) {
        // The ridge from front to back, the gable to the street.
        const ridge = h + pitch * (L / 2)
        const [rf, rb] = [mid(f0, f1, ridge), mid(b0, b1, ridge)]
        as(SKIN.roof)
        this.quad(
          t(z(f0, h), 0, L / 2, L / 2),
          t(rf, 0, 0, L / 2),
          t(rb, deep, 0, L / 2),
          t(z(b0, h), deep, L / 2, L / 2),
          base,
          tiles,
        )
        this.quad(
          t(rf, 0, 0, L / 2),
          t(z(f1, h), 0, L / 2, L / 2),
          t(z(b1, h), deep, L / 2, L / 2),
          t(rb, deep, 0, L / 2),
          base,
          tiles,
        )
        as(SKIN.front)
        this.tri(w(f0, h, 0, L), w(f1, h, L, L), [...rf, L / 2, L, h], base, wall)
        as(SKIN.wall)
        this.tri(w(b1, h, 0, L), w(b0, h, L, L), [...rb, L / 2, L, h], base, wall)
        return
      }
      const ridge = h + pitch * (deep / 2)
      const [r0, r1] = [mid(f0, b0, ridge), mid(f1, b1, ridge)]
      const out = (p: Pt, s: number) => [p[0] + n[0] * s, p[1] + n[1] * s, h - pitch * eave]
      const run = deep / 2 + eave
      as(SKIN.roof)
      this.quad(
        t(out(f0, -eave), 0, run, run),
        t(out(f1, -eave), L, run, run),
        t(r1, L, 0, run),
        t(r0, 0, 0, run),
        base,
        tiles,
      )
      this.quad(
        t(r0, 0, 0, run),
        t(r1, L, 0, run),
        t(out(b1, eave), L, run, run),
        t(out(b0, eave), 0, run, run),
        base,
        tiles,
      )
      as(SKIN.wall)
      this.tri(
        w(f0, h, sideB, sideB),
        [...r0, sideB / 2, sideB, h],
        w(b0, h, 0, sideB),
        base,
        wall,
      )
      this.tri(
        w(f1, h, 0, sideF),
        w(b1, h, sideF, sideF),
        [...r1, sideF / 2, sideF, h],
        base,
        wall,
      )
    } finally {
      this.look = 0
    }
  }

  /** A long block along one edge of a CCW outline, on its inside. */
  edgeBlock(
    a: Pt,
    c: Pt,
    width: number,
    z0: number,
    h: number,
    base: number,
    wall: THREE.Color,
    top: THREE.Color,
  ) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1])
    if (len < 2) return
    const ux = (c[0] - a[0]) / len
    const uy = (c[1] - a[1]) / len
    // Inside a CCW ring is to the left of each edge.
    const cx = (a[0] + c[0]) / 2 - uy * (width / 2)
    const cy = (a[1] + c[1]) / 2 + ux * (width / 2)
    this.block(
      cx,
      cy,
      Math.atan2(uy, ux) - Math.PI / 2,
      width,
      len,
      z0,
      h,
      'flat',
      base,
      wall,
      top,
    )
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('ground', new THREE.Float32BufferAttribute(this.base, 1))
    g.setAttribute('years', new THREE.Float32BufferAttribute(this.years, 4))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('colour', new THREE.Float32BufferAttribute(this.colour, 3))
    g.setAttribute('skin', new THREE.Float32BufferAttribute(this.skin, 4))
    return g
  }
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

    // A building refaced within its years is built once for each stone, each standing
    // for its own years.
    for (const m of meta.monuments as Monument[]) {
      const phases = m.stone ?? [{ from: ALWAYS[0], stone: 'stucco' as Stone }]
      phases.forEach((ph, i) => {
        const from = Math.max(m.years[0], ph.from)
        const to = Math.min(m.years[1], (phases[i + 1]?.from ?? ALWAYS[1] + 1) - 1)
        if (from > to) return
        b.dates = [from, to, ...(m.unfinished ?? [1, 0])]
        b.face = STONE[ph.stone].face
        b.shade = STONE[ph.stone].shade
        this.monument(b, m)
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
    for (const w of meta.wall as { pts: number[][]; known: boolean }[]) {
      const h = w.known ? 10 : 8.5
      const col = w.known ? C.stone : C.stoneLight
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [a, c] = [w.pts[i], w.pts[i + 1]]
        const len = Math.hypot(c[0] - a[0], c[1] - a[1])
        if (len < 0.1) continue
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
    for (const [x, y, ground] of meta.gates as number[][])
      b.block(x, y, 0.3, 13, 13, -6, 16, 'hip', ground, C.stone, C.roof)

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
  private monument(b: Builder, m: Monument) {
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

function edges(ring: Pt[], f: (a: Pt, c: Pt) => void) {
  for (let i = 0; i + 1 < ring.length; i++) f(ring[i], ring[i + 1])
}

function polygonArea(r: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}

/** A ring wound counter-clockwise (`true`) or clockwise. */
function ccw(r: Pt[], want: boolean): Pt[] {
  return polygonArea(r) > 0 === want ? r : [...r].reverse()
}

/** The smallest rectangle round a ring, by its edges' directions: centre, angle of its long side, sides. */
function orientedBox(r: Pt[]) {
  let best = { area: Infinity, cx: 0, cy: 0, angle: 0, long: 0, short: 0 }
  for (let i = 0; i + 1 < r.length; i++) {
    const a = Math.atan2(r[i + 1][1] - r[i][1], r[i + 1][0] - r[i][0])
    const [c, s] = [Math.cos(a), Math.sin(a)]
    const us = r.map(([x, y]) => x * c + y * s)
    const vs = r.map(([x, y]) => -x * s + y * c)
    const [u0, u1, v0, v1] = [
      Math.min(...us),
      Math.max(...us),
      Math.min(...vs),
      Math.max(...vs),
    ]
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2]
      const [lu, lv] = [u1 - u0, v1 - v0]
      best = {
        area,
        cx: mu * c - mv * s,
        cy: mu * s + mv * c,
        // `block` runs its depth along the angle's normal; make depth the long side.
        angle: lu >= lv ? a - Math.PI / 2 : a,
        long: Math.max(lu, lv),
        short: Math.min(lu, lv),
      }
    }
  }
  return best
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
  const scale = select(stands, select(unfinished, float(0.33), float(1)), float(0))
  const sink = select(stands, float(0), float(40))
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    ground.add(up.mul(modelUniforms.grow).mul(scale)).sub(sink).mul(vex),
  )
  // Heights over the ground as built, before the model rises.
  const built = positionGeometry.z
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
  // The relief under the city, washed over it, so the hills read from above.
  const wash = mix(float(1), reliefWash(positionWorld.x, positionWorld.y), 0.9)
  const lit = attribute('colour', 'vec3')
    .mul(paint)
    .mul(foot)
    .mul(mix(float(1), open, 0.5))
    .mul(wash)
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
