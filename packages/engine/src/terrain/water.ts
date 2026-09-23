import * as THREE from 'three/webgpu'
import {
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  max,
  mix,
  mod,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
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
const SEA_SHALLOW = rgb('#3E8C98')
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

/**
 * Dave Hoskins' "hash without sine": well conditioned for lattice coordinates in the
 * hundreds. A sin-based hash loses precision on arguments that large and its values
 * correlate along the axes, which showed as straight lines through the ripples.
 */
function hash(x: F, y: F, z: F): F {
  let p = fract(vec3(mod(x, PERIOD), mod(y, PERIOD), mod(z, 1024)).mul(0.1031))
  p = p.add(dot(p, p.yzx.add(33.33)))
  return fract(p.x.add(p.y).mul(p.z))
}

/**
 * Value noise on a lattice that repeats every PERIOD cells in x and y, with its
 * gradient in x and y worked out analytically — one evaluation per octave rather than
 * three for finite differences. Value in 0…1, gradient per lattice cell.
 */
function noise(p: V2, z: F): { value: F; grad: V2 } {
  const i = floor(p)
  const f = fract(p)
  const iz = floor(z)
  const fz = fract(z)
  const u = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10))
  const du = f
    .mul(f)
    .mul(f.mul(f.sub(2)).add(1))
    .mul(30)
  const uz = fz
    .mul(fz)
    .mul(fz)
    .mul(fz.mul(fz.mul(6).sub(15)).add(10))
  const x0 = i.x
  const y0 = i.y
  const x1 = i.x.add(1)
  const y1 = i.y.add(1)
  const z1 = iz.add(1)
  const a = hash(x0, y0, iz)
  const b = hash(x1, y0, iz)
  const c = hash(x0, y1, iz)
  const d = hash(x1, y1, iz)
  const e = hash(x0, y0, z1)
  const g1 = hash(x1, y0, z1)
  const g2 = hash(x0, y1, z1)
  const h = hash(x1, y1, z1)
  const k1 = b.sub(a)
  const k2 = c.sub(a)
  const k3 = e.sub(a)
  const k4 = a.sub(b).sub(c).add(d)
  const k5 = a.sub(c).sub(e).add(g2)
  const k6 = a.sub(b).sub(e).add(g1)
  const k7 = a.negate().add(b).add(c).sub(d).add(e).sub(g1).sub(g2).add(h)
  const value = a
    .add(k1.mul(u.x))
    .add(k2.mul(u.y))
    .add(k3.mul(uz))
    .add(k4.mul(u.x).mul(u.y))
    .add(k5.mul(u.y).mul(uz))
    .add(k6.mul(uz).mul(u.x))
    .add(k7.mul(u.x).mul(u.y).mul(uz))
  const gx = du.x.mul(k1.add(k4.mul(u.y)).add(k6.mul(uz)).add(k7.mul(u.y).mul(uz)))
  const gy = du.y.mul(k2.add(k5.mul(uz)).add(k4.mul(u.x)).add(k7.mul(uz).mul(u.x)))
  return { value, grad: vec2(gx, gy) }
}

