import * as THREE from 'three/webgpu'
import {
  abs,
  attribute,
  clamp,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  length,
  max,
  mix,
  positionGeometry,
  select,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { advanceOf, loadFont, msdfInk, type FontData } from './msdf.ts'

/**
 * Settlements and seats (DESIGN.md §7.4, §7.5): a marker and a name for every place
 * that stood in the year shown and matters at the current zoom, placed so nothing
 * overlaps.
 *
 * Unlike territory names these are set at a fixed size on screen — a town is a point,
 * and its name is type, not land — so each is anchored to its place on the plane and
 * offset in pixels by the vertex shader.
 *
 * - **What shows.** A place's prominence (places.yaml, 1 overview … 4 close in) sets
 *   the zoom it appears from; its civic status sets its marker and its rank when names
 *   compete.
 * - **Collision** is greedy by rank over screen boxes, with each name trying the side
 *   its record prefers, then the others. Territory and sea names are obstacles. It
 *   runs when the zoom, tilt, size or year changes — never for a pan, which moves
 *   every box together — and names cross-fade in and out.
 * - **Seats.** A kingdom whose extent is unknown (seats.yaml) is marked at its capital
 *   in its power's colour, with its name above: the map says where power sat and
 *   nothing about where it ended.
 */

export interface PlaceRecord {
  id: string
  name: string
  pleiades?: string
  kind: string
  x: number
  y: number
  years: [number, number]
  prominence: { value: number; years: [number, number] }[]
  status: { value: string; years: [number, number] }[]
  labelSide?: 'n' | 's' | 'e' | 'w'
  /** Share of land under a name on each side, at each of the file's `landScales`. */
  land?: Record<string, number[]>
  confidence: string
  review: string
  sources: { citation: string; locator?: string }[]
  note?: string
}

interface SeatRecord {
  polity: string
  name: string
  place: string
  years: [number, number]
}

/** What the inspector shows for a place under the cursor. */
export interface PlaceHit {
  place: PlaceRecord
  status?: string
  /** The kingdom seated here this year, if any. */
  seatOf?: { polity: string; name: string }
}

/** Obstacles from other layers: screen boxes, CSS px. */
export type Box = [number, number, number, number]

/**
 * A place appears once the map is at or closer than this, m per CSS px, by prominence.
 * Only Rome is on the map at every scale; zoomed right out the territories carry it.
 */
const TIER_MPP = [Infinity, 3000, 1500, 800, 400]
/** Seats name their kingdom from the regional view in; further out the colours do. */
const SEAT_MPP = 1700
/** Name size, em in CSS px, by prominence. EB Garamond's x-height is small. */
const TIER_EM = [0, 18, 16.5, 16, 15]
/** Capitals are set in Cinzel, whose lowercase are small capitals, lightly tracked. */
const CAPITAL_TRACKING = 0.06
/** Rank of civic status when names compete; lower wins. */
const STATUS_RANK: Record<string, number> = {
  'caput mundi': 0,
  'provincial seat': 1,
  'royal seat': 1,
  conventus: 2,
  colonia: 3,
  municipium: 4,
  'civitas libera': 4,
  'civitas foederata': 4,
  emporium: 5,
}
const MARKER = { dot: 0, capital: 1, seat: 2, caput: 3 } as const
const FADE_MS = 220
/** Gap between a marker and its name, px. */
const GAP = 4

const INK = new THREE.Color('#2A241E')
const PAPER = new THREE.Color('#EDE6D6')
/**
 * Settlement names are light type with a dark halo, everywhere (decided 2026-09-22):
 * territories are dark capitals printed on the land, settlements float above it, seas
 * are gold italic. Light reads over busy relief where dark ink sinks into it.
 */
const NAME_INK = new THREE.Color('#F3EBDA')
const NAME_HALO = new THREE.Color('#1B1612')

export const placeUniforms = {
  /** Viewport, CSS px. */
  viewport: uniform(new THREE.Vector2(1, 1)),
  enabled: uniform(1),
}

interface Item {
  key: string
  place: PlaceRecord
  seat?: SeatRecord
  tier: number
  rank: number
  status?: string
  marker: number
  markerPx: number
  em: number
  /** The kingdom's name, set beside a seat. */
  title?: string
  /** Which face the place's own name is set in: Garamond, or Cinzel for a capital. */
  nameFace: 'text' | 'title'
  alpha: number
  target: number
  /** Where the name went: offset of its box's lower-left from the anchor, px. */
  nameAt?: [number, number]
  titleAt?: [number, number]
}

export class PlaceLayer {
  readonly group = new THREE.Group()
  private places: PlaceRecord[] = []
  private seats: SeatRecord[] = []
  private landScales: number[] = []
  private text: { font: FontData; atlas: THREE.Texture } | null = null
  private title: { font: FontData; atlas: THREE.Texture } | null = null
  private items = new Map<string, Item>()
  private last = { mpp: 0, pitch: -1, w: 0, h: 0, year: NaN }
  private meshes: { markers?: THREE.Mesh; text?: THREE.Mesh; title?: THREE.Mesh } = {}
  private materials: {
    markers?: THREE.Material
    text?: THREE.Material
    title?: THREE.Material
  } = {}
  private lastTick = performance.now()
  /** The seat's colour, from the political layer: its power's, for the year. */
  seatColour: (polity: string, year: number) => THREE.Color = () => INK

  async load() {
    const [data, text, title] = await Promise.all([
      fetch('/labels/places.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      loadFont('garamond'),
      loadFont('cinzel'),
    ])
    if (!data || !text || !title) return
    this.places = data.places
    this.landScales = data.landScales ?? []
    this.seats = data.seats
    this.text = text
    this.title = title
    this.materials.markers = markerMaterial()
    this.materials.text = textMaterial(text.font, text.atlas, 0.05, 0.62)
    // Cinzel's hairlines are finer than Garamond's: more gain, and a stronger glow so a
    // capital lifts off the territory lettering it often sits on.
    this.materials.title = textMaterial(title.font, title.atlas, 0.25, 0.66)
  }

  /**
   * Per frame. Re-runs placement when the view's scale changes or the year does, and
   * advances the fades; returns true while anything is still fading.
   */
  update(
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number,
    mpp: number,
    pitch: number,
    year: number,
    obstacles: () => Box[],
  ) {
    if (!this.text) return false
    placeUniforms.viewport.value.set(w, h)
    const l = this.last
    if (
      year !== l.year ||
      Math.abs(mpp / l.mpp - 1) > 0.04 ||
      pitch !== l.pitch ||
      w !== l.w ||
      h !== l.h
    ) {
      Object.assign(l, { mpp, pitch, w, h, year })
      this.place(camera, w, h, mpp, year, obstacles())
    }
    const now = performance.now()
    const step = (now - this.lastTick) / FADE_MS
    this.lastTick = now
    let moving = false
    for (const it of this.items.values()) {
      if (it.alpha === it.target) continue
      it.alpha =
        it.target > it.alpha
          ? Math.min(it.target, it.alpha + step)
          : Math.max(it.target, it.alpha - step)
      moving = true
    }
    if (moving) this.writeAlpha()
    return moving
  }

  /**
   * Screen boxes (CSS px, y up) of the names allowed over other lettering — Rome's —
   * for that lettering to knock out. Per frame, since a pan moves them.
   */
  knockouts(camera: THREE.PerspectiveCamera, w: number, h: number): Box[] {
    const out: Box[] = []
    const v = new THREE.Vector3()
    for (const it of this.items.values()) {
      if (it.status !== 'caput mundi' || !it.nameAt || it.alpha <= 0) continue
      v.set(it.place.x, it.place.y, 0).project(camera)
      const sx = ((v.x + 1) / 2) * w
      const sy = ((v.y + 1) / 2) * h
      const [ox, oy] = it.nameAt
      const m = it.markerPx / 2 + 5
      out.push([
        Math.min(sx - m, sx + ox) - 4,
        Math.min(sy - m, sy + oy) - 5,
        Math.max(sx + m, sx + ox + this.nameWidth(it)) + 4,
        Math.max(sy + m, sy + oy + it.em * 0.72) + 5,
      ])
    }
    return out
  }

  /** The place under a client position, if a visible marker or name is there. */
  pick(
    camera: THREE.PerspectiveCamera,
    el: HTMLElement,
    clientX: number,
    clientY: number,
  ): PlaceHit | null {
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = r.height - (clientY - r.top)
    let best: Item | null = null
    let bestD = 10
    const v = new THREE.Vector3()
    for (const it of this.items.values()) {
      if (it.target < 1) continue
      v.set(it.place.x, it.place.y, 0).project(camera)
      const sx = ((v.x + 1) / 2) * r.width
      const sy = ((v.y + 1) / 2) * r.height
      let d = Math.hypot(sx - x, sy - y)
      if (it.nameAt) {
        const [ox, oy] = it.nameAt
        const wpx = this.nameWidth(it)
        if (x >= sx + ox && x <= sx + ox + wpx && y >= sy + oy && y <= sy + oy + it.em)
          d = 0
      }
      if (d < bestD) {
        best = it
        bestD = d
      }
    }
    if (!best) return null
    return {
      place: best.place,
      status: best.status,
      seatOf: best.seat ? { polity: best.seat.polity, name: best.seat.name } : undefined,
    }
  }

  // --- placement --------------------------------------------------------------------

  private candidates(year: number, mpp: number): Item[] {
    const seatAt = new Map(
      this.seats
        .filter((s) => s.years[0] <= year && year <= s.years[1])
        .map((s) => [s.place, s]),
    )
    const out: Item[] = []
    for (const p of this.places) {
      if (p.years[0] > year || p.years[1] < year) continue
      const tier = at(p.prominence, year) ?? 4
      const status = at(p.status, year)
      const seat = mpp <= SEAT_MPP ? seatAt.get(p.id) : undefined
      if (mpp > TIER_MPP[tier] && !seat && status !== 'caput mundi') continue
      const capital =
        status === 'caput mundi' || status === 'provincial seat' || status === 'royal seat'
      out.push({
        key: p.id,
        place: p,
        seat,
        tier,
        // Seats rank with the provincial capitals: they are the only mark those
        // kingdoms have on the map.
        rank: (seat ? 1 : (STATUS_RANK[status ?? ''] ?? 6)) + tier * 10,
        status,
        marker: seat
          ? MARKER.seat
          : status === 'caput mundi'
            ? MARKER.caput
            : capital
              ? MARKER.capital
              : MARKER.dot,
        markerPx: seat
          ? 10
          : status === 'caput mundi'
            ? 10
            : capital
              ? 9
              : tier <= 2
                ? 5.5
                : 4.5,
        em: seat
          ? Math.max(TIER_EM[tier], 16)
          : status === 'caput mundi'
            ? 19
            : TIER_EM[tier],
        title: seat ? seat.name.toUpperCase() : undefined,
        // A seat's city is set in Garamond, so it does not read as a second kingdom.
        nameFace: capital && !seat ? 'title' : 'text',
        alpha: 0,
        target: 1,
      })
    }
    return out.sort((a, b) => a.rank - b.rank || a.place.name.localeCompare(b.place.name))
  }

  private nameWidth(it: Item) {
    const f = (it.nameFace === 'title' ? this.title! : this.text!).font
    const tracking = it.nameFace === 'title' ? CAPITAL_TRACKING : 0
    return (advanceOf(f, it.place.name, tracking) / f.size) * it.em
  }

  private titleWidth(it: Item) {
    const f = this.title!.font
    return (advanceOf(f, it.title!, 0.12) / f.size) * it.em * 0.85
  }

  private place(
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number,
    mpp: number,
    year: number,
    obstacles: Box[],
  ) {
    // Other layers' lettering, and what this pass has placed. Rome alone is set over a
    // territory name if it must be: a map without Rome on it is wrong, a name crossing
    // it only crowded.
    const placed: Box[] = []
    const hit = (b: Box, list: Box[]) =>
      list.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
    const free = (b: Box, it: Item) =>
      !hit(b, placed) && (it.status === 'caput mundi' || !hit(b, obstacles))
    // Sides with land under them first, in the record's order of preference; a name
    // over water is a last resort, and is printed light when it comes to that.
    // The land shares measured at the scale nearest this one.
    let li = 0
    for (let i = 1; i < this.landScales.length; i++)
      if (
        Math.abs(Math.log(this.landScales[i] / mpp)) <
        Math.abs(Math.log(this.landScales[li] / mpp))
      )
        li = i
    const landOf = (it: Item, side: string) => it.place.land?.[side]?.[li] ?? 1
    const onLand = (it: Item, order: string[]) =>
      [...order].sort((a, b) => Number(landOf(it, a) < 0.5) - Number(landOf(it, b) < 0.5))
    /** First side, in order, where a w×h box beside the marker is free; its lower-left offset. */
    const beside = (
      it: Item,
      sx: number,
      sy: number,
      w: number,
      h: number,
      order: string[],
    ) => {
      const off = it.markerPx / 2 + GAP
      const sides: Record<string, [number, number]> = {
        e: [off, -h / 2],
        w: [-off - w, -h / 2],
        n: [-w / 2, off],
        s: [-w / 2, -off - h],
      }
      for (const side of order) {
        const [ox, oy] = sides[side]
        const b: Box = [sx + ox - 1, sy + oy - 2, sx + ox + w + 1, sy + oy + h + 2]
        if (free(b, it)) {
          placed.push(b)
          return { at: [ox, oy] as [number, number], side }
        }
      }
      return null
    }
    const v = new THREE.Vector3()
    const next = new Map<string, Item>()
    for (const it of this.candidates(year, mpp)) {
      v.set(it.place.x, it.place.y, 0).project(camera)
      if (v.z > 1) continue
      const sx = ((v.x + 1) / 2) * w
      const sy = ((v.y + 1) / 2) * h
      const m = it.markerPx / 2 + 1
      const marker: Box = [sx - m, sy - m, sx + m, sy + m]
      if (!free(marker, it)) continue
      placed.push(marker)
      const order = [it.place.labelSide, 'e', 'w', 'n', 's'].filter(
        (s, i, a) => s && a.indexOf(s) === i,
      ) as string[]
      // A seat is lettered first with its kingdom's name, in the territory face; the
      // city's own name follows once the zoom would show that city anyway.
      let titleAt: [number, number] | undefined
      let rest = order
      if (it.title) {
        const t = beside(
          it,
          sx,
          sy,
          this.titleWidth(it),
          it.em * 0.85 * 0.7,
          onLand(it, ['e', 'w', 'n', 's']),
        )
        if (t) {
          titleAt = t.at
          rest = order.filter((s) => s !== t.side)
        }
      }
      let nameAt: [number, number] | undefined
      // (Not when the kingdom is named for its city: Emesa once is enough.)
      const sameName = it.title?.toLowerCase() === it.place.name.toLowerCase()
      if (!it.title || (mpp <= TIER_MPP[it.tier] && !sameName)) {
        const n = beside(it, sx, sy, this.nameWidth(it), it.em * 0.72, onLand(it, rest))
        nameAt = n?.at
      }
      // A town with no room for its name is left off entirely; a capital keeps its mark.
      if (!nameAt && !titleAt && it.marker === MARKER.dot) {
        placed.pop()
        continue
      }
      const prev = this.items.get(it.key)
      next.set(it.key, { ...it, alpha: prev?.alpha ?? 0, target: 1, nameAt, titleAt })
    }
    // What no longer fits fades out where it was.
    for (const [key, it] of this.items) {
      if (!next.has(key) && it.alpha > 0) next.set(key, { ...it, target: 0 })
    }
    this.items = next
    this.rebuild()
  }

  // --- geometry ---------------------------------------------------------------------

  /** Vertex order per item is recorded so alpha can be rewritten without a rebuild. */
  private ranges = new Map<
    string,
    { markers: [number, number]; text: [number, number]; title: [number, number] }
  >()

  private rebuild() {
    const markers = new Quads()
    const text = new Quads()
    const title = new Quads()
    this.ranges.clear()
    for (const it of this.items.values()) {
      const { x, y } = it.place
      const r = {
        markers: [0, 0] as [number, number],
        text: [0, 0] as [number, number],
        title: [0, 0] as [number, number],
      }
      r.markers[0] = markers.count
      // The quad covers the mark and its outer ring; the shader draws in pixels from
      // the offset, and reads the mark's radius from uv.x.
      const R = it.markerPx / 2
      const s = R + 4
      const colour = it.seat ? this.seatColour(it.seat.polity, this.last.year) : PAPER
      markers.quad(
        x,
        y,
        [-s, -s, s, s],
        [R, 0, R, 0],
        [it.marker, colour.r, colour.g, colour.b],
      )
      r.markers[1] = markers.count
      r.text[0] = text.count
      if (it.nameAt && it.nameFace === 'text')
        glyphs(text, this.text!.font, it.place.name, x, y, it.nameAt, it.em, 0)
      r.text[1] = text.count
      r.title[0] = title.count
      if (it.nameAt && it.nameFace === 'title')
        glyphs(
          title,
          this.title!.font,
          it.place.name,
          x,
          y,
          it.nameAt,
          it.em,
          CAPITAL_TRACKING,
        )
      if (it.title && it.titleAt)
        glyphs(title, this.title!.font, it.title, x, y, it.titleAt, it.em * 0.85, 0.12)
      r.title[1] = title.count
      this.ranges.set(it.key, r)
    }
    this.meshes.markers = markers.into(
      this.meshes.markers,
      this.materials.markers!,
      this.group,
      12,
    )
    this.meshes.text = text.into(this.meshes.text, this.materials.text!, this.group, 13)
    this.meshes.title = title.into(this.meshes.title, this.materials.title!, this.group, 13)
    this.writeAlpha()
  }

  private writeAlpha() {
    for (const k of ['markers', 'text', 'title'] as const) {
      const mesh = this.meshes[k]
      if (!mesh) continue
      const attr = mesh.geometry.getAttribute('alpha') as THREE.BufferAttribute
      for (const [key, r] of this.ranges) {
        const a = this.items.get(key)?.alpha ?? 0
        for (let i = r[k][0]; i < r[k][1]; i++)
          for (let v = 0; v < 4; v++) attr.setX(i * 4 + v, a)
      }
      attr.needsUpdate = true
    }
  }
}

/** The value of a dated list in `year`. */
function at<T>(list: { value: T; years: [number, number] }[], year: number): T | undefined {
  return list.find((d) => d.years[0] <= year && year <= d.years[1])?.value
}

/** Screen-offset quads: an anchor on the plane, corner offsets in px, uv, and one vec4 of data. */
class Quads {
  anchor: number[] = []
  offset: number[] = []
  uvs: number[] = []
  data: number[] = []
  count = 0

  quad(
    x: number,
    y: number,
    [x0, y0, x1, y1]: number[],
    [u0, v0, u1, v1]: number[],
    d: number[],
  ) {
    const corners = [
      [x0, y0, u0, v1],
      [x1, y0, u1, v1],
      [x1, y1, u1, v0],
      [x0, y1, u0, v0],
    ]
    for (const [ox, oy, u, v] of corners) {
      this.anchor.push(x, y, 0)
      this.offset.push(ox, oy)
      this.uvs.push(u, v)
      this.data.push(...d)
    }
    this.count++
  }

  into(
    mesh: THREE.Mesh | undefined,
    material: THREE.Material,
    group: THREE.Group,
    order: number,
  ) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.anchor, 3))
    g.setAttribute('offset', new THREE.Float32BufferAttribute(this.offset, 2))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    g.setAttribute('data', new THREE.Float32BufferAttribute(this.data, 4))
    g.setAttribute(
      'alpha',
      new THREE.Float32BufferAttribute(new Float32Array(this.count * 4), 1),
    )
    const index: number[] = []
    for (let q = 0; q < this.count; q++)
      index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3)
    g.setIndex(index)
    if (mesh) {
      mesh.geometry.dispose()
      mesh.geometry = g
      return mesh
    }
    const m = new THREE.Mesh(g, material)
    m.frustumCulled = false
    m.renderOrder = order
    group.add(m)
    return m
  }
}

