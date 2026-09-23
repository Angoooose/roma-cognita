/**
 * The records of DESIGN §5.1. Each schema parses the authored YAML and yields
 * the normalised form: era strings become astronomical endpoints (time.ts),
 * shorthand becomes the full dated list. `z.input<>` is what an author writes;
 * `z.output<>` is what the pipeline and engine read.
 *
 * Geometry never lives here. Atoms, routes, landscape changes and physical
 * features carry their shapes in GeoJSON under data/geometry/, keyed by the
 * same ids (§5.6).
 */
import { z } from 'zod'
import {
  historical,
  LonLatSchema,
  PleiadesIdSchema,
  SlugSchema,
  SourceRefSchema,
} from './common.ts'
import { EndSchema, StartSchema, intervalFields, type Endpoint } from './time.ts'

// --- source ------------------------------------------------------------------

export const SourceSchema = z
  .strictObject({
    id: SlugSchema,
    /** `ancient`: a text from antiquity. `modern`: scholarship, atlases. `dataset`: machine-readable data we ingest. */
    kind: z.enum(['ancient', 'modern', 'dataset']),
    citation: z.string().min(1),
    url: z.url().optional(),
    /** Required for datasets: the attribution screen and any re-licensing build are generated from it. */
    licence: z.string().min(1).optional(),
    /**
     * For a dataset a build reads directly, with no record between (Itiner-e's roads):
     * the pipeline step that uses it. Stands in for a citation.
     */
    usedBy: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .refine((s) => s.kind !== 'dataset' || s.licence, {
    message: 'a dataset source must state its licence',
    path: ['licence'],
  })
export type Source = z.output<typeof SourceSchema>

// --- name --------------------------------------------------------------------

/**
 * A dated, language-tagged name, written inline on the record it names. A name
 * with no dates inherits its target's interval; one with no sources inherits
 * its target's. The loader flattens these into `NameRecord`s.
 */
export const NameSchema = z.strictObject({
  text: z.string().min(1),
  /** BCP 47: `la`, `grc`, `grc-Latn`. Omitted where nobody has yet recorded it. */
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a BCP 47 tag such as "la" or "grc"')
    .optional(),
  preferred: z.boolean().optional(),
  from: StartSchema.optional(),
  to: EndSchema.optional(),
  sources: z.array(SourceRefSchema).min(1).optional(),
  note: z.string().optional(),
})
export type Name = z.output<typeof NameSchema>

export type NameTarget = { kind: 'polity' | 'place' | 'feature'; id: string }

/** The flattened `name` entity of §5.1, with every inherited field filled in. */
export interface NameRecord {
  target: NameTarget
  text: string
  lang?: string
  preferred: boolean
  from: Endpoint
  to: Endpoint
  sources: z.output<typeof SourceRefSchema>[]
  note?: string
}

// --- atom --------------------------------------------------------------------

/**
 * One vertex of an outline, and how the frontier reaches it from the vertex
 * before. A bare `[lon, lat]` is a routing point joined by a straight line: out
 * over the sea, where the coast will cut it, or across ground where the
 * frontier is a convention and a straight line says so.
 */
export const LegSchema = z.union([
  LonLatSchema,
  z.strictObject({
    at: LonLatSchema,
    /**
     * `line` (the default): straight from the previous vertex.
     * `river`: down or up the modern main channel (HydroRIVERS) from the previous
     *   vertex to this one — for a frontier the sources put on a river.
     * `crest`: along the ridge in the DEM from the previous vertex to this one —
     *   for a frontier the sources put on a watershed or a range.
     * `curve`: a smooth curve through this run of `curve` vertices, for a zone
     *   whose edge nobody surveyed; it passes through every vertex.
     */
    via: z.enum(['line', 'river', 'crest', 'curve']).optional(),
    /** The Pleiades place the vertex stands on, if it is one; the build checks it is near. */
    pleiades: PleiadesIdSchema.optional(),
    /** What the vertex is: "Rubicon mouth", "Saltus Castulonensis". */
    note: z.string().optional(),
  }),
])
export type Leg = z.infer<typeof LegSchema>

/**
 * How an atom's outline is made, so the pipeline can rebuild it from its parts
 * (npm run atoms -w pipeline) without re-deciding anything. Every outline is
 * drawn out over the sea and clipped to land, so the coast is exact and only the
 * inland frontier is authored; then the atoms earlier in atoms.yaml are cut out
 * of it, so a frontier two atoms share is drawn once, by the earlier one, and
 * the later one is drawn to overlap it.
 */
export const ConstructionSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('outline'),
    /** The frontier, vertex by vertex, closed back to the first. */
    edge: z.array(LegSchema).min(3),
  }),
  z.strictObject({
    method: z.literal('box'),
    /** West, south, east, north: an island, whose coast is its boundary. */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
])

