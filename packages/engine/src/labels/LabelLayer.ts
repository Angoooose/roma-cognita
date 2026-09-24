import * as THREE from 'three/webgpu'
import {
  attribute,
  float,
  max,
  mix,
  screenUV,
  select,
  smoothstep,
  uniform,
  uv,
  vec3,
} from 'three/tsl'
import { politicsUniforms } from '../politics/PoliticalLayer.ts'
import { loadFont, msdfInk, type FontData } from './msdf.ts'

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

interface Placement {
  kind: 'land' | 'water'
  /** The polity a land name belongs to, and the atoms it names. */
  polity?: string
  atoms?: string[]
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
  /** Whether names set over this lettering cut it back (land names, not the seas). */
  knockout?: boolean
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
    knockout: true,
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
  /**
   * Knockouts: screen rectangles (u0, v0, u1, v1 in screen uv, v down) where land
   * lettering fades so a name set over it can be read — Rome over ITALIA. A printer
   * does the same, cutting the territory name back around the city.
   */
  knockout: [
    uniform(new THREE.Vector4(-1, -1, -1, -1)),
    uniform(new THREE.Vector4(-1, -1, -1, -1)),
  ],
}

/** Sets the knockouts from boxes in CSS px, y up; unused slots are cleared. */
export function setKnockouts(
  boxes: [number, number, number, number][],
  w: number,
  h: number,
) {
  labelUniforms.knockout.forEach((u, i) => {
    const b = boxes[i]
    if (b) u.value.set(b[0] / w, 1 - b[3] / h, b[2] / w, 1 - b[1] / h)
    else u.value.set(-1, -1, -1, -1)
  })
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
  /** Glyph corners of the names on the map, plane metres, for other layers to avoid. */
  private glyphBoxes: { corners: [number, number][]; capHeight: number; font: string }[] =
    []

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

  /**
   * A polity's names on the map, by the years they are shown: for search to list
   * when it is on the map, and to frame it. Paths are plane metres.
   */
  namesOf(polity: string): {
    text: string
    years: [number, number][]
    path: [number, number][]
    atoms: string[]
  }[] {
    return this.placements
      .filter((p) => p.kind === 'land' && p.polity === polity)
      .map((p) => ({ text: p.text, years: p.years, path: p.path, atoms: p.atoms ?? [] }))
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
    this.glyphBoxes = []

    for (const [name, face] of this.faces) {
      const positions: number[] = []
      const uvs: number[] = []
      const caps: number[] = []
      const mode: number[] = []
      const index: number[] = []
      for (const [p, m] of modes) {
        if (p.font !== name) continue
        for (const q of layout(face.font, p)) {
          if (m !== 2)
            this.glyphBoxes.push({
              corners: q.map(([x, y]) => [x, y]),
              capHeight: p.capHeight,
              font: p.font,
            })
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

  /**
   * Screen boxes (CSS px, y up) of every glyph legible at this zoom, so settlement
   * names can keep off them.
   */
  obstacles(
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number,
    mpp: number,
  ): [number, number, number, number][] {
    const out: [number, number, number, number][] = []
    const v = new THREE.Vector3()
    for (const g of this.glyphBoxes) {
      const style = STYLES[g.font]
      const px = g.capHeight / mpp
      if (!style || px < style.fadeIn[0] || px > style.fadeOut[1]) continue
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const [x, y] of g.corners) {
        v.set(x, y, 0).project(camera)
        const sx = ((v.x + 1) / 2) * w
        const sy = ((v.y + 1) / 2) * h
        x0 = Math.min(x0, sx)
        y0 = Math.min(y0, sy)
        x1 = Math.max(x1, sx)
        y1 = Math.max(y1, sy)
      }
      if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) continue
      out.push([x0, y0, x1, y1])
    }
    return out
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
  const loaded = await loadFont(name)
  return loaded ? new Face(loaded.font, loaded.atlas, style) : null
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

  const { ink, halo } = msdfInk(f, atlas, uv(), style.gain, style.haloAlpha)

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
  // Inside a knockout, land lettering drops to a ghost; soft over a few pixels.
  let knocked: THREE.Node<'float'> = float(0)
  if (style.knockout) {
    for (const k of labelUniforms.knockout) {
      const r = k as unknown as THREE.Node<'vec4'>
      const soft = float(0.004)
      const inside = smoothstep(r.x.sub(soft), r.x, screenUV.x)
        .mul(float(1).sub(smoothstep(r.z, r.z.add(soft), screenUV.x)))
        .mul(smoothstep(r.y.sub(soft), r.y, screenUV.y))
        .mul(float(1).sub(smoothstep(r.w, r.w.add(soft), screenUV.y)))
      knocked = max(knocked, inside)
    }
  }
  mat.opacityNode = max(ink.mul(style.inkAlpha), halo)
    .mul(float(1).sub(knocked.mul(0.72)))
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
