/**
 * The cross-record rules of DESIGN §5.6, and the doubt report of §1.6.
 *
 * Errors are things the build must not ship: a claim on an atom that does not
 * exist, two owners of one atom in one year, an interval that ends before it
 * starts, a record with no source, an atom without a shape. Warnings are things
 * a human should look at but that may be true: an open end that runs into a
 * later record, a client claim with no client-of relation behind it.
 *
 * The doubt report is not a list of problems. It is what the data itself says
 * it is unsure of — review: needs-check, confidence: uncertain — plus what
 * this validator could not check at all, so nobody mistakes silence for a pass.
 */
import {
  FEATURE_GEOMETRY_KIND,
  claimLayer,
  formatYear,
  highest,
  lowest,
  mayOverlap,
  overlaps,
  type ClaimRelation,
  type Endpoint,
  type Interval,
  type Polity,
  type SourceRef,
} from '@roma-cognita/schema'
import { contains as geometryContains, overlapArea, ringProblems } from './geo.ts'
import type { Dataset, Issue } from './load.ts'
import { namesSeveral, passageUrl } from './passages/passage.ts'
import { WORKS } from './passages/works.ts'
import { checkQuote } from './quotes.ts'

type Dated = { from: Endpoint; to: Endpoint }
type Sourced = { sources: SourceRef[] }
type Reviewed = { review: string; confidence: string; note?: string }

const span = (r: Dated) => `${r.from.text} – ${r.to.text}`

/** The kinds of polity each claim relation expects; anything else is worth a look. */
const RELATION_KINDS: Record<ClaimRelation, Polity['kind'][] | null> = {
  province: ['province'],
  'citizen-territory': ['citizen-territory'],
  client: ['kingdom', 'city-state', 'people', 'league'],
  allied: null,
  independent: null,
  occupied: null,
}

/** The polity relation a claim of this kind should have behind it. */
const RELATION_BEHIND: Partial<Record<ClaimRelation, string>> = {
  province: 'province-of',
  'citizen-territory': 'citizen-territory-of',
  client: 'client-of',
}

/** Rounding atom coordinates to 4 decimals leaves hairline overlaps; anything bigger is real. */
const MAX_OVERLAP_KM2 = 0.5

