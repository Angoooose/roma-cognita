import type { LabelLayer } from './labels/LabelLayer.ts'
import type { PlaceHit, PlaceLayer } from './labels/PlaceLayer.ts'
import type {
  ClaimRecord,
  PoliticalHit,
  PoliticalLayer,
} from './politics/PoliticalLayer.ts'

/** Something on the map a reader can go to by name. */
export type MapRef = { kind: 'place' | 'polity'; id: string }

/** A searchable thing: what it is called, what it is, and when the map shows it. */
export interface MapEntry {
  ref: MapRef
  /** Its name in the year asked for, or in the first year it is on the map. */
  name: string
  /** Every other name it has carried, for search to match. */
  names: string[]
  /** A settlement's civic status, or a polity's kind: 'province', 'kingdom', … */
  kind: string
  /** The years it is on the map, astronomical and inclusive, in order, within the data's window. */
  years: [number, number][]
  /**
   * What it is part of, in the same year as `name`: for a settlement the polity that
   * holds its ground, or the kingdom seated there; for a polity the power it answers to.
   */
  of?: string
  /** A polity's footing with that power, as its claim records it. */
  relation?: ClaimRecord['relation']
  /** The mark the map draws it with, and its colour (sRGB hex) for a fill or a seat. */
  mark: 'fill' | 'caput' | 'capital' | 'seat' | 'town'
  fill?: string
  /** A settlement's prominence, 1 (overview) … 4 (close in). */
  prominence?: number
  /** How far a polity's name runs on the map, metres: a rough measure of its size. */
  reach?: number
}

/** Where to look, as a ground target and a scale in m per CSS pixel. */
interface Frame {
  x: number
  y: number
  mpp: number
}

interface Layers {
  places: PlaceLayer
  politics: PoliticalLayer
  labels: LabelLayer
}

/**
 * Everything the reader can search for, named for `year`. `placeAtoms` is the atom each
 * settlement stands on, for what holds it (RomeMap.entries reads them once).
 */
export function entries(
  { places, politics, labels }: Layers,
  year: number,
  placeAtoms: Map<string, string | null>,
): MapEntry[] {
  const window = politics.window
  if (!window) return []
  const hex = (c: { getHexString(): string }) => `#${c.getHexString()}`
  const out: MapEntry[] = []
  for (const p of places.all) {
    const years = spans([p.years], window)
    if (!years.length) continue
    const y = on(years, year) ? year : years[0][0]
    const hit = places.hitFor(p.id, y)
    const status = hit?.status
    const atom = placeAtoms.get(p.id)
    const holder = atom ? politics.holderOf(atom, y) : undefined
    // A city-state named for its city says nothing new; its status does.
    const held = holder && politics.nameOf(holder, y)
    const seat = hit?.seatOf
    const capital = status === 'provincial seat' || status === 'royal seat'
    out.push({
      ref: { kind: 'place', id: p.id },
      name: p.name,
      names: [],
      kind: status ?? 'settlement',
      years,
      of: seat?.name ?? (held !== p.name ? held : undefined),
      mark: seat
        ? 'seat'
        : status === 'caput mundi'
          ? 'caput'
          : capital
            ? 'capital'
            : 'town',
      fill: seat ? hex(politics.colourOf(seat.polity, y)) : undefined,
      prominence: p.prominence.find((d) => d.years[0] <= y && y <= d.years[1])?.value ?? 4,
    })
  }
  for (const p of politics.polities) {
    const shown = labels.namesOf(p.id)
    const seats = places.allSeats.filter((s) => s.polity === p.id)
    const years = spans(
      [...shown.flatMap((n) => n.years), ...seats.map((s) => s.years)],
      window,
    )
    // A power with no ground of its own (Rome, through its provinces) has nothing to go to.
    if (!years.length) continue
    const y = on(years, year) ? year : years[0][0]
    const name = politics.nameOf(p.id, y) ?? p.name
    const names = new Set([
      p.name,
      ...(p.names ?? []).map((n) => n.text),
      ...shown.map((n) => titleCase(n.text)),
    ])
    names.delete(name)
    const hit = hitFor({ places, politics, labels }, { kind: 'polity', id: p.id }, y)
    const territory = hit && 'territory' in hit ? hit.territory : undefined
    const power = territory?.power
    out.push({
      ref: { kind: 'polity', id: p.id },
      name,
      names: [...names],
      kind: p.kind,
      years,
      of: power && power.id !== p.id ? power.name : undefined,
      relation: territory?.claim?.relation,
      mark: 'fill',
      fill: hex(politics.colourOf(p.id, y)),
      reach: shown
        .filter((n) => on(n.years, y))
        .reduce((sum, n) => sum + length(n.path), 0),
    })
  }
  return out
}

