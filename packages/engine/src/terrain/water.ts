import * as THREE from 'three/webgpu'
import {
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  Fn,
  If,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'

/**
 * Water shading, close up and far out (DESIGN.md §7.2).
 *
 * Far out the sea is the paper tier's deliberate contrast: dark navy, a bright band of
 * shallows, a hairline of ink. Close in it earns the same treatment the land gets —
 * detail that arrives as it becomes resolvable, never before — so it stops reading as
 * a flat fill beside 15 m relief:
 *
 * - **Colour from depth, as light falls off in water:** sand showing through the first
 *   few metres, turquoise over the shelf, a mid blue on the slope, navy in the basins.
 *   Each step is an exponential in depth rather than a ramp between two numbers, so it
 *   has no edge for coarse bathymetry to draw.
 * - **A textured surface:** four octaves of noise (~1.6 km swell, ~250 m chop,
 *   ~60 m and ~15 m ripples) perturb a normal, each fading in only once it spans a few pixels.
 *   The normal is lit by the map's own north-west light and gives a warm glint and a
 *   pale sky sheen that grow as the camera tilts.
 * - **Surf in metres, not pixels:** lines of foam parallel to gently shelving shores
 *   (beaches, not cliffs) over the last ~120 m, broken up by noise, with a line of
 *   foam at the water's edge — the engraver's waterlining, read as surf. The fixed 7-pixel rim that stood in for all of this is
 *   kept only at the overview, where it is what makes the coast legible.
 * - **Wet sand:** a darker band a few metres wide along low, flat shores.
 *
 * None of it moves. The map is a plate, not a scene: motion would pull the eye from
 * what the map is about, and a still map only needs drawing when something changes.
 *
 * Nothing here is a claim about the past: it is how water looks, not where anything
 * was. Colours are the tokens in §8.1 plus the steps between them.
 */

function rgb(hex: string) {
  const c = new THREE.Color(hex)
  return vec3(c.r, c.g, c.b)
}

const SEA_DEEP = rgb('#1E3150')
const SEA_MID = rgb('#24506E')
const SEA_SHALLOW = rgb('#4E7F8A')
const SEA_SAND = rgb('#86BCAD')
const LAKE = rgb('#2F6478')
const FOAM = rgb('#E9EEE6')
const GLINT = rgb('#FFF3D6')
const SKY = rgb('#7C98AA')

type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
type V3 = THREE.Node<'vec3'>

/**
 * Wavelengths (km) of every noise the water uses: the four surface octaves, then the
 * two that break up the surf. Each gets its own lattice (see `waterLattice`).
 */
export const WATER_WAVELENGTHS = [1.6, 0.25, 0.06, 0.015, 0.09, 0.03] as const
type Wavelength = (typeof WATER_WAVELENGTHS)[number]

/** Noise cells before the pattern repeats; see `waterLattice`. */
const PERIOD = 256

/**
 * Where a tile sits on each noise lattice, as small numbers the GPU can hold exactly.
 *
 * World kilometres divided by a 15 m wavelength are ~230,000 lattice cells, and at that
 * magnitude float32 steps in sixtieths of a cell: close in, the ripples came out on a
 * visible grid. So the water's noise repeats every PERIOD cells, each tile's offset into
 * that period is worked out here in double precision, and the shader only adds the
 * position within the tile. Neighbouring tiles still meet exactly.
 */
export function waterLattice(tile: { x0: number; y0: number }, local: V2) {
  const lattices = new Map<number, V2>()
  for (const w of WATER_WAVELENGTHS) {
    const o = new THREE.Vector2(wrap(tile.x0 / 1000 / w), wrap(tile.y0 / 1000 / w))
    lattices.set(w, uniform(o).add(local.div(w)))
  }
  return (w: Wavelength) => lattices.get(w)!
}

function wrap(v: number) {
  return ((v % PERIOD) + PERIOD) % PERIOD
}

/** Texels per noise cell in the baked noise (below). */
const TEXELS_PER_CELL = 4
const NOISE_SIZE = PERIOD * TEXELS_PER_CELL
/** Gradient range the texture stores, per cell (quintic value noise stays within ±1.9). */
const GRAD_RANGE = 2

/**
 * The water's noise, baked once: value noise on a PERIOD-cell lattice with its
 * gradient, four texels a cell. An octave is then one texture read, not eight hashes
 * and their interpolation — the arithmetic version made water views 12–25% dearer to
 * draw than before this shading existed. The pattern is the same noise the shader
 * used to compute: quintic value noise over Dave Hoskins' sine-free hash (a sin hash
 * correlates along the axes and drew straight lines through the ripples), so it
 * tiles exactly at the lattice's period.
 *
 * RGBA8: value, then the gradient in x and y mapped from ±GRAD_RANGE. Mipmapped, and
 * read at an explicit level, since the reads sit inside branches where implicit
 * derivatives are undefined.
 */
export const waterNoise = (() => {
  const cells = new Float32Array(PERIOD * PERIOD)
  for (let y = 0; y < PERIOD; y++)
    for (let x = 0; x < PERIOD; x++) cells[y * PERIOD + x] = hash(x, y)
  const at = (x: number, y: number) => cells[(y % PERIOD) * PERIOD + (x % PERIOD)]
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4)
  for (let ty = 0; ty < NOISE_SIZE; ty++) {
    for (let tx = 0; tx < NOISE_SIZE; tx++) {
      // Texel centres, so linear filtering reconstructs the field between them.
      const px = (tx + 0.5) / TEXELS_PER_CELL
      const py = (ty + 0.5) / TEXELS_PER_CELL
      const ix = Math.floor(px)
      const iy = Math.floor(py)
      const fx = px - ix
      const fy = py - iy
      const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
      const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
      const dux = 30 * fx * fx * (fx * (fx - 2) + 1)
      const duy = 30 * fy * fy * (fy * (fy - 2) + 1)
      const a = at(ix, iy)
      const b = at(ix + 1, iy)
      const c = at(ix, iy + 1)
      const d = at(ix + 1, iy + 1)
      const k1 = b - a
      const k2 = c - a
      const k4 = a - b - c + d
      const o = (ty * NOISE_SIZE + tx) * 4
      data[o] = Math.round((a + k1 * ux + k2 * uy + k4 * ux * uy) * 255)
      data[o + 1] = encodeGrad(dux * (k1 + k4 * uy))
      data[o + 2] = encodeGrad(duy * (k2 + k4 * ux))
      data[o + 3] = 255
    }
  }
  const t = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
})()

