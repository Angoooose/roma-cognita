/**
 * Bakes the index of sources the sources page reads (apps/explorer/src/sources):
 *
 * - `build/sources/index.json`: every work in sources.yaml with what cites it (how
 *   many records, of what type, how firmly, which of them on it alone), the places in
 *   it cited with their quotes and links, the years of the window its history records
 *   are in force, and the ground they hold; which works are cited together; and the
 *   atoms' outlines, small, for the plate of the ground. The shape is
 *   `SourcesIndex` in packages/schema.
 *
 *   npm run sources -w pipeline
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AreaGeometry,
  Builds,
  Confidence,
  SourceEntry,
  SourceKind,
  SourcesIndex,
} from '@roma-cognita/schema'
import { loadDataset } from '../load.ts'
import { passageUrl, workUrl } from '../passages/passage.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT_DIR, 'build/sources')

/** The window, astronomical: 133 BCE to 27 BCE. */
const FIRST = -132
const LAST = -26
/** History records: the ones with a holder, a standing and a date. */
const HISTORY = new Set(['claim', 'polity', 'relation'])

/**
 * What a work's `usedBy` builds, by the folder of the code that reads it: the people,
 * the model of Rome, the roads. Other code that cites a work builds nothing the page
 * names apart.
 */
function builds(usedBy: string | undefined): Builds[] {
  const out = new Set<Builds>()
  for (const path of usedBy?.split(/,\s*/) ?? []) {
    if (path.includes('/people/')) out.add('people')
    else if (path.includes('/rome/')) out.add('rome')
    else if (path.includes('/roads/')) out.add('roads')
  }
  return [...out]
}

interface Ref {
  source: string
  locator?: string
  quote?: string
}

/** A record as the index counts it: what it is, what it is about, what it cites. */
interface Cited {
  type: string
  /** What the record is about, by name: the state, the place, the ground. */
  name: string
  refs: Ref[]
  confidence?: Confidence
  from?: number
  to?: number
  atom?: string
}

const data = loadDataset()
const known = new Set(data.sources.map((s) => s.id))

/** Every citation anywhere in a record, its dated names and values included. */
function refsOf(o: unknown, out: Ref[] = []): Ref[] {
  if (!o || typeof o !== 'object') return out
  if (Array.isArray(o)) {
    for (const x of o) refsOf(x, out)
    return out
  }
  const r = o as Record<string, unknown>
  if (typeof r.source === 'string' && known.has(r.source)) out.push(r as unknown as Ref)
  for (const v of Object.values(r)) refsOf(v, out)
  return out
}

const preferred = (
  names: { text: string; preferred?: boolean }[] | undefined,
  id: string,
) => names?.find((n) => n.preferred)?.text ?? names?.[0]?.text ?? id
const polityName = new Map(data.polities.map((p) => [p.id, preferred(p.names, p.id)]))
const named = (id: string) => polityName.get(id) ?? id
/**
 * A piece of ground by name. Atoms have none of their own: one that a state of the
 * same id holds takes its name, and the rest are read from the id ("lusitania-north"
 * → "Lusitania North").
 */
const grounded = (id: string) =>
  polityName.get(id) ??
  id.replace(
    /(^|-)(\w)/g,
    (_, dash: string, c: string) => (dash ? ' ' : '') + c.toUpperCase(),
  )
const year = (e: { year: number | null; latest: number | null; earliest: number | null }) =>
  e.year ?? e.latest ?? e.earliest ?? undefined

const records: Cited[] = [
  ...data.claims.map((c) => ({
    type: 'claim',
    name: named(c.polity),
    refs: refsOf(c),
    confidence: c.confidence,
    from: year(c.from),
    to: year(c.to),
    atom: c.atom,
  })),
  ...data.polities.map((p) => ({
    type: 'polity',
    name: named(p.id),
    refs: refsOf(p),
    confidence: p.confidence,
    from: year(p.from),
    to: year(p.to),
  })),
  ...data.relations.map((r) => ({
    type: 'relation',
    name: named(r.polity),
    refs: refsOf(r),
    confidence: r.confidence,
    from: year(r.from),
    to: year(r.to),
  })),
  ...data.atoms.map((a) => ({
    type: 'outline',
    name: grounded(a.id),
    refs: refsOf(a),
    atom: a.id,
  })),
  ...data.places.map((p) => ({
    type: 'place',
    name: preferred(p.names, p.id),
    refs: refsOf(p),
    from: year(p.from),
    to: year(p.to),
  })),
  ...data.features.map((f) => ({
    type: 'feature',
    name: preferred(f.names, f.id),
    refs: refsOf(f),
    from: year(f.from),
    to: year(f.to),
  })),
  ...data.landscapeChanges.map((l) => ({
    type: 'landscape',
    name: grounded(l.id),
    refs: refsOf(l),
    from: year(l.from),
    to: year(l.to),
  })),
]

// --- each work ----------------------------------------------------------------------

const entries = new Map<
  string,
  SourceEntry & { located: Map<string, SourceEntry['passageList'][number]> }
