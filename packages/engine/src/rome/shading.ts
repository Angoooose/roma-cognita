import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  sin,
  If,
  int,
  ivec2,
  max,
  min,
  mix,
  normalize,
  select,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'

// fields.ts imports this file too; each only calls the other's functions when a
// shader is built, by when both are loaded.
import { groundStanding, plotShown } from './fields.ts'
import { C } from './builder.ts'
import { seededNoise } from '../terrain/noise.ts'

/**
 * The ground the model of Rome stands on (DESIGN.md §7.7), printed onto the terrain
 * when the map is zoomed right into the city. The buildings are ModelLayer's; this is
 * the ground under them:
 *
 * - **The ground** keeps the terrain's own colour, laid on and lit by the smoothed
 *   relief (`groundLift`, `smoothGradient`), not the surface model the rest of the
 *   map uses, whose modern buildings would show through.
 * - **The Tiber** on its real course, in place of the coarse river line (see
 *   `plateMask`).
 * - **Streets and roads** (streets.ts) as paved ways between the houses, paler than
 *   the ground; roads wider.
 * - **The Forum's square**, paved across in tufa and then travertine, its slabs'
 *   joints drawn close in.
 *
 * - **The walled city's ground** as trodden earth, where it is not paved.
 * - **The model's shadows**, baked, where its ground mesh does not take the real ones.
 */
export const planUniforms = {
  enabled: uniform(1),
  /** Device pixels per CSS pixel: line widths are CSS px. */
  pixelRatio: uniform(1),
  /** The plate's grid: north-west corner (plane metres), extent in metres and texels. */
  plateOrigin: uniform(new THREE.Vector2(0, 0)),
  plateSize: uniform(new THREE.Vector2(1, 1)),
  plateTexels: uniform(new THREE.Vector2(1, 1)),
  /** Clamps of the plate's fields, metres: (unused), circuit, river, reach. */
  plateClamps: uniform(new THREE.Vector4(12, 48, 16, 1400)),
  /** The street field's clamp, metres. */
  streetClamp: uniform(12),
  /** The Forum's square: its field's clamp, metres (0 until loaded), and its length's direction. */
  squareClamp: uniform(0),
  squareAxis: uniform(new THREE.Vector2(1, 0)),
  /** The year its travertine was laid (pipeline model.ts `FORUM_PAVING`); tufa before. */
  travertineFrom: uniform(-43),
  /** How much the terrain is laid on the smoothed ground: set per frame from the scale. */
  flatten: uniform(0),
  /** 0 until the plate has loaded. */
  loaded: uniform(0),
  /** How far the model stands (ModelLayer's `grow`): its ground mesh takes the shadows. */
  meshShown: uniform(0),
  /**
   * How much the relief under the city is drawn up, so the hills read from above:
   * the smoothed slope's light is exaggerated this many times, on the ground and in
   * the wash over the model (`reliefWash`). Twice, now the valley floors lie at
   * their ancient depth (pipeline ground.ts): more, and a real slope falls muddy.
   */
  relief: uniform(2),
  /** The year shown, astronomical (ModelLayer sets it with the model's). */
  year: uniform(-62),
}

function blank(bytes = [255, 0, 255, 255]) {
  const t = new THREE.DataTexture(new Uint8Array(bytes), 1, 1)
  t.needsUpdate = true
  return t
}

/**
 * The texture nodes the shaders read, their values swapped in once loaded: the
 * plate's fields (plate-0 streets, plate-1 the river and the reach, plate-2 the
 * country, fields.ts), and the smoothed ground heights (ground.png, decoded to metres
 * by PlanLayer).
 */
export const planTextures = {
  plate: [
    texture(blank([255, 0, 255, 255])),
    texture(blank([255, 255, 0, 255])),
    texture(blank([0, 0, 255, 255])),
  ],
  ground: texture(blank([0, 0, 0, 255])),
}

/** The trodden ground of the walled city. */
const EARTH = new THREE.Color('#BCAB88')
/**
 * The Forum's slabs, metres: in rows along its length, each row's joints staggered.
 * Their size is illustrative, not a survey's.
 */