function encodeGrad(g: number) {
  return Math.round(Math.max(0, Math.min(1, g / (2 * GRAD_RANGE) + 0.5)) * 255)
}

/** Dave Hoskins' "hash without sine", in 0…1. */
function hash(x: number, y: number) {
  const f = (v: number) => v - Math.floor(v)
  let p0 = f(x * 0.1031)
  let p1 = f(y * 0.1031)
  let p2 = 0
  const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33)
  p0 += d
  p1 += d
  p2 += d
  return f((p0 + p1) * p2)
}

/**
 * One octave of the baked noise at lattice position `p`, for a wavelength seen at
 * `pxM` metres a pixel: the mip level is the texels a pixel covers, worked out here
 * because the read may sit in a branch. Value 0…1, gradient per lattice cell.
 */
function noise(p: V2, wavelengthKm: number, pxM: F): { value: F; grad: V2 } {
  const lod = pxM
    .mul(TEXELS_PER_CELL / (wavelengthKm * 1000))
    .max(1)
    .log2()
  const s = texture(waterNoise, p.div(PERIOD)).level(lod)
  return { value: s.r, grad: s.gb.mul(2 * GRAD_RANGE).sub(GRAD_RANGE) }
}

/** Where on the tiled noise each octave reads, so no two octaves share a pattern. */
function slice(seed: number) {
  return vec2((seed * 37.13) % PERIOD, (seed * 71.71) % PERIOD)
}

