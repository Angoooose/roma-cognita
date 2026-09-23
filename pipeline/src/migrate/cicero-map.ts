/**
 * One-off migration of the bulk parts of cicero-map into data/: the atom
 * geometry and the 222 curated places. The small, judgement-heavy files
 * (polities, claims, relations, seats, atoms metadata) were migrated by hand,
 * row by row, and are not regenerated here.
 *
 * Kept in the repo as the record of what the migration did, not as a build
 * step. Once run, data/ is the source of truth: re-running it overwrites
 * data/places.yaml and data/geometry/atoms.geojson, including any hand edits.
 *
 *   npx tsx pipeline/src/migrate/cicero-map.ts [path/to/cicero-map]
 *   npx prettier --write data/places.yaml
 *
 * Geometry. cicero-map/public/geo/polities.json is already processed — seeded,
 * cut, clipped to Natural Earth land, de-overlapped, simplified — and in lon/lat
 * (checked: every position is inside ±180/±90, and inside the frame). It was
 * wound for d3-geo (clockwise exteriors). It is rewound to RFC 7946 here, which
 * is the convention everything under data/geometry holds (see ../geo.ts).
 *
 * Places. cicero-map/data/places.json holds the curation (name, tier, status,
 * label side, the gazetteer's alternative spellings) and a rough `near`;
 * cicero-map/public/geo/places.json holds what its build resolved against
 * Pleiades: the Pleiades id and coordinate. Both are joined here, by array
 * position (the build emitted them in order, which is checked by name).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Document, isMap, isSeq, visit, type Node } from 'yaml'
import type { AreaGeometry, LonLat } from '@roman-map/schema'
import { formatYear } from '@roman-map/schema'
import { distanceKm, rewindRFC7946, ringProblems } from '../geo.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
const OLD = resolve(process.argv[2] ?? resolve(ROOT, '../cicero-map'))
const DATA = resolve(ROOT, 'data')

const readJson = (p: string) => JSON.parse(readFileSync(resolve(OLD, p), 'utf8'))

/** cicero-map writes −43 for 43 BCE: historical numbering, whatever its comments say. */
const oldYear = (y: number) => {
  if (!Number.isInteger(y) || y >= 0) throw new Error(`unexpected cicero-map year ${y}`)
  return formatYear(1 + y)
}

// --- geometry ----------------------------------------------------------------

function migrateGeometry() {
  const src = readJson('public/geo/polities.json')
  const features = src.features.map(
    (f: { properties: { atom: string }; geometry: AreaGeometry }) => {
      const geometry = rewindRFC7946(f.geometry)
      const problems = ringProblems(geometry)
      if (problems.length) {
        throw new Error(
          `${f.properties.atom}: ${problems.map((p) => p.problem).join('; ')}`,
        )
      }
      return { type: 'Feature', id: f.properties.atom, properties: {}, geometry }
    },
  )
  mkdirSync(resolve(DATA, 'geometry'), { recursive: true })
  // One feature per line: diffs then show which atom changed.
  const body = features.map((f: unknown) => JSON.stringify(f)).join(',\n')
  writeFileSync(
    resolve(DATA, 'geometry/atoms.geojson'),
    `{"type":"FeatureCollection","features":[\n${body}\n]}\n`,
  )
  console.log(`atoms.geojson: ${features.length} atoms, rewound to RFC 7946`)
}

// --- places ------------------------------------------------------------------

interface OldPlace {
  name: string
  near: LonLat
  tier: number
  status?: string
  side?: string
  also?: string[]
  from?: number
  note?: string
  source?: string
  confidence?: string
}