/** Where to look to see `ref` in `year`, in a view `w` × `h` CSS px; null if it is not on the map. */
export function frame(
  layers: Layers,
  ref: MapRef,
  year: number,
  w: number,
  h: number,
): Frame | null {
  const { places, labels } = layers
  if (ref.kind === 'place') {
    const p = places.all.find((q) => q.id === ref.id)
    if (!p || !places.hitFor(p.id, year)) return null
    // Well inside the scale it shows from, but never so far out that a town is lost.
    return { x: p.x, y: p.y, mpp: Math.min(600, 0.6 * places.showsFrom(p.id, year)) }
  }
  const paths = labels
    .namesOf(ref.id)
    .filter((n) => on(n.years, year))
    .flatMap((n) => n.path)
  if (paths.length) {
    const xs = paths.map((q) => q[0])
    const ys = paths.map((q) => q[1])
    const [x0, x1, y0, y1] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ]
    // A name runs along most of its territory: two fifths of the view leaves the land round it.
    const mpp = Math.max((x1 - x0) / (0.4 * w), (y1 - y0) / (0.4 * h), 120)
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, mpp }
  }
  const seat = seatOf(places, ref.id, year)
  return seat ? frame(layers, { kind: 'place', id: seat }, year, w, h) : null
}

/** What the inspector shows for `ref` in `year`, as a pick would report it. */
export function hitFor(
  { places, labels, politics }: Layers,
  ref: MapRef,
  year: number,
): { place: PlaceHit } | { territory: PoliticalHit } | null {
  if (ref.kind === 'place') {
    const place = places.hitFor(ref.id, year)
    return place && { place }
  }
  // The ground its name is on, held in its own right that year.
  const atom = labels
    .namesOf(ref.id)
    .filter((n) => on(n.years, year))
    .flatMap((n) => n.atoms)
    .find((a) => politics.holderOf(a, year) === ref.id)
  const territory = atom ? politics.hitAt(atom, year) : null
  if (territory) return { territory }
  // A kingdom drawn only by its seat is shown as the seat.
  const seat = seatOf(places, ref.id, year)
  const place = seat ? places.hitFor(seat, year) : null
  return place && { place }
}

function seatOf(places: PlaceLayer, polity: string, year: number) {
  return places.allSeats.find(
    (s) => s.polity === polity && s.years[0] <= year && year <= s.years[1],
  )?.place
}

function length(path: [number, number][]) {
  let d = 0
  for (let k = 1; k < path.length; k++)
    d += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1])
  return d
}

function on(years: [number, number][], year: number) {
  return years.some(([a, b]) => a <= year && year <= b)
}

/** Ranges clipped to the window, sorted, and merged where they touch. */
function spans(ranges: [number, number][], [lo, hi]: [number, number]) {
  const clipped = ranges
    .map(([a, b]): [number, number] => [Math.max(a, lo), Math.min(b, hi)])
    .filter(([a, b]) => a <= b)
    .sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const r of clipped) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([...r])
  }
  return out
}

/** `BITHYNIA ET PONTUS` → `Bithynia et Pontus`, as the lettering's words are written. */
function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(' ')
    .map((w, k) => (k > 0 && w === 'et' ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}