/** Lays `text` in a line from `at` (the box's lower-left, px from the anchor). */
function glyphs(
  q: Quads,
  f: FontData,
  text: string,
  x: number,
  y: number,
  at: [number, number],
  em: number,
  tracking: number,
) {
  const k = em / f.size
  const cps = [...text].map((c) => c.codePointAt(0)!)
  // The box's bottom is the baseline.
  let pen = at[0]
  for (let i = 0; i < cps.length; i++) {
    const g = f.chars.get(cps[i])
    if (g && g.width > 0) {
      const left = pen + g.xoffset * k
      const top = at[1] + (f.base - g.yoffset) * k
      q.quad(
        x,
        y,
        [left, top - g.height * k, left + g.width * k, top],
        [
          g.x / f.scaleW,
          g.y / f.scaleH,
          (g.x + g.width) / f.scaleW,
          (g.y + g.height) / f.scaleH,
        ],
        [0, 0, 0, 0],
      )
    }
    pen += (g?.xadvance ?? f.size * 0.6) * k
    if (i + 1 < cps.length)
      pen += (f.kerning.get(`${cps[i]},${cps[i + 1]}`) ?? 0) * k + tracking * em
  }
}

/** Anchored on the plane, offset in pixels: the clip position moves by px × 2 / viewport. */
function screenAnchored(mat: THREE.MeshBasicNodeMaterial) {
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionGeometry, 1))
  const px = attribute('offset', 'vec2').mul(2).div(placeUniforms.viewport)
  mat.vertexNode = vec4(clip.xy.add(px.mul(clip.w)), clip.z, clip.w)
  mat.transparent = true
  mat.depthTest = false
  mat.depthWrite = false
  mat.side = THREE.DoubleSide
}

function markerMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial()
  screenAnchored(mat)
  const d = attribute('data', 'vec4')
  const shape = d.x
  const fill = vec3(d.y, d.z, d.w)
  // Drawn in pixels, from the interpolated offset: every stroke is a fixed width and
  // antialiased over one pixel, however large the mark, like an engraved symbol.
  const p = attribute('offset', 'vec2')
  const R = uv().x
  const r = length(p)
  const cover = (sd: THREE.Node<'float'>) => clamp(float(0.5).sub(sd), 0, 1)
  // Town: an ink dot with a paper hairline round it.
  const dotInk = cover(r.sub(R))
  const dotPaper = cover(r.sub(R.add(1)))
  // Capital: a fine ring round a dot, paper between them.
  const ringInk = cover(abs(r.sub(R.sub(0.7))).sub(0.65))
  const pip = cover(r.sub(R.mul(0.36)))
  const inside = cover(r.sub(R))
  // Rome: the capital's mark with a second, finer ring outside it.
  const outer = cover(abs(r.sub(R.add(2.3))).sub(0.45))
  const outerPaper = cover(r.sub(R.add(3.2)))
  // Seat: a diamond in its power's colour, outlined in ink.
  const dd = abs(p.x).add(abs(p.y)).sub(R).mul(0.7071)
  const dia = cover(dd.sub(0.5))
  const diaInk = cover(abs(dd).sub(0.6))
  const capitalInk = max(ringInk, pip)
  const ink = select(
    shape.greaterThan(2.5),
    max(capitalInk, outer),
    select(
      shape.greaterThan(1.5),
      diaInk,
      select(shape.greaterThan(0.5), capitalInk, dotInk),
    ),
  )
  const under = select(
    shape.greaterThan(2.5),
    max(inside, outerPaper.mul(0.5)),
    select(
      shape.greaterThan(1.5),
      dia,
      select(shape.greaterThan(0.5), inside, dotPaper.mul(0.55)),
    ),
  )
  const base = select(
    shape.greaterThan(1.5).and(shape.lessThan(2.5)),
    fill,
    vec3(PAPER.r, PAPER.g, PAPER.b),
  )
  mat.colorNode = mix(base, vec3(INK.r, INK.g, INK.b), ink)
  mat.opacityNode = max(ink, under)
    .mul(attribute('alpha', 'float'))
    .mul(placeUniforms.enabled)
  return mat
}

function textMaterial(f: FontData, atlas: THREE.Texture, gain: number, haloAlpha: number) {
  const mat = new THREE.MeshBasicNodeMaterial()
  screenAnchored(mat)
  // One style everywhere, land or sea. (Choosing light or dark per name, by the ground
  // under it, was tried and read as random: neighbours differed and names flipped
  // with the zoom.) The halo is wider than the land lettering's, and soft, so the
  // name holds on pale desert as well as on dark relief.
  const { ink, halo } = msdfInk(f, atlas, uv(), gain, haloAlpha, 2.4)
  mat.colorNode = mix(
    vec3(NAME_HALO.r, NAME_HALO.g, NAME_HALO.b),
    vec3(NAME_INK.r, NAME_INK.g, NAME_INK.b),
    ink,
  )
  mat.opacityNode = max(ink.mul(0.97), halo)
    .mul(attribute('alpha', 'float'))
    .mul(placeUniforms.enabled)
  return mat
}
