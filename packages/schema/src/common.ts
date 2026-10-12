import { z } from 'zod'

/**
 * Our own stable ids: lowercase slugs, never array positions and never an
 * upstream file's ids (AWMC's OBJECTIDs are renumbered between releases).
 */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ids are lowercase slugs, e.g. "hispania-citerior"')

/** A Pleiades place id, as the digits of its URI (`https://pleiades.stoa.org/places/423025`). */
export const PleiadesIdSchema = z
  .string()
  .regex(/^\d+$/, 'a Pleiades id is the number from the place URI, as a string')

/** How firmly the sources support the record. This is drawn. */
export const ConfidenceSchema = z.enum(['certain', 'probable', 'uncertain'])
export type Confidence = z.infer<typeof ConfidenceSchema>

/** The state of our own work on the record. Reported by the build, never drawn. */
export const ReviewSchema = z.enum(['verified', 'draft', 'needs-check'])
export type Review = z.infer<typeof ReviewSchema>

/**
 * A citation: a source id from data/sources.yaml, plus where in it (page, map,
 * fragment). A citation with a `quote` names one passage and was read
 * (research/README.md); one without backs nothing and stands as further reading.
 */
export const SourceRefSchema = z
  .strictObject({
    source: SlugSchema,
    locator: z.string().min(1).optional(),
    /** The words relied on, copied from the text; `…` marks a cut. The validator finds them in it. */
    quote: z.string().min(1).optional(),
    /** The record's fields this passage states. `[]`: cited for context. */
    supports: z.array(z.string().min(1)).optional(),
    /**
     * The page the quote was read on, when it is not the passage the locator
     * links to: a scan's full text, an article's PDF.
     */
    url: z.url().optional(),
  })
  .refine((s) => !s.supports?.length || s.quote, {
    message: 'a citation that supports a field needs the quote it rests on',
    path: ['supports'],
  })
export type SourceRef = z.infer<typeof SourceRefSchema>

/** WGS84 longitude, latitude — the only coordinates the data files ever hold. */
export const LonLatSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
])
export type LonLat = z.infer<typeof LonLatSchema>

/**
 * The fields every historical record carries (DESIGN §5.3). `sources` is
 * required and non-empty: a claim nobody can look up is not a claim.
 */
export const historical = {
  sources: z.array(SourceRefSchema).min(1, 'every historical record needs a source'),
  confidence: ConfidenceSchema,
  review: ReviewSchema,
  note: z.string().optional(),
}