export function checkDataset(ds: Dataset): Issue[] {
  const issues: Issue[] = []
  const where = (r: object) => ds.origin.get(r) ?? '(unknown)'
  const error = (rule: string, r: object | string, message: string) =>
    issues.push({
      level: 'error',
      rule,
      where: typeof r === 'string' ? r : where(r),
      message,
    })
  const warn = (rule: string, r: object | string, message: string) =>
    issues.push({
      level: 'warning',
      rule,
      where: typeof r === 'string' ? r : where(r),
      message,
    })

  // --- identity --------------------------------------------------------------

  const index = <T extends { id: string }>(kind: string, rows: T[]) => {
    const m = new Map<string, T>()
    for (const r of rows) {
      if (m.has(r.id)) error('duplicate-id', r, `${kind} id "${r.id}" is used twice`)
      else m.set(r.id, r)
    }
    return m
  }
  const sources = index('source', ds.sources)
  const atoms = index('atom', ds.atoms)
  const polities = index('polity', ds.polities)
  const places = index('place', ds.places)
  index('route', ds.routes)
  index('road-correction', ds.roadCorrections)
  index('landscape-change', ds.landscapeChanges)
  index('feature', ds.features)

  // --- sources ---------------------------------------------------------------

  const cited = new Set<string>()
  const sourced: (object & Sourced)[] = [
    ...ds.atoms,
    ...ds.polities,
    ...ds.claims,
    ...ds.relations,
    ...ds.seats,
    ...ds.places,
    ...ds.routes,
    ...ds.roadCorrections,
    ...ds.landscapeChanges,
    ...ds.features,
    ...ds.names,
  ]
  const names = new Set<object>(ds.names)
  const quoted = new Set<SourceRef>()
  for (const r of sourced) {
    // The schema requires at least one source; this catches records built in
    // code (fixtures, migrations) that bypassed it.
    if (!r.sources.length)
      error('no-source', r, 'a historical record needs at least one source')
    for (const s of r.sources) {
      cited.add(s.source)
      // A name's citations are usually its record's, inherited: checked there.
      for (const f of names.has(r) ? [] : (s.supports ?? []))
        if (!hasField(r, f))
          error(
            'supports-field',
            r,
            `${s.source} supports "${f}", which the record doesn't have`,
          )
      if (s.quote && !quoted.has(s)) {
        quoted.add(s)
        if (s.locator && WORKS[s.source] && namesSeveral(s.locator))
          error(
            'one-passage',
            r,
            `${s.source} ${s.locator}: a quoted citation names one passage; cite the source once for each`,
          )
        else if (!s.locator && WORKS[s.source] && !s.url)
          error(
            'quote-locator',
            r,
            `${s.source}: a quote needs the locator of the passage it is from`,
          )
        else {
          const q = checkQuote(s, sources.get(s.source))
          if (q.status === 'not-found')
            error(
              'quote-not-found',
              r,
              `${s.source} ${s.locator ?? ''}: the quote isn't in ${q.in}`,
            )
        }
      }
      if (!sources.has(s.source))
        error('missing-source', r, `cites unknown source "${s.source}"`)
      // A text we can link into, cited somewhere its page has no place for: a typo,
      // a numbering the page doesn't use, or an anchor list that needs a re-fetch.
      // One with its own url links there instead (the inspector prefers it).
      else if (s.locator && !s.url && WORKS[s.source] && !passageUrl(s.source, s.locator))
        warn(
          'unlinked-passage',
          r,
          `${s.source} ${s.locator}: no passage to link to (src/passages)`,
        )
    }
  }
  for (const s of ds.sources) {
    if (!cited.has(s.id) && !s.usedBy)
      warn('unused-source', s, `source "${s.id}" is never cited`)
  }

  // --- intervals -------------------------------------------------------------

  const dated: (object & Dated)[] = [
    ...ds.polities,
    ...ds.claims,
    ...ds.relations,
    ...ds.seats,
    ...ds.places,
    ...ds.routes,
    ...ds.roadCorrections,
    ...ds.landscapeChanges,
    ...ds.features,
    ...ds.names,
  ]
  const intervalOk = (r: object, i: Dated, what = '') => {
    if (i.to.year < i.from.year || highest(i.to) < lowest(i.from)) {
      error(
        'end-before-start',
        r,
        `${what}ends (${i.to.text}) before it starts (${i.from.text})`,
      )
      return false
    }
    return true
  }
  const sane = new Set<object>()
  for (const r of dated) if (intervalOk(r, r)) sane.add(r)
  for (const p of ds.places) {
    for (const c of p.condition)
      if (c.kept && c.value !== 'under construction')
        error(
          'kept-not-works',
          p,
          `"kept" is only for works rebuilding it, not "${c.value}"`,
        )
    for (const d of [...p.prominence, ...p.status, ...p.condition]) {
      intervalOk(p, d, `${String(d.value)}: `)
      if (d.from.year < p.from.year || d.to.year > p.to.year) {
        warn(
          'outside-parent',
          p,
          `"${String(d.value)}" (${span(d)}) runs outside the place (${span(p)})`,
        )
      }
    }
  }

  /** Warns when a dependent record renders outside the polity's own lifetime. */
  const withinPolity = (r: object & Dated, id: string, what: string) => {
    const p = polities.get(id)
    if (!p || !sane.has(r) || !sane.has(p)) return
    if (r.from.year < p.from.year || r.to.year > p.to.year) {
      warn(
        'outside-polity',
        r,
        `${what} (${span(r)}) runs outside polity "${id}" (${span(p)})`,
      )
    }
  }

  // --- claims ----------------------------------------------------------------

  for (const c of ds.claims) {
    if (!atoms.has(c.atom)) error('missing-atom', c, `claim on unknown atom "${c.atom}"`)
    const p = polities.get(c.polity)
    if (!p) {
      error('missing-polity', c, `claim by unknown polity "${c.polity}"`)
      continue
    }
    withinPolity(c, c.polity, 'claim')
    const kinds = RELATION_KINDS[c.relation]
    if (kinds && !kinds.includes(p.kind)) {
      warn('relation-kind', c, `a ${c.relation} claim by a ${p.kind} ("${p.id}")`)
    }
    const behind = RELATION_BEHIND[c.relation]
    if (behind && sane.has(c)) {
      const covering = ds.relations.filter(
        (r) => r.polity === c.polity && r.type === behind && sane.has(r),
      )
      const covered = covering.some(
        (r) => r.from.year <= c.from.year && c.to.year <= r.to.year,
      )
      if (!covered) {
        warn(
          'relation-missing',
          c,
          `a ${c.relation} claim (${span(c)}) with no ${behind} relation for "${c.polity}" covering it`,
        )
      }
    }
  }

  const overlapping = <T extends object & Dated>(
    rows: T[],
    key: (r: T) => string,
    describe: (k: string) => string,
    level: 'error' | 'warning',
    rule: string,
  ) => {
    const groups = new Map<string, T[]>()
    for (const r of rows) {
      if (!sane.has(r)) continue
      const k = key(r)
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    for (const [k, group] of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i], group[j]]
          if (overlaps(a as Interval, b as Interval)) {
            issues.push({
              level,
              rule,
              where: where(b),
              message: `${describe(k)}: ${span(b)} overlaps ${where(a)} (${span(a)})`,
            })
          } else if (mayOverlap(a as Interval, b as Interval)) {
            warn(
              'may-overlap',
              b,
              `${describe(k)}: ${span(b)} could overlap ${where(a)} (${span(a)}) under its fuzzy or open ends — close the open end`,
            )
          }
        }
      }
    }
  }

  overlapping(
    ds.claims,
    (c) => `${c.atom}\u0000${claimLayer(c.relation)}`,
    (k) => {
      const [atom, layer] = k.split('\u0000')
      return `two ${layer} claims on atom "${atom}"`
    },
    'error',
    'claim-overlap',
  )

  // --- relations and seats ---------------------------------------------------

  for (const r of ds.relations) {
    if (!polities.has(r.polity)) error('missing-polity', r, `unknown polity "${r.polity}"`)
    if (!polities.has(r.of)) error('missing-polity', r, `unknown polity "${r.of}"`)
    if (r.polity === r.of) error('self-relation', r, `"${r.polity}" is ${r.type} itself`)
    withinPolity(r, r.polity, 'relation')
  }
  // A polity stands to another in one way at a time: not province and client at once.
  overlapping(
    ds.relations,
    (r) => `${r.polity}\u0000${r.of}`,
    (k) => `two relations of "${k.split('\u0000')[0]}" to "${k.split('\u0000')[1]}"`,
    'error',
    'relation-overlap',
  )

  for (const s of ds.seats) {
    if (!polities.has(s.polity))
      error('missing-polity', s, `seat of unknown polity "${s.polity}"`)
    if (!places.has(s.place))
      error('missing-place', s, `seat at unknown place "${s.place}"`)
    withinPolity(s, s.polity, 'seat')
    const p = places.get(s.place)
    if (
      p &&
      sane.has(s) &&
      sane.has(p) &&
      (s.from.year < p.from.year || s.to.year > p.to.year)
    ) {
      warn(
        'outside-place',
        s,
        `seat (${span(s)}) runs outside place "${p.id}" (${span(p)})`,
      )
    }
  }
  // A monument stands in a settlement. The settlement's open ends are bounds, so only
  // years it cannot share with the monument under any reading are worth a word.
  for (const p of ds.places) {
    if (!p.within) continue
    const city = places.get(p.within)
    if (!city) error('missing-place', p, `stands within unknown place "${p.within}"`)
    else if (sane.has(p) && sane.has(city) && !mayOverlap(p, city))
      warn(
        'outside-place',
        p,
        `(${span(p)}) never shares a year with place "${city.id}" (${span(city)})`,
      )
  }

  // Two courts at once is possible (Mauretania had two kings) but worth a look.
  overlapping(
    ds.seats,
    (s) => s.polity,
    (k) => `two seats for "${k}"`,
    'warning',
    'seat-overlap',
  )

  // --- atoms and geometry ----------------------------------------------------

  for (const a of ds.atoms) {
    const g = ds.geometry.atoms.get(a.id)
    if (!g) {
      error(
        'missing-geometry',
        a,
        `atom "${a.id}" has no feature in geometry/atoms.geojson`,
      )
      continue
    }
    for (const p of ringProblems(g)) {
      error('geometry', a, `polygon ${p.polygon}, ring ${p.ring}: ${p.problem}`)
    }
    if (a.anchor && !geometryContains(g, a.anchor.at)) {
      warn('anchor-outside', a, `label anchor [${a.anchor.at}] is outside the atom`)
    }
    if (a.splitFrom) {
      if (ds.claims.some((c) => c.atom === a.splitFrom)) {
        error('split-parent-claimed', a, `split parent "${a.splitFrom}" still has claims`)
      }
    }
    if (!ds.claims.some((c) => c.atom === a.id)) {
      warn('unclaimed-atom', a, `atom "${a.id}" is never claimed by anyone`)
    }
  }
  // Atoms tile: no ground belongs to two. The build (npm run atoms) guarantees
  // it by cutting every earlier atom out of each outline; this catches a
  // hand-edited geometry file or a build that went wrong.
  const shaped = ds.atoms.filter((a) => ds.geometry.atoms.has(a.id))
  for (let i = 0; i < shaped.length; i++) {
    for (let j = i + 1; j < shaped.length; j++) {
      const [a, b] = [shaped[i], shaped[j]]
      const km2 = overlapArea(ds.geometry.atoms.get(a.id)!, ds.geometry.atoms.get(b.id)!)
      if (km2 > MAX_OVERLAP_KM2)
        error(
          'atom-overlap',
          b,
          `atom "${b.id}" overlaps "${a.id}" by ${km2.toFixed(1)} km²`,
        )
    }
  }
  for (const id of ds.geometry.atoms.keys()) {
    if (!atoms.has(id)) {
      error(
        'orphan-geometry',
        `geometry/atoms.geojson (${id})`,
        `a shape for no atom "${id}"`,
      )
    }
  }

  // --- physical features and their shapes ------------------------------------

  const features = new Map(ds.features.map((f) => [f.id, f]))
  for (const f of ds.features) {
    const shape = ds.geometry.features.get(f.id)
    const expected = (FEATURE_GEOMETRY_KIND as Record<string, 'area' | 'line' | undefined>)[
      f.kind
    ]
    if (!shape) {
      // Floodplains and rivers are drawn from their shapes; without one they are invisible.
      if (f.kind === 'floodplain' || f.kind === 'river')
        error(
          'missing-geometry',
          f,
          `${f.kind} "${f.id}" has no feature in geometry/features.geojson`,
        )
      continue
    }
    const g = shape.geometry
    const got = g.type === 'Polygon' || g.type === 'MultiPolygon' ? 'area' : 'line'
    if (!expected) {
      error(
        'geometry-kind',
        f,
        `a ${f.kind} takes no shape, but geometry/features.geojson has a ${g.type}`,
      )
      continue
    }
    if (got !== expected) {
      error(
        'geometry-kind',
        f,
        `a ${f.kind} is ${expected === 'area' ? 'a Polygon or MultiPolygon' : 'a LineString or MultiLineString'}, not a ${g.type}`,
      )
      continue
    }
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      for (const p of ringProblems(g))
        error('geometry', f, `polygon ${p.polygon}, ring ${p.ring}: ${p.problem}`)
    } else {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates
      const bad = lines
        .flat()
        .find(([x, y]) => !(x >= -180 && x <= 180 && y >= -90 && y <= 90))
      if (bad)
        error('geometry', f, `position [${bad}] is not lon/lat — projected coordinates?`)
    }
    if (shape.properties?.discharge !== undefined && f.kind !== 'river')
      warn('discharge', f, `discharge is only meaningful on a river line`)
  }
  for (const id of ds.geometry.features.keys()) {
    if (!features.has(id)) {
      error(
        'orphan-geometry',
        `geometry/features.geojson (${id})`,
        `a shape for no feature "${id}"`,
      )
    }
  }

  // --- landscape corrections and their shapes --------------------------------

  // The coast build applies these two from their shapes; without one a record does nothing.
  const drawnOps = new Set(['add-water', 'remove-water'])
  const changes = new Map(ds.landscapeChanges.map((c) => [c.id, c]))
  for (const c of ds.landscapeChanges) {
    const g = ds.geometry.landscapeChanges.get(c.id)
    if (!g) {
      if (drawnOps.has(c.op))
        error(
          'missing-geometry',
          c,
          `${c.op} "${c.id}" has no feature in geometry/landscape-changes.geojson`,
        )
      continue
    }
    for (const p of ringProblems(g))
      error('geometry', c, `polygon ${p.polygon}, ring ${p.ring}: ${p.problem}`)
  }
  for (const id of ds.geometry.landscapeChanges.keys()) {
    if (!changes.has(id)) {
      error(
        'orphan-geometry',
        `geometry/landscape-changes.geojson (${id})`,
        `a shape for no landscape change "${id}"`,
      )
    }
  }
  // A place standing in water the map restores is either misplaced or the shore is:
  // the coast was drawn from reconstructions, and the places are where the sources
  // put the thing itself, so neither wins by default.
  const waters = ds.landscapeChanges.filter(
    (c) => c.op === 'add-water' && ds.geometry.landscapeChanges.has(c.id),
  )
  for (const p of ds.places) {
    if (p.kind === 'river' || p.kind === 'road' || p.kind === 'street') continue
    for (const c of waters) {
      if (!geometryContains(ds.geometry.landscapeChanges.get(c.id)!, p.location)) continue
      if (sane.has(p) && sane.has(c) && !mayOverlap(p, c)) continue
      warn('place-in-water', p, `stands in water that landscape change "${c.id}" restores`)
    }
  }

  // --- polities that nothing draws -------------------------------------------

  for (const p of ds.polities) {
    const drawn =
      ds.claims.some((c) => c.polity === p.id) ||
      ds.seats.some((s) => s.polity === p.id) ||
      ds.relations.some((r) => r.of === p.id)
    if (!drawn)
      warn('undrawn-polity', p, `polity "${p.id}" has no claim, seat or dependant`)
  }

  // --- names -----------------------------------------------------------------

  const byTarget = new Map<string, typeof ds.names>()
  for (const n of ds.names) {
    const k = `${n.target.kind}:${n.target.id}`
    byTarget.set(k, [...(byTarget.get(k) ?? []), n])
  }
  for (const [k, names] of byTarget) {
    const preferred = names.filter((n) => n.preferred)
    if (!preferred.length) warn('no-preferred-name', k, `${k} has no preferred name`)
  }
  overlapping(
    ds.names.filter((n) => n.preferred),
    (n) => `${n.target.kind}:${n.target.id}\u0000${n.lang ?? ''}`,
    (k) => `two preferred names for ${k.split('\u0000')[0]}`,
    'warning',
    'name-overlap',
  )

  return issues
}

