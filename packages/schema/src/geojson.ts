/**
 * The GeoJSON the data files hold: lon/lat (RFC 7946), features keyed by our
 * own ids. Only shape is checked here; winding, closure and "is this really
 * lon/lat" are the pipeline's job (pipeline/src/geo.ts), because a zod error on
 * the ten-thousandth vertex of Macedonia is not a useful message.
 */
import { z } from 'zod'
import { SlugSchema } from './common.ts'

const Position = z.tuple([z.number(), z.number()])
const Ring = z.array(Position).min(4)

export const PolygonSchema = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.array(Ring).min(1),
})
export const MultiPolygonSchema = z.strictObject({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(Ring).min(1)).min(1),
})
export const LineStringSchema = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(Position).min(2),
})
export const MultiLineStringSchema = z.strictObject({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(Position).min(2)).min(1),
})

export const AreaGeometrySchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
])
export type AreaGeometry = z.infer<typeof AreaGeometrySchema>

export const AnyGeometrySchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
  LineStringSchema,
  MultiLineStringSchema,
])

/** A feature whose `id` is the record id it gives a shape to. */
export const keyedFeature = <G extends z.ZodType>(geometry: G) =>
  z.object({
    type: z.literal('Feature'),
    id: SlugSchema,
    properties: z.record(z.string(), z.unknown()).nullable(),
    geometry,
  })

export const keyedCollection = <G extends z.ZodType>(geometry: G) =>
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(keyedFeature(geometry)),
  })

/** data/geometry/atoms.geojson */
export const AtomGeometrySchema = keyedCollection(AreaGeometrySchema)
export type AtomGeometry = z.infer<typeof AtomGeometrySchema>

/**
 * data/geometry/landscape-changes.geojson: the area each landscape correction covers.
 * Written by the generators in pipeline/src/landscape, each of which owns its own ids.
 */
export const LandscapeChangeGeometrySchema = keyedCollection(AreaGeometrySchema)

/**
 * Properties a feature's shape may carry. `discharge` (m³/s) is a rough mean
 * flow for river lines, used only to size the line on the map; the record's
 * note says where it came from. `derivation` records how a derived shape was
 * made (tool, date, thresholds).
 */
export const FeaturePropertiesSchema = z
  .strictObject({
    discharge: z.number().positive().optional(),
    /**
     * For a MultiLineString river, one flag per part: true where the course is our
     * interpolation between attested sites rather than a channel on the ground. Drawn
     * fainter, so a guess never reads as a survey.
     */
    reconstructed: z.array(z.boolean()).optional(),
    /**
     * A river line surveyed more closely than HydroRIVERS' modern channel it follows
     * (OpenStreetMap's, rivers/fetch.ts): the rivers build draws it in place of the
     * modern reaches along it and joins their tributaries to it.
     */
    replacesModern: z.boolean().optional(),
    derivation: z.string().optional(),
  })
  .nullable()

/** data/geometry/features.geojson: areas for floodplains, lakes, marshes and plains; lines for rivers and for the courses of water names. */
export const FeatureGeometrySchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: SlugSchema,
      properties: FeaturePropertiesSchema,
      geometry: AnyGeometrySchema,
    }),
  ),
})
export type FeatureGeometry = z.infer<typeof FeatureGeometrySchema>
export type AnyGeometry = z.infer<typeof AnyGeometrySchema>

/**
 * Which geometry each feature kind takes. Kinds not listed carry no shape yet. For
 * water — seas, gulfs, straits — the line is the course the name is lettered along,
 * not an extent: the coast mask draws the water itself.
 */
export const FEATURE_GEOMETRY_KIND = {
  floodplain: 'area',
  lake: 'area',
  sea: 'line',
  gulf: 'line',
  strait: 'line',
  marsh: 'area',
  plain: 'area',
  river: 'line',
} as const
