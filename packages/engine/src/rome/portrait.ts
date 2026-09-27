import * as THREE from 'three/webgpu'
import {
  float,
  log2,
  max,
  mix,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { css, planTextures, planUniforms, plateUV } from './shading.ts'

/**
 * The model of Rome drawn from straight overhead (DESIGN.md §7.7), for the map to show
 * further out than the model itself is drawn: close enough that the city should look
 * like itself, a miniature under glass, and not a patch of colour, but too far out
 * for its houses to be worth standing up. ModelLayer renders the standing model into
 * it once it has loaded, with its sun and its shadows, and again for each year; the
 * terrain lays it on the ground from `SHOW_MPP` in, and it gives way to the model as
 * that rises out of it (`meshShown`).
 *
 * It is kept premultiplied: its colour is already weighted by its cover, which is 0
 * between the houses, where the ground under it shows.
 */
export const portraitUniforms = {
  /** South-west corner and size of what it covers, plane metres. */
  origin: uniform(new THREE.Vector2(0, 0)),
  size: uniform(new THREE.Vector2(1, 1)),
  /** Metres per texel. */
  texel: uniform(1),
  /** 0 until it has been drawn. */
  ready: uniform(0),
}

function blank() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  t.needsUpdate = true
  return t
}

/** The texture node the terrain reads, its value swapped for the render once drawn. */
export const portraitTexture = texture(blank())

/** The scales (m per CSS px) it comes in between: none at the first, all by the second. */
const SHOW_MPP: [number, number] = [70, 50]

/** The trodden ground between the houses inside the wall (shading.ts `EARTH`). */
const EARTH = new THREE.Color('#BCAB88')

type F = THREE.Node<'float'>

/** Where (`mx`, `my`) falls in the portrait, and whether it falls inside it at all. */
function lookup(mx: F, my: F) {
  const u = portraitUniforms
  const uv = vec2(mx, my).sub(u.origin).div(u.size)
  const inside = uv.x
    .greaterThan(0)
    .and(uv.x.lessThan(1))
    .and(uv.y.greaterThan(0))
    .and(uv.y.lessThan(1))
  // The render comes out with its rows top down: north is at v = 0.
  return { uv: vec2(uv.x, float(1).sub(uv.y)).clamp(0, 1), inside: inside.select(1, 0) }
}

/** How much the portrait shows at this scale: until the model has risen out of it. */
function shownAt(pxM: F) {
  return float(1)
    .sub(smoothstep(SHOW_MPP[1], SHOW_MPP[0], css(pxM)))
    .mul(float(1).sub(planUniforms.meshShown))
    .mul(planUniforms.enabled)
    .mul(planUniforms.loaded)
    .mul(portraitUniforms.ready)
}

/**
 * The city from above over the terrain's `colour` at plane position (`mx`, `my`),
 * metres: the ground inside the wall trodden earth, as the plan draws it once the
 * model stands, and the houses over it. `pxM` is metres per device pixel, taken
 * outside any branch: the mip level is worked out from it, so this can be read
 * anywhere. `lit` is the light the ground is shaded by.
 */
export function portraitShading(colour: THREE.Node<'vec3'>, mx: F, my: F, pxM: F, lit: F) {
  const { uv, inside } = lookup(mx, my)
  const shown = shownAt(pxM).mul(inside)
  const city = texture(planTextures.plate[1], plateUV(mx, my))
    .level(float(0))
    .r.mul(255)
    .sub(128)
    .div(127)
    .mul(planUniforms.plateClamps.y)
  const walled = float(1).sub(smoothstep(-24, 8, city))
  const ground = mix(
    vec3(colour),
    vec3(EARTH.r, EARTH.g, EARTH.b).mul(lit),
    walled.mul(0.7).mul(shown),
  )
  const lod = log2(max(pxM.div(portraitUniforms.texel), float(1)))
  const over = vec4(texture(portraitTexture, uv).level(lod)).mul(shown)
  return ground.mul(float(1).sub(over.a)).add(over.rgb)
}

/**
 * How much of the ground the portrait covers at a plane point, smoothed over a few of
 * its texels past the pixel's own, so it is solid across the built-up city and not
 * only on its roofs: the map's own roads give way under it, as they do to the plan's
 * streets once the model stands, rather than showing between the houses. Only in and
 * just round the walls: out in the country the roads keep on. `pxM` as
 * `portraitShading`.
 */
export function portraitCover(mx: F, my: F, pxM: F) {
  const { uv, inside } = lookup(mx, my)
  const lod = log2(max(pxM.div(portraitUniforms.texel), float(1))).add(3)
  const a = texture(portraitTexture, uv).level(lod).a
  const city = texture(planTextures.plate[1], plateUV(mx, my))
    .level(float(0))
    .r.mul(255)
    .sub(128)
    .div(127)
    .mul(planUniforms.plateClamps.y)
  const near = float(1).sub(smoothstep(0, 40, city))
  return smoothstep(0.15, 0.45, a).mul(near).mul(shownAt(pxM)).mul(inside)
}