export interface WaterInputs {
  /** Metres to the shore, positive on land. */
  shore: F
  /** 1 on land, 0 on water, antialiased across the coast. */
  isLand: F
  /** Metres, ≤ 0, below the local water surface. */
  depth: F
  /** Ground height, m — lakes are told from sea by it. */
  height: F
  /** Raw terrain slope (|gradient|), for telling a beach from a cliff on the land side. */
  slope: F
  /** The tile's position on each noise lattice (`waterLattice`). */
  lattice: (wavelengthKm: Wavelength) => V2
  /** Metres per screen pixel. */
  pxM: F
  /** Fades detail of a wavelength (km) out before it would shimmer. */
  detail: (wavelengthKm: number) => F
  /** The map's key light, a unit vector. */
  light: THREE.Vector3
}

/** The surface octaves: wavelength (km), slope amplitude, noise slice. */
const OCTAVES: [Wavelength, number, number][] = [
  [1.6, 0.025, 31],
  [0.25, 0.06, 37],
  [0.06, 0.11, 41],
  [0.015, 0.14, 43],
]

/**
 * The water's colour, and how wet the ground is along the shore.
 *
 * The surface and the surf are most of this shader's cost — a noise octave is eight
 * hashes — and most pixels need neither: land, the overview, and zooms where an
 * octave is finer than a pixel. So they sit behind branches that whole screens take
 * the same way, and cost nothing where they cannot show. Derivatives are undefined
 * inside a branch (and WGSL rejects them), so everything that needs one is evaluated
 * first, outside.
 */