const SLAB = { row: 1.5, length: 3 }
/**
 * The paved streets and roads: basalt, as the censors of 174 BCE had the city's
 * streets paved (Livy 41.27.5, "vias sternendas silice in urbe"), and the Via Appia
 * from the temple of Mars to Bovillae in 293 BCE (Livy 10.47.4). A warm grey, the lava weathered
 * and dusty, not black, so the city stays light.
 */
export const BASALT = new THREE.Color('#9A948A')
/**
 * The basalt's blocks, metres across: polygonal, fitted to each other. Their size is
 * illustrative, not a survey's.
 */
const BLOCK_M = 0.7
/** The river: the map's own river colour (terrain/material.ts). */
const WATER = new THREE.Color('#3D7A8E')
const INK = new THREE.Color('#2A241E')
const LIGHT = new THREE.Vector3(-0.5, 0.5, 0.707).normalize()

type F = THREE.Node<'float'>
/** Two numbers in [0, 1) for a lattice square: a sine hash, for keys under 289. */
const jitter = (k: THREE.Node<'vec2'>) =>
  fract(sin(vec2(dot(k, vec2(127.1, 311.7)), dot(k, vec2(269.5, 183.3)))).mul(43758.5453))
const rgb = (c: THREE.Color) => vec3(c.r, c.g, c.b)

/** Metres per CSS pixel from metres per device pixel. */
export const css = (pxM: F) => pxM.mul(planUniforms.pixelRatio)

/** How far the board reaches beyond everything on the plan, metres, before its wobble. */
const REACH_M = 420

export const plateUV = (mx: F, my: F) =>
  vec2(
    mx.sub(planUniforms.plateOrigin.x).div(planUniforms.plateSize.x),
    planUniforms.plateOrigin.y.sub(my).div(planUniforms.plateSize.y),
  )

/** The distance beyond the hull of the plan, metres (plate-1 blue), at a level safe anywhere. */
export const reachAt = (mx: F, my: F) =>
  texture(planTextures.plate[1], plateUV(mx, my))
    .level(float(0))
    .b.mul(255)
    .sub(128)
    .div(127)
    .mul(planUniforms.plateClamps.w)

/** Smoothed ground height at a plane point, metres (a half-float texture, PlanLayer). */
function groundAt(mx: F, my: F) {
  return texture(planTextures.ground, plateUV(mx, my)).level(float(0)).r
}

/**
 * For the terrain's vertex shader: the smoothed height the ground takes under the
 * model, and how much it takes it — all of it well inside the board, easing back to
 * the terrain's own over its last 300 m, and only while the board shows.
 */
export function groundLift(mx: F, my: F) {
  const inside = float(1).sub(smoothstep(REACH_M - 380, REACH_M - 80, reachAt(mx, my)))
  return {
    height: groundAt(mx, my),
    weight: inside
      .mul(planUniforms.flatten)
      .mul(planUniforms.loaded)
      .mul(planUniforms.enabled),
  }
}

/**
 * How much of the model's own ground mesh shows (ModelLayer): all of it well inside
 * the laid-smooth ground, fading out before the terrain starts to rise back to its
 * own heights, so the mesh never floats over them. Past it the terrain draws the
 * board on to its ragged edge.
 */
export function groundMeshFade(mx: F, my: F) {
  return float(1).sub(smoothstep(REACH_M - 470, REACH_M - 400, reachAt(mx, my)))
}

/**
 * How much of the plan shows at a plane point: all of it within ~420 m of everything
 * on it, from 18 m/px in, none from 26 out. The terrain uses it to hold back the
 * coarse river line and the map's roads where the plan draws the Tiber and the
 * streets. `pxM` must be taken outside a branch.
 */
export function plateMask(mx: F, my: F, pxM: F) {
  const zoom = float(1)
    .sub(smoothstep(18, 26, css(pxM)))
    .mul(planUniforms.enabled)
    .mul(planUniforms.loaded)
  return zoom.mul(float(1).sub(smoothstep(REACH_M - 120, REACH_M, reachAt(mx, my))))
}

