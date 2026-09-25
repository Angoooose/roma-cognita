import * as THREE from 'three/webgpu'

/**
 * The mesh the model of Rome is built of (ModelLayer.ts), and its vocabulary: the
 * primitives and the building types every monument is raised from.
 */
/** Years that span everything: the generated city, the wall, the trees. */
export const ALWAYS = [-100000, 100000, 1, 0]

/** Floats per generated building in model.bin, its kinds and roofs (pipeline city.ts `LOT_KIND`, `ROOF`). */
export const FABRIC_STRIDE = 14
export const LOT = { flats: 0, house: 1, warehouse: 2, suburb: 3 }
export const ROOF = { along: 0, across: 1, flat: 2, lean: 3 }

/**
 * What the shader paints on a face (`Builder.look`, `skin` in `material`): a
 * generated house's front, its other walls or its tiled roof, or squared stone laid
 * in courses (the Servian Wall, wall.ts).
 */
export const SKIN = { none: 0, front: 1, wall: 2, roof: 3, ashlar: 4 }

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

export const C = {
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
  /**
   * The Servian Wall's Grotta Oscura tufa, pale yellow-grey (Platner & Ashby, Murus
   * Servii Tullii; Middleton 1892); its walk, trodden; and the shade of its passages.
   */
  wallTufa: new THREE.Color('#CEC09D'),
  wallWalk: new THREE.Color('#B9AC8E'),
  wallShade: new THREE.Color('#8C8270'),
  /** A retaining wall of squared tufa, and its coping. */
  retaining: new THREE.Color('#C2AE8A'),
  retainingTop: new THREE.Color('#D0C0A0'),
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

export type Pt = [number, number]

export type OBB = ReturnType<typeof orientedBox>

/** The depth of an arch's ring of voussoirs, and of the string-course under a channel, metres (Ashby 1935, p. 131). */
/** A shaft's spoil heap: its radius and height, metres, and how far from the masonry they fade out. */
export const MOUND_R_M = 4
export const MOUND_H_M = 0.9
export const MOUND_FADE_M = 260

const VOUSSOIR_M = 0.65
const STRING_M = 0.35

/** An arcade's proportions, metres (pipeline aqueducts.ts `ARCADE`). */
export interface ArcadeSize {
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
export interface Aqueduct {
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
export class Builder {
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
  /**
   * How much of a building stands while it is part-built (its years' third and
   * fourth values): the height it is cut off at, metres over its ground, and 1 if
   * it is a burnt shell rather than works in progress. Set per monument once it is
   * built (`finish`).
   */
  part: number[] = []
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

  /**
   * One triangle; points are [x, y, z above base], and the normal is its own. `base`
   * is the ground under all three, or under each (a long wall on sloping ground).
   */
  tri(a: number[], b: number[], c: number[], base: number | number[], col: THREE.Color) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    n = n.map((q) => q / l)
    for (const [k, p] of [a, b, c].entries()) {
      this.pos.push(p[0] - this.ox, p[1] - this.oy, p[2])
      this.base.push(typeof base === 'number' ? base : base[k])
      this.years.push(...this.dates)
      this.normal.push(n[0], n[1], n[2])
      this.colour.push(col.r, col.g, col.b)
      this.skin.push(this.look, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0)
      this.part.push(1e5, 0)
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

  quad(
    a: number[],
    b: number[],
    c: number[],
    d: number[],
    base: number | number[],
    col: THREE.Color,
  ) {
    if (typeof base === 'number') {
      this.tri(a, b, c, base, col)
      this.tri(a, c, d, base, col)
    } else {
      this.tri(a, b, c, [base[0], base[1], base[2]], col)
      this.tri(a, c, d, [base[0], base[2], base[3]], col)
    }
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

  /** Raises what was built since `from` by `dz` metres over the same ground. */
  lift(from: number, dz: number) {
    if (!dz) return
    for (let i = from; i < this.pos.length / 3; i++) this.pos[i * 3 + 2] += dz
  }

  /** Where the vertices built from now on start, for `finish`. */
  mark() {
    return this.pos.length / 3
  }

  /**
   * Sets how much of what was built since `from` stands while part-built: `share` of
   * its full height, as works rising or a shell left by fire (`burnt`).
   */
  finish(from: number, share: number, burnt: boolean) {
    let top = 0
    for (let i = from; i < this.pos.length / 3; i++)
      top = Math.max(top, this.pos[i * 3 + 2])
    for (let i = from; i < this.pos.length / 3; i++) {
      this.part[i * 2] = top * share
      this.part[i * 2 + 1] = burnt ? 1 : 0
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('ground', new THREE.Float32BufferAttribute(this.base, 1))
    g.setAttribute('years', new THREE.Float32BufferAttribute(this.years, 4))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('colour', new THREE.Float32BufferAttribute(this.colour, 3))
    g.setAttribute('skin', new THREE.Float32BufferAttribute(this.skin, 4))
    g.setAttribute('part', new THREE.Float32BufferAttribute(this.part, 2))
    return g
  }
}

export function edges(ring: Pt[], f: (a: Pt, c: Pt) => void) {
  for (let i = 0; i + 1 < ring.length; i++) f(ring[i], ring[i + 1])
}

export function polygonArea(r: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}

/** A ring wound counter-clockwise (`true`) or clockwise. */
export function ccw(r: Pt[], want: boolean): Pt[] {
  return polygonArea(r) > 0 === want ? r : [...r].reverse()
}

/** The smallest rectangle round a ring, by its edges' directions: centre, angle of its long side, sides. */
export function orientedBox(r: Pt[]) {
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