export const AtomSchema = z.strictObject({
  id: SlugSchema,
  /**
   * How far the outline can be trusted, which sets how its borders are drawn:
   * `surveyed` solid, `derived` lighter, `schematic` a soft band with a dashed core.
   */
  evidence: z.enum(['surveyed', 'derived', 'schematic']),
  /** Set when this atom is a child of a split (§5.5); claims on the parent were rewritten onto it. */
  splitFrom: SlugSchema.optional(),
  /** The atom is the union of these parts — Hispania Citerior is the mainland outline plus a box round the Baliares. */
  construction: z.array(ConstructionSchema).min(1),
  /** Overrides where a polity's name hangs on this ground. The pipeline checks it stays inside. */
  anchor: z.strictObject({ at: LonLatSchema, note: z.string().optional() }).optional(),
  ...historical,
})
export type Atom = z.output<typeof AtomSchema>

// --- polity ------------------------------------------------------------------

export const PolityKindSchema = z.enum([
  'state',
  'province',
  'citizen-territory',
  'kingdom',
  'city-state',
  'league',
  'people',
])

/**
 * A political unit, independent of ground. `kind` says what sort of thing it
 * is; how it stood to Rome is a `relation`, and what ground it held is a
 * `claim`. cicero-map folded all three into one `kind` field.
 */
export const PolitySchema = z.strictObject({
  id: SlugSchema,
  kind: PolityKindSchema,
  names: z.array(NameSchema).min(1),
  ...intervalFields,
  /** Free text until rulers are records of their own. */
  ruler: z.string().optional(),
  ...historical,
})
export type Polity = z.output<typeof PolitySchema>

// --- claim -------------------------------------------------------------------

export const ClaimRelationSchema = z.enum([
  'province',
  'citizen-territory',
  'client',
  'allied',
  'independent',
  'occupied',
])
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>

/**
 * Claims on one atom must not overlap within a layer. Holding and occupation
 * are separate layers: when Parthia overran Syria in 40 BCE the province did
 * not cease to be one, so both rows stand, and the map chooses which to draw.
 */
export const claimLayer = (r: ClaimRelation): 'holding' | 'occupation' =>
  r === 'occupied' ? 'occupation' : 'holding'

/** The time series: this atom, held by this polity, in this way, over these years. */
export const ClaimSchema = z.strictObject({
  atom: SlugSchema,
  polity: SlugSchema,
  relation: ClaimRelationSchema,
  ...intervalFields,
  ...historical,
})
export type Claim = z.output<typeof ClaimSchema>

// --- relation ----------------------------------------------------------------

export const RelationTypeSchema = z.enum([
  'province-of',
  'citizen-territory-of',
  'client-of',
  'allied-to',
  'subject-of',
])

/** A polity-to-polity link over time: `numidia` is `client-of` `rome`. */
export const RelationSchema = z.strictObject({
  polity: SlugSchema,
  type: RelationTypeSchema,
  of: SlugSchema,
  ...intervalFields,
  ...historical,
})
export type Relation = z.output<typeof RelationSchema>

