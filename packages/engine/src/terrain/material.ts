import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  fwidth,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { ROOT } from '@roman-map/world'
import { politicalShading } from '../politics/shading.ts'
import { roadShading } from '../roads/shading.ts'

/**
 * Terrain shading: ground colour from climate and terrain, multi-directional light, and
 * water from the coast mask.
 *
 * Ground is built only from physical data (DESIGN.md §7.1): the climate texture picks
 * the colour family, slope and height decide rock and snow, and noise breaks up flat
 * colour at three scales. Nothing here draws a field, a forest or a settlement — those
 * would be claims, and claims need evidence. Colours are the tokens in §8.1.
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

/**
 * Textures every tile shares. The climate texture is baked by `npm run biome -w
 * pipeline`; until it loads (or if it was never built) every texel reads as humid
 * temperate, which is the colour the spike used.
 */
export const terrainTextures = {
  biome: (() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
    t.needsUpdate = true
    return t
  })() as THREE.Texture,
}

// Ground colour families, one per climate channel of the biome texture.
const GROUND_TEMPERATE = rgb('#7F8757')
const GROUND_DESERT = rgb('#CDB28A')
const GROUND_DESERT_ROCK = rgb('#B08C68')
const GROUND_STEPPE = rgb('#B8A77C')
const GROUND_DRY_SUMMER = rgb('#939260')
const GROUND_COLD = rgb('#7C8264')
const GROUND_FLOODPLAIN = rgb('#738049')
const ROCK = rgb('#8C8378')
const SNOW = rgb('#E9E6E0')

const SEA_DEEP = rgb('#1E3150')
const SEA_SHALLOW = rgb('#4E7F8A')
const LAKE = rgb('#2F6478')
const RIVER = rgb('#3D7A8E')
const INK = rgb('#2A241E')

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

export interface TileFrame {
  x0: number
  y0: number
  size: number
}