// --- evidence ------------------------------------------------------------------

/** Fields that only describe the record itself, which no passage is cited for. */
const OWN_FIELDS = new Set(['id', 'sources', 'confidence', 'review', 'note', 'names'])

/** Whether a record has this field, filled in: a citation can only support what it says. */
function hasField(r: object, f: string): boolean {
  const v = (r as Record<string, unknown>)[f]
  return !OWN_FIELDS.has(f) && v !== undefined && !(Array.isArray(v) && !v.length)
}

/**
 * The fields of each kind of record that say something happened, which the
 * research rule asks a quote for (research/README.md). Where a record leaves one
 * out, it isn't asked for.
 */
type RecordKind =
  | 'atoms'
  | 'polities'
  | 'claims'
  | 'relations'
  | 'seats'
  | 'places'
  | 'routes'
  | 'roadCorrections'
  | 'landscapeChanges'
  | 'features'

const STATED: Record<RecordKind, string[]> = {
  atoms: ['construction'],
  polities: ['kind', 'from', 'to', 'ruler'],
  claims: ['polity', 'relation', 'from', 'to'],
  relations: ['type', 'of', 'from', 'to'],
  seats: ['place', 'from', 'to'],
  places: ['location', 'from', 'to', 'status', 'condition'],
  routes: ['from', 'to'],
  roadCorrections: ['from', 'to'],
  landscapeChanges: ['op', 'from', 'to'],
  features: ['from', 'to'],
}

