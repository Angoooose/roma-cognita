/**
 * Map lettering, placed offline (DESIGN.md §7.5). Writes build/labels/territories.json:
 *
 * - land: one placement per distinct territory (a polity and the set of atoms it
 *   holds), with the years it is in force, in Cinzel capitals;
 * - water: one per sea, gulf and strait, along its hand-placed course
 *   (pipeline/src/labels/seas.ts), in EB Garamond italic.
 *
 * And build/labels/places.json: every settlement in plane metres with its dated
 * prominence and status, and the seats of kingdoms drawn as their capital. Those are
 * placed at run time, in screen space, because what fits depends on the zoom.
 *
 * Needs the font atlases (npm run fonts -w pipeline) for letter widths.
 *
 *   npm run labels -w pipeline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatYear } from '@roma-cognita/schema'
import { loadDataset } from '../load.ts'
import { passageUrl, workUrl } from '../passages/passage.ts'
import type { Ring } from '../water/raster.ts'
import { projectRing } from '../water/sources.ts'
import { placeLabel, textWidth, type FontMetrics } from './territories.ts'
import { knownPolygons, readKnownWorld } from '../known/world.ts'
import { projection } from '@roma-cognita/world'
import { lonLatToPixel, readDem, TILE, type Raster } from '../features/dem.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT_DIR, 'build/labels')

export function readFont(name: string): FontMetrics {
  const meta = JSON.parse(readFileSync(join(ROOT_DIR, `build/fonts/${name}.json`), 'utf8'))
  const H = meta.chars.find((c: { char: string }) => c.char === 'H')
  // Glyph boxes carry half the distance range of padding on each side.
  const capPx = H.height - meta.distanceField.distanceRange
  return {
    size: meta.info.size,
    advance: new Map(
      meta.chars.map((c: { id: number; xadvance: number }) => [c.id, c.xadvance]),
    ),
    kerning: new Map(
      meta.kernings.map((k: { first: number; second: number; amount: number }) => [
        `${k.first},${k.second}`,
        k.amount,
      ]),
    ),
    capHeight: capPx / meta.info.size,
  }
}

const data = loadDataset()
const font = readFont('cinzel')
/** The polity's preferred name in force in `year` (Bithynia becomes Bithynia et Pontus in 63). */
const name = (id: string, year: number) => {
  const preferred = data.names.filter(
    (n) => n.target.kind === 'polity' && n.target.id === id && n.preferred,
  )
  return (
    (preferred.find((n) => n.from.year <= year && year <= n.to.year) ?? preferred[0])
      ?.text ?? id
  )
}

// Territories by year: polity → sorted atom ids. The holding layer only, as drawn.
const years = data.claims.flatMap((c) => [c.from.year, c.to.year])
const [first, last] = [Math.min(...years), Math.max(...years)]
const territories = new Map<
  string,
  { polity: string; atoms: string[]; text: string; years: number[] }
>()
for (let y = first; y <= last; y++) {
  const held = new Map<string, string[]>()
  for (const c of data.claims) {
    if (c.relation === 'occupied' || c.from.year > y || c.to.year < y) continue
    held.set(c.polity, [...(held.get(c.polity) ?? []), c.atom])
  }
  for (const [polity, atoms] of held) {
    // A renamed polity on the same ground is a new label.
    const text = name(polity, y)
    const key = `${polity}:${atoms.sort().join('+')}:${text}`
    let t = territories.get(key)
    if (!t) territories.set(key, (t = { polity, atoms, text, years: [] }))
    t.years.push(y)
  }
}

// A name goes on the known part of its territory: past the edge of the known world the
// map is only a sketch, and a name there would claim what the colour does not.
const known = readKnownWorld()
const ringsFor = (atoms: string[]): Ring[] => {
  const out: Ring[] = []
  let polygon = 0
  for (const id of atoms) {
    for (const poly of knownPolygons(known, id, data.geometry.atoms.get(id)!)) {
      const p = polygon++
      for (const ring of poly) out.push(projectRing(ring, p, Infinity))
    }
  }
  return out
}

