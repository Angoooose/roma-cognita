/**
 * Fetches the excavated streets of Rome from SITAR, the archaeological GIS of the
 * Soprintendenza Speciale di Roma, into data/geometry/rome-sitar.geojson (DESIGN.md
 * §7.7): `npm run rome:sitar -w pipeline`.
 *
 * SITAR records every piece of ancient street found in an excavation — a stretch of
 * paving, a kerb, a ramp or a flight of steps — as an outline where it was found,
 * with the years it is dated to. Only those in and around the Servian Wall that may
 * have stood between 68 and 27 BCE are kept: begun by 27 BCE, and either in use to
 * 68 or dated to the one year it was built.
 * Most are dated only "Roman" (509 BCE–476 CE); those are kept, since nothing says
 * they are later. Undated pieces are not.
 *
 * It also keeps the heights excavations measured on the ground people walked on
 * then — floors, paving, the surfaces of streets and yards — for the ancient ground
 * the model stands on (ground.ts): data/geometry/rome-levels.geojson. Only those in
 * a phase dated between 400 BCE and 150 CE, begun by 14 CE, are kept, and those of
 * the pieces the corrections of the ground cite; a piece dated only "Roman" says
 * nothing of how high the ground then was.
 *
 * The recorded streets whose course is drawn from the evidence (routes.ts) pass
 * along these pieces, citing them by number; the generated streets (city.ts) keep
 * to the rest. The data is CC BY-SA 4.0 (data/sources.yaml, `sitar`). Run it again
 * to pick up new excavations, and look at the diff.
 *
 * And the Servian Wall: SITAR's reconstruction of its whole course, and the pieces of
 * it that were found, into data/geometry/rome-servian.geojson (servian.ts).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projection } from '@roman-map/world'
import { DATA_DIR } from '../load.ts'
import { CORRECTIONS } from './ground.ts'

const WFS = 'https://repositar.archeositarproject.it/geoserver/wfs'
/** The walled city and a margin round it, lat/lon. */
const BOX = [41.874, 12.462, 41.914, 12.515]
/** The window: a piece is kept if it may have stood in these years. */
const WINDOW = [-68, -27]

interface Props {
  codice_pa: number
  codice_oi: number
  categoria: string
  def_oggettiva: string | null
  definizione_specifica1: string | null
  def_interpretativa: string | null
  anno_da: number | null
  anno_a: number | null
  metodo_georef: string | null
  descrizione: string | null
}

const params = new URLSearchParams({
  service: 'WFS',
  version: '2.0.0',
  request: 'GetFeature',
  typeNames: 'sitar:v_st_archaeo_part',
  outputFormat: 'application/json',
  srsName: 'EPSG:4326',
  bbox: `${BOX.join(',')},urn:ogc:def:crs:EPSG::4326`,
})
const res = await fetch(`${WFS}?${params}`, {
  headers: { 'User-Agent': 'roman-map pipeline (rome:sitar)' },
})
if (!res.ok) throw new Error(`SITAR: ${res.status} ${(await res.text()).slice(0, 400)}`)
const all = (
  (await res.json()) as {
    features: { properties: Props; geometry: { type: string; coordinates: unknown } }[]
  }
).features

const round = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(round) : Math.round((v as number) * 1e6) / 1e6
const fetched = new Date().toISOString().slice(0, 10)
const features = all
  .filter((f) => f.properties.categoria === 'INFRASTRUTTURE VIARIE')
  .filter(({ properties: p }) => p.anno_da !== null && p.anno_da <= WINDOW[1])
  // A range is a phase of use; a single year is when it was built (the Appia's
  // paving by the Porta Capena, 312 BCE), and a built street stood on.
  .filter(
    ({ properties: p }) =>
      p.anno_a === null || p.anno_a >= WINDOW[0] || p.anno_a === p.anno_da,
  )
  .sort((a, b) => a.properties.codice_pa - b.properties.codice_pa)
  .map(({ properties: p, geometry }) => ({
    type: 'Feature',
    id: p.codice_pa,
    properties: {
      investigation: p.codice_oi,
      what: p.definizione_specifica1,
      name: p.def_interpretativa,
      from: p.anno_da,
      to: p.anno_a,
      placed: p.metodo_georef,
      note: p.descrizione?.replace(/\s+/g, ' ').trim() ?? null,
      fetched,
    },
    geometry: { type: geometry.type, coordinates: round(geometry.coordinates) },
  }))

