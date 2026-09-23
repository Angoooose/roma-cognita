import * as THREE from 'three/webgpu'
import {
  cameraProjectionMatrix,
  dFdx,
  dFdy,
  Fn,
  fwidth,
  max,
  mix,
  modelViewMatrix,
  positionGeometry,
  vec4,
} from 'three/tsl'
import { ROOT } from '@roman-map/world'
import { GRATICULE_INK, graticuleNode } from './graticule.ts'
import { knownDistanceKm, paperNode } from './paper.ts'
import { INK, terrainTextures } from '../terrain/material.ts'

/**
 * The paper the map is drawn on, reaching far past the terrain: plain paper with the
 * graticule, so the terra incognita's construction lines run on after the terrain data
 * ends instead of stopping at its edge. Where the two meet, the terrain has faded to
 * the same flat paper and draws the same lines (terrain/material.ts).
 *
 * Drawn after the terrain and pinned to the far plane, so the depth test leaves only
 * the pixels no terrain covered: the paper's noise is paid for where it shows, not
 * across the whole screen beneath the map.
 */
export class PaperLayer {
  readonly mesh: THREE.Mesh

  /** Build after the known-world texture has loaded: the paper browns away from it. */
  constructor() {
    const c = new THREE.Vector2(ROOT.x + ROOT.size / 2, ROOT.y + ROOT.size / 2)
    // Far enough that the horizon of the most tilted, furthest view is still paper.
    const h = ROOT.size * 10
    // Plane metres as the vertex positions, so the shader reads them directly.
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        // prettier-ignore
        [c.x - h, c.y - h, 0, c.x + h, c.y - h, 0, c.x + h, c.y + h, 0, c.x - h, c.y + h, 0],
        3,
      ),
    )
    g.setIndex([0, 1, 2, 0, 2, 3])

    const mat = new THREE.MeshBasicNodeMaterial()
    mat.depthWrite = false
    mat.side = THREE.DoubleSide
    // z = w puts every fragment at depth 1, the clear value: it passes the (less-equal)
    // depth test only where nothing has been drawn.
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry, 1))
    mat.vertexNode = vec4(clip.x, clip.y, clip.w, clip.w)

    mat.colorNode = Fn(() => {
      const km = positionGeometry.xy.div(1000)
      // Derivatives first, outside the paper's branches.
      const pxKm = max(fwidth(km.x), 1e-6).toVar()
      const kmDx = dFdx(km).toVar()
      const kmDy = dFdy(km).toVar()
      const sheet = paperNode(km, pxKm, knownDistanceKm(terrainTextures.known, km))
      return mix(sheet, INK, graticuleNode(km, kmDx, kmDy).mul(GRATICULE_INK))
    })()

    this.mesh = new THREE.Mesh(g, mat)
    // After the terrain, so the depth buffer already holds it.
    this.mesh.renderOrder = 1
    this.mesh.frustumCulled = false
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