/** Rough plane size of an atom (its rings' boxes), for choosing where a name falls back to. */
const atomArea = (id: string) =>
  ringsFor([id]).reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxY - r.minY), 0)

/** Consecutive years as [from, to] ranges. */
const ranges = (ys: number[]) => {
  const out: [number, number][] = []
  for (const y of ys) {
    const last = out[out.length - 1]
    if (last && last[1] === y - 1) last[1] = y
    else out.push([y, y])
  }
  return out
}

const labels: Record<string, unknown>[] = []
for (const t of territories.values()) {
  const text = t.text.toUpperCase()
  // A territory joined by a narrow neck (Bithynia and Pontus at the Parthenius) can
  // be too long and thin for one curve; then the name goes on its largest atom.
  const byArea = [...t.atoms].sort((a, b) => atomArea(b) - atomArea(a))
  const place =
    placeLabel(ringsFor(t.atoms), text, font) ??
    (t.atoms.length > 1
      ? (byArea.map((a) => placeLabel(ringsFor([a]), text, font)).find(Boolean) ?? null)
      : null)
  if (!place) {
    console.warn(`  no room for ${text} on ${t.atoms.join('+')}`)
    continue
  }
  const r = ranges(t.years)
  labels.push({
    polity: t.polity,
    kind: 'land',
    font: 'cinzel',
    text,
    atoms: t.atoms,
    years: r,
    ...place,
    path: place.path.map(([x, y]) => [Math.round(x), Math.round(y)]),
    capHeight: Math.round(place.capHeight),
    tracking: Math.round(place.tracking * 1000) / 1000,
    fit: Math.round(place.fit * 100) / 100,
  })
  console.log(
    `${text.padEnd(22)} ${(place.capHeight / 1000).toFixed(1).padStart(5)} km caps, tracking ${place.tracking.toFixed(2)} em, ${r.map(([a, b]) => `${formatYear(a)}–${formatYear(b)}`).join(', ')}`,
  )
}

// --- water names ------------------------------------------------------------------

/** Tracking for water names: open, as italic lettering on a chart is. */
const SEA_TRACKING = 0.16
/** How much of its course a water name fills. */
const SEA_FILL = 0.9
const italic = readFont('garamond-italic')
const featureName = (id: string) =>
  data.names.find((n) => n.target.kind === 'feature' && n.target.id === id && n.preferred)
    ?.text ?? id
for (const f of data.features) {
  if (f.kind !== 'sea' && f.kind !== 'gulf' && f.kind !== 'strait') continue
  const shape = data.geometry.features.get(f.id)
  if (!shape || shape.geometry.type !== 'LineString') continue
  const path = smooth(
    shape.geometry.coordinates.map(([lon, lat]) => projection.forward(lon, lat)),
  )
  let length = 0
  for (let i = 1; i < path.length; i++)
    length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  const text = featureName(f.id)
  const em = (SEA_FILL * length) / textWidth(text, italic, SEA_TRACKING)
  const capHeight = em * italic.capHeight
  labels.push({
    feature: f.id,
    kind: 'water',
    font: 'garamond-italic',
    text,
    years: [[Math.max(first, f.from.year), Math.min(last, f.to.year)]],
    path: path.map(([x, y]) => [Math.round(x), Math.round(y)]),
    capHeight: Math.round(capHeight),
    tracking: SEA_TRACKING,
  })
  console.log(
    `${text.padEnd(22)} ${(capHeight / 1000).toFixed(1).padStart(5)} km caps (water)`,
  )
}