export interface EvidenceReport {
  /** Every stated field has a quote, found in its text, that supports it. */
  backed: number
  /** Some do. */
  partly: number
  /** Which records those are, and the fields still without a quote. */
  gaps: { where: string; fields: string[] }[]
  /** None do: no quoted citation yet. */
  unresearched: number
  /** Cited only to datasets, which back geometry and positions, not events. */
  datasets: number
  quotes: { found: number; unread: number }
}

export function evidence(ds: Dataset): EvidenceReport {
  const byId = new Map(ds.sources.map((s) => [s.id, s]))
  const out: EvidenceReport = {
    backed: 0,
    partly: 0,
    gaps: [],
    unresearched: 0,
    datasets: 0,
    quotes: { found: 0, unread: 0 },
  }
  const counted = new Set<SourceRef>()
  for (const [kind, fields] of Object.entries(STATED) as [RecordKind, string[]][]) {
    for (const r of ds[kind] as (object & Sourced)[]) {
      if (r.sources.every((s) => byId.get(s.source)?.kind === 'dataset')) {
        out.datasets++
        continue
      }
      const backed = new Set<string>()
      for (const s of r.sources) {
        if (!s.quote) continue
        const q = checkQuote(s, byId.get(s.source))
        if (!counted.has(s)) {
          counted.add(s)
          if (q.status === 'found') out.quotes.found++
          if (q.status === 'unread') out.quotes.unread++
        }
        if (q.status === 'found') for (const f of s.supports ?? []) backed.add(f)
      }
      const asked = fields.filter((f) => hasField(r, f))
      const got = asked.filter((f) => backed.has(f)).length
      if (got && got === asked.length) out.backed++
      else if (got) {
        out.partly++
        out.gaps.push({
          where: ds.origin.get(r) ?? '(unknown)',
          fields: asked.filter((f) => !backed.has(f)),
        })
      } else out.unresearched++
    }
  }
  return out
}

