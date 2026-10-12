/**
 * What each known building of the model of Rome was like (DESIGN.md §7.7): its type,
 * its size, its columns, its stairs, the way it faced — as its sources describe it for
 * 133–27 BCE, with those sources, so the model builds each one as itself and not as a
 * typical box of its kind. The engine's architecture (packages/engine/src/rome/
 * architecture.ts and monuments.ts) knows how such a building is put together; this
 * file says which building it is.
 *
 * A design places its building by the record's surveyed outline (its box and axis)
 * unless it says otherwise: `at` for a centre where there is no outline or the outline
 * is of later remains, `size` for its extent across its front and along its depth,
 * `bearing` for the way its front faces. Numbers are the sources' where they give
 * them; where they do not, the note says what is typical and why.
 */
import { projection } from '@roma-cognita/world'
import type { Place } from '@roma-cognita/schema'
import { DESIGNS_CAMPUS } from './designs/campus.ts'
import { DESIGNS_CAPITOL } from './designs/capitol.ts'
import { DESIGNS_FORUM } from './designs/forum.ts'
import { DESIGNS_SOUTH } from './designs/south.ts'

export type Order = 'tuscan' | 'doric' | 'ionic' | 'corinthian'

interface Placing {
  /** Its centre, lon/lat, where the outline does not give it. */
  at?: [number, number]
  /** Where in its own frame `at` lies, if not at its centre: across and along, metres. */
  atLocal?: [number, number]
  /** Across its front and along its depth, metres. */
  size?: [number, number]
  /** The way its front faces, degrees clockwise from true north (not the plane's). */
  bearing?: number
  /** The building's own extent where it is smaller than its site (its site is `size`). */
  extent?: [number, number]
  /**
   * The level its site is cut and filled to (model.ts): the mean of the ground under
   * it (the default, cut and fill balanced); the lowest, where it was cut into a slope;
   * the highest, where it was built out as a terrace, its foundations running down;
   * or the height above the sea its excavators found, metres.
   */
  level?: 'low' | 'mean' | 'top' | number
  /**
   * The sides (front, right, back, left) where its site was cut into a hillside, behind
   * retaining walls no higher than `h`, metres. On its other sides the ground stood
   * near its level, or at `foot` where it was built out over lower ground on its own
   * walls, and today's higher ground there, the fill of later centuries, is taken
   * down to it, or along a `street` at its level raised to it (model.ts).
   */
  cut?: {
    sides: [boolean, boolean, boolean, boolean]
    h: number
    foot?: number
    /**
     * The sides along which a street or terrace ran at its level, where today's ground
     * is lower: the ground there raised to its level and eased back down beyond.
     */
    street?: [boolean, boolean, boolean, boolean]
  }
  /** How much of it stands while it is being built, as a share of its height. */
  progress?: number
  /**
   * Its site was open ground before it was built — a platform, a precinct, an estate's
   * grounds — so no generated houses stand there in the years before it.
   */
  open?: boolean
  /** What the numbers rest on: the sources, and what is inferred. */
  why: string
}

export interface TempleDesign {
  model: 'temple'
  plan: 'peripteral' | 'sine-postico' | 'prostyle' | 'pseudoperipteral' | 'in-antis'
  front: number
  flank?: number
  porch?: number
  fullPorch?: boolean
  order: Order
  /** Column height, metres. */
  column: number
  podium: number
  stairs: 'front' | 'lateral' | 'none'
  platform?: number
  platformH?: number
  niche?: number
  cellae?: number
  cellaWidth?: number
  porchWidth?: number
  stairWidth?: number
  apse?: boolean
  covering?: 'tile' | 'gilt'
  quadriga?: boolean
  precinct?: [number, number]
  grove?: [number, number]
  terrace?: [number, number, number, number, number]
  forecourt?: { w: number; l: number; h: number; order: Order; colour?: string }
  altar?: number
  /** The building's place within its site, across and along, where it is not at the middle. */
  offset?: [number, number]
}

export interface TholosDesign {
  model: 'tholos'
  columns: number
  order: Order
  column: number
  podium: number
  crepis?: boolean
  covering?: 'tile' | 'gilt'
  walled?: boolean
  platform?: [number, number, number]
  offset?: [number, number]
}

