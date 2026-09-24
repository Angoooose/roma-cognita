import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  Fn,
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
  /** How much the terrain is laid on the smoothed ground: set per frame from the scale. */
  flatten: uniform(0),
  /** 0 until the plate has loaded. */
  loaded: uniform(0),
  /** How far the model stands (ModelLayer's `grow`): its ground mesh takes the shadows. */
  meshShown: uniform(0),
  /**
   * How much the relief under the city is drawn up, so the hills read from above:
   * the smoothed slope's light is exaggerated this many times, on the ground and in
   * the wash over the model (`reliefWash`).
   */
  relief: uniform(4),
}

function blank(bytes = [255, 0, 255, 255]) {
  const t = new THREE.DataTexture(new Uint8Array(bytes), 1, 1)
  t.needsUpdate = true
  return t
}

/**
 * The texture nodes the shaders read, their values swapped in once loaded: the
 * plate's fields (plate-0 streets, plate-1 the river and the reach), and the smoothed
 * ground heights (ground.png, decoded to metres by PlanLayer).
 */
export const planTextures = {
  plate: [texture(blank([255, 0, 255, 255])), texture(blank([255, 255, 0, 255]))],
  ground: texture(blank([0, 0, 0, 255])),
}

/** The trodden ground of the walled city. */
const EARTH = new THREE.Color('#BCAB88')
/** The paved streets and roads: pale stone over the ground. */
const PAVING = new THREE.Color('#D9CFBA')
/** The river: the map's own river colour (terrain/material.ts). */
const WATER = new THREE.Color('#3D7A8E')
const INK = new THREE.Color('#2A241E')
const LIGHT = new THREE.Vector3(-0.5, 0.5, 0.707).normalize()

type F = THREE.Node<'float'>
const rgb = (c: THREE.Color) => vec3(c.r, c.g, c.b)

/** Metres per CSS pixel from metres per device pixel. */
const css = (pxM: F) => pxM.mul(planUniforms.pixelRatio)

/** How far the board reaches beyond everything on the plan, metres, before its wobble. */
const REACH_M = 420

const plateUV = (mx: F, my: F) =>
  vec2(
    mx.sub(planUniforms.plateOrigin.x).div(planUniforms.plateSize.x),
    planUniforms.plateOrigin.y.sub(my).div(planUniforms.plateSize.y),
  )

/** The distance beyond the hull of the plan, metres (plate-1 blue), at a level safe anywhere. */
const reachAt = (mx: F, my: F) =>
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
  return clamp(lit, 0.45, 1.3).mul(mix(float(0.9), float(1.07), high))
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
 * outside any branch.
 */
function planOver(colour: THREE.Node<'vec3'>, mx: F, my: F, pxM: F, lit: F) {
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
  const walled = float(1).sub(smoothstep(-24, 8, city))
  out.assign(mix(out, rgb(EARTH).mul(lit), walled.mul(0.7).mul(planUniforms.meshShown)))

  // Baked shadows, as the model rises, where its ground mesh does not take its real ones.
  const baked = planUniforms.meshShown.mul(float(1).sub(groundMeshFade(mx, my)))
  out.assign(out.mul(float(1).sub(p0.r.mul(0.3).mul(baked))))

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
  const show = streetsShow(pxM)
  out.assign(mix(out, rgb(PAVING).mul(lit), paved.mul(0.9).mul(show)))
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
      line(abs(river), 1.4).mul(0.6).mul(bank).mul(tiberReach(mx, my)),
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
 * is metres per device pixel, taken outside any branch.
 */
export function planShading(colour: THREE.Node<'vec3'>, mx: F, my: F, pxM: F) {
  const plate = plateMask(mx, my, pxM)
  return Fn(() => {
    const out = vec3(colour).toVar()
    If(plate.greaterThan(0), () => {
      out.assign(mix(out, planOver(out, mx, my, pxM, slopeLight(mx, my)), plate))
    })
    return out
  })()
}