>()
for (const s of data.sources) {
  entries.set(s.id, {
    id: s.id,
    kind: s.kind as SourceKind,
    citation: s.citation,
    url: s.url ?? workUrl(s.id),
    author: s.kind === 'ancient' ? s.citation.split(', ')[0] : s.citation,
    records: 0,
    cites: 0,
    quoted: 0,
    passages: 0,
    builds: builds(s.usedBy),
    byType: {},
    sole: 0,
    coverage: new Array(LAST - FIRST + 1).fill(0),
    atoms: [],
    conf: { certain: 0, probable: 0, uncertain: 0 },
    passageList: [],
    located: new Map(),
  })
}

for (const r of records) {
  const ids = [...new Set(r.refs.map((x) => x.source))]
  for (const x of r.refs) {
    const e = entries.get(x.source)!
    e.cites++
    if (x.quote) e.quoted++
    if (!x.locator) continue
    const p = e.located.get(x.locator) ?? {
      locator: x.locator,
      passage: passageUrl(x.source, x.locator),
      records: [],
    }
    if (x.quote && !p.quote) p.quote = x.quote
    if (!p.records.some((x) => x.name === r.name && x.type === r.type))
      p.records.push({ name: r.name, type: r.type })
    e.located.set(x.locator, p)
  }
  const history = HISTORY.has(r.type)
  for (const id of ids) {
    const e = entries.get(id)!
    e.records++
    e.byType[r.type] = (e.byType[r.type] ?? 0) + 1
    if (r.atom && !e.atoms.includes(r.atom)) e.atoms.push(r.atom)
    // Every dated record counts toward the years: a town stands in them as a
    // province does.
    if (r.from !== undefined && r.to !== undefined)
      for (let y = Math.max(r.from, FIRST); y <= Math.min(r.to, LAST); y++)
        e.coverage[y - FIRST]++
    if (!history) continue
    if (ids.length === 1) e.sole++
    if (r.confidence) e.conf[r.confidence]++
  }
}

const sources: SourceEntry[] = [...entries.values()]
  .map(({ located, ...e }) => ({
    ...e,
    passages: located.size,
    passageList: [...located.values()],
  }))
  .sort((a, b) => b.records - a.records)

// --- works cited together ------------------------------------------------------------

const pairs = new Map<string, number>()
for (const r of records) {
  if (!HISTORY.has(r.type)) continue
  const ids = [...new Set(r.refs.map((x) => x.source))].sort()
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const k = `${ids[i]}|${ids[j]}`
      pairs.set(k, (pairs.get(k) ?? 0) + 1)
    }
}
const links = [...pairs]
  .filter(([, n]) => n >= 3)
  .map(([k, n]) => {
    const [a, b] = k.split('|')
    return { a, b, n }
  })
  .sort((x, y) => y.n - x.n)

// --- the atoms' outlines, small ------------------------------------------------------

// Equirectangular over 10° W–50° E, 22° N–52° N, its height squeezed for 37° N: the
// plate is a picture of which ground, not a map to measure on.
const W = 1000
const [LON0, LON1, LAT0, LAT1] = [-10, 50, 22, 52]
const H = Math.round(
  ((W * (LAT1 - LAT0)) / (LON1 - LON0) / Math.cos((37 * Math.PI) / 180)) * 0.85,
)
const px = (lon: number) => Math.round(((lon - LON0) / (LON1 - LON0)) * W)
const py = (lat: number) => Math.round(((LAT1 - lat) / (LAT1 - LAT0)) * H)

function ring(r: number[][]): string {
  let out = ''
  let last = ''
  for (const [lon, lat] of r) {
    const k = `${px(lon)},${py(lat)}`
    if (k === last) continue
    out += (out ? 'L' : 'M') + k
    last = k
  }
  // A ring that rounds to a point or a line is too small to draw.
  return out.split('L').length > 3 ? `${out}Z` : ''
}

const atoms: Record<string, string> = {}
for (const [id, g] of data.geometry.atoms as Map<string, AreaGeometry>) {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  atoms[id] = polygons.map((p) => ring(p[0])).join('')
}

// --- out -----------------------------------------------------------------------------

const byKind: Record<SourceKind, number> = { ancient: 0, modern: 0, dataset: 0 }
for (const s of sources) byKind[s.kind]++
const all = records.flatMap((r) => r.refs)
const index: SourcesIndex = {
  first: FIRST,
  last: LAST,
  totals: {
    sources: sources.length,
    byKind,
    records: records.length,
    citations: all.length,
    located: all.filter((x) => x.locator).length,
    quoted: all.filter((x) => x.quote).length,
  },
  sources,
  links,
  atoms,
}

mkdirSync(OUT, { recursive: true })
const json = JSON.stringify(index)
writeFileSync(join(OUT, 'index.json'), json)
console.log(
  `sources: ${sources.length} works, ${index.totals.citations} citations, ${links.length} pairs cited together → build/sources/index.json (${Math.round(json.length / 1024)} KB)`,
)
