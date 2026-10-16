/**
 * Reads data/ into typed, time-normalised records. Every build step starts
 * here, so every build step sees the same thing the validator checked.
 *
 * Layout (DESIGN §5.6): one YAML file per entity type, `<entity>.yaml`, which
 * may be split by region into `<entity>/*.yaml` once it grows — both are read
 * and concatenated. Each file is a YAML sequence of records. Geometry is
 * GeoJSON under data/geometry/, keyed by record id.
 *
 * Parsing goes through packages/schema, so era strings arrive as astronomical
 * endpoints and shorthand arrives expanded. Nothing is silently dropped: a
 * record that fails its schema is reported and left out of the dataset, and
 * `loadDataset` refuses to return a dataset that had any.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { z } from 'zod'
import {
  AtomGeometrySchema,
  LandscapeChangeGeometrySchema,
  FeatureGeometrySchema,
  AtomSchema,
  ClaimSchema,
  FeatureSchema,
  LandscapeChangeSchema,
  PlaceSchema,
  PolitySchema,
  RelationSchema,
  SeatSchema,
  SourceSchema,
  type AnyGeometry,
  type AreaGeometry,
  type Atom,
  type Claim,
  type Feature,
  type LandscapeChange,
  type NameRecord,
  type NameTarget,
  type Place,
  type Polity,
  type Relation,
  type RoadCorrection,
  type Route,
  type Seat,
  type Source,
  RoadCorrectionSchema,
  RouteSchema,
} from '@roma-cognita/schema'

/** The repository root. */
export const ROOT_DIR = resolve(import.meta.dirname, '../..')
export const DATA_DIR = join(ROOT_DIR, 'data')
/** Downloaded sources, gitignored: each build fetches or unzips into it once. */
export const CACHE_DIR = join(ROOT_DIR, '.cache/sources')

export interface Issue {
  level: 'error' | 'warning'
  /** A short stable name for the rule, so a report can be grouped and grepped. */
  rule: string
  /** `claims.yaml#12 (cyprus → cilicia)` */
  where: string
  message: string
}

export interface Dataset {
  sources: Source[]
  atoms: Atom[]
  polities: Polity[]
  claims: Claim[]
  relations: Relation[]
  seats: Seat[]
  places: Place[]
  routes: Route[]
  /** Corrections to Itiner-e's dating of its lines (road-corrections.yaml). */
  roadCorrections: RoadCorrection[]
  landscapeChanges: LandscapeChange[]
  features: Feature[]
  /** Every inline name, flattened into the `name` entity with inherited dates and sources. */
  names: NameRecord[]
  geometry: {
    atoms: Map<string, AreaGeometry>
    /** data/geometry/features.geojson, keyed by feature id. */
    features: Map<string, FeatureShape>
    /** data/geometry/landscape-changes.geojson, keyed by landscape-change id. */
    landscapeChanges: Map<string, AreaGeometry>
  }
  /** Where each record came from, for messages: `claims.yaml#3`. Keyed by the record object. */
  origin: WeakMap<object, string>
}

/** A feature's shape and the properties it carries (`discharge` for river lines). */
export interface FeatureShape {
  geometry: AnyGeometry
  properties: { discharge?: number; derivation?: string } | null
}

/** Every entity file, its schema, and whether the dataset is incomplete without it. */
const ENTITIES = {
  sources: { file: 'sources', schema: SourceSchema, required: true },
  atoms: { file: 'atoms', schema: AtomSchema, required: true },
  polities: { file: 'polities', schema: PolitySchema, required: true },
  claims: { file: 'claims', schema: ClaimSchema, required: true },
  relations: { file: 'relations', schema: RelationSchema, required: false },
  seats: { file: 'seats', schema: SeatSchema, required: false },
  places: { file: 'places', schema: PlaceSchema, required: false },
  routes: { file: 'routes', schema: RouteSchema, required: false },
  roadCorrections: {
    file: 'road-corrections',
    schema: RoadCorrectionSchema,
    required: false,
  },
  landscapeChanges: {
    file: 'landscape-changes',
    schema: LandscapeChangeSchema,
    required: false,
  },
  features: { file: 'features', schema: FeatureSchema, required: false },
} as const

