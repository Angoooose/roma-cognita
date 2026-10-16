import * as THREE from 'three/webgpu'
import { vec3 } from 'three/tsl'

/** An sRGB token as a linear-space vec3 (THREE.Color converts on construction). */
export function rgb(hex: string) {
  const c = new THREE.Color(hex)
  return vec3(c.r, c.g, c.b)
}