const out = join(DATA_DIR, 'geometry/rome-sitar.geojson')
writeFileSync(
  out,
  JSON.stringify({ type: 'FeatureCollection', features }, null, 1).replace(
    /\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g,
    '[$1, $2]',
  ) + '\n',
)
console.log(`${features.length} pieces of street → ${out}`)

// --- the ancient ground ----------------------------------------------------------------

/** A level is kept if its piece's phase began in these years (astronomical)… */
const LEVEL_FROM = [-399, 14]
/** …and ended by this one. */
const LEVEL_TO = 150

interface Level {
  codice_pa: number
  quota: number | null
  categoria: string | null
  definizione: string | null
  nome_pt: string | null
}
const levelRes = await fetch(
  `${WFS}?${new URLSearchParams({ ...Object.fromEntries(params), typeNames: 'sitar:v_st_archaeo_part_altimetry' })}`,
  { headers: { 'User-Agent': 'roman-map pipeline (rome:sitar)' } },
)
if (!levelRes.ok) throw new Error(`SITAR levels: ${levelRes.status}`)
const levels = (
  (await levelRes.json()) as {
    features: { properties: Level; geometry: { coordinates: [number, number] } }[]
  }
).features
const pieceOf = new Map(all.map((f) => [f.properties.codice_pa, f.properties]))
/** A point on a surface walked on: a floor, a pavement, a street, a walking level; not a wall's top or a foundation. */
const walkedOn = (l: Level, p: Props) =>
  l.categoria === 'rivestimenti pavimentali' ||
  l.definizione === 'piano di calpestio/di frequentazione' ||
  (p.categoria === 'INFRASTRUTTURE VIARIE' &&
    !/cresta|fondazione|rasatura|fondo/i.test(l.nome_pt ?? ''))
const cited = new Set(CORRECTIONS.flatMap((c) => c.pieces))
const kept = levels
  .map((f) => ({ f, p: pieceOf.get(f.properties.codice_pa) }))
  .filter(({ f, p }) => p && f.properties.quota !== null && walkedOn(f.properties, p))
  // Those the corrections of the ground cite (ground.ts), and the rest of that period.
  .filter(
    ({ p }) =>
      cited.has(p!.codice_pa) ||
      (p!.anno_da !== null &&
        p!.anno_da >= LEVEL_FROM[0] &&
        p!.anno_da <= LEVEL_FROM[1] &&
        p!.anno_a !== null &&
        p!.anno_a <= LEVEL_TO),
  )
  .sort((a, b) => a.p!.codice_pa - b.p!.codice_pa)
  .map(({ f, p }) => ({
    type: 'Feature',
    properties: {
      piece: p!.codice_pa,
      level: f.properties.quota,
      what:
        f.properties.categoria === 'rivestimenti pavimentali'
          ? 'floor or paving'
          : p!.categoria === 'INFRASTRUTTURE VIARIE'
            ? 'street'
            : 'walking level',
      from: p!.anno_da,
      to: p!.anno_a,
      fetched,
    },
    geometry: { type: 'Point', coordinates: round(f.geometry.coordinates) },
  }))
const levelsOut = join(DATA_DIR, 'geometry/rome-levels.geojson')
writeFileSync(
  levelsOut,
  JSON.stringify({ type: 'FeatureCollection', features: kept }, null, 1).replace(
    /\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g,
    '[$1, $2]',
  ) + '\n',
)
console.log(`${kept.length} ancient ground levels → ${levelsOut}`)

// --- the Servian Wall ------------------------------------------------------------------

/**
 * SITAR's reconstruction of the whole course of the 4th-century wall (codice PA 19694,
 * made for the 2017 "Roma medio repubblicana" conference from the surveyed remains,
 * archive plans and historic maps, studies of the terrain and earlier reconstructions),
 * and what it records of the wall itself: the stretches, the earth rampart and ditch,
 * and the gates. The course is drawn as a band about 4 m wide; servian.ts takes its
 * middle line. Pieces not named as the wall's are kept only where they lie on it.
 */