/** How much the terrain is lit by the smoothed relief (`smoothGradient`) at a point. */
export function smoothWeight(mx: F, my: F) {
  return groundLift(mx, my).weight.mul(planUniforms.meshShown)
}

/**
 * The wash of relief laid over the model, as an illustrated map shades its hills:
 * the smoothed ground lit from the north-west with its slope drawn up
 * (`planUniforms.relief`), so slopes turned from the light fall darker, and the
 * hilltops a little lighter than the valleys. 1 on flat ground at the valleys' mean.
 */
export function reliefWash(mx: F, my: F) {
  const g = smoothGradient(mx, my).mul(planUniforms.relief)
  const n = normalize(vec3(g.x.negate(), g.y.negate(), 1))
  const lit = dot(n, vec3(LIGHT.x, LIGHT.y, LIGHT.z)).div(LIGHT.z)
  const high = smoothstep(18, 55, groundAt(mx, my))
  return clamp(lit, 0.7, 1.3).mul(mix(float(0.9), float(1.07), high))
}

/**
 * How much the map's coarse river line gives way to the plan's Tiber: like
 * `plateMask`, but ending well inside the plan's edge, so the coarse line is back
 * under the Tiber before the Tiber fades out, and the river never breaks.
 */
export function riverSwap(mx: F, my: F, pxM: F) {
  const zoom = float(1)
    .sub(smoothstep(18, 26, css(pxM)))
    .mul(planUniforms.enabled)
    .mul(planUniforms.loaded)
  return zoom.mul(tiberReach(mx, my))
}

/** How much of the plan's Tiber is drawn: all of it well inside, crossfading to the map's line. */
function tiberReach(mx: F, my: F) {
  return float(1).sub(smoothstep(REACH_M - 520, REACH_M - 260, reachAt(mx, my)))
}

/**
 * How much the plan's streets show at a scale: all of them while a road's line fits
 * well inside the street field's clamp, none once it would reach it — every texel
 * would then read as street. Coarser than that the map's own roads draw instead.
 * `pxM` is metres per device pixel.
 */
export function streetsShow(pxM: F) {
  const roadHalf = max(planUniforms.pixelRatio.mul(pxM).mul(2), 5)
  return float(1).sub(smoothstep(0.45, 0.8, roadHalf.div(planUniforms.streetClamp)))
}

/**
 * The smoothed ground's gradient at a plane point, metres per metre, x east and y
 * north as the terrain's own: under the model the terrain is lit and coloured by it,
 * so the surface model's modern buildings do not show as relief or rock.
 */
export function smoothGradient(mx: F, my: F) {
  // Taken up as the model rises (`smoothWeight`); coarser, the surface model's
  // buildings are below a texel anyway.
  const step = float(4)
  return vec2(
    groundAt(mx.add(step), my).sub(groundAt(mx.sub(step), my)),
    groundAt(mx, my.add(step)).sub(groundAt(mx, my.sub(step))),
  ).div(step.mul(2))
}

/**
 * The plan over the terrain's colour at a plane point: the model's baked shadows
 * where its own cannot fall, the paved streets and roads, and the Tiber. `lit` is
 * the light the paving is shaded by. `pxM` is metres per device pixel, taken
 * outside any branch. Everything is drawn as far as the board reaches (`plate`), but
 * the roads, which run on as far as the country does (`roads`).
 */
