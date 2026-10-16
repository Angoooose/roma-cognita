import * as THREE from 'three/webgpu'
import {
  abs,
  float,
  If,
  mix,
  mx_noise_float,
  smoothstep,
  texture,
  vec2,
} from 'three/tsl'
import { ROOT } from '@roma-cognita/world'
import { rgb } from '../color.ts'

/**
 * The paper past the known world, as a surface rather than a flat colour: fibre grain,
 * a few water stains and foxing, and a slow browning away from the known world, as the
 * margins of an old sheet go. Shared by the terrain (its terra incognita) and the paper
 * beneath it (PaperLayer.ts), which must agree exactly where the terrain ends — so it
 * depends only on plane position, pixel size and the distance to the known world,
 * never on anything tile-specific.
 */

export const PAPER_HEX = '#D9CFB8'
const PAPER = rgb(PAPER_HEX)
/** Where the sheet has browned furthest from the known world. */
const PAPER_AGED = rgb('#CDBE9E')
/** A stain's tide line, and the foxing: the brown that old paper spots with. */
const STAIN = rgb('#B7A27B')

/**
 * Gradient noise in the plane, about ±1, with `seed` choosing an independent field. 2D
 * rather than the terrain's 3D-with-a-seed-axis: half the lattice corners, and the
 * paper and the sketch evaluate a dozen or more of these a pixel.
 */
export function noise2(q: THREE.Node<'vec2'>, seed: number): THREE.Node<'float'> {
  return mx_noise_float(q.add(vec2(seed * 37.1, seed * -19.7)))
}

/**
 * Distance to the edge of the known world in km, positive outside, at plane position
 * `km` — from the texture `npm run known -w pipeline` bakes over the quadtree root: 128
 * at the edge, 4 km a step, image row 0 the north edge. Sampled at level 0 (it has no
 * mipmaps), so it may be read inside a branch.
 */
export function knownDistanceKm(
  known: THREE.Texture,
  km: THREE.Node<'vec2'>,
): THREE.Node<'float'> {
  const rootKm = ROOT.size / 1000
  const uv = vec2(
    km.x.sub(ROOT.x / 1000).div(rootKm),
    float(1).sub(km.y.sub(ROOT.y / 1000).div(rootKm)),
  )
  return texture(known, uv).level(float(0)).r.mul(255).sub(128).mul(4)
}

/**
 * `km` is plane position in kilometres, `pxKm` kilometres per screen pixel, `knownKm`
 * the distance to the known world (`knownDistanceKm`). No derivatives or implicit-LOD
 * samples, so the terrain can call it inside a branch; it branches itself, so it must
 * be called inside a `Fn`.
 */
export function paperNode(
  km: THREE.Node<'vec2'>,
  pxKm: THREE.Node<'float'>,
  knownKm: THREE.Node<'float'>,
): THREE.Node<'vec3'> {
  const noise = (q: THREE.Node<'vec2'>, wl: number, seed: number) => noise2(q.div(wl), seed)

  // Browning: none at the known world's edge, full ~500 km out, where the texture's
  // distance saturates — past the quadtree root it clamps, so the far paper is uniform.
  const age = smoothstep(0, 500, knownKm.add(noise(km, 400, 41).mul(120)))
  let colour: THREE.Node<'vec3'> = mix(PAPER, PAPER_AGED, age.mul(0.55))

  // Water stains: a few broad, pale blooms with a darker tide line where each dried,
  // more of them the older the paper. Soft-edged over several pixels at any zoom.
  const bloom = noise(km, 320, 42)
    .mul(0.65)
    .add(noise(km, 90, 43).mul(0.35))
  const edge = float(0.06).max(pxKm.div(40))
  const inside = smoothstep(float(0.34).sub(edge), float(0.34).add(edge), bloom)
  const tide = float(1).sub(smoothstep(0, edge.mul(1.5), abs(bloom.sub(0.34))))
  const stains = age.mul(0.4).add(0.15)
  colour = mix(colour, STAIN, inside.mul(0.1).add(tide.mul(0.22)).mul(stains))

  // Foxing: small scattered spots, only where they are at least a few pixels across.
  // Like the grain below, drawn only at the zooms where it shows: noise is the cost.
  const paper = colour.toVar()
  const foxVisible = float(1).sub(smoothstep(0.4, 1.2, pxKm))
  If(foxVisible.greaterThan(0), () => {
    const spots = noise(km, 12, 44)
      .mul(0.7)
      .add(noise(km, 3, 45).mul(0.3))
    const fox = smoothstep(0.62, 0.72, spots)
    paper.assign(
      mix(paper, STAIN, fox.mul(0.25).mul(foxVisible).mul(age.mul(0.7).add(0.3))),
    )
  })

  // Fibre grain: bands of noise, each shown only while its features are two to eight
  // pixels across, so the paper has a tooth at every zoom and never shimmers. Stretched
  // a little along x, as a laid sheet's fibres run. At most two bands show at once.
  const grain = float(0).toVar()
  for (const [k, wl] of [0.25, 1, 4, 16, 64, 256].entries()) {
    const w = smoothstep(wl / 16, wl / 8, pxKm).mul(
      float(1).sub(smoothstep(wl / 4, wl / 2, pxKm)),
    )
    If(w.greaterThan(0), () => {
      grain.addAssign(noise(vec2(km.x.mul(0.45), km.y), wl, 46 + k).mul(w))
    })
  }
  return paper.mul(float(1).add(grain.mul(0.05)))
}
