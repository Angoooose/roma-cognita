import * as THREE from 'three/webgpu'
import {
  abs,
  asin,
  atan,
  clamp,
  float,
  fract,
  length,
  max,
  smoothstep,
  vec2,
} from 'three/tsl'
import { EARTH_RADIUS, PROJECTION } from '@roman-map/world'

/**
 * Longitude and latitude in the shader, and the graticule drawn from them: the terra
 * incognita sketch's construction lines, which run on past the terrain data onto the
 * paper beneath it (PaperLayer.ts). Both draw it with `graticuleNode`, so the lines
 * meet exactly where the terrain ends.
 */

const RAD = Math.PI / 180

// The Albers constants, as in world/albers.ts, for the inverse in the shader.
const n =
  (Math.sin(PROJECTION.parallels[0] * RAD) + Math.sin(PROJECTION.parallels[1] * RAD)) / 2
const C =
  Math.cos(PROJECTION.parallels[0] * RAD) ** 2 +
  2 * n * Math.sin(PROJECTION.parallels[0] * RAD)
// In km, so the numbers stay well inside float32 range.
const R_KM = EARTH_RADIUS / 1000
const RHO0_KM = (R_KM * Math.sqrt(C - 2 * n * Math.sin(PROJECTION.lat0 * RAD))) / n

/** Longitude and latitude in degrees, from plane km: the spherical Albers inverse. */
function lonLatNode(km: THREE.Node<'vec2'>): THREE.Node<'vec2'> {
  const dy = float(RHO0_KM).sub(km.y)
  const rho = length(vec2(km.x, dy))
  const theta = atan(km.x, dy)
  const s = float(C)
    .sub(rho.mul(n / R_KM).pow(2))
    .div(2 * n)
  const lon = theta
    .div(n)
    .add(PROJECTION.lon0 * RAD)
    .div(RAD)
  const lat = asin(clamp(s, -1, 1)).div(RAD)
  return vec2(lon, lat)
}

/**
 * Ink coverage of the graticule, every 5°, about a pixel wide at any zoom. `kmDx` and
 * `kmDy` are `dFdx(km)` and `dFdy(km)`, taken by the caller: the terrain draws the
 * graticule inside a branch, where derivatives are not allowed. The screen width of a
 * degree comes from differencing the inverse across them, so the inverse is only ever
 * evaluated where the graticule is drawn.
 */
export function graticuleNode(
  km: THREE.Node<'vec2'>,
  kmDx: THREE.Node<'vec2'>,
  kmDy: THREE.Node<'vec2'>,
): THREE.Node<'float'> {
  const ll = lonLatNode(km)
  const llPx = abs(lonLatNode(km.add(kmDx)).sub(ll)).add(
    abs(lonLatNode(km.add(kmDy)).sub(ll)),
  )
  const cell = abs(fract(ll.div(5).add(0.5)).sub(0.5)).mul(5)
  const cellPx = cell.div(max(llPx, 1e-6))
  return max(
    float(1).sub(smoothstep(0.3, 0.9, cellPx.x)),
    float(1).sub(smoothstep(0.3, 0.9, cellPx.y)),
  )
}

/** How dark the graticule's ink is, on the terrain and on the paper beneath it. */
export const GRATICULE_INK = 0.22