export interface WaterInputs {
  /** Metres to the shore, positive on land. */
  shore: F
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

export function waterShading({
  shore,
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
  // How close in the camera is: 0 at the paper tier, 1 at a province or smaller.
  const close = float(1).sub(smoothstep(60, 600, pxM))

  // --- colour from depth ---------------------------------------------------------
  let sea: V3 = mix(SEA_DEEP, SEA_MID, exp(d.div(-450)))
  sea = mix(sea, SEA_SHALLOW, exp(d.div(-28)).mul(0.9))
  sea = mix(sea, SEA_SAND, exp(d.div(-3.5)).mul(0.55).mul(close))
  // The overview's shore rim: a band of shallows a few pixels wide along every coast,
  // for where the bathymetry is coarser than the coast. Close in, the depth and the
  // surf carry the shore instead. Measured with the camera's metres per pixel, not the
  // field's own derivative: at an islet smaller than a mask texel that derivative
  // breaks down, and the rim came out as a square around it.
  const rim = float(1)
    .sub(smoothstep(0, pxM.mul(7), offshore))
    .mul(smoothstep(20, 120, pxM))
  sea = mix(sea, SEA_SHALLOW, rim.mul(0.45))
  let water: V3 = mix(sea, mix(LAKE, SEA_SHALLOW, rim.mul(0.35)), lake)

  // --- the surface ---------------------------------------------------------------
  // Each octave is its own slice of the noise (the third axis) and is warped by the one
  // above it: value noise alone lines up with its lattice, and
  // close in that read as a faint cross-hatch. Its gradient runs about ±2 per cell,
  // hence the halving.
  let warp: V2 = vec2(0, 0)
  const octave = (wavelengthKm: Wavelength, amp: number, seed: number): V2 => {
    const g = noise(lattice(wavelengthKm).add(warp), float(seed)).grad
    warp = g.mul(0.8)
    return g.mul(amp * 0.5).mul(detail(wavelengthKm))
  }
  const grad = octave(1.6, 0.025, 31)
    .add(octave(0.25, 0.06, 37))
    .add(octave(0.06, 0.11, 41))
    .add(octave(0.015, 0.14, 43))
    // Lakes are calmer than the sea.
    .mul(mix(float(1), float(0.5), lake))
  const n = normalize(vec3(grad.x.negate(), grad.y.negate(), 1))
  const L = vec3(light.x, light.y, light.z)
  const V = normalize(cameraPosition.sub(positionWorld))
  // Diffuse from the same light as the land, compressed so it reads as texture on the
  // surface, not as relief.
  const lit = dot(n, L).div(light.z).sub(1).mul(0.6).add(1)
  water = water.mul(clamp(lit, 0.92, 1.08))
  // Sheen: water reflects more of the sky the more obliquely it is seen.
  const fresnel = pow(float(1).sub(clamp(dot(n, V), 0, 1)), 5)
  water = mix(water, SKY, fresnel.mul(0.2).mul(close))
  // Glint: a broad Blinn-Phong lobe of the key light, strongest when tilted towards it.
  const H = normalize(L.add(V))
  const glint = pow(clamp(dot(n, H), 0, 1), 160)
    .mul(0.5)
    .mul(close)
  water = mix(water, GLINT, clamp(glint, 0, 0.7))

  // --- surf ----------------------------------------------------------------------
  // Only on shores that shelve gently: the bathymetry here falls less than ~1 in 8.
  const gentle = float(1).sub(smoothstep(0.06, 0.2, d.div(offshore.max(5))))
  const surfing = gentle.mul(float(1).sub(lake)).mul(float(1).sub(smoothstep(5, 18, pxM)))
  // Lines 28 m apart, each crest sharp, fading with distance out.
  const phase = offshore.div(28)
  const crest = pow(
    sin(phase.mul(2 * Math.PI))
      .mul(0.5)
      .add(0.5),
    10,
  )
  const envelope = exp(offshore.div(-45)).mul(float(1).sub(smoothstep(40, 130, offshore)))
  const breakup = smoothstep(0.35, 0.7, noise(lattice(0.09), float(7)).value)
  // The edge line: a few metres wide, never thinner than a pixel and a half.
  const edgeW = max(float(5), pxM.mul(1.5))
  const edge = float(1)
    .sub(smoothstep(edgeW.mul(0.25), edgeW, offshore))
    .mul(
      smoothstep(0.2, 0.65, noise(lattice(0.03), float(3)).value)
        .mul(0.6)
        .add(0.4),
    )
  const foam = clamp(max(edge, crest.mul(envelope).mul(breakup)), 0, 1).mul(surfing)
  water = mix(water, FOAM, foam.mul(0.75))

  // --- the land side -------------------------------------------------------------
  // Wet sand: low, flat ground within a few metres of the water, only once a few metres
  // are more than a pixel.
  const wetW = max(float(10), pxM.mul(1.5))
  const wet = float(1)
    .sub(smoothstep(0, wetW, shore))
    .mul(float(1).sub(smoothstep(3, 8, height)))
    .mul(float(1).sub(smoothstep(0.05, 0.2, slope)))
    .mul(float(1).sub(smoothstep(4, 16, pxM)))
    .mul(float(1).sub(lake))

  return { water, wet }
}