type EntityKey = keyof typeof ENTITIES

/** `<name>.yaml` plus anything under `<name>/`, in a stable order. */
function filesFor(dir: string, name: string): string[] {
  const out: string[] = []
  const single = join(dir, `${name}.yaml`)
  if (existsSync(single)) out.push(single)
  const sub = join(dir, name)
  if (existsSync(sub) && statSync(sub).isDirectory()) {
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.ya?ml$/.test(e.name)) out.push(p)
      }
    }
    walk(sub)
  }
  return out
}

const label = (raw: unknown): string => {
  if (!raw || typeof raw !== 'object') return ''
  const r = raw as Record<string, unknown>
  if (typeof r.id === 'string') return ` (${r.id})`
  if (typeof r.atom === 'string') return ` (${r.atom} → ${r.polity})`
  if (typeof r.polity === 'string' && typeof r.of === 'string')
    return ` (${r.polity} ${r.type} ${r.of})`
  if (typeof r.polity === 'string') return ` (${r.polity} at ${r.place})`
  return ''
}

const formatPath = (path: PropertyKey[]) =>
  path.length
    ? path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('')
    : ''

function readEntity<S extends z.ZodType>(
  dir: string,
  key: EntityKey,
  schema: S,
  required: boolean,
  origin: WeakMap<object, string>,
  issues: Issue[],
): z.output<S>[] {
  const { file } = ENTITIES[key]
  const files = filesFor(dir, file)
  if (!files.length && required) {
    issues.push({
      level: 'error',
      rule: 'missing-file',
      where: `${file}.yaml`,
      message: `no ${file}.yaml or ${file}/ under ${dir}`,
    })
  }
  const out: z.output<S>[] = []
  for (const path of files) {
    const rel = relative(dir, path)
    let doc: unknown
    try {
      doc = parseYaml(readFileSync(path, 'utf8'), { prettyErrors: true })
    } catch (err) {
      issues.push({
        level: 'error',
        rule: 'yaml',
        where: rel,
        message: (err as Error).message,
      })
      continue
    }
    if (doc === null || doc === undefined) continue
    if (!Array.isArray(doc)) {
      issues.push({
        level: 'error',
        rule: 'yaml',
        where: rel,
        message: 'a data file is a YAML sequence of records',
      })
      continue
    }
    doc.forEach((raw, i) => {
      const where = `${rel}#${i + 1}${label(raw)}`
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          issues.push({
            level: 'error',
            rule: 'schema',
            where,
            message: `${formatPath(iss.path).replace(/^\./, '') || '(record)'}: ${iss.message}`,
          })
        }
        return
      }
      const rec = parsed.data as z.output<S> & object
      origin.set(rec, where)
      out.push(rec)
    })
  }
  return out
}

function readGeoJson<S extends z.ZodType<{ features: { id: string }[] }>>(
  dir: string,
  file: string,
  required: boolean,
  schema: S,
  issues: Issue[],
): z.output<S> | null {
  const path = join(dir, 'geometry', file)
  const where = `geometry/${file}`
  if (!existsSync(path)) {
    if (required)
      issues.push({ level: 'error', rule: 'missing-file', where, message: `no ${where}` })
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    issues.push({ level: 'error', rule: 'geojson', where, message: (err as Error).message })
    return null
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    for (const iss of parsed.error.issues.slice(0, 10)) {
      issues.push({
        level: 'error',
        rule: 'geojson',
        where: `${where}${formatPath(iss.path)}`,
        message: iss.message,
      })
    }
    return null
  }
  const seen = new Set<string>()
  for (const f of (parsed.data as { features: { id: string }[] }).features) {
    if (seen.has(f.id)) {
      issues.push({
        level: 'error',
        rule: 'duplicate-id',
        where: `${where} (${f.id})`,
        message: 'two shapes for one id',
      })
    }
    seen.add(f.id)
  }
  return parsed.data as z.output<S>
}

