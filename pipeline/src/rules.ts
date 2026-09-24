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
} from '@roman-map/schema'
import { contains as geometryContains, overlapArea, ringProblems } from './geo.ts'
import type { Dataset, Issue } from './load.ts'
import { passageUrl } from './passages/passage.ts'
import { WORKS } from './passages/works.ts'

type Dated = { from: Endpoint; to: Endpoint }
type Sourced = { sources: { source: string; locator?: string }[] }
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
    ...ds.landscapeChanges,
    ...ds.features,
    ...ds.names,
  ]
  for (const r of sourced) {
    // The schema requires at least one source; this catches records built in
    // code (fixtures, migrations) that bypassed it.
    if (!r.sources.length)
      error('no-source', r, 'a historical record needs at least one source')
    for (const s of r.sources) {
      cited.add(s.source)
      if (!sources.has(s.source))
        error('missing-source', r, `cites unknown source "${s.source}"`)
      // A text we can link into, cited somewhere its page has no place for: a typo,
      // a numbering the page doesn't use, or an anchor list that needs a re-fetch.
      else if (s.locator && WORKS[s.source] && !passageUrl(s.source, s.locator))
        warn('unlinked-passage', r, `${s.source} ${s.locator}: no passage to link to (src/passages)`)
    }
  }
  for (const s of ds.sources) {
    if (!cited.has(s.id) && !s.usedBy) warn('unused-source', s, `source "${s.id}" is never cited`)
  }

  // --- intervals -------------------------------------------------------------

  const dated: (object & Dated)[] = [
    ...ds.polities,
    ...ds.claims,
    ...ds.relations,
    ...ds.seats,
    ...ds.places,
    ...ds.routes,
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
    for (const d of [...p.prominence, ...p.status]) {
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
        error('atom-overlap', b, `atom "${b.id}" overlaps "${a.id}" by ${km2.toFixed(1)} km²`)
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
    const expected = (FEATURE_GEOMETRY_KIND as Record<string, 'area' | 'line' | undefined>)[f.kind]
    if (!shape) {
      // Floodplains and rivers are drawn from their shapes; without one they are invisible.
      if (f.kind === 'floodplain' || f.kind === 'river')
        error('missing-geometry', f, `${f.kind} "${f.id}" has no feature in geometry/features.geojson`)
      continue
    }
    const g = shape.geometry
    const got = g.type === 'Polygon' || g.type === 'MultiPolygon' ? 'area' : 'line'
    if (!expected) {
      error('geometry-kind', f, `a ${f.kind} takes no shape, but geometry/features.geojson has a ${g.type}`)
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
      const bad = lines.flat().find(([x, y]) => !(x >= -180 && x <= 180 && y >= -90 && y <= 90))
      if (bad) error('geometry', f, `position [${bad}] is not lon/lat — projected coordinates?`)
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
      'places against Pleiades: ids and positions are as cicero-map resolved them and are not re-fetched',
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
      'landscape changes': ds.landscapeChanges.length,
      features: ds.features.length,
    },
    claimYears: bounded.length
      ? `${formatYear(Math.min(...bounded))} – ${formatYear(Math.max(...bounded))}`
      : null,
  }
}