// --- the doubt report ----------------------------------------------------------

export interface Doubt {
  where: string
  why?: string
}

export interface DoubtReport {
  needsCheck: Doubt[]
  uncertain: Doubt[]
  /** Rules DESIGN §5.6 asks for that this validator cannot yet check, said out loud. */
  notChecked: string[]
  counts: Record<string, number>
  /** The earliest and latest dated (not open) claim endpoint: the span the data actually pins down. */
  claimYears: string | null
}

/** The first sentence of a note, which is where the reason usually is. */
const firstSentence = (s?: string) => {
  if (!s) return undefined
  const flat = s.replace(/\s+/g, ' ').trim()
  // A full stop followed by a capital, and not after an abbreviation such as
  // "c." or "P." — a one- or two-letter word.
  const m = /^(.{20,}?[^\s.]{3}[.)])\s+(?=[A-Z(])/.exec(flat)
  const out = m ? m[1] : flat
  return out.length > 160 ? `${out.slice(0, 157)}…` : out
}

/** Prefers the migration reviewer's sentence when there is one — it says what to look at. */
const reason = (note?: string) => {
  if (!note) return undefined
  const i = note.indexOf('Migration review:')
  return firstSentence(i >= 0 ? note.slice(i) : note)
}

export function doubts(ds: Dataset): DoubtReport {
  const where = (r: object) => ds.origin.get(r) ?? '(unknown)'
  const reviewed: (object & Reviewed & Sourced)[] = [
    ...ds.atoms,
    ...ds.polities,
    ...ds.claims,
    ...ds.relations,
    ...ds.seats,
    ...ds.places,
    ...ds.routes,
    ...ds.roadCorrections,
    ...ds.landscapeChanges,
    ...ds.features,
  ]
  const years = ds.claims.flatMap((c) => [c.from, c.to])
  const bounded = years.filter((e) => !e.open).map((e) => e.year)
  return {
    needsCheck: reviewed
      .filter((r) => r.review === 'needs-check')
      .map((r) => ({ where: where(r), why: reason(r.note) })),
    uncertain: reviewed
      .filter((r) => r.confidence === 'uncertain')
      .map((r) => ({ where: where(r), why: reason(r.note) })),
    notChecked: [
      'atom geometry against its construction: that data/geometry/atoms.geojson is what npm run atoms -w pipeline builds from atoms.yaml is not re-checked here; rebuild after editing an outline',
      'vertex places: that a vertex naming a Pleiades place stands near it is checked by npm run atoms, not here',
      'places against Pleiades: ids and positions are taken as recorded and are not re-fetched',
    ],
    counts: {
      sources: ds.sources.length,
      atoms: ds.atoms.length,
      'atom shapes': ds.geometry.atoms.size,
      'feature shapes': ds.geometry.features.size,
      polities: ds.polities.length,
      claims: ds.claims.length,
      relations: ds.relations.length,
      seats: ds.seats.length,
      places: ds.places.length,
      names: ds.names.length,
      routes: ds.routes.length,
      'road corrections': ds.roadCorrections.length,
      'landscape changes': ds.landscapeChanges.length,
      features: ds.features.length,
    },
    claimYears: bounded.length
      ? `${formatYear(Math.min(...bounded))} – ${formatYear(Math.max(...bounded))}`
      : null,
  }
}