/** A few control points → a smooth 24-point curve (Catmull–Rom through every point). */
function smooth(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts
  const out: [number, number][] = []
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  const per = Math.ceil(24 / (pts.length - 1))
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)]
    for (let k = 0; k < per; k++) {
      const t = k / per
      const t2 = t * t
      const t3 = t2 * t
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + cc) * t +
          (2 * a - 5 * b + 4 * cc - d) * t2 +
          (-a + 3 * b - 3 * cc + d) * t3)
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, 'territories.json'),
  JSON.stringify({
    _comment:
      'Placements: land names per distinct territory, water names per sea. `path` is the polyline the middle of the capitals follows, plane metres, left to right; `capHeight` metres; `tracking` em; `years` astronomical ranges, inclusive; `font` a build/fonts atlas.',
    labels,
  }),
)
console.log(`${labels.length} placements (${territories.size} territories)`)

// --- places and seats -------------------------------------------------------------

const years2 = (e: { from: { year: number }; to: { year: number } }) => [
  e.from.year,
  e.to.year,
]
const placeName = (id: string) =>
  data.names.find((n) => n.target.kind === 'place' && n.target.id === id && n.preferred)
    ?.text ??
  data.names.find((n) => n.target.kind === 'place' && n.target.id === id)?.text ??
  id
const sourceById = new Map(data.sources.map((s) => [s.id, s]))
const planned = new Set<string>(
  JSON.parse(
    readFileSync(join(ROOT_DIR, 'data/geometry/rome.geojson'), 'utf8'),
  ).features.map((f: { id: string }) => f.id),
)
const places = data.places.map((p) => {
  const [x, y] = projection.forward(...p.location)
  return {
    id: p.id,
    name: placeName(p.id),
    pleiades: p.pleiades,
    kind: p.kind,
    x: Math.round(x),
    y: Math.round(y),
    years: years2(p),
    prominence: p.prominence.map((d) => ({ value: d.value, years: years2(d) })),
    status: p.status.map((d) => ({ value: d.value, years: years2(d) })),
    condition: p.condition.length
      ? p.condition.map((d) => ({ value: d.value, years: years2(d) }))
      : undefined,
    within: p.within,
    // Drawn on the city plan (build/rome), so it is named without a marker.
    outlined: planned.has(p.id) || undefined,
    labelSide: p.labelSide,
    confidence: p.confidence,
    review: p.review,
    sources: p.sources.map((s) => ({
      id: s.source,
      citation: sourceById.get(s.source)?.citation ?? s.source,
      url: sourceById.get(s.source)?.url ?? workUrl(s.source),
      locator: s.locator,
      // The page a quote was read on, where there is one, before the link the locator builds.
      passage: s.url ?? passageUrl(s.source, s.locator),
    })),
    note: p.note,
  }
})
// The ground under each place, metres, from Mapterhorn at z10 (~100 m texels): the
// engine lifts its marker and name to it, so a tilted view does not slide them off
// their place (labels/PlaceLayer.ts).
const ELEVATION_Z = 10
const demTiles = new Map<string, Raster>()
for (const [i, p] of places.entries()) {
  const [lon, lat] = data.places[i].location
  const [px, py] = lonLatToPixel(ELEVATION_Z, lon, lat)
  const key = `${Math.floor(px / TILE)}/${Math.floor(py / TILE)}`
  let r = demTiles.get(key)
  if (!r) {
    r = await readDem({ west: lon, east: lon, south: lat, north: lat }, ELEVATION_Z)
    demTiles.set(key, r)
  }
  const h = r.data[Math.floor(py - r.y0) * r.width + Math.floor(px - r.x0)]
  ;(p as Record<string, unknown>).z = Math.max(0, Math.round(h))
}

