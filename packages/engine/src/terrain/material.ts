import * as THREE from 'three/webgpu'
import {
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'

/**
 * Terrain shading for the spike: multi-directional light over a hypsometric ramp.
 *
 * Deliberately plain — no materials, no water, no coast mask yet (DESIGN.md §11, A1).
 * The point is to judge the relief itself. Colours are the draft tokens in §8.1.
 */

/** Shared by every tile, so one write re-lights the whole map. */
export const terrainUniforms = {
  /** Geometric vertical exaggeration; only visible when the camera tilts. */
  verticalExaggeration: uniform(1.5),
  /**
   * Exaggeration applied to the gradient before lighting. Relief at the overview is
   * sampled from coarse texels whose slopes are nearly flat, so it has to be pushed
   * harder the further out the camera is — the controls set this from metres/pixel.
   */
  shadeExaggeration: uniform(1),
}

/** An sRGB token as a linear-space vec3 (THREE.Color converts on construction). */
function rgb(hex: string) {
  const c = new THREE.Color(hex)
  return vec3(c.r, c.g, c.b)
}

const SEA = rgb('#1E3150')
const RAMP: [number, string][] = [
  [0, '#8E9563'],
  [300, '#A3A270'],
  [900, '#B9AE86'],
  [1800, '#A89B8A'],
  [2800, '#D9D5CF'],
]

/** Light directions: azimuth clockwise from north, altitude, weight. NW carries it. */
const LIGHTS: [number, number, number][] = [
  [315, 45, 0.6],
  [270, 40, 0.2],
  [0, 40, 0.2],
]

function lightVector(azDeg: number, altDeg: number) {
  const az = (azDeg * Math.PI) / 180
  const alt = (altDeg * Math.PI) / 180
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt))
}

export function createTerrainMaterial(tex: THREE.DataTexture, n: number, skirtDepth: number) {
  const mat = new THREE.MeshBasicNodeMaterial()
  // Skirts face every way; culling them by winding would open the cracks they hide.
  mat.side = THREE.DoubleSide

  // Texels are vertex-aligned: uv 0 and 1 land on the centres of the edge texels, which
  // is what lets neighbouring tiles agree exactly along their shared edge.
  const texUV = uv().mul((n - 1) / n).add(0.5 / n)
  const vertexSample = texture(tex, texUV).level(float(0))
  const h = vertexSample.r
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    // A uniform, not a literal: a number baked into the graph makes a distinct shader
    // per tile size, and each one compiles — a 200 ms hitch per new zoom level.
    h.mul(terrainUniforms.verticalExaggeration).add(positionLocal.z.mul(uniform(skirtDepth))),
  )

  const s = texture(tex, texUV)
  const height = s.r
  const grad = vec2(s.g, s.b).mul(terrainUniforms.shadeExaggeration)
  const normal = normalize(vec3(grad.x.negate(), grad.y.negate(), 1))

  let shade: THREE.Node<'float'> = float(0)
  for (const [az, alt, w] of LIGHTS) {
    const L = lightVector(az, alt)
    // Normalised so flat ground reads 1 and only slopes move away from the base colour.
    shade = shade.add(max(dot(normal, vec3(L.x, L.y, L.z)), 0).mul(w / L.z))
  }

  let land: THREE.Node<'vec3'> = rgb(RAMP[0][1])
  for (let i = 1; i < RAMP.length; i++) {
    const [h0] = RAMP[i - 1]
    const [h1, c1] = RAMP[i]
    land = mix(land, rgb(c1), smoothstep(h0, h1, height))
  }

  const lit = land.mul(clamp(shade, 0, 1.6).mul(0.7).add(0.3))
  // Temporary: sea is wherever the source says zero. The coast SDF replaces this (A2).
  mat.colorNode = mix(SEA, lit, smoothstep(0.0, 0.5, height))
  return mat
}