function planOver(
  colour: THREE.Node<'vec3'>,
  mx: F,
  my: F,
  pxM: F,
  lit: F,
  plate: F,
  roads: F,
) {
  const aa = pxM.mul(0.6)
  const px = planUniforms.pixelRatio.mul(pxM)
  const line = (d: F, widthPx: number) =>
    float(1).sub(smoothstep(px.mul(widthPx / 2).sub(aa), px.mul(widthPx / 2).add(aa), d))
  const uv2 = plateUV(mx, my)
  const p0 = texture(planTextures.plate[0], uv2).level(float(0))
  const p1 = texture(planTextures.plate[1], uv2).level(float(0))
  const river = p1.g.mul(255).sub(128).div(127).mul(planUniforms.plateClamps.z)
  const out = vec3(colour).toVar()

  // Inside the walls the ground between the houses is trodden earth, not grass: the
  // terrain's colour pulled most of the way to it, its relief kept.
  const city = p1.r.mul(255).sub(128).div(127).mul(planUniforms.plateClamps.y)
  // A recorded garden standing inside the wall keeps its own ground (fields.ts).
  const walled = float(1)
    .sub(smoothstep(-24, 8, city))
    .mul(float(1).sub(groundStanding(mx, my)))
  out.assign(
    mix(out, rgb(EARTH).mul(lit), walled.mul(0.7).mul(planUniforms.meshShown).mul(plate)),
  )

  // Baked shadows, as the model rises, where its ground mesh does not take its real ones:
  // out in the country, as its fields come in, since most there are its trees'
  // (fields.ts `plotShown`).
  const baked = planUniforms.meshShown
    .mul(float(1).sub(groundMeshFade(mx, my)))
    .mul(plotShown(mx, my))
  out.assign(out.mul(float(1).sub(p0.r.mul(0.3).mul(baked).mul(plate))))

  // The Forum's square, paved: tufa, then Caesar's travertine. Close in, the joints
  // between its slabs, in rows along its length, and each slab a shade apart.
  const toSquare = p0.g.mul(255).sub(128).div(127).mul(planUniforms.squareClamp)
  const hasSquare = select(planUniforms.squareClamp.greaterThan(0), float(1), float(0))
    .mul(planUniforms.meshShown)
    .mul(plate)
  const onSquare = float(1)
    .sub(smoothstep(aa.negate(), aa, toSquare))
    .mul(hasSquare)
  const sx = mx.sub(planUniforms.plateOrigin.x)
  const sy = my.sub(planUniforms.plateOrigin.y)
  const ax = planUniforms.squareAxis
  const along = sx.mul(ax.x).add(sy.mul(ax.y))
  const across = sy.mul(ax.x).sub(sx.mul(ax.y)).div(SLAB.row)
  const row = floor(across)
  const stagger = fract(row.mul(0.618)).mul(SLAB.length)
  const slabU = along.add(stagger).div(SLAB.length)
  const joint = min(
    float(0.5)
      .sub(abs(fract(slabU).sub(0.5)))
      .mul(SLAB.length),
    float(0.5)
      .sub(abs(fract(across).sub(0.5)))
      .mul(SLAB.row),
  )
  // Drawn while a row is several pixels wide; coarser, the square is one stone.
  const close = float(1).sub(smoothstep(SLAB.row / 8, SLAB.row / 4, css(pxM)))
  const seam = float(1)
    .sub(smoothstep(max(px.mul(0.35), 0.04), max(px.mul(0.35), 0.04).add(aa), joint))
    .mul(close)
  const shade = seededNoise(vec2(row, floor(slabU)).add(0.5), 7)
    .mul(0.05)
    .mul(close)
  const stone = select(
    planUniforms.year.greaterThanEqual(planUniforms.travertineFrom),
    rgb(C.travertine),
    rgb(C.tufa),
  )
  const slab = stone
    .mul(lit)
    .mul(float(1).add(shade))
    .mul(float(1).sub(seam.mul(0.14)))
  out.assign(mix(out, slab, onSquare))
  out.assign(mix(out, rgb(INK), line(abs(toSquare), 0.6).mul(0.12).mul(hasSquare)))

  // Paved streets and roads. What a line is comes from the nearest texel.
  const cell = min(
    floor(uv2.mul(planUniforms.plateTexels)),
    planUniforms.plateTexels.sub(1),
  )
  const code = floor(
    (
      textureLoad(
        planTextures.plate[0],
        ivec2(int(cell.x), int(cell.y)),
      ) as unknown as THREE.Node<'vec4'>
    ).a
      .mul(255)
      .add(0.5),
  )
  const isRoad = code.lessThan(160)
  const half = select(isRoad, max(px.mul(2), 5), max(px.mul(1.4), 3))
  const toStreet = p0.b.mul(planUniforms.streetClamp)
  const paved = float(1).sub(smoothstep(half.sub(aa), half.add(aa), toStreet))
  const show = streetsShow(pxM).mul(select(isRoad, max(plate, roads), plate))
  // Close in, the joints between the basalt's polygonal blocks: the edges of cells
  // round a jittered point in each square of a lattice, each block a shade apart.
  const blocks = float(1).sub(smoothstep(BLOCK_M / 8, BLOCK_M / 4, css(pxM)))
  const basalt = rgb(BASALT).mul(lit).toVar()
  If(paved.mul(show).mul(blocks).greaterThan(0.001), () => {
    const q = vec2(sx, sy).div(BLOCK_M)
    const base = floor(q)
    const f = q.sub(base)
    const near = float(8).toVar()
    const next = float(8).toVar()
    const tone = float(0).toVar()
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = vec2(dx, dy)
        const k = base.add(n)
        const h = jitter(k.sub(floor(k.div(289)).mul(289)))
        const d = length(n.add(h.mul(0.8).add(0.1)).sub(f))
        If(d.lessThan(near), () => {
          next.assign(near)
          near.assign(d)
          tone.assign(h.x)
        }).ElseIf(d.lessThan(next), () => {
          next.assign(d)
        })
      }
    const edge = next.sub(near).mul(0.5 * BLOCK_M)
    const w = max(px.mul(0.35), 0.03)
    const seam = float(1)
      .sub(smoothstep(w, w.add(aa), edge))
      .mul(blocks)
    basalt.assign(
      basalt
        .mul(float(1).add(tone.sub(0.5).mul(0.08).mul(blocks)))
        .mul(float(1).sub(seam.mul(0.18))),
    )
  })
  out.assign(mix(out, basalt, paved.mul(0.9).mul(show)))
  out.assign(
    mix(
      out,
      rgb(INK),
      line(abs(toStreet.sub(half)), 0.6)
        .mul(0.12)
        .mul(show),
    ),
  )

  // The Tiber, with a soft darker bank.
  const water = float(1)
    .sub(smoothstep(aa.negate(), aa, river))
    .mul(tiberReach(mx, my))
    .mul(plate)
  out.assign(mix(out, rgb(WATER), water))
  // The bank only while its line fits well inside the river field's clamp; coarser,
  // every texel near the water would read as bank.
  const bank = float(1).sub(
    smoothstep(0.3, 0.6, px.mul(0.7).div(planUniforms.plateClamps.z)),
  )
  out.assign(
    mix(
      out,
      rgb(WATER).mul(0.75),
      line(abs(river), 1.4).mul(0.6).mul(bank).mul(tiberReach(mx, my)).mul(plate),
    ),
  )
  return out
}