// Which side of each place has land, so a name can sit on the land and not the sea.
// Measured on the coast mask at 431 m texels over the box a name of this length would
// cover, at each of LAND_SCALES m/px (the engine picks the nearest): the share of land
// under the box on each side. Sizes mirror the engine's TIER_EM.
const LAND_SCALES = [3000, 1500, 800, 400, 200]
const SIDE_EM = [0, 18, 16.5, 16, 15, 14]
const water = await coastSampler()
for (const p of places) {
  const tier = p.prominence[0]?.value ?? 4
  const land: Record<string, number[]> = { e: [], w: [], n: [], s: [] }
  for (const mpp of LAND_SCALES) {
    const wM = p.name.length * 0.5 * SIDE_EM[tier] * mpp
    const hM = 0.72 * SIDE_EM[tier] * mpp
    const off = 8 * mpp
    const boxes: Record<string, [number, number, number, number]> = {
      e: [p.x + off, p.y - hM / 2, p.x + off + wM, p.y + hM / 2],
      w: [p.x - off - wM, p.y - hM / 2, p.x - off, p.y + hM / 2],
      n: [p.x - wM / 2, p.y + off, p.x + wM / 2, p.y + off + hM],
      s: [p.x - wM / 2, p.y - off - hM, p.x + wM / 2, p.y - off],
    }
    for (const [side, [x0, y0, x1, y1]] of Object.entries(boxes)) {
      let n = 0
      for (let i = 0; i < 10; i++)
        for (let j = 0; j < 3; j++)
          if (
            water.isLand(
              x0 + ((x1 - x0) * (i + 0.5)) / 10,
              y0 + ((y1 - y0) * (j + 0.5)) / 3,
            )
          )
            n++
      land[side].push(Math.round((n / 30) * 100) / 100)
    }
  }
  ;(p as Record<string, unknown>).land = land
}

const seats = data.seats.map((s) => ({
  polity: s.polity,
  name: name(s.polity, s.from.year),
  place: s.place,
  years: years2(s),
  confidence: s.confidence,
}))
writeFileSync(
  join(OUT, 'places.json'),
  JSON.stringify({
    _comment:
      'Settlements and monuments in plane metres (z: the ground under them, metres) with dated prominence (1 overview … 4 close, 5 the city plan), status and condition; seats of kingdoms drawn as their capital. Years astronomical, inclusive.',
    landScales: LAND_SCALES,
    places,
    seats,
  }),
)
console.log(`${places.length} places, ${seats.length} seats`)

/** Land or sea at a plane point, from the coast mask's level-6 tiles (build/water). */
async function coastSampler() {
  const { default: sharp } = await import('sharp')
  const { ROOT, TILE_TEXELS } = await import('@roma-cognita/world')
  const dir = join(ROOT_DIR, 'build/water')
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const level = 6
  const codes = new Uint8Array(Buffer.from(index.codes[level], 'base64'))
  const n = 2 ** level
  const size = ROOT.size / n
  const tiles = new Map<string, Uint8Array | null>()
  const keys = new Set<string>()
  for (const p of data.places) {
    const [x, y] = projection.forward(...p.location)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const i = Math.floor((x - ROOT.x) / size) + di
        const j = Math.floor((y - ROOT.y) / size) + dj
        if (codes[j * n + i] === 2) keys.add(`${i}/${j}`)
      }
  }
  for (const key of keys) {
    try {
      const { data: px, info } = await sharp(join(dir, `${level}/${key}.webp`))
        .raw()
        .toBuffer({ resolveWithObject: true })
      const ch = new Uint8Array(TILE_TEXELS * TILE_TEXELS)
      for (let k = 0; k < ch.length; k++) ch[k] = px[k * info.channels]
      tiles.set(key, ch)
    } catch {
      tiles.set(key, null)
    }
  }
  return {
    isLand(x: number, y: number) {
      const i = Math.floor((x - ROOT.x) / size)
      const j = Math.floor((y - ROOT.y) / size)
      if (i < 0 || j < 0 || i >= n || j >= n) return false
      const code = codes[j * n + i]
      if (code !== 2) return code === 1 || code === 3
      const t = tiles.get(`${i}/${j}`)
      if (!t) return false
      const c = Math.round(((x - (ROOT.x + i * size)) / size) * (TILE_TEXELS - 1))
      const r =
        TILE_TEXELS - 1 - Math.round(((y - (ROOT.y + j * size)) / size) * (TILE_TEXELS - 1))
      return t[r * TILE_TEXELS + c] > 127
    },
  }
}
