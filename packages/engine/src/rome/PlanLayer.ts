import * as THREE from 'three/webgpu'
import { planTextures, planUniforms } from './shading.ts'
import { fieldUniforms, GROUND } from './fields.ts'

/**
 * The plan of Rome (DESIGN.md §7.7): loads the board the model stands on (the
 * plate's fields and the smoothed ground, baked by `npm run rome -w pipeline`), finds
 * the monument under a point for picking, and says how close the camera may come.
 * The board is drawn by the terrain (shading.ts), the buildings by ModelLayer, the
 * names by the place and label layers, since every monument is a place.
 */
interface Outline {
  id: string
  years: [number, number]
  /** Plane metres: polygons of rings, outer first. */
  rings: [number, number][][][]
  box: [number, number, number, number]
}

/** The smoothed ground in metres on the plate's grid, row 0 the north edge. */
export interface Ground {
  heights: Float32Array
  width: number
  height: number
  /** The grid's west and north edges, plane metres, and its texel. */
  x0: number
  y1: number
  texel: number
}

/** Below this scale (m per CSS px) a click inside a monument's outline picks it. */
export const PLAN_MPP = 24

/** The camera's closest distance over the model, metres: near enough to see its doors and windows. */
const CLOSE_IN_M = 250

export class PlanLayer {
  private outlines: Outline[] = []
  /** The plate's rectangle, plane metres: x0, y0, x1, y1. */
  private plate: [number, number, number, number] | null = null
  /** The smoothed ground, for the model's own ground mesh (ModelLayer). */
  ground: Ground | null = null

  async load() {
    const meta = await fetch('/rome/plan.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (!meta) return
    const [fields, ground] = await Promise.all([
      Promise.all([0, 1, 2].map((i) => loadField(`/rome/plate-${i}.png`))),
      loadGround('/rome/ground.png'),
    ])
    if (fields.some((t) => !t) || !ground) return
    fields.forEach((t, i) => (planTextures.plate[i].value = t!))
    planTextures.ground.value = ground.texture
    const pl = meta.plate
    this.ground = {
      heights: ground.heights,
      width: pl.width,
      height: pl.height,
      x0: pl.x0,
      y1: pl.y0 + pl.height * pl.texel,
      texel: pl.texel,
    }
    planUniforms.plateOrigin.value.set(pl.x0, pl.y0 + pl.height * pl.texel)
    planUniforms.plateSize.value.set(pl.width * pl.texel, pl.height * pl.texel)
    planUniforms.plateTexels.value.set(pl.width, pl.height)
    planUniforms.streetClamp.value = pl.streetClamp
    planUniforms.plateClamps.value.set(0, pl.cityClamp, pl.riverClamp, pl.reachClamp)
    // The country (fields.ts): its reach and clamps, and the recorded grounds' years.
    const fl = pl.fields
    fieldUniforms.reach.value = fl.reach
    fieldUniforms.edgeClamp.value = fl.edgeClamp
    fieldUniforms.laneClamp.value = fl.laneClamp
    const slots = fieldUniforms.grounds.array as THREE.Vector4[]
    fl.grounds.forEach(
      (
        g: { kind: keyof typeof GROUND; years: [number, number]; prior: number },
        k: number,
      ) => slots[k + 1].set(g.years[0], g.years[1], g.prior, GROUND[g.kind]),
    )
    this.plate = [pl.x0, pl.y0, pl.x0 + pl.width * pl.texel, pl.y0 + pl.height * pl.texel]
    this.outlines = meta.outlines.map((o: Omit<Outline, 'box'>) => {
      const pts = o.rings.flat(2)
      return {
        id: o.id,
        years: o.years,
        rings: o.rings,
        box: [
          Math.min(...pts.map((p) => p[0])),
          Math.min(...pts.map((p) => p[1])),
          Math.max(...pts.map((p) => p[0])),
          Math.max(...pts.map((p) => p[1])),
        ],
      }
    })
    planUniforms.loaded.value = 1
  }

  /**
   * How close the camera may come over a plane point: CLOSE_IN_M over the plate,
   * whose model holds up to ~1 m/px where the terrain's texels do not, easing back to
   * `normal` over the first 1.5 km outside it.
   */
  minDistanceAt(x: number, y: number, normal: number) {
    if (!this.plate) return normal
    const [x0, y0, x1, y1] = this.plate
    const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))
    const t = Math.min(1, d / 1500)
    return CLOSE_IN_M + (normal - CLOSE_IN_M) * t * t * (3 - 2 * t)
  }

  /** The plate's rectangle, plane metres (x0, y0, x1, y1), once loaded. */
  get rect() {
    return this.plate
  }

  /** The id of the monument standing at a plane point in `year`, smallest first. */
  pick(x: number, y: number, year: number): string | null {
    const hits = this.outlines.filter(
      (o) =>
        o.years[0] <= year &&
        year <= o.years[1] &&
        x >= o.box[0] &&
        x <= o.box[2] &&
        y >= o.box[1] &&
        y <= o.box[3] &&
        o.rings.some((poly) => poly.reduce((c, ring) => c !== inRing(x, y, ring), false)),
    )
    const size = (o: Outline) => (o.box[2] - o.box[0]) * (o.box[3] - o.box[1])
    return hits.sort((a, b) => size(a) - size(b))[0]?.id ?? null
  }
}

function inRing(x: number, y: number, ring: [number, number][]) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

async function bitmapOf(url: string) {
  const res = await fetch(url)
  if (!res.ok) return null
  return createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
}

/** A field image: data, not colour — no colour management, no premultiplication. */
async function loadField(url: string) {
  try {
    const bitmap = await bitmapOf(url)
    if (!bitmap) return null
    const tex = new THREE.Texture(bitmap)
    tex.colorSpace = THREE.NoColorSpace
    tex.flipY = false
    tex.premultiplyAlpha = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
  } catch {
    return null
  }
}

/**
 * The smoothed ground: centimetres over two bytes, decoded here into a half-float
 * texture of metres, since interpolating the two bytes separately would terrace it.
 */
async function loadGround(url: string) {
  try {
    const bitmap = await bitmapOf(url)
    if (!bitmap) return null
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    const heights = new Float32Array(bitmap.width * bitmap.height)
    const h = new Uint16Array(heights.length)
    for (let i = 0; i < h.length; i++) {
      heights[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 100
      h[i] = THREE.DataUtils.toHalfFloat(heights[i])
    }
    const tex = new THREE.DataTexture(
      h,
      bitmap.width,
      bitmap.height,
      THREE.RedFormat,
      THREE.HalfFloatType,
    )
    tex.colorSpace = THREE.NoColorSpace
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return { texture: tex, heights }
  } catch {
    return null
  }
}
