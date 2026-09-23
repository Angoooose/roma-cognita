import * as THREE from 'three/webgpu'
import {
  attribute,
  clamp,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { politicsUniforms } from '../politics/PoliticalLayer.ts'

/**
 * Map lettering (DESIGN.md §7.5, §8.2), placed offline (pipeline/src/labels) and drawn
 * here as one mesh of glyph quads per typeface, from multi-channel distance-field
 * atlases:
 *
 * - land names in Cinzel capitals, dark ink with a faint paper halo;
 * - water names in EB Garamond italic, warm gold on the dark sea.
 *
 * Names are sized in metres, so they grow and shrink with what they name, the way a
 * printed map's lettering does; each fades in once it is big enough to read and out
 * again once it is too big to take in. A year change swaps the set of land names,
 * cross-fading with the political colours.
 */

interface Glyph {
  x: number
  y: number
  width: number
  height: number
  xoffset: number
  yoffset: number
  xadvance: number
}

interface FontData {
  size: number
  base: number
  scaleW: number
  scaleH: number
  range: number
  capPx: number
  chars: Map<number, Glyph>
  kerning: Map<string, number>
}

interface Placement {
  kind: 'land' | 'water'
  font: string
  text: string
  years: [number, number][]
  path: [number, number][]
  capHeight: number
  tracking: number
}

/** How each typeface is inked. */
interface FaceStyle {
  ink: THREE.Color
  inkAlpha: number
  halo: THREE.Color
  haloAlpha: number
  /** Ink spread past the outline, px: a printer's gain for hairline faces. */
  gain: number
  /** Cap heights, in screen pixels, over which names fade in and out. */
  fadeIn: [number, number]
  fadeOut: [number, number]
}

const STYLES: Record<string, FaceStyle> = {
  cinzel: {
    ink: new THREE.Color('#2A241E'),
    inkAlpha: 0.92,
    halo: new THREE.Color('#EDE6D6'),
    haloAlpha: 0.14,
    gain: 0.35,
    fadeIn: [7, 11],
    fadeOut: [80, 130],
  },
  'garamond-italic': {
    ink: new THREE.Color('#C9A15A'),
    inkAlpha: 0.9,
    halo: new THREE.Color('#15233B'),
    haloAlpha: 0.35,
    gain: 0.25,
    fadeIn: [6, 9],
    fadeOut: [60, 100],
  },
}

export const labelUniforms = {
  /** Ground metres per CSS pixel at the target; the zoom fade keys on it. */
  metresPerPixel: uniform(1000),
  enabled: uniform(1),
}

/** One typeface: its atlas, metrics, material and the mesh of its glyphs. */
class Face {
  mesh: THREE.Mesh | null = null
  readonly font: FontData
  readonly atlas: THREE.Texture
  readonly material: THREE.MeshBasicNodeMaterial
  constructor(font: FontData, atlas: THREE.Texture, style: FaceStyle) {
    this.font = font
    this.atlas = atlas
    this.material = createMaterial(font, atlas, style)
  }
}

export class LabelLayer {
  readonly group = new THREE.Group()
  private faces = new Map<string, Face>()
  private placements: Placement[] = []
  private shown = new Set<Placement>()

  async load() {
    const labels = await fetch('/labels/territories.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (!labels) return
    this.placements = labels.labels
    const names = [...new Set(this.placements.map((p) => p.font))]
    await Promise.all(
      names.map(async (name) => {
        const face = await loadFace(name)
        if (face) this.faces.set(name, face)
      }),
    )
  }

  /** Rebuilds the glyph meshes for `year`; names that change cross-fade with the colours. */
  setYear(year: number, animate: boolean) {
    const next = new Set(
      this.placements.filter((p) => p.years.some(([a, b]) => a <= year && year <= b)),
    )
    // 0 steady, 1 arriving, 2 leaving — the shader weighs each by the politics fade.
    const modes = new Map<Placement, number>()
    for (const p of next) modes.set(p, animate && !this.shown.has(p) ? 1 : 0)
    if (animate) for (const p of this.shown) if (!next.has(p)) modes.set(p, 2)
    this.shown = next

    for (const [name, face] of this.faces) {
      const positions: number[] = []
      const uvs: number[] = []
      const caps: number[] = []
      const mode: number[] = []
      const index: number[] = []
      for (const [p, m] of modes) {
        if (p.font !== name) continue
        for (const q of layout(face.font, p)) {
          const base = positions.length / 3
          for (const [x, y, u, v] of q) {
            positions.push(x, y, 0)
            uvs.push(u, v)
            caps.push(p.capHeight)
            mode.push(m)
          }
          index.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      g.setAttribute('capHeight', new THREE.Float32BufferAttribute(caps, 1))
      g.setAttribute('fadeMode', new THREE.Float32BufferAttribute(mode, 1))
      g.setIndex(index)
      if (face.mesh) {
        face.mesh.geometry.dispose()
        face.mesh.geometry = g
      } else {
        face.mesh = new THREE.Mesh(g, face.material)
        face.mesh.frustumCulled = false
        face.mesh.renderOrder = 10
        this.group.add(face.mesh)
      }
    }
  }

  dispose() {
    for (const f of this.faces.values()) {
      f.mesh?.geometry.dispose()
      f.material.dispose()
      f.atlas.dispose()
    }
  }
}

async function loadFace(name: string): Promise<Face | null> {
  const style = STYLES[name]
  if (!style) return null
  const [meta, bitmap] = await Promise.all([
    fetch(`/fonts/${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`/fonts/${name}.png`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) =>
        b
          ? createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
          : null,
      )
      .catch(() => null),
  ])
  if (!meta || !bitmap) return null
  const H = meta.chars.find((c: { char: string }) => c.char === 'H')
  const font: FontData = {
    size: meta.info.size,
    base: meta.common.base,
    scaleW: meta.common.scaleW,
    scaleH: meta.common.scaleH,
    range: meta.distanceField.distanceRange,
    capPx: H.height - meta.distanceField.distanceRange,
    chars: new Map(meta.chars.map((c: Glyph & { id: number }) => [c.id, c])),
    kerning: new Map(
      meta.kernings.map((k: { first: number; second: number; amount: number }) => [
        `${k.first},${k.second}`,
        k.amount,
      ]),
    ),
  }
  const tex = new THREE.Texture(bitmap)
  tex.colorSpace = THREE.NoColorSpace
  tex.flipY = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return new Face(font, tex, style)
}

/**
 * Glyph quads for one placement, in plane metres: [x, y, u, v] × 4 per glyph.
 * Each glyph is centred on the path at its own arc length and turned to the path's
 * tangent there, which is how lettering follows a curve without shearing.
 */
function layout(f: FontData, p: Placement): [number, number, number, number][][] {
  const em = p.capHeight / (f.capPx / f.size)
  const k = em / f.size // metres per atlas pixel
  const cps = [...p.text].map((c) => c.codePointAt(0)!)
  // Total advance, to centre the text on the path.
  let width = 0
  for (let i = 0; i < cps.length; i++) {
    width += (f.chars.get(cps[i])?.xadvance ?? f.size * 0.6) * k
    if (i + 1 < cps.length)
      width += (f.kerning.get(`${cps[i]},${cps[i + 1]}`) ?? 0) * k + p.tracking * em
  }
  // Paths are baked left to right; if one ever is not, lay it the other way rather
  // than print a name upside down.
  const pts = p.path[p.path.length - 1][0] < p.path[0][0] ? [...p.path].reverse() : p.path
  const path = arcLength(pts)
  let pen = (path.total - width) / 2
  // The path runs through the middle of the capitals: baseline is half a cap below.
  const mid = f.base - f.capPx / 2
  const quads: [number, number, number, number][][] = []
  for (let i = 0; i < cps.length; i++) {
    const g = f.chars.get(cps[i])
    const adv = (g?.xadvance ?? f.size * 0.6) * k
    if (g && g.width > 0) {
      const cx = pen + (g.xoffset + g.width / 2) * k
      const [px, py, tx, ty] = path.at(cx)
      const nx = -ty
      const ny = tx
      const hw = (g.width / 2) * k
      const top = (mid - g.yoffset) * k
      const bottom = (mid - g.yoffset - g.height) * k
      const corner = (
        dx: number,
        up: number,
        u: number,
        v: number,
      ): [number, number, number, number] => [
        px + tx * dx + nx * up,
        py + ty * dx + ny * up,
        u / f.scaleW,
        v / f.scaleH,
      ]
      quads.push([
        corner(-hw, bottom, g.x, g.y + g.height),
        corner(hw, bottom, g.x + g.width, g.y + g.height),
        corner(hw, top, g.x + g.width, g.y),
        corner(-hw, top, g.x, g.y),
      ])
    }
    pen += adv
    if (i + 1 < cps.length)
      pen += (f.kerning.get(`${cps[i]},${cps[i + 1]}`) ?? 0) * k + p.tracking * em
  }
  return quads
}

function createMaterial(f: FontData, atlas: THREE.Texture, style: FaceStyle) {
  const mat = new THREE.MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthTest = false
  mat.depthWrite = false
  mat.side = THREE.DoubleSide

  // Multi-channel distance: the median of the three channels is the signed distance,
  // 0.5 on the outline. Its range in screen pixels comes from how fast the atlas
  // coordinates move per pixel, so edges stay a pixel wide at every size.
  const s = texture(atlas, uv())
  const sd = max(min(s.r, s.g), min(max(s.r, s.g), s.b))
  const unitRange = vec2(f.range / f.scaleW, f.range / f.scaleH)
  const screenTexSize = vec2(1).div(fwidth(uv()))
  const pxRange = max(dot(unitRange, screenTexSize).mul(0.5), 1)
  const dist = pxRange.mul(sd.sub(0.5))
  // Hairlines thin to nothing at map sizes, so the ink is set a fraction of a pixel
  // outside the outline: a printer's slight gain, not a bold face.
  const ink = clamp(dist.add(0.5 + style.gain), 0, 1)
  // A faint halo about a pixel and a half wide, enough to lift the ink off what is
  // under it. Measured in the field's own units and capped well inside its range, so
  // at small sizes it narrows instead of filling the glyph's box.
  const haloSd = min(float(1.5).div(pxRange), float(0.3))
  const halo = smoothstep(float(0.5).sub(haloSd), float(0.5).sub(haloSd.mul(0.3)), sd).mul(
    style.haloAlpha,
  )

  const capPx = attribute('capHeight', 'float').div(labelUniforms.metresPerPixel)
  const zoom = smoothstep(style.fadeIn[0], style.fadeIn[1], capPx).mul(
    float(1).sub(smoothstep(style.fadeOut[0], style.fadeOut[1], capPx)),
  )
  const m = attribute('fadeMode', 'float')
  const k = politicsUniforms.mix
  const year = select(
    m.greaterThan(1.5),
    float(1).sub(k),
    select(m.greaterThan(0.5), k, float(1)),
  )

  mat.colorNode = mix(
    vec3(style.halo.r, style.halo.g, style.halo.b),
    vec3(style.ink.r, style.ink.g, style.ink.b),
    ink,
  )
  mat.opacityNode = max(ink.mul(style.inkAlpha), halo)
    .mul(zoom)
    .mul(year)
    .mul(labelUniforms.enabled)
  return mat
}

/** A polyline with arc-length lookup: position and unit tangent at distance s along it. */
function arcLength(pts: [number, number][]) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = cum[cum.length - 1]
  return {
    total,
    at(s: number): [number, number, number, number] {
      // Past the ends, continue along the end tangents: a long name overhangs straight.
      let i = 1
      while (i < cum.length - 1 && cum[i] < s) i++
      const seg = cum[i] - cum[i - 1] || 1
      const t = (s - cum[i - 1]) / seg
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      const tx = (bx - ax) / seg
      const ty = (by - ay) / seg
      // Smooth the tangent across vertices by blending with the neighbouring segment.
      let sx = tx
      let sy = ty
      if (t < 0.5 && i > 1) {
        const [cx, cy] = pts[i - 2]
        const l = cum[i - 1] - cum[i - 2] || 1
        const w = 0.5 - t
        sx = tx * (1 - w) + ((ax - cx) / l) * w
        sy = ty * (1 - w) + ((ay - cy) / l) * w
      } else if (t > 0.5 && i < pts.length - 1) {
        const [cx, cy] = pts[i + 1]
        const l = cum[i + 1] - cum[i] || 1
        const w = t - 0.5
        sx = tx * (1 - w) + ((cx - bx) / l) * w
        sy = ty * (1 - w) + ((cy - by) / l) * w
      }
      const n = Math.hypot(sx, sy) || 1
      return [ax + (bx - ax) * t, ay + (by - ay) * t, sx / n, sy / n]
    },
  }
}