/** Two places share a name; the slug gets a region so both ids are stable and readable. */
const DISAMBIGUATE: Record<string, (p: OldPlace) => string> = {
  Ptolemais: (p) => (p.near[0] < 30 ? 'ptolemais-cyrenaica' : 'ptolemais-phoenicia'),
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** The classical citations on the three rows that override Pleiades' dates. */
const CITATIONS: Record<string, { source: string; locator: string }[]> = {
  Carthago: [
    { source: 'appian', locator: 'Pun. 136' },
    { source: 'plutarch', locator: 'C. Gracch. 11' },
    { source: 'cassius-dio', locator: '43.50' },
  ],
  Corinthus: [
    { source: 'pausanias', locator: '2.1.2' },
    { source: 'strabo', locator: '8.6.23' },
    { source: 'cassius-dio', locator: '43.50' },
  ],
  Lugdunum: [
    { source: 'cassius-dio', locator: '46.50' },
    { source: 'cicero-fam', locator: '10.11' },
  ],
}

/**
 * Rows the migration review found doubtful. Their data is migrated as it was;
 * they are flagged for a human, with the reason, rather than silently changed.
 */
const DOUBTS: Record<string, string> = {
  Nicomedia:
    'Migration review: tagged "royal seat", but the Bithynian kingdom ended with the bequest of 74 and Bithynia was a province throughout the window. Probably wants "provincial seat" or nothing.',
  Cirta:
    'Migration review: tagged "royal seat" across the window, but after Thapsus (46) Cirta was given to P. Sittius and his men; the status wants to end in 47.',
  Bibracte:
    'Migration review: tagged "royal seat", but the Aedui were governed by an annual vergobret, not a king (Caesar, BG 1.16). Probably wants no status.',
  Ancyra:
    'Migration review: tagged "royal seat" for Deiotarus; see the doubt on the Galatian seat in seats.yaml.',
  Emesa:
    'Migration review: tagged "royal seat"; see the doubt on the Emesene seat in seats.yaml (Arethusa).',
}

/** Places a seat points at that cicero-map never lettered. Coordinates are cicero-map's seat positions. */
const SEAT_ONLY = [
  {
    name: 'Hierapolis-Castabala',
    at: [36.2667, 37.2167] as LonLat,
    confidence: 'probable',
    note: "Seat of Tarcondimotus (seats.yaml). Not joined to Pleiades by cicero-map; its position is cicero-map's own.",
  },
  {
    name: 'Chalcis sub Libano',
    at: [36.11, 34.0] as LonLat,
    confidence: 'uncertain',
    note: "The Ituraean seat (seats.yaml). The site is not securely identified, and it is not joined to Pleiades; the position is cicero-map's guess and the weakest in the dataset.",
  },
]

/** A move larger than this between cicero-map's rough position and Pleiades' is worth a second look. */
const MOVE_KM = 28 // about a quarter of a degree, cicero-map's own reporting threshold

function migratePlaces() {
  const curated: OldPlace[] = readJson('data/places.json').places
  const built = readJson('public/geo/places.json').features as {
    properties: { name: string; pid: string }
    geometry: { coordinates: LonLat }
  }[]
  if (curated.length !== built.length)
    throw new Error('places: curated and built rows differ')

  const ids = new Set<string>()
  const rows: Record<string, unknown>[] = []
  const moved: string[] = []

  curated.forEach((p, i) => {
    const b = built[i]
    if (b.properties.name !== p.name)
      throw new Error(`places: row ${i} is ${p.name} / ${b.properties.name}`)
    const id = DISAMBIGUATE[p.name]?.(p) ?? slug(p.name)
    if (ids.has(id)) throw new Error(`places: duplicate id ${id}`)
    ids.add(id)

    const location = b.geometry.coordinates
    const km = distanceKm(p.near, location)
    const notes: string[] = []
    if (p.note) notes.push(p.note)
    let review = 'draft'
    let confidence = p.confidence ?? 'certain'
    if (km > MOVE_KM) {
      moved.push(`${p.name} (${km.toFixed(0)} km)`)
      notes.push(
        `Migration: Pleiades puts this ${km.toFixed(0)} km from cicero-map's curated position [${p.near}]; check it is the same place.`,
      )
      review = 'needs-check'
      confidence = 'probable'
    }
    if (DOUBTS[p.name]) {
      notes.push(DOUBTS[p.name])
      review = 'needs-check'
    }

    rows.push({
      id,
      pleiades: b.properties.pid,
      kind: 'settlement',
      location,
      names: [
        { text: p.name, preferred: true },
        ...(p.also ?? []).map((text) => ({ text })),
      ],
      from: p.from !== undefined ? oldYear(p.from) : 'before 68 BCE',
      to: 'after 43 BCE',
      prominence: p.tier,
      ...(p.status ? { status: p.status } : {}),
      ...(p.side ? { labelSide: p.side } : {}),
      sources: [
        ...(CITATIONS[p.name] ?? []),
        { source: 'pleiades', locator: `places/${b.properties.pid}` },
      ],
      confidence,
      review,
      ...(notes.length ? { note: notes.join('\n\n') } : {}),
    })
  })

  for (const s of SEAT_ONLY) {
    rows.push({
      id: slug(s.name),
      kind: 'settlement',
      location: s.at,
      names: [{ text: s.name, preferred: true }],
      from: 'before 68 BCE',
      to: 'after 43 BCE',
      sources: [
        { source: 'sullivan-1990' },
      ],
      confidence: s.confidence,
      review: 'needs-check',
      note: s.note,
    })
  }

  const doc = new Document(rows)
  // Short maps and lists of scalars read better on one line; notes stay folded.
  visit(doc, {
    Map(_, node) {
      const n = node as Node & { items: { value: unknown }[]; flow?: boolean }
      if (
        n.items.length <= 3 &&
        n.items.every((it) => !isMap(it.value) && !isSeq(it.value))
      ) {
        n.flow = true
      }
    },
    Seq(_, node) {
      if (node.items.every((it) => typeof (it as { value?: unknown }).value === 'number')) {
        node.flow = true
      }
    },
  })
  const header = `# Settlements, and how loudly each is lettered.
#
# Pleiades knows what existed and what it was called; it has no idea what
# mattered, so this file decides. \`prominence\` is cicero-map's tier: 1 the
# overview, 2 from 1.5x, 3 from 3x, 4 from 5x — tier 4 is largely Cicero's own
# Italy. The ranking is Roman civic status and administrative weight, not size:
# a conventus seat belongs on a political map at a size its population would
# not earn, and status is datable in a way population is not.
#
# Generated once by pipeline/src/migrate/cicero-map.ts from cicero-map's curated
# data/places.json and the Pleiades join its build resolved: \`location\` and
# \`pleiades\` are Pleiades', the rest is cicero-map's curation. Edit by hand
# from here on. Name language was not recorded by cicero-map and is left
# untagged; the non-preferred names are the spellings the gazetteer files the
# place under.
#
# Dates: every place stood throughout cicero-map's 68–43 BCE window (its build
# filtered Pleiades by attested date), hence the open ends — except where a row
# overrides Pleiades, because period dating is not event dating: Pleiades has
# Carthage continuously from 750 BCE although it lay in ruins from 146 until
# Caesar refounded it.
#
# confidence: certain where the Pleiades join landed within ${MOVE_KM} km of the
# curated position; a longer move is marked probable and needs-check.

`
  const yaml = doc
    .toString({ lineWidth: 92, singleQuote: true, flowCollectionPadding: false })
    .replace(/\n- id: /g, '\n\n- id: ')
  writeFileSync(resolve(DATA, 'places.yaml'), header + yaml)
  console.log(`places.yaml: ${rows.length} places (${SEAT_ONLY.length} added for seats)`)
  console.log(
    `  moved more than ${MOVE_KM} km by the Pleiades join: ${moved.join(', ') || 'none'}`,
  )

  // The seats file claims the old seat coordinates agree with Pleiades; show it.
  const seats: { place: string; lon: number; lat: number }[] =
    readJson('data/seats.json').seats
  for (const s of seats) {
    const row = rows.find((r) => (r.names as { text: string }[])[0].text === s.place)
    if (!row) continue
    const km = distanceKm([s.lon, s.lat], row.location as LonLat)
    console.log(
      `  seat ${s.place}: cicero-map position is ${km.toFixed(1)} km from Pleiades`,
    )
  }
}

migrateGeometry()
migratePlaces()