function readAtomGeometry(dir: string, issues: Issue[]): Map<string, AreaGeometry> {
  const data = readGeoJson(dir, 'atoms.geojson', true, AtomGeometrySchema, issues)
  return new Map((data?.features ?? []).map((f) => [f.id, f.geometry]))
}

/** Optional: a dataset with no physical features has no features.geojson. */
function readFeatureGeometry(dir: string, issues: Issue[]): Map<string, FeatureShape> {
  const data = readGeoJson(dir, 'features.geojson', false, FeatureGeometrySchema, issues)
  return new Map(
    (data?.features ?? []).map((f) => [f.id, { geometry: f.geometry, properties: f.properties }]),
  )
}

/** Optional: a dataset with no landscape corrections has no landscape-changes.geojson. */
function readLandscapeGeometry(dir: string, issues: Issue[]): Map<string, AreaGeometry> {
  const data = readGeoJson(dir, 'landscape-changes.geojson', false, LandscapeChangeGeometrySchema, issues)
  return new Map((data?.features ?? []).map((f) => [f.id, f.geometry]))
}

/** Flattens inline names, filling in what each inherits from the record it names. */
function flattenNames(
  kind: NameTarget['kind'],
  records: (Polity | Place | Feature)[],
  origin: WeakMap<object, string>,
): NameRecord[] {
  const out: NameRecord[] = []
  for (const r of records) {
    for (const n of r.names) {
      const rec: NameRecord = {
        target: { kind, id: r.id },
        text: n.text,
        lang: n.lang,
        preferred: n.preferred ?? false,
        from: n.from ?? r.from,
        to: n.to ?? r.to,
        sources: n.sources ?? r.sources,
        note: n.note,
      }
      origin.set(rec, `${origin.get(r)} name "${n.text}"`)
      out.push(rec)
    }
  }
  return out
}

/** Reads everything and reports every schema problem, without deciding whether that is fatal. */
export function readDataset(dir: string = DATA_DIR): { dataset: Dataset; issues: Issue[] } {
  const issues: Issue[] = []
  const origin = new WeakMap<object, string>()
  const read = <K extends EntityKey>(key: K) =>
    readEntity(dir, key, ENTITIES[key].schema, ENTITIES[key].required, origin, issues)

  const polities = read('polities') as Polity[]
  const places = read('places') as Place[]
  const features = read('features') as Feature[]
  const dataset: Dataset = {
    sources: read('sources') as Source[],
    atoms: read('atoms') as Atom[],
    polities,
    claims: read('claims') as Claim[],
    relations: read('relations') as Relation[],
    seats: read('seats') as Seat[],
    places,
    routes: read('routes') as Route[],
    roadCorrections: read('roadCorrections') as RoadCorrection[],
    landscapeChanges: read('landscapeChanges') as LandscapeChange[],
    features,
    names: [
      ...flattenNames('polity', polities, origin),
      ...flattenNames('place', places, origin),
      ...flattenNames('feature', features, origin),
    ],
    geometry: {
      atoms: readAtomGeometry(dir, issues),
      features: readFeatureGeometry(dir, issues),
      landscapeChanges: readLandscapeGeometry(dir, issues),
    },
    origin,
  }
  return { dataset, issues }
}

/**
 * The loader later build steps use: the dataset, or an exception listing every
 * schema error. Cross-record rules are the validator's job (rules.ts); a build
 * that wants them too should call `checkDataset`.
 */
export function loadDataset(dir: string = DATA_DIR): Dataset {
  const { dataset, issues } = readDataset(dir)
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length) {
    const lines = errors.slice(0, 20).map((e) => `  ${e.where}: ${e.message}`)
    if (errors.length > 20) lines.push(`  … and ${errors.length - 20} more`)
    throw new Error(`data/ does not load — run npm run data:validate\n${lines.join('\n')}`)
  }
  return dataset
}
