import * as THREE from 'three/webgpu'
import { clamp, float, floor, int, ivec2, max, min, mix, select, smoothstep, texture, textureLoad, uniform, uv, vec3 } from 'three/tsl'

/**
 * Roman roads, painted into the terrain like the rivers (DESIGN.md §7.4): a cased
 * line — cream core, dark edges — from each tile's distance-to-road field, so a road sits on the relief at any
 * tilt. The field also carries the nearest road's first year, class and certainty
 * (packRoad in heightWorker.ts), so the timeline shows a road only from the year the
 * source dates it, and never before.
 *
 * - Main roads appear from the regional view in, secondary roads closer; never at the
 *   overview.
 * - Certainty sets the strength: surveyed roads solid, conjectured lighter,
 *   hypothetical faint. Itiner-e surveys only a small share of its segments as certain.
 */
export const roadUniforms = {
  /** The year shown, astronomical. */
  year: uniform(-62),
  enabled: uniform(1),
  /** Device pixels per CSS pixel: widths are CSS px, so a road looks the same on any screen. */
  pixelRatio: uniform(1),
}

/** The road's edges and its core. */
const EDGE = new THREE.Color('#2E1C13')
const CORE = new THREE.Color('#E4D3AE')

type F = THREE.Node<'float'>

export function roadShading(tex: THREE.TextureNode, n: number, pxM: F, texelM: F) {
  // Distance interpolates; the code is read from the nearest texel, never blended.
  const d = texture(tex, uv().mul((n - 1) / n).add(0.5 / n)).r
  const near = min(floor(uv().mul(n - 1).add(0.5)), float(n - 1))
  const code = floor((textureLoad(tex, ivec2(int(near.x), int(near.y))) as unknown as THREE.Node<'vec4'>).y.add(0.5))
  const year = floor(code.div(6)).sub(300)
  const rest = code.sub(floor(code.div(6)).mul(6))
  const secondary = select(rest.greaterThanEqual(3), float(1), float(0))
  const certainty = rest.sub(secondary.mul(3))

  const built = select(year.lessThanEqual(roadUniforms.year), float(1), float(0))
  // Zoom: roads belong to the regional view and closer, never the overview — main
  // roads from ~900 m/px, secondary from ~400.
  const cssM = pxM.mul(roadUniforms.pixelRatio)
  const mainOn = float(1).sub(smoothstep(650, 950, cssM))
  const secondaryOn = float(1).sub(smoothstep(280, 420, cssM))
  const zoom = mix(mainOn, secondaryOn, secondary)

  // A cased road, the atlas symbol: a warm core between two fine dark edges, in the
  // same language as the settlement names (light type, dark halo). Widths in pixels.
  const widthPx = mix(float(3.2), float(2.4), secondary).mul(roadUniforms.pixelRatio)
  const edgePx = mix(float(0.8), float(0.7), secondary).mul(roadUniforms.pixelRatio)
  // Never narrower than ~0.6 texel, capped in pixels — the river rule (material.ts):
  // a bilinear distance overestimates on the line's centre, and a line thinner than
  // that breaks into dashes between texel centres.
  const floorM = texelM.mul(0.6).min(pxM.mul(1.4))
  const outer = max(widthPx.mul(pxM).mul(0.5), floorM)
  const inner = max(outer.sub(edgePx.mul(pxM)), float(0))
  const aa = max(pxM.mul(0.5), texelM.mul(0.3).min(pxM.mul(1.2)))
  const casing = float(1).sub(smoothstep(outer.sub(aa), outer.add(aa), d))
  const core = float(1).sub(smoothstep(inner.sub(aa), inner.add(aa), d))
  // Certainty: surveyed roads full strength, conjectured lighter, hypothetical faint.
  const strength = select(certainty.lessThan(0.5), float(1), select(certainty.lessThan(1.5), float(0.8), float(0.55)))
  const alpha = clamp(casing.mul(strength).mul(zoom).mul(built).mul(roadUniforms.enabled), 0, 1)
  const colour = mix(vec3(EDGE.r, EDGE.g, EDGE.b), vec3(CORE.r, CORE.g, CORE.b), core.div(max(casing, 1e-3)).clamp(0, 1))
  return { colour, alpha }
}
