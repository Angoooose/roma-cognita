import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  Fn,
  fract,
  fwidth,
  If,
  length,
  max,
  min,
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
import { DATA_RECT, ROOT } from '@roman-map/world'
import { politicalShading } from '../politics/shading.ts'
import { roadShading } from '../roads/shading.ts'
import { GRATICULE_INK, graticuleNode } from '../edge/graticule.ts'
import { knownDistanceKm, noise2, paperNode } from '../edge/paper.ts'
import { seededNoise } from './noise.ts'
import { waterLattice, waterShading } from './water.ts'

/**
 * Terrain shading: ground colour from climate and terrain, multi-directional light, and
 * water from the coast mask and the baked depth (water.ts).
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
  /**
   * Distance to the edge of the known world (`npm run known -w pipeline`; decoded by
   * edge/paper.ts `knownDistanceKm`). Until it loads, or if it was never built, all of
   * it reads as known and the colour runs to the edge of the data.
   */
  known: (() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
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

const RIVER = rgb('#3D7A8E')
export const INK = rgb('#2A241E')

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

/**
 * A bound on the ground noise's magnitude, for skipping it where no value could matter.
 * Perlin noise on a plane stays within about ±1; this leaves a factor of two.
 */
const NOISE_BOUND = 2

export interface TileFrame {
  x0: number
  y0: number
  size: number
}

/** A tile's own data textures, in the order the worker builds them. */
export interface TileTextures {
  terrain: THREE.DataTexture
  water: THREE.DataTexture
  politics: THREE.DataTexture
  roads: THREE.DataTexture
}

/**
 * The terrain material, one for every tile. Building a node material's shader is the
 * expensive part — some 30 ms of the main thread for this graph — and three rebuilds it
 * for every material it has not seen, even when the WGSL comes out the same. So there
 * is one graph, and what differs per tile (its textures and where it sits) is swapped in
 * by `bind` just before the tile draws: three keeps each object's bindings apart.
 */
export function createTerrainMaterial(n: number) {
  const slots = {
    terrain: texture(blankTile(THREE.RGBAFormat)),
    water: texture(blankTile(THREE.RGBAFormat)),
    politics: texture(blankTile(THREE.RGBAFormat)),
    roads: texture(blankTile(THREE.RGFormat)),
  }
  // Uniforms, not literals: a number baked into the graph makes a distinct shader per
  // tile size. Set per tile by `bind`.
  const skirtDepth = uniform(0)
  const standInDrop = uniform(0)
  const origin = uniform(new THREE.Vector2())
  const extent = uniform(1)
  const texelM = uniform(1)
  const lattice = waterLattice(uv().mul(extent))

  const mat = new THREE.MeshBasicNodeMaterial()
  // Skirts face every way; culling them by winding would open the cracks they hide.
  mat.side = THREE.DoubleSide

  // Texels are vertex-aligned: uv 0 and 1 land on the centres of the edge texels, which
  // is what lets neighbouring tiles agree exactly along their shared edge.
  const texUV = uv().mul((n - 1) / n).add(0.5 / n)
  const h = texture(slots.terrain, texUV).level(float(0)).r
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    h
      .mul(terrainUniforms.verticalExaggeration)
      .add(positionLocal.z.mul(skirtDepth))
      .sub(standInDrop),
  )

  const s = texture(slots.terrain, texUV)
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
  const km = origin.add(uv().mul(extent))
  // Kilometres per screen pixel: detail finer than about two pixels is faded out rather
  // than left to shimmer.
  const pxKm = max(fwidth(km.x), 1e-6)
  const pxM = pxKm.mul(1000)
  const detail = (wavelengthKm: number) => float(1).sub(smoothstep(wavelengthKm / 6, wavelengthKm / 2, pxKm))
  /**
   * `noise × amplitude × detail`, skipping the noise wherever the fade is 0 and
   * the product is nothing: most of the map, for the finer scales, at the overview —
   * and wherever `matters` says no value of it could change the result.
   */
  const detailNoise = (
    wavelengthKm: number,
    seed: number,
    amplitude: number,
    matters: THREE.Node<'bool'> | null = null,
  ) =>
    Fn(() => {
      const fade = detail(wavelengthKm).toVar()
      const v = float(0).toVar()
      const needed = fade.greaterThan(0)
      If(matters ? needed.and(matters) : needed, () => {
        v.assign(noise(wavelengthKm, seed).mul(amplitude).mul(fade))
      })
      return v
    })()
  const noise = (wavelengthKm: number, seed: number) => seededNoise(km.div(wavelengthKm), seed)

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
  const patch = detailNoise(6, 2, 0.05)
  const grain = detailNoise(0.6, 3, 0.04)
  ground = ground.mul(float(1).add(drift).add(patch).add(grain))

  // Deserts are not one colour: sand seas are pale, rocky plateaus, escarpments and wadi
  // walls darker and redder. Only the terrain decides which is which — a noise field
  // here was tried and read as camouflage, patches the ground does not have.
  const rough = smoothstep(0.02, 0.18, slope)
  const desertTone = mix(GROUND_DESERT.mul(1.04), GROUND_DESERT_ROCK, rough)
  ground = mix(ground, desertTone, b.r.mul(0.8))

  // Rock on steep ground and bare ground high up. The noise is within ±2 (NOISE_BOUND),
  // so below a slope of 0.05 it cannot lift the ground to the rock's threshold of 0.35.
  const rockBreak = detailNoise(1.5, 4, 0.15, slope.greaterThan(0.35 - 0.15 * NOISE_BOUND))
  const rock = max(smoothstep(0.35, 0.8, slope.add(rockBreak)), smoothstep(1700, 2600, height))
  ground = mix(ground, ROCK, rock.mul(0.85))
  // Snow: permanent only on the highest ground, lower where the climate is cold.
  const snowLine = mix(float(3000), float(2400), b.a)
  // Its noise (±150 m × NOISE_BOUND) is only needed within reach of the snow line.
  const snowNoise = Fn(() => {
    const v = float(0).toVar()
    If(height.add(150 * NOISE_BOUND).greaterThan(snowLine), () => {
      v.assign(noise(2, 5).mul(150))
    })
    return v
  })()
  const snow = smoothstep(snowLine, snowLine.add(500), height.add(snowNoise))
  ground = mix(ground, SNOW, snow.mul(float(1).sub(smoothstep(0.9, 1.3, slope))))

  const litLand = ground.mul(clamp(shade, 0, 1.6).mul(0.7).add(0.3))

  // --- water -------------------------------------------------------------------------
  const w = texture(slots.water, texUV)
  const shore = w.r // metres to the shore, positive on land
  const depth = w.g // metres, ≤ 0
  // One screen pixel, in metres of shore distance: everything that should look the same
  // width at every zoom is measured in these.
  const px = max(fwidth(shore), 1e-3)
  const isLand = smoothstep(px.mul(-0.5), px.mul(0.5), shore)

  const [kaz, kalt] = LIGHTS[0]
  const { water, wet } = waterShading({
    shore,
    isLand,
    depth,
    height,
    slope,
    lattice: lattice.at,
    pxM,
    detail,
    light: lightVector(kaz, kalt),
  })

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
  // Wet sand along low, flat shores: darker and a touch cooler, as damp ground is.
  const ground0 = mix(litLand, litFertile, floodplain.mul(0.9)).mul(
    mix(vec3(1, 1, 1), vec3(0.72, 0.74, 0.76), wet),
  )

  // Politics (politics/shading.ts). The fill is lit by the same light as the ground, but
  // compressed towards flat, so relief still reads through it without muddying it; the
  // glow and the border are printed over the rivers, as ink would be.
  const pol = politicalShading(slots.politics, n, pxKm)
  const lit = clamp(shade, 0, 1.6).mul(0.4).add(0.6)
  const litFill = pol.fill.mul(lit)
  const tinted = mix(ground0, litFill, pol.fillAlpha)
  const glowed = mix(tinted, pol.glow.mul(lit), pol.glowAlpha)
  const withRivers = mix(glowed, RIVER, inRiver)
  // Roads over the rivers they cross, under the borders.
  const road = roadShading(slots.roads, n, pxM, texelM)
  const withRoads = mix(withRivers, road.colour, road.alpha)
  const landWithRivers = mix(withRoads, pol.line, pol.lineAlpha)

  // A hairline of ink on the shore, as on an engraved plate.
  const coastLine = float(1).sub(smoothstep(0, px.mul(0.9), abs(shore)))

  // --- terra incognita: the unfinished sketch -----------------------------------------
  // Past the known world the map stops claiming anything. Colour drains away and leaves
  // only what a cartographer inks first: the coast, a few offshore lines along it, the
  // rivers, contours on the high ground and the graticule. Nothing here is invented —
  // every line is drawn from the same physical data as the coloured map, only not
  // filled in. Where it begins is the edge of the known world (data/known-world.yaml),
  // made to wander a little further so its straight segments never read as ruled.
  const knownKm = knownDistanceKm(terrainTextures.known, km)

  // How far inside the edge of the data rectangle this point is. The rectangle bounds
  // the frame plus 3° and is closest to it in the far north, where 3° of longitude is
  // only ~160 km; everywhere else the data reaches further.
  const toRectKm = min(
    min(km.x.sub(DATA_RECT.minX / 1000), float(DATA_RECT.maxX / 1000).sub(km.x)),
    min(km.y.sub(DATA_RECT.minY / 1000), float(DATA_RECT.maxY / 1000).sub(km.y)),
  )

  // Everything below costs some twenty noise lookups a pixel, and most of the map is
  // nowhere near the edge — so it is drawn only where it can show. The wash's wobble
  // (±175 km in toKnownKm, ±47 in its ragged edge) and the pooling inside it (at most
  // max(5 px, 14 km)) cannot reach further in than this bound; inside it the result is
  // exactly the coloured map.
  const nearEdge = max(knownKm, float(150).sub(toRectKm)).greaterThan(
    max(pxKm.mul(5), 14).add(260).negate(),
  )

  const sketchNoise = (wavelengthKm: number, seed: number) => noise2(km.div(wavelengthKm), seed)
  const toKnownKm = knownKm.add(sketchNoise(650, 23).mul(130)).add(sketchNoise(180, 21).mul(45))

  // The colour stops the way a wash does: at a crisp, ragged edge, a little darker just
  // inside it where the pigment pooled — not a long blend, which over the sea went to
  // mud between navy and paper. It stops at the known world's edge, or 150 km short of
  // the data's if that comes first, leaving room for the sketch. `pastWash` is how far
  // past that edge a point is; `unknown` how much of the sketch shows there.
  const ragged = sketchNoise(40, 24)
    .mul(35)
    .add(sketchNoise(12, 25).mul(12).mul(detail(12)))
  const pastWash = max(toKnownKm, float(150).sub(toRectKm)).add(ragged)
  const washAA = max(pxKm.mul(1.2), 1.5)

  // The sketch, for the branch. Derivatives are undefined inside a branch (and WGSL
  // rejects them), so the ones it needs are taken outside and passed in: `kmDx` and
  // `kmDy` for the graticule, `hw` for the contours.
  const sketchAt = (
    pastWash: THREE.Node<'float'>,
    kmDx: THREE.Node<'vec2'>,
    kmDy: THREE.Node<'vec2'>,
    hw: THREE.Node<'float'>,
  ): THREE.Node<'vec3'> => {

    // Then the sketch trails off, as a drawing left unfinished does: each kind of line
    // gives out at its own distance past the wash — contours first, then rivers, the
    // offshore lines and the coast, and last the graticule, the construction lines drawn
    // before anything else. A line does not dim as it goes; it breaks, like a pen running
    // dry, into dashes and then nothing. Everything is gone before the edge of the data.
    const fadeNoise = sketchNoise(160, 22).mul(30)
    const past = pastWash.add(fadeNoise)
    const rectKeep = smoothstep(10, 70, toRectKm.add(fadeNoise))
    // Where along a line the pen gives out: broad gaps at the overview, finer breaks close
    // in, each faded by pixel size like the ground's noise.
    const breaks = sketchNoise(60, 31)
      .mul(0.6)
      .add(sketchNoise(14, 32).mul(0.4).mul(detail(14)))
      .mul(0.5)
      .add(0.5)
    const trail = (fromKm: number, toKm: number) => {
      const t = smoothstep(fromKm, toKm, past).mul(1.3).sub(0.15)
      return smoothstep(t.sub(0.12), t.add(0.12), breaks).mul(rectKeep)
    }
    // Pen pressure: a little heavier and lighter along every line.
    const pressure = float(0.82).add(sketchNoise(4, 33).mul(0.25).mul(detail(4)))
    const blank = max(smoothstep(400, 720, past), float(1).sub(rectKeep))

    // The paper (edge/paper.ts), land and sea alike. Near the wash it keeps a faint
    // mottle and a breath of relief from the ground beneath; both are gone by the blank,
    // where it must match the paper beneath the map (edge/PaperLayer.ts) exactly.
    const sheet = paperNode(km, pxKm, knownKm)

    // The graticule, every 5°, only in the sketch: the cartographer's construction lines.
    // Unlike the rest it does not trail off — it runs on at full strength past the edge
    // of the data, where the paper beneath the map (edge/PaperLayer.ts) carries it on.
    const graticule = graticuleNode(km, kmDx, kmDy).mul(GRATICULE_INK)

    // Past the blank that is all there is: every other line has trailed off by 600 km
    // and the mottle by 720. The lines are drawn only short of it.
    const sketch = mix(sheet, INK, graticule).toVar()
    If(past.lessThan(720).and(rectKeep.greaterThan(0)), () => {
      const mottle = float(1).add(drift.mul(0.5)).add(patch.mul(0.3))
      const relief = mix(float(1), clamp(shade, 0, 1.6).mul(0.14).add(0.86), isLand)
      const paper = mix(sheet.mul(mottle).mul(relief), sheet, blank)

      // Offshore lines: three hairlines following the coast a few pixels out, fainter as
      // they go, as on an engraved chart.
      const offPx = shore.negate().div(px)
      const ripple = (at: number, weight: number) =>
        float(1)
          .sub(smoothstep(0.3, 0.85, abs(offPx.sub(at))))
          .mul(weight)
      // Only along the sea: round every lake they turn the lake country into a scribble.
      const atSea = float(1).sub(smoothstep(1, 3, height))
      // And only where the shore distance is finer than the lines: from coarse texels they
      // trace the texel grid as a maze.
      const fineShore = float(1).sub(smoothstep(1.5, 3, texelM.div(pxM)))
      const ripples = max(max(ripple(4, 0.45), ripple(8.5, 0.3)), ripple(14, 0.18))
        .mul(atSea)
        .mul(fineShore)

      // Contours every 500 m on the high ground only, dropped where they would crowd
      // closer than a few pixels (mountains at the overview) and where the tile's texels
      // are big on screen — bilinear heights draw their grid as square contours.
      const hq = height.div(500)
      const contourPx = abs(fract(hq.add(0.5)).sub(0.5)).div(hw)
      const contour = float(1)
        .sub(smoothstep(0.35, 0.9, contourPx))
        .mul(float(1).sub(smoothstep(0.12, 0.3, hw)))
        .mul(float(1).sub(smoothstep(2, 4, texelM.div(pxM))))
        .mul(smoothstep(350, 500, height))
        .mul(isLand)

      const drawnInk = max(
        max(
          coastLine.mul(mix(float(0.4), float(0.75), atSea)).mul(trail(40, 600)),
          ripples.mul(trail(20, 300)),
        ),
        max(
          contour.mul(0.3).mul(trail(0, 200)),
          inRiver.mul(isLand).mul(0.45).mul(trail(10, 280)),
        ),
      )
      // Pen pressure varies the drawn lines only: the graticule must match the paper's.
      sketch.assign(mix(paper, INK, max(drawnInk.mul(pressure), graticule)))
    })
    return sketch
  }

  mat.colorNode = Fn(() => {
    // Derivatives first, and the samples they read, outside the branches below: inside
    // one, a derivative is undefined, and a sample first taken there is not taken for
    // pixels that skip it. The pixel size in km is taken by `nearEdge`, in shore metres
    // by `isLand`.
    const kmDx = dFdx(km).toVar()
    const kmDy = dFdy(km).toVar()
    const hw = max(fwidth(height.div(500)), 1e-4).toVar()
    const landCover = isLand.toVar()

    // The wash, only near the known world's edge; everywhere else it is the map.
    const past = float(0).toVar()
    const unknown = float(0).toVar()
    const pooled = float(0).toVar()
    If(nearEdge, () => {
      past.assign(pastWash)
      unknown.assign(smoothstep(washAA.negate(), washAA, past))
      pooled.assign(smoothstep(max(pxKm.mul(5), 14).negate(), 0, past))
    })

    // The coloured map, except where the sketch covers it entirely.
    const colour = vec3(0).toVar()
    If(unknown.lessThan(1), () => {
      const sea = water.toVar()
      // Open sea is drawn from the water alone: the land's shading, most of the cost, is
      // mixed in by `isLand`, which is 0 there. So it is only worked out where it shows.
      const land = vec3(0).toVar()
      If(landCover.greaterThan(0), () => {
        land.assign(landWithRivers)
      })
      const coloured = mix(mix(sea, land, landCover), INK, coastLine.mul(0.35))
      colour.assign(coloured.mul(float(1).sub(pooled.mul(0.12))))
    })

    // The sketch, only where some of it shows.
    If(unknown.greaterThan(0), () => {
      colour.assign(mix(colour, sketchAt(past, kmDx, kmDy, hw), unknown))
    })
    return colour
  })()

  /** Points the material at one tile; called from the tile's `onBeforeRender`. */
  const bind = (tile: TileFrame, t: TileTextures) => {
    slots.terrain.value = t.terrain
    slots.water.value = t.water
    slots.politics.value = t.politics
    slots.roads.value = t.roads
    // Deep enough to hide the gap where a coarse stand-in meets fine tiles in the
    // mountains; 1% of the tile left dark cracks along tile edges on zoom-outs.
    skirtDepth.value = tile.size * 0.03
    // Coarser tiles sit slightly lower, so where a stand-in and the finer tiles over it
    // are both drawn the finer one wins the depth test. Invisible from above: 0.1% of the
    // tile's size, 7 m at level 10, 1.8 km for the whole-map level-2 tiles.
    standInDrop.value = tile.size * 0.001
    origin.value.set(tile.x0 / 1000, tile.y0 / 1000)
    extent.value = tile.size / 1000
    texelM.value = tile.size / (n - 1)
    lattice.set(tile)
  }
  return { material: mat, bind }
}

/** Stands in for a tile's texture until the first tile binds its own: same format, same sampler. */
function blankTile(format: THREE.PixelFormat) {
  const channels = format === THREE.RGFormat ? 2 : 4
  const t = new THREE.DataTexture(new Uint16Array(channels), 1, 1, format, THREE.HalfFloatType)
  t.minFilter = t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}