// --- seat --------------------------------------------------------------------

/** A polity drawn as its capital because nobody knows its extent. */
export const SeatSchema = z.strictObject({
  polity: SlugSchema,
  place: SlugSchema,
  ...intervalFields,
  ...historical,
})
export type Seat = z.output<typeof SeatSchema>

// --- place -------------------------------------------------------------------

/**
 * Something that can be written either as a single value holding for the
 * record's whole life, or as a dated list. The single form is what nearly
 * every row needs; the list is there for the colony founded half way through.
 */
const datedValue = <T extends z.ZodType>(value: T) =>
  z.union([
    value,
    z
      .array(z.strictObject({ value, ...intervalFields, note: z.string().optional() }))
      .min(1),
  ])

export const PlaceStatusSchema = z.enum([
  'caput mundi',
  'provincial seat',
  'royal seat',
  'conventus',
  'colonia',
  'municipium',
  'civitas libera',
  'civitas foederata',
  'emporium',
])

/** 1 is the overview; 4 is a plate zoomed into one region. */
export const TierSchema = z.number().int().min(1).max(4)

export interface Dated<T> {
  value: T
  from: Endpoint
  to: Endpoint
  note?: string
}

export const PlaceSchema = z
  .strictObject({
    id: SlugSchema,
    pleiades: PleiadesIdSchema.optional(),
    kind: z.enum(['settlement', 'fort', 'sanctuary', 'pass', 'port', 'villa']),
    location: LonLatSchema,
    names: z.array(NameSchema).min(1),
    ...intervalFields,
    /** How loudly the place is lettered — curated, because Pleiades has no measure of importance. */
    prominence: datedValue(TierSchema).optional(),
    /** Roman civic status or administrative role, which is what a political map ranks by. */
    status: datedValue(PlaceStatusSchema).optional(),
    labelSide: z.enum(['n', 's', 'e', 'w']).optional(),
    ...historical,
  })
  .transform((p) => {
    const expand = <T>(v: T | Dated<T>[] | undefined): Dated<T>[] =>
      v === undefined ? [] : Array.isArray(v) ? v : [{ value: v, from: p.from, to: p.to }]
    return { ...p, prominence: expand(p.prominence), status: expand(p.status) }
  })
export type Place = z.output<typeof PlaceSchema>

// --- route, landscape change, feature (schema only in v1) --------------------

/** A road segment. Only segments with a construction date ship: an undated road cannot move with the timeline. */
export const RouteSchema = z.strictObject({
  id: SlugSchema,
  class: z.enum(['main', 'secondary', 'minor']),
  /** The built interval. */
  ...intervalFields,
  name: z.string().optional(),
  ...historical,
})
export type Route = z.output<typeof RouteSchema>

/** A dated correction to modern physical geography: silted bays, drained lakes, reservoirs. */
export const LandscapeChangeSchema = z.strictObject({
  id: SlugSchema,
  op: z.enum([
    'add-water',
    'remove-water',
    'add-marsh',
    'remove-marsh',
    'remove-reservoir',
    'river-course',
  ]),
  ...intervalFields,
  ...historical,
})
export type LandscapeChange = z.output<typeof LandscapeChangeSchema>

/** A named physical feature. "Always" is still a date range: `before …` to `after …`. */
export const FeatureSchema = z.strictObject({
  id: SlugSchema,
  kind: z.enum([
    'river',
    'mountain',
    'range',
    'cape',
    'sea',
    'gulf',
    'strait',
    'lake',
    'marsh',
    'plain',
    'island',
    /**
     * Ground watered by a great river's flood, drawn green where the river
     * crosses dry land. Its shape is derived offline from terrain
     * (pipeline/src/features/derive-floodplains.ts), never traced.
     */
    'floodplain',
  ]),
  pleiades: PleiadesIdSchema.optional(),
  names: z.array(NameSchema).min(1),
  ...intervalFields,
  ...historical,
})
export type Feature = z.output<typeof FeatureSchema>
