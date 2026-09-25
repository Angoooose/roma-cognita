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
 * The recorded streets whose course is drawn from the evidence (courses.ts) pass
 * along these pieces, citing them by number; the generated streets (city.ts) keep
 * to the rest. The data is CC BY-SA 4.0 (data/sources.yaml, `sitar`). Run it again
 * to pick up new excavations, and look at the diff.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../load.ts'

const WFS = 'https://repositar.archeositarproject.it/geoserver/wfs'
/** The walled city and a margin round it, lat/lon. */
const BOX = [41.874, 12.462, 41.914, 12.515]
/** The window: a piece is kept if it may have stood in these years. */
const WINDOW = [-68, -27]

interface Props {
  codice_pa: number
  codice_oi: number
  categoria: string
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