/** Any other building type the engine builds (monuments.ts), with its own fields. */
export interface OtherDesign {
  model:
    | 'basilica'
    | 'curia'
    | 'forum'
    | 'porticus'
    | 'theatre'
    | 'circus'
    | 'mausoleum'
    | 'bridge'
    | 'arch'
    | 'tabularium'
    | 'regia'
    | 'domus'
    | 'rostra'
    | 'shrine'
    | 'basin'
    | 'tomb'
    | 'navalia'
    | 'prison'
    | 'island'
    | 'amphitheatre'
    | 'hut'
    | 'enclosure'
    | 'square'
    | 'comitium'
    | 'quay'
    | 'horrea'
    | 'ara'
    | 'plain'
  [k: string]: unknown
}

export type Design = Placing &
  (TempleDesign | TholosDesign | OtherDesign) & {
    /** Later forms of it, from a year (astronomical): the fields that change then. */
    phases?: ({ from: number } & Record<string, unknown>)[]
  }

export const DESIGNS: Record<string, Design> = {
  ...DESIGNS_FORUM,
  ...DESIGNS_CAPITOL,
  ...DESIGNS_CAMPUS,
  ...DESIGNS_SOUTH,
}

/**
 * A temple no source describes in detail: the typical mid-Republican temple on its
 * podium — four columns across a deep porch two bays deep, of the Tuscan order under
 * stucco, a flight of steps across its front — placed and sized as the record's point
 * temple is (model.ts `POINT_TEMPLE`), its front downhill. Vitruvius' Tuscan temple
 * (4.7) and the Largo Argentina's Temple C are its models.
 */
export const DEFAULT_TEMPLE: Design = {
  model: 'temple',
  plan: 'prostyle',
  front: 4,
  porch: 2,
  order: 'tuscan',
  column: 8,
  podium: 3,
  stairs: 'front',
  why: "A typical mid-Republican temple: Vitruvius 4.7; the Largo Argentina's Temple C.",
}

/**
 * The footprints of the designs that give their own size, with any shops behind
 * their porticoes, as rectangles in plane metres, for what must reach round them or keep off them before the model is built
 * (the plate's extent, the streets drawn from the evidence). Placed as the model
 * places them (model.ts), but without the outline's box, so a design with no `at`
 * is centred on its record's point.
 */
export function designFootprints(
  places: Map<string, Place>,
): { id: string; ring: [number, number][] }[] {
  return Object.entries(DESIGNS).flatMap(([id, d]) => {
    const p = places.get(id)
    if (!p || !d.size) return []
    const [cx, cy] = projection.forward(...(d.at ?? p.location))
    const b = planeBearing(d.bearing ?? 0, d.at ?? p.location)
    const f = [Math.sin(b), Math.cos(b)]
    const r = [f[1], -f[0]]
    const [du, dv] = d.atLocal ?? [0, 0]
    const [ox, oy] = [cx - r[0] * du - f[0] * dv, cy - r[1] * du - f[1] * dv]
    const [w, l] = d.size
    // With the shops behind its porticoes (front, right, back, left).
    const shops = (d as { shops?: { depth: number; sides: boolean[] } }).shops
    const [mf, mr, mb, ml] = [0, 1, 2, 3].map((i) => (shops?.sides[i] ? shops.depth : 0))
    const ring = [
      [-w / 2 - ml, -l / 2 - mb],
      [w / 2 + mr, -l / 2 - mb],
      [w / 2 + mr, l / 2 + mf],
      [-w / 2 - ml, l / 2 + mf],
      [-w / 2 - ml, -l / 2 - mb],
    ].map(
      ([u, v]) => [ox + r[0] * u + f[0] * v, oy + r[1] * u + f[1] * v] as [number, number],
    )
    return [{ id, ring }]
  })
}

/**
 * A true compass bearing, degrees, as a bearing on the atlas's plane at a point,
 * radians: the plane's north is turned from true north away from its central
 * meridian (about 4.6° at Rome), so a design's bearing is turned by as much.
 */
export function planeBearing(degrees: number, [lon, lat]: [number, number]) {
  const a = projection.forward(lon, lat)
  const n = projection.forward(lon, lat + 0.001)
  return (degrees * Math.PI) / 180 + Math.atan2(n[0] - a[0], n[1] - a[1])
}
