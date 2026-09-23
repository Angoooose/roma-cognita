import * as THREE from 'three/webgpu'
import { clamp, dot, float, fwidth, max, min, smoothstep, texture, vec2 } from 'three/tsl'

/**
 * Multi-channel distance-field type (pipeline/src/labels/fonts.ts): loading an atlas
 * and its metrics, and the shader nodes that ink a glyph from it. Shared by the
 * names along curves (LabelLayer) and the screen-space settlement names (PlaceLayer).
 */

export interface Glyph {
  x: number
  y: number
  width: number
  height: number
  xoffset: number
  yoffset: number
  xadvance: number
}

export interface FontData {
  size: number
  base: number
  scaleW: number
  scaleH: number
  range: number
  /** Cap height in atlas pixels. */
  capPx: number
  chars: Map<number, Glyph>
  kerning: Map<string, number>
}

export async function loadFont(
  name: string,
): Promise<{ font: FontData; atlas: THREE.Texture } | null> {
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
    // Glyph boxes carry half the distance range of padding on each side.
    capPx: H.height - meta.distanceField.distanceRange,
    chars: new Map(meta.chars.map((c: Glyph & { id: number }) => [c.id, c])),
    kerning: new Map(
      meta.kernings.map((k: { first: number; second: number; amount: number }) => [
        `${k.first},${k.second}`,
        k.amount,
      ]),
    ),
  }
  const atlas = new THREE.Texture(bitmap)
  atlas.colorSpace = THREE.NoColorSpace
  atlas.flipY = false
  atlas.minFilter = THREE.LinearFilter
  atlas.magFilter = THREE.LinearFilter
  atlas.generateMipmaps = false
  atlas.needsUpdate = true
  return { font, atlas }
}

/** Advance of `text` in atlas pixels, with `tracking` em between letters. */
export function advanceOf(f: FontData, text: string, tracking = 0) {
  const cps = [...text].map((c) => c.codePointAt(0)!)
  let w = 0
  for (let i = 0; i < cps.length; i++) {
    w += f.chars.get(cps[i])?.xadvance ?? f.size * 0.6
    if (i + 1 < cps.length)
      w += (f.kerning.get(`${cps[i]},${cps[i + 1]}`) ?? 0) + tracking * f.size
  }
  return w
}

/**
 * Ink and halo coverage for a glyph fragment. The median of the three channels is the
 * signed distance, 0.5 on the outline; its range in screen pixels comes from how fast
 * the atlas coordinates move per pixel, so edges stay a pixel wide at every size.
 *
 * - `gain`: px the ink spreads past the outline — a printer's gain for hairline faces.
 * - The halo is `haloPx` wide (1.5 by default), measured in the field's own units and
 *   capped well inside its range, so at small sizes it narrows instead of filling the
 *   glyph's box.
 */
export function msdfInk(
  f: FontData,
  atlas: THREE.Texture,
  uvNode: THREE.Node<'vec2'>,
  gain: number,
  haloAlpha: number,
  haloPx = 1.5,
) {
  const s = texture(atlas, uvNode)
  const sd = max(min(s.r, s.g), min(max(s.r, s.g), s.b))
  const unitRange = vec2(f.range / f.scaleW, f.range / f.scaleH)
  const screenTexSize = vec2(1).div(fwidth(uvNode))
  const pxRange = max(dot(unitRange, screenTexSize).mul(0.5), 1)
  const dist = pxRange.mul(sd.sub(0.5))
  const ink = clamp(dist.add(0.5 + gain), 0, 1)
  const haloSd = min(float(haloPx).div(pxRange), float(0.4))
  const halo = smoothstep(float(0.5).sub(haloSd), float(0.5).sub(haloSd.mul(0.3)), sd).mul(
    haloAlpha,
  )
  return { ink, halo }
}
