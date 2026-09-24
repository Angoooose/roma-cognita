/**
 * How DPRR's "provinces" line up with our polities (PEOPLE.md §3.1, phase 2):
 * data/dprr-provinces.yaml, one entry per DPRR province name.
 *
 * DPRR's 92 provinces are not all ground. Only a `territory` is joined to polities,
 * and only its governors and their staff appear in a province's inspector. The table
 * is our own work, so it lives in data/ under our licence: it refers to DPRR by its
 * province names and copies nothing else from it (PEOPLE.md §2).
 */
import { z } from 'zod'
import { ConfidenceSchema, ReviewSchema, SlugSchema, SourceRefSchema } from './common.ts'
import { EndSchema, StartSchema } from './time.ts'

export const DprrProvinceKindSchema = z.enum([
  /** Ground we draw as a polity: Asia, Cilicia. */
  'territory',
  /** A part of Italy (Samnium, Etruria), inside a polity we draw whole. */
  'region',
  /** A single city or its district: Capua, Tarentum. */
  'city',
  /** A standing court at Rome: repetundae, de vi. */
  'court',
  /** A praetor's jurisdiction at Rome: urbanus, inter peregrinos, Rome itself. */
  'jurisdiction',
  /** A command without fixed ground: the fleet, the Mediterranean, "in the east". */
  'command',
  /** A name too broad to place on one polity: Hispania, Gallia. */
  'vague',
])
export type DprrProvinceKind = z.infer<typeof DprrProvinceKindSchema>

export const DprrProvinceSchema = z
  .strictObject({
    /** DPRR's province name, exactly as DPRR spells it. */
    dprr: z.string().min(1),
    kind: DprrProvinceKindSchema,
    /**
     * The polities a territory stands for, each over the years it does. No dates
     * means whenever both exist. More than one entry at once means the post covered
     * all of them.
     */
    polities: z
      .array(
        z.strictObject({
          polity: SlugSchema,
          from: StartSchema.optional(),
          to: EndSchema.optional(),
          /**
           * How sure this one join is, where it is less sure than the name's others:
           * `uncertain` marks everyone it brings to the polity as uncertain there.
           */
          confidence: ConfidenceSchema.optional(),
          note: z.string().optional(),
        }),
      )
      .default([]),
    /** Needed wherever the join is more than the same name: a date, a merger, a choice. */
    sources: z.array(SourceRefSchema).optional(),
    confidence: ConfidenceSchema,
    review: ReviewSchema,
    note: z.string().optional(),
  })
  .refine((p) => p.kind === 'territory' || p.polities.length === 0, {
    message: 'only a territory is joined to polities',
    path: ['polities'],
  })
  .refine((p) => p.kind !== 'territory' || p.polities.length > 0, {
    message: 'a territory needs at least one polity',
    path: ['polities'],
  })
export type DprrProvince = z.output<typeof DprrProvinceSchema>