export function waterShading({
  shore,
  isLand,
  depth,
  height,
  slope,
  lattice,
  pxM,
  detail,
  light,
}: WaterInputs) {
  const d = depth.negate().max(0)
  const offshore = shore.negate().max(0)
  // Lakes sit above sea level; the sea and the below-sea-level seas (Caspian, Dead Sea)
  // do not. Lakes keep one colour — no depth is baked for them.
  const lake = smoothstep(1, 3, height)

  const water = Fn(() => {
    const px = pxM.toVar()
    const fades = OCTAVES.map(([w]) => detail(w).toVar())
    // How close in the camera is: 0 at the paper tier, 1 at a province or smaller.
    const close = float(1).sub(smoothstep(60, 600, px))
    // Land pixels are drawn over whatever this returns, so they skip all of it.
    const colour = SEA_DEEP.toVar()
    If(isLand.lessThan(0.999), () => {
      // --- colour from depth -------------------------------------------------------
      let sea: V3 = mix(SEA_DEEP, SEA_MID, exp(d.div(-450)))
      sea = mix(sea, SEA_SHALLOW, exp(d.div(-28)).mul(0.9))
      sea = mix(sea, SEA_SAND, exp(d.div(-3.5)).mul(0.55).mul(close))
      // The overview's shore rim: a band of shallows a few pixels wide along every
      // coast, for where the bathymetry is coarser than the coast. Close in, the depth
      // and the surf carry the shore instead. Measured with the camera's metres per
      // pixel, not the field's own derivative: at an islet smaller than a mask texel that
      // derivative breaks down, and the rim came out as a square around it.
      const rim = float(1)
        .sub(smoothstep(0, px.mul(7), offshore))
        .mul(smoothstep(20, 120, px))
      sea = mix(sea, SEA_SHALLOW, rim.mul(0.45))
      colour.assign(mix(sea, mix(LAKE, SEA_SHALLOW, rim.mul(0.35)), lake))

      If(px.lessThan(600), () => {
        // --- the surface -----------------------------------------------------------
        // Each octave reads its own slice of the noise and is warped by the one above
        // it: value noise alone lines up with its lattice, and close in that read as a
        // faint cross-hatch. Its gradient runs about ±2 per cell, hence the halving. An
        // octave finer than a pixel is skipped, not just faded.
        const grad = vec2(0, 0).toVar()
        const warp = vec2(0, 0).toVar()
        OCTAVES.forEach(([w, amp, seed], k) => {
          If(fades[k].greaterThan(0), () => {
            const g = noise(lattice(w).add(slice(seed)).add(warp), w, px).grad
            warp.assign(g.mul(0.8))
            grad.addAssign(g.mul(amp * 0.5).mul(fades[k]))
          })
        })
        // Lakes are calmer than the sea.
        const calm = grad.mul(mix(float(1), float(0.5), lake))
        const n = normalize(vec3(calm.x.negate(), calm.y.negate(), 1))
        const L = vec3(light.x, light.y, light.z)
        const V = normalize(cameraPosition.sub(positionWorld))
        // Diffuse from the same light as the land, compressed so it reads as texture on
        // the surface, not as relief.
        const lit = dot(n, L).div(light.z).sub(1).mul(0.6).add(1)
        let c: V3 = colour.mul(clamp(lit, 0.92, 1.08))
        // Sheen: water reflects more of the sky the more obliquely it is seen.
        const fresnel = pow(float(1).sub(clamp(dot(n, V), 0, 1)), 5)
        c = mix(c, SKY, fresnel.mul(0.2).mul(close))
        // Glint: a broad Blinn-Phong lobe of the key light, strongest when tilted
        // towards it.
        const H = normalize(L.add(V))
        const glint = pow(clamp(dot(n, H), 0, 1), 160)
          .mul(0.5)
          .mul(close)
        colour.assign(mix(c, GLINT, clamp(glint, 0, 0.7)))

        // --- surf ------------------------------------------------------------------
        If(px.lessThan(18).and(offshore.lessThan(130)), () => {
          // Only on shores that shelve gently: the bathymetry falls less than ~1 in 8.
          const gentle = float(1).sub(smoothstep(0.06, 0.2, d.div(offshore.max(5))))
          const surfing = gentle
            .mul(float(1).sub(lake))
            .mul(float(1).sub(smoothstep(5, 18, px)))
          // Lines 28 m apart, each crest sharp, fading with distance out.
          const crest = pow(
            sin(offshore.div(28).mul(2 * Math.PI))
              .mul(0.5)
              .add(0.5),
            10,
          )
          const envelope = exp(offshore.div(-45)).mul(
            float(1).sub(smoothstep(40, 130, offshore)),
          )
          const breakup = smoothstep(
            0.35,
            0.7,
            noise(lattice(0.09).add(slice(7)), 0.09, px).value,
          )
          // The edge line: a few metres wide, never thinner than a pixel and a half.
          const edgeW = max(float(5), px.mul(1.5))
          const edge = float(1)
            .sub(smoothstep(edgeW.mul(0.25), edgeW, offshore))
            .mul(
              smoothstep(0.2, 0.65, noise(lattice(0.03).add(slice(3)), 0.03, px).value)
                .mul(0.6)
                .add(0.4),
            )
          const foam = clamp(max(edge, crest.mul(envelope).mul(breakup)), 0, 1).mul(surfing)
          colour.assign(mix(colour, FOAM, foam.mul(0.75)))
        })
      })
    })
    return colour
  })()

  // --- the land side ---------------------------------------------------------------
  // Wet sand: low, flat ground within a few metres of the water, only once a few metres
  // are more than a pixel.
  const wetW = max(float(10), pxM.mul(1.5))
  const wet = float(1)
    .sub(smoothstep(0, wetW, shore))
    .mul(float(1).sub(smoothstep(3, 8, height)))
    .mul(float(1).sub(smoothstep(0.05, 0.2, slope)))
    .mul(float(1).sub(smoothstep(4, 16, pxM)))
    .mul(float(1).sub(lake))

  return { water: water as unknown as V3, wet }
}
