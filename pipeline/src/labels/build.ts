/**
 * Map lettering, placed offline (DESIGN.md §7.5). Writes build/labels/territories.json:
 *
 * - land: one placement per distinct territory (a polity and the set of atoms it
 *   holds), with the years it is in force, in Cinzel capitals;
 * - water: one per sea, gulf and strait, along its hand-placed course
 *   (pipeline/src/labels/seas.ts), in EB Garamond italic.
 *
 * Needs the font atlases (npm run fonts -w pipeline) for letter widths.
 *
 *   npm run labels -w pipeline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatYear } from '@roman-map/schema'
import { loadDataset } from '../load.ts'
import type { Ring } from '../water/raster.ts'
import { projectRing } from '../water/sources.ts'
import { placeLabel, textWidth, type FontMetrics } from './territories.ts'
import { projection } from '@roman-map/world'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT_DIR, 'build/labels')

export function readFont(name: string): FontMetrics {
  const meta = JSON.parse(readFileSync(join(ROOT_DIR, `build/fonts/${name}.json`), 'utf8'))
  const H = meta.chars.find((c: { char: string }) => c.char === 'H')
  // Glyph boxes carry half the distance range of padding on each side.
  const capPx = H.height - meta.distanceField.distanceRange
  return {
    size: meta.info.size,
    advance: new Map(meta.chars.map((c: { id: number; xadvance: number }) => [c.id, c.xadvance])),
    kerning: new Map(
      meta.kernings.map((k: { first: number; second: number; amount: number }) => [`${k.first},${k.second}`, k.amount]),
    ),
    capHeight: capPx / meta.info.size,
  }
}

const data = loadDataset()
const font = readFont('cinzel')
const name = (id: string) =>
  data.names.find((n) => n.target.kind === 'polity' && n.target.id === id && n.preferred)?.text ?? id

// Territories by year: polity → sorted atom ids. The holding layer only, as drawn.
const years = data.claims.flatMap((c) => [c.from.year, c.to.year])
const [first, last] = [Math.min(...years), Math.max(...years)]
const territories = new Map<string, { polity: string; atoms: string[]; years: number[] }>()
for (let y = first; y <= last; y++) {
  const held = new Map<string, string[]>()
  for (const c of data.claims) {
    if (c.relation === 'occupied' || c.from.year > y || c.to.year < y) continue
    held.set(c.polity, [...(held.get(c.polity) ?? []), c.atom])
  }
  for (const [polity, atoms] of held) {
    const key = `${polity}:${atoms.sort().join('+')}`
    let t = territories.get(key)
    if (!t) territories.set(key, (t = { polity, atoms, years: [] }))
    t.years.push(y)
  }
}

const ringsFor = (atoms: string[]): Ring[] => {
  const out: Ring[] = []
  let polygon = 0
  for (const id of atoms) {
    const geom = data.geometry.atoms.get(id)!
    for (const poly of geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates) {
      const p = polygon++
      for (const ring of poly) out.push(projectRing(ring, p, Infinity))
    }
  }
  return out
}

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
  const text = name(t.polity).toUpperCase()
  const place = placeLabel(ringsFor(t.atoms), text, font)
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
  data.names.find((n) => n.target.kind === 'feature' && n.target.id === id && n.preferred)?.text ?? id
for (const f of data.features) {
  if (f.kind !== 'sea' && f.kind !== 'gulf' && f.kind !== 'strait') continue
  const shape = data.geometry.features.get(f.id)
  if (!shape || shape.geometry.type !== 'LineString') continue
  const path = smooth(shape.geometry.coordinates.map(([lon, lat]) => projection.forward(lon, lat)))
  let length = 0
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
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
  console.log(`${text.padEnd(22)} ${(capHeight / 1000).toFixed(1).padStart(5)} km caps (water)`)
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
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3)
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