const COURSE = 19694
/** An unnamed piece of wall, rampart, ditch or gate of the Republic is the wall's within this of its course, metres. */
const ON_COURSE_M = 40
const WALL_KINDS = new Set(['cinta muraria', 'aggere', 'fossato difensivo', 'porta urbica'])
const SERVIAN_GATE =
  /^Porta (Carmentalis|Fontinalis|Sanqualis|Salutaris|Quirinalis|Collina|Viminalis|Esquilina|Caelimontana|Capena|Naevia|Raudusculana|Trigemina)$|^Arco di Dolabella/
interface WallProps extends Props {
  tipo_pa: string | null
  georef: string | null
}
const wallRes = await fetch(
  `${WFS}?${new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'sitar:v_st_archaeo_part',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: "categoria='INFRASTRUTTURE DI FORTIFICAZIONE/MILITARI'",
  })}`,
  { headers: { 'User-Agent': 'roman-map pipeline (rome:sitar)' } },
)
if (!wallRes.ok) throw new Error(`SITAR wall: ${wallRes.status}`)
const forts = (
  (await wallRes.json()) as {
    features: { properties: WallProps; geometry: { type: string; coordinates: unknown } }[]
  }
).features
const course = forts.find((f) => Number(f.properties.codice_pa) === COURSE)
if (!course) throw new Error(`SITAR: no course of the wall (${COURSE})`)
const plane = (lonLat: number[]) => projection.forward(lonLat[0], lonLat[1])
const flat = (coords: unknown): number[][] =>
  typeof (coords as unknown[])[0] === 'number'
    ? [coords as number[]]
    : (coords as unknown[]).flatMap(flat)
const courseSegs = (course.geometry.coordinates as number[][][][]).flatMap((poly) =>
  poly[0].slice(1).map((q, i) => [plane(poly[0][i]), plane(q)]),
)
const toCourse = (p: number[]) => {
  let d = Infinity
  for (const [a, b] of courseSegs) {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    )
    d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]))
  }
  return d
}
const wallFeatures = forts
  .filter(({ properties: p }) => WALL_KINDS.has(p.definizione_specifica1 ?? ''))
  .filter(({ properties: p }) => p.anno_da === null || Number(p.anno_da) <= WINDOW[1])
  .filter(
    ({ properties: p, geometry }) =>
      p.def_interpretativa === 'Murus Servii Tullii' ||
      SERVIAN_GATE.test(p.def_interpretativa ?? '') ||
      // An unnamed one dated within the Republic, lying on the course.
      (!p.def_interpretativa &&
        p.anno_a !== null &&
        Number(p.anno_a) < 0 &&
        Math.min(...flat(geometry.coordinates).map((q) => toCourse(plane(q)))) <
          ON_COURSE_M),
  )
  .sort((a, b) => Number(a.properties.codice_pa) - Number(b.properties.codice_pa))
  .map(({ properties: p, geometry }) => ({
    type: 'Feature',
    id: Number(p.codice_pa),
    properties: {
      investigation: Number(p.codice_oi),
      what: p.definizione_specifica1,
      name: p.def_interpretativa,
      // A survey of remains, or a reconstruction (the course, a gate's site).
      record: p.tipo_pa,
      from: p.anno_da === null ? null : Number(p.anno_da),
      to: p.anno_a === null ? null : Number(p.anno_a),
      // How well it is placed: certo (surveyed), approssimato, ricostruito.
      placed: p.georef,
      note: p.descrizione?.replace(/\s+/g, ' ').trim() ?? null,
      fetched,
    },
    geometry: { type: geometry.type, coordinates: round(geometry.coordinates) },
  }))
const wallOut = join(DATA_DIR, 'geometry/rome-servian.geojson')
writeFileSync(
  wallOut,
  JSON.stringify({ type: 'FeatureCollection', features: wallFeatures }, null, 1).replace(
    /\[\n\s+(-?[\d.]+),\n\s+(-?[\d.]+)\n\s+\]/g,
    '[$1, $2]',
  ) + '\n',
)
console.log(`${wallFeatures.length} pieces of the Servian Wall and its course → ${wallOut}`)