export function createTerrainMaterial(
  terrainTex: THREE.DataTexture,
  waterTex: THREE.DataTexture,
  politicsTex: THREE.DataTexture,
  roadsTex: THREE.DataTexture,
  n: number,
  tile: TileFrame,
) {
  // Deep enough to hide the gap where a coarse stand-in meets fine tiles in the
  // mountains; 1% of the tile left dark cracks along tile edges on zoom-outs.
  const skirtDepth = tile.size * 0.03
  // Coarser tiles sit slightly lower, so where a stand-in and the finer tiles over it
  // are both drawn the finer one wins the depth test. Invisible from above: 0.1% of the
  // tile's size, 7 m at level 10, 1.8 km for the whole-map level-2 tiles.
  const standInDrop = uniform(tile.size * 0.001)
  const mat = new THREE.MeshBasicNodeMaterial()
  // Skirts face every way; culling them by winding would open the cracks they hide.
  mat.side = THREE.DoubleSide

  // Texels are vertex-aligned: uv 0 and 1 land on the centres of the edge texels, which
  // is what lets neighbouring tiles agree exactly along their shared edge.
  const texUV = uv().mul((n - 1) / n).add(0.5 / n)
  const h = texture(terrainTex, texUV).level(float(0)).r
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    // A uniform, not a literal: a number baked into the graph makes a distinct shader
    // per tile size, and each one compiles — a 200 ms hitch per new zoom level.
    h
      .mul(terrainUniforms.verticalExaggeration)
      .add(positionLocal.z.mul(uniform(skirtDepth)))
      .sub(standInDrop),
  )

  const s = texture(terrainTex, texUV)
  const height = s.r
  const grad = vec2(s.g, s.b).mul(terrainUniforms.shadeExaggeration)
  const normal = normalize(vec3(grad.x.negate(), grad.y.negate(), 1))

  let shade: THREE.Node<'float'> = float(0)
  for (const [az, alt, w] of LIGHTS) {
    const L = lightVector(az, alt)
    // Normalised so flat ground reads 1 and only slopes move away from the base colour.
    shade = shade.add(max(dot(normal, vec3(L.x, L.y, L.z)), 0).mul(w / L.z))
  }

  // --- ground ------------------------------------------------------------------------
  // World position in km, for noise that runs continuously across tiles. Kilometres
  // rather than metres keep the noise lattice small enough for float32 at every zoom.
  // Uniforms, not literals, so every tile shares one compiled shader.
  const origin = uniform(new THREE.Vector2(tile.x0 / 1000, tile.y0 / 1000))
  const extent = uniform(tile.size / 1000)
  const km = origin.add(uv().mul(extent))
  // Kilometres per screen pixel: detail finer than about two pixels is faded out rather
  // than left to shimmer.
  const pxKm = max(fwidth(km.x), 1e-6)
  const pxM = pxKm.mul(1000)
  const detail = (wavelengthKm: number) => float(1).sub(smoothstep(wavelengthKm / 6, wavelengthKm / 2, pxKm))
  const noise = (wavelengthKm: number, seed: number) => mx_noise_float(vec3(km.div(wavelengthKm), seed))

  // Slope is the raw gradient — the real steepness, not the exaggerated one the lighting
  // uses — so it means the same at every zoom (coarse tiles smooth it, which is right:
  // cliffs are not visible there).
  const slope = length(vec2(s.g, s.b))

  // Climate. The biome texture spans the quadtree root; image row 0 is the north edge.
  const rootKm = ROOT.size / 1000
  const biomeUV = vec2(
    km.x.sub(ROOT.x / 1000).div(rootKm),
    float(1).sub(km.y.sub(ROOT.y / 1000).div(rootKm)),
  )
  // Climate zones never meet along a line on the ground, so their edges are warped by
  // ~25 km of low-frequency noise: the texture's 3.5 km texels otherwise draw the
  // boundary as a crisp contour at the overview.
  const warp = vec2(noise(90, 11), noise(90, 12)).mul(25 / rootKm)
  const b = texture(terrainTextures.biome, biomeUV.add(warp))
  const temperate = clamp(float(1).sub(b.r).sub(b.g).sub(b.b).sub(b.a), 0, 1)
  let ground: THREE.Node<'vec3'> = GROUND_TEMPERATE.mul(temperate)
    .add(GROUND_DESERT.mul(b.r))
    .add(GROUND_STEPPE.mul(b.g))
    .add(GROUND_DRY_SUMMER.mul(b.b))
    .add(GROUND_COLD.mul(b.a))

  // Three scales of variation, so flat colour never reads as flat: regional drift
  // (~60 km), patchwork (~6 km) and grain (~600 m, only once it is resolvable). Each
  // moves lightness a few percent and nudges between the ground's own family and its
  // neighbours, never towards a colour the climate did not pick.
  const drift = noise(60, 1).mul(0.06)
  const patch = noise(6, 2).mul(0.05).mul(detail(6))
  const grain = noise(0.6, 3).mul(0.04).mul(detail(0.6))
  ground = ground.mul(float(1).add(drift).add(patch).add(grain))

  // Deserts are not one colour: sand seas are pale, rocky plateaus, escarpments and wadi
  // walls darker and redder. Only the terrain decides which is which — a noise field
  // here was tried and read as camouflage, patches the ground does not have.
  const rough = smoothstep(0.02, 0.18, slope)
  const desertTone = mix(GROUND_DESERT.mul(1.04), GROUND_DESERT_ROCK, rough)
  ground = mix(ground, desertTone, b.r.mul(0.8))

  // Rock on steep ground and bare ground high up.
  const rockBreak = noise(1.5, 4).mul(0.15).mul(detail(1.5))
  const rock = max(smoothstep(0.35, 0.8, slope.add(rockBreak)), smoothstep(1700, 2600, height))
  ground = mix(ground, ROCK, rock.mul(0.85))
  // Snow: permanent only on the highest ground, lower where the climate is cold.
  const snowLine = mix(float(3000), float(2400), b.a)
  const snow = smoothstep(snowLine, snowLine.add(500), height.add(noise(2, 5).mul(150)))
  ground = mix(ground, SNOW, snow.mul(float(1).sub(smoothstep(0.9, 1.3, slope))))

  const litLand = ground.mul(clamp(shade, 0, 1.6).mul(0.7).add(0.3))

  // --- water -------------------------------------------------------------------------
  const w = texture(waterTex, texUV)
  const shore = w.r // metres to the shore, positive on land
  const depth = w.g // metres, ≤ 0
  // One screen pixel, in metres of shore distance: everything that should look the same
  // width at every zoom is measured in these.
  const px = max(fwidth(shore), 1e-3)
  const isLand = smoothstep(px.mul(-0.5), px.mul(0.5), shore)

  // Depth carries the shallows where the sea floor really shelves; a narrow screen-space
  // rim along every shore keeps the coast legible where the bathymetry is too coarse to.
  // Squared so the ramp tightens against the coast: the source is ~1–2 km at sea, and a
  // wide ramp over it shows its blobs where the floor falls away.
  const shelf = smoothstep(-160, -6, depth).pow(2)
  const rim = float(1).sub(smoothstep(0, px.mul(7), shore.negate()))
  const sea = mix(SEA_DEEP, SEA_SHALLOW, max(shelf.mul(0.8), rim.mul(0.45)))
  // Lakes sit above sea level; the sea and the below-sea-level seas (Caspian, Dead Sea)
  // do not. Lakes take one flat colour — no shelf, the depth source does not know them.
  const lake = mix(LAKE, SEA_SHALLOW, rim.mul(0.35))
  const water = mix(sea, lake, smoothstep(1, 3, height))

  // Rivers, from the per-texel distance and discharge the worker computed (see
  // rivers.ts for the sizing, which this mirrors). A river is drawn at its real width
  // once that is more than a pixel or two, and at a width that grows with discharge
  // before then — so the Nile reads as the Nile at the overview without turning into a
  // kilometre-wide band when zoomed in. Whether it shows at all follows the same rule
  // the worker used to choose which rivers a tile carries.
  const riverDist = w.b
  // Negative discharge marks a reconstructed course: our line between attested sites,
  // drawn thinner and paler so it never reads as a surveyed river.
  const reconstructed = smoothstep(0, -1e-3, w.a)
  const riverQ = max(abs(w.a), 1e-3)
  const qMin = pxM.div(30).pow(1.3)
  const visible = smoothstep(qMin, qMin.mul(2), riverQ)
  const screenWidth = clamp(float(0.8).add(riverQ.div(qMin).log2().mul(0.35)), 0.8, 3.2)
  // Never thinner than ~1.2 texels. The stored distance is bilinearly interpolated, and
  // on a line's centre that overestimates it by up to half a texel (more on the
  // diagonal); a line drawn thinner than that breaks into dashes wherever it runs
  // between texel centres — and where that happens shifts with every zoom step.
  const texelM = uniform(tile.size / (n - 1))
  // Capped in pixels, so a magnified stand-in tile cannot turn a river into a band.
  const texelFloor = texelM.mul(0.6).min(pxM.mul(1.5))
  const halfWidth = max(riverQ.sqrt().mul(3), screenWidth.mul(pxM).mul(0.5), texelFloor).mul(
    mix(float(1), float(0.7), reconstructed),
  )
  const aa = max(pxM.mul(0.5), texelM.mul(0.3).min(pxM.mul(1.5)))
  const inRiver = float(1)
    .sub(smoothstep(halfWidth.sub(aa), halfWidth.add(aa), riverDist))
    .mul(visible)
    .mul(mix(float(1), float(0.45), reconstructed))
  // Floodplains: the irrigated land of the Nile, the Fayum and the Mesopotamian
  // alluvium, from authored and sourced `floodplain` records baked into the coast mask
  // (DESIGN.md §7.1). Edges are soft over a few hundred metres, and never narrower
  // than a pixel so they do not alias.
  const toFloodplain = s.a // metres to the floodplain edge, positive inside
  const edge = max(float(250), pxM)
  const floodplain = smoothstep(edge.negate(), edge, toFloodplain)
  const fertile = GROUND_FLOODPLAIN.mul(float(1).add(patch).add(grain))
  const litFertile = fertile.mul(clamp(shade, 0, 1.6).mul(0.7).add(0.3))
  const ground0 = mix(litLand, litFertile, floodplain.mul(0.9))

  // Politics (politics/shading.ts). The fill is lit by the same light as the ground, but
  // compressed towards flat, so relief still reads through it without muddying it; the
  // glow and the border are printed over the rivers, as ink would be.
  const pol = politicalShading(politicsTex, n, pxKm)
  const lit = clamp(shade, 0, 1.6).mul(0.4).add(0.6)
  const litFill = pol.fill.mul(lit)
  const tinted = mix(ground0, litFill, pol.fillAlpha)
  const glowed = mix(tinted, pol.glow.mul(lit), pol.glowAlpha)
  const withRivers = mix(glowed, RIVER, inRiver)
  // Roads over the rivers they cross, under the borders.
  const road = roadShading(roadsTex, n, pxM, texelM)
  const withRoads = mix(withRivers, road.colour, road.alpha)
  const landWithRivers = mix(withRoads, pol.line, pol.lineAlpha)

  // A hairline of ink on the shore, as on an engraved plate.
  const coastLine = float(1).sub(smoothstep(0, px.mul(0.9), abs(shore)))

  mat.colorNode = mix(mix(water, landWithRivers, isLand), INK, coastLine.mul(0.35))
  return mat
}