/** The light the paving is shaded by: the smoothed ground's own slope. */
function slopeLight(mx: F, my: F) {
  const step = float(4)
  const gx = groundAt(mx.add(step), my).sub(groundAt(mx.sub(step), my))
  const gy = groundAt(mx, my.add(step)).sub(groundAt(mx, my.sub(step)))
  const n = normalize(vec3(gx.negate().mul(1.5), gy.negate().mul(1.5), step.mul(2)))
  return clamp(
    float(0.62).add(max(dot(n, vec3(LIGHT.x, LIGHT.y, LIGHT.z)), 0).mul(0.45)),
    0.7,
    1.15,
  )
}

/**
 * The plan over the terrain's `colour` at plane position (`mx`, `my`), metres. `pxM`
 * is metres per device pixel, taken outside any branch. `roads` is how far the plan's
 * roads run on beyond the board: as far as the country round it (fields.ts
 * `countryMask`), so a road out of a gate does not stop short in the fields.
 */
export function planShading(colour: THREE.Node<'vec3'>, mx: F, my: F, pxM: F, roads: F) {
  const plate = plateMask(mx, my, pxM)
  return Fn(() => {
    const out = vec3(colour).toVar()
    If(max(plate, roads).greaterThan(0), () => {
      out.assign(planOver(out, mx, my, pxM, slopeLight(mx, my), plate, roads))
    })
    return out
  })()
}
