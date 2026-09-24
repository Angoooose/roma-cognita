import * as THREE from 'three/webgpu'
import { abs, clamp, dot, float, floor, Fn, If, int, ivec2, max, min, mix, select, smoothstep, textureLoad, uv, vec3 } from 'three/tsl'
import { politicsTables, politicsUniforms } from './PoliticalLayer.ts'

/**
 * The political layer as the terrain shader draws it: fills, borders and glow, from
 * the tile's political field (which atoms meet at the nearest boundary, and how far
 * away it is) and the year's tables (who held each atom).
 *
 * Borders are drawn here, in the terrain's own pass, rather than as lines over it: they
 * sit on the relief at any tilt with nothing to z-fight, and one distance field gives
 * the line, its antialiasing and the glow together. The field is baked from the atom
 * outlines at 431 m texels (the outlines themselves are ~1 km), and its distance is
 * interpolated, so a line is placed to a fraction of that and never steps.
 *
 * Which borders show is decided per year, per pixel: none between two atoms of one
 * polity, a light line between provinces of one power, and a full border with its glow
 * between powers, around a client kingdom, or where claimed land meets unclaimed. The
 * sea draws nothing.
 */

export interface PoliticalNodes {
  /** Fill colour (linear) and coverage, 0 where nothing is claimed. */
  fill: THREE.Node<'vec3'>
  fillAlpha: THREE.Node<'float'>
  /** The glow along a border: the fill colour, more saturated. */
  glow: THREE.Node<'vec3'>
  glowAlpha: THREE.Node<'float'>
  line: THREE.Node<'vec3'>
  lineAlpha: THREE.Node<'float'>
}

type V4 = THREE.Node<'vec4'>
type F = THREE.Node<'float'>

export function politicalShading(tex: THREE.TextureNode, n: number, pxKm: F): PoliticalNodes {
  // Texel centres sit at integer positions (the grid is vertex-aligned). Labels come
  // from the nearest texel — they can never be interpolated — and the distance from a
  // bilinear mix of the four around, each first expressed against the nearest texel's
  // pair of labels (see alignDistance in heightWorker.ts, which this mirrors).
  const pos = uv().mul(n - 1)
  const base = min(floor(pos), float(n - 2))
  const t = pos.sub(base)
  const at = (dx: number, dy: number) =>
    textureLoad(tex, ivec2(int(base.x.add(dx)), int(base.y.add(dy)))) as unknown as V4
  const c00 = at(0, 0)
  const c10 = at(1, 0)
  const c01 = at(0, 1)
  const c11 = at(1, 1)
  const right = t.x.greaterThan(0.5)
  const nearest = select(t.y.greaterThan(0.5), select(right, c11, c01), select(right, c10, c00)) as V4
  const lo = nearest.x
  const hi = nearest.y
  const align = (c: V4) => {
    const same = c.x.equal(lo).and(c.y.equal(hi))
    const own = select(c.z.greaterThan(0), c.y, c.x)
    return select(same, c.z, select(own.equal(hi), abs(c.z), abs(c.z).negate())) as F
  }
  const d = mix(mix(align(c00), align(c10), t.x), mix(align(c01), align(c11), t.x), t.y)
  const dPx = abs(d).div(pxKm)

  // The two years' tables, looked up for both labels.
  const row = (table: THREE.DataTexture, label: F, r: number) =>
    textureLoad(table, ivec2(int(label), int(r))) as unknown as V4
  const side = smoothstep(-0.6, 0.6, d.div(pxKm))
  const year = (table: THREE.DataTexture) => {
    const fillLo = row(table, lo, 0)
    const fillHi = row(table, hi, 0)
    const idLo = row(table, lo, 1)
    const idHi = row(table, hi, 1)
    const inkLo = row(table, lo, 2)
    const inkHi = row(table, hi, 2)
    const sea = max(idLo.w, idHi.w)
    const differentPolity = select(idLo.x.equal(idHi.x), float(0), float(1))
    const differentPower = select(idLo.y.equal(idHi.y), float(0), float(1))
    // A client kingdom is its own realm inside its power's colour: its edge is a full
    // border, not the light line between two provinces.
    const client = max(inkLo.w, inkHi.w)
    const claimed = max(fillLo.w, fillHi.w).greaterThan(0)
    const live = select(claimed, float(1), float(0)).mul(float(1).sub(sea))
    const power = max(differentPower, differentPolity.mul(client)).mul(live)
    const province = differentPolity.mul(float(1).sub(power)).mul(live)
    const schematic = select(max(idLo.z, idHi.z).greaterThan(1.5), float(1), float(0))
    const fill = mix(fillLo, fillHi, side)
    const ink = select(fillHi.w.greaterThan(fillLo.w), inkHi, inkLo)
    return { fill, power, province, schematic, ink }
  }
  // The year shown, and only while a cross-fade runs the one it is leaving: at rest the
  // mix is exactly 1 and the old year's lookups would be multiplied by nothing.
  const k = politicsUniforms.mix
  const b = year(politicsTables.to)
  type Year = ReturnType<typeof year>
  // Typed as floats inside; the same graph serves the vec4s.
  const fading = <T extends F | V4>(pick: (y: Year) => T): T =>
    Fn(() => {
      const v = (pick(b) as F).toVar()
      If(k.lessThan(1), () => {
        v.assign(mix(pick(year(politicsTables.from)) as F, pick(b) as F, k))
      })
      return v
    })() as unknown as T
  const fill = fading((y) => y.fill)
  const power = fading((y) => y.power)
  const province = fading((y) => y.province)
  const schematic = fading((y) => y.schematic).mul(power)
  const ink = fading((y) => y.ink)
  const on = politicsUniforms.enabled

  // The border zone: in pixels at the overview, capped in kilometres close in, where it
  // becomes the main sign of the border as fills fade (§7.6). It must stay inside the
  // field's reach — 48 texels of the level drawn, never less than ~30 px or 21 km — or
  // it would be cut off where the field stops seeing the boundary.
  const zoneKm = min(pxKm.mul(26), float(15))
  const zone = float(1).sub(smoothstep(float(0), zoneKm, abs(d)))

  // Lines, in pixels. A schematic boundary is a convention, not a surveyed line
  // (DESIGN.md §7.3): no hard line and no glow, and the fill fades in across the zone
  // instead, so the edge reads as a region's margin rather than a frontier.
  const powerLine = float(1).sub(smoothstep(0.55, 1.6, dPx)).mul(0.9)
  const schematicLine = float(1).sub(smoothstep(0, 4, dPx)).mul(0.22)
  const provinceLine = float(1).sub(smoothstep(0.15, 1.0, dPx)).mul(0.45)
  const lineAlpha = max(mix(powerLine, schematicLine, schematic).mul(power), provinceLine.mul(province)).mul(on)
  const feather = mix(float(1), smoothstep(float(0), zoneKm, abs(d)), schematic)

  // Glow: a band of the realm's own colour, richer than its fill, along a power border
  // and on the claimed side only.
  const luma = dot(fill.xyz, vec3(0.2126, 0.7152, 0.0722))
  const glow = clamp(mix(vec3(luma), fill.xyz, 1.15).mul(0.94), 0, 1)
  const glowAlpha = zone.mul(power).mul(float(1).sub(schematic)).mul(fill.w).mul(politicsUniforms.glow).mul(on)

  return {
    fill: fill.xyz,
    fillAlpha: fill.w.mul(politicsUniforms.fill).mul(feather).mul(on),
    glow,
    glowAlpha,
    line: ink.xyz,
    lineAlpha,
  }
}
